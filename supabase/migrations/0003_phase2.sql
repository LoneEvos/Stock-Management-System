-- ============================================================================
-- 0003 — Phase 2 (Sync Update v2, 13 Jun 2026) — RERUN-SAFE (idempotent)
-- Jalankan SETELAH 0001_init.sql dan 0002_security_hardening.sql.
-- Aman dijalankan berulang: objek yang sudah ada dilewati/diganti identik,
-- backfill me-resync summary ke kebenaran ledger.
--
-- Isi:
--  1. stock_balances: saldo O(1) yang di-maintain trigger dari ledger
--     (ledger tetap satu-satunya sumber kebenaran — saldo bisa diverifikasi
--     ulang kapan pun; pemeriksaan harian membandingkan keduanya).
--  2. Guard saldo non-negatif dibaca dari summary (O(baris insert), bukan SUM).
--  3. Koreksi Entri: entri pembalik ber-correction_of, divalidasi trigger —
--     dibedakan dari penyesuaian opname.
--  4. Kolom reference: bonus/promo/sample WAJIB punya referensi
--     (campaign / approval) untuk entri baru.
--  5. Versioning resep bundle: edit resep = versi baru, order lama tak berubah.
--  6. View dibangun ulang membaca summary + kolom baseline_unverified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SUMMARY SALDO O(1)
-- ---------------------------------------------------------------------------

create table if not exists public.stock_balances (
  product_id  uuid not null references public.products(id),
  batch_id    uuid not null references public.batches(id),
  stock_state public.stock_state not null,
  qty         integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (product_id, batch_id, stock_state)
);

-- Maintenance: setiap INSERT ledger meng-upsert saldo terkait.
-- NAMA trigger penting: 'ledger_apply_summary' < 'ledger_balance_guard'
-- (trigger statement-level AFTER berurutan alfabetis) → summary selalu
-- ter-update SEBELUM guard membacanya.
create or replace function public.trg_ledger_apply_summary() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.stock_balances (product_id, batch_id, stock_state, qty)
  select i.product_id, i.batch_id, i.stock_state, sum(i.qty_delta)::int
  from inserted i
  group by i.product_id, i.batch_id, i.stock_state
  on conflict (product_id, batch_id, stock_state)
  do update set qty = public.stock_balances.qty + excluded.qty,
                updated_at = now();
  return null;
end $$;

drop trigger if exists ledger_apply_summary on public.stock_ledger;
create trigger ledger_apply_summary
  after insert on public.stock_ledger
  referencing new table as inserted
  for each statement execute function public.trg_ledger_apply_summary();

-- Backfill/resync dari ledger (rerun me-reset qty ke kebenaran ledger,
-- tidak menggandakan).
insert into public.stock_balances (product_id, batch_id, stock_state, qty, updated_at)
select product_id, batch_id, stock_state, sum(qty_delta)::int, now()
from public.stock_ledger
group by product_id, batch_id, stock_state
on conflict (product_id, batch_id, stock_state)
do update set qty = excluded.qty, updated_at = now();

-- Akses: baca untuk user login, tanpa tulis lewat API (hanya trigger/server).
alter table public.stock_balances enable row level security;
drop policy if exists select_stock_balances on public.stock_balances;
create policy select_stock_balances on public.stock_balances
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.stock_balances from anon, authenticated;
revoke select on public.stock_balances from anon;

-- ---------------------------------------------------------------------------
-- 2. GUARD SALDO NON-NEGATIF → baca summary (bukan SUM ledger)
-- ---------------------------------------------------------------------------

create or replace function public.trg_ledger_balance_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bad record;
begin
  select sb.product_id, sb.batch_id, sb.stock_state, sb.qty as bal
    into bad
  from public.stock_balances sb
  where (sb.product_id, sb.batch_id, sb.stock_state) in
        (select distinct i.product_id, i.batch_id, i.stock_state from inserted i)
    and sb.qty < 0
  limit 1;

  if found then
    raise exception
      'Saldo stok tidak boleh negatif (product=%, batch=%, state=%, saldo=%)',
      bad.product_id, bad.batch_id, bad.stock_state, bad.bal;
  end if;
  return null;
end $$;

-- Trigger guard dibuat di 0001 dengan fungsi lama (SUM ledger); pastikan
-- terpasang dan memakai fungsi baru di atas (baca summary).
drop trigger if exists ledger_balance_guard on public.stock_ledger;
create trigger ledger_balance_guard
  after insert on public.stock_ledger
  referencing new table as inserted
  for each statement execute function public.trg_ledger_balance_guard();

-- Index komposit untuk verifikasi ulang saldo dari ledger (pemeriksaan harian).
-- CATATAN: nama index pada IF NOT EXISTS tidak boleh berkualifikasi skema —
-- skema mengikuti tabelnya.
create index if not exists idx_ledger_key
  on public.stock_ledger (product_id, batch_id, stock_state);

-- ---------------------------------------------------------------------------
-- 3. KOREKSI ENTRI (sumber selisih ke-5: salah input admin)
--    Entri pembalik cepat: movement/reason/batch sama, qty dinegasikan,
--    correction_of menunjuk entri asal. Dibedakan dari ADJUSTMENT_OPNAME.
-- ---------------------------------------------------------------------------

-- Arah qty bebas untuk entri koreksi (pembalik), tetap ketat untuk lainnya.
-- Pasangan drop-if-exists + add = idempoten.
alter table public.stock_ledger drop constraint if exists valid_sign_for_type;
alter table public.stock_ledger add constraint valid_sign_for_type check (
  (correction_of is not null) or
  (movement_type in ('INBOUND_MAKLON', 'INITIAL_COUNT', 'RETURN_IN') and qty_delta > 0) or
  (movement_type in ('SALE_OUT', 'MANUAL_OUT', 'WRITE_OFF')          and qty_delta < 0) or
  (movement_type = 'ADJUSTMENT_OPNAME')
);

-- Validasi koreksi di level DB: pembalik harus persis cermin entri asal,
-- dan satu entri hanya bisa dikoreksi SEKALI.
create or replace function public.trg_validate_correction() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  orig public.stock_ledger%rowtype;
begin
  if new.correction_of is null then
    return new;
  end if;

  select * into orig from public.stock_ledger where id = new.correction_of;
  if not found then
    raise exception 'Koreksi menunjuk entri ledger yang tidak ada (id=%)', new.correction_of;
  end if;
  if exists (select 1 from public.stock_ledger l where l.correction_of = new.correction_of) then
    raise exception 'Entri % sudah pernah dikoreksi — koreksi hanya sekali.', new.correction_of;
  end if;
  if new.qty_delta <> -orig.qty_delta
     or new.product_id <> orig.product_id
     or new.batch_id <> orig.batch_id
     or new.stock_state <> orig.stock_state
     or new.movement_type <> orig.movement_type
     or new.reason <> orig.reason then
    raise exception
      'Koreksi harus cermin persis entri asal (qty dinegasikan; produk/batch/jenis/alasan sama).';
  end if;
  if new.note is null or length(trim(new.note)) = 0 then
    raise exception 'Koreksi wajib menyertakan catatan alasan.';
  end if;
  return new;
end $$;

drop trigger if exists ledger_validate_correction on public.stock_ledger;
create trigger ledger_validate_correction
  before insert on public.stock_ledger
  for each row execute function public.trg_validate_correction();

create index if not exists idx_ledger_correction
  on public.stock_ledger (correction_of)
  where correction_of is not null;

-- ---------------------------------------------------------------------------
-- 4. REFERENSI untuk bonus/promo/sample (kebocoran terbesar harus BISA
--    DIJELASKAN: campaign apa / disetujui siapa — bukan sekadar tercatat)
-- ---------------------------------------------------------------------------

alter table public.stock_ledger add column if not exists reference text;

-- NOT VALID: baris lama (seed/riwayat) dibiarkan; baris BARU wajib patuh.
-- ADD CONSTRAINT tidak punya IF NOT EXISTS → dibungkus DO-block.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_out_needs_reference'
      and conrelid = 'public.stock_ledger'::regclass
  ) then
    alter table public.stock_ledger add constraint manual_out_needs_reference
      check (
        correction_of is not null
        or not (movement_type = 'MANUAL_OUT' and reason in ('bonus', 'promo', 'sample'))
        or (reference is not null and length(trim(reference)) > 0)
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. VERSIONING RESEP BUNDLE (append-only juga: edit = versi baru)
-- ---------------------------------------------------------------------------

alter table public.bundles      add column if not exists active_version integer not null default 1;
alter table public.bundle_items add column if not exists version        integer not null default 1;

alter table public.bundle_items drop constraint if exists bundle_items_bundle_id_product_id_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bundle_items_unique_per_version'
      and conrelid = 'public.bundle_items'::regclass
  ) then
    alter table public.bundle_items add constraint bundle_items_unique_per_version
      unique (bundle_id, version, product_id);
  end if;
end $$;

-- Pesanan mencatat versi resep yang dipakai saat pecah bundle.
alter table public.order_items add column if not exists bundle_version integer;

-- ---------------------------------------------------------------------------
-- 6. VIEWS → baca summary; v_product_stock + baseline_unverified
-- ---------------------------------------------------------------------------

create or replace view public.v_stock_balance as
select product_id, batch_id, stock_state, qty
from public.stock_balances;

create or replace view public.v_batch_stock as
select
  b.id as batch_id,
  b.product_id,
  b.batch_code,
  b.expiry_date,
  b.received_at,
  coalesce(sum(sb.qty) filter (where sb.stock_state = 'SELLABLE'), 0)::int   as sellable_qty,
  coalesce(sum(sb.qty) filter (where sb.stock_state = 'DAMAGED'), 0)::int    as damaged_qty,
  coalesce(sum(sb.qty) filter (where sb.stock_state = 'QUARANTINE'), 0)::int as quarantine_qty
from public.batches b
left join public.stock_balances sb on sb.batch_id = b.id
group by b.id;

-- baseline_unverified: punya entri stok awal (INITIAL_COUNT) tapi belum pernah
-- tersentuh opname terposting → angka awal masih PERKIRAAN (keputusan klien #5).
create or replace view public.v_product_stock as
select
  p.id as product_id,
  p.sku,
  p.name,
  p.is_active,
  coalesce(sb.sellable, 0)::int   as sellable_qty,
  coalesce(sb.damaged, 0)::int    as damaged_qty,
  coalesce(sb.quarantine, 0)::int as quarantine_qty,
  coalesce(r.reserved, 0)::int    as reserved_qty,
  (coalesce(sb.sellable, 0) - coalesce(r.reserved, 0))::int as available_qty,
  (
    exists (select 1 from public.stock_ledger l
            where l.product_id = p.id and l.movement_type = 'INITIAL_COUNT')
    and not exists (select 1 from public.opname_counts oc
                    join public.opname_sessions os on os.id = oc.session_id
                    where oc.product_id = p.id and os.status = 'POSTED')
  ) as baseline_unverified
from public.products p
left join (
  select product_id,
         sum(qty) filter (where stock_state = 'SELLABLE')   as sellable,
         sum(qty) filter (where stock_state = 'DAMAGED')    as damaged,
         sum(qty) filter (where stock_state = 'QUARANTINE') as quarantine
  from public.stock_balances
  group by product_id
) sb on sb.product_id = p.id
left join (
  select product_id, sum(qty) as reserved
  from public.reservations
  where status = 'ACTIVE'
  group by product_id
) r on r.product_id = p.id;

-- Pertahankan pengerasan 0002 pada view yang dibangun ulang.
alter view public.v_stock_balance set (security_invoker = on);
alter view public.v_batch_stock   set (security_invoker = on);
alter view public.v_product_stock set (security_invoker = on);
revoke select on public.v_stock_balance, public.v_batch_stock, public.v_product_stock from anon;
