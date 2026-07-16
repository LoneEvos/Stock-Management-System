-- ============================================================================
-- Sistem Rekonsiliasi Stok — Skema Database
-- Prinsip inti: TIDAK ADA ANGKA STOK YANG BERUBAH TANPA JEJAK.
-- Semua pergerakan fisik lewat SATU stock_ledger append-only.
-- Stok "saat ini" tidak pernah disimpan — selalu SUM(qty_delta) dari ledger.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================== ENUMS =======================================

-- Jenis pergerakan fisik. CATATAN DESAIN: pembatalan SEBELUM kirim tidak
-- menulis ke ledger karena stok fisik tidak pernah bergerak — jejaknya ada di
-- order_events + reservations (status RELEASED). Ledger = kebenaran fisik.
create type movement_type as enum (
  'INBOUND_MAKLON',    -- barang masuk dari maklon
  'INITIAL_COUNT',     -- stok awal (baseline) per batch — import/opname awal
  'SALE_OUT',          -- keluar fisik saat kirim (Shopee SHIPPED / TikTok IN_TRANSIT)
  'MANUAL_OUT',        -- keluar manual: penjualan offline, bonus, promo, sampel, rusak, kedaluwarsa
  'RETURN_IN',         -- retur diterima masuk ke stock_state tertentu
  'ADJUSTMENT_OPNAME', -- koreksi hasil hitung fisik (opname)
  'WRITE_OFF'          -- penghapusan: hilang di ekspedisi, pemusnahan
);

-- ALASAN dan KANAL adalah dua hal terpisah (keputusan klien).
-- offline_sale dan bonus sama-sama manual, tapi artinya beda.
create type ledger_reason as enum (
  'maklon_receipt',
  'initial_baseline',
  'sale',
  'offline_sale',
  'bonus',
  'promo',
  'sample',
  'damaged',
  'expired',
  'return_sellable',
  'return_damaged',
  'lost_in_transit',
  'opname_correction',
  'disposal'
);

create type channel as enum ('shopee', 'tiktok', 'offline', 'internal');

create type stock_state as enum ('SELLABLE', 'DAMAGED', 'QUARANTINE');

create type order_status as enum
  ('CREATED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED');

create type reservation_status as enum ('ACTIVE', 'RELEASED', 'CONVERTED');

create type return_status as enum ('IN_TRANSIT_BACK', 'RECEIVED', 'INSPECTED', 'CLOSED');

create type return_condition as enum ('SELLABLE', 'DAMAGED', 'LOST');

create type anomaly_status as enum ('OPEN', 'INVESTIGATING', 'RESOLVED');
create type anomaly_severity as enum ('INFO', 'WARNING', 'CRITICAL');

create type opname_status as enum ('OPEN', 'POSTED', 'CANCELLED');

create type event_source as enum ('simulator', 'import', 'api', 'manual');

-- ============================== MASTER DATA =================================

create table products (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Bundle hanyalah RESEP — tidak ada stok bundle. Listing paket marketplace
-- dipecah menjadi produk satuan saat data masuk (ingestion).
create table bundles (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table bundle_items (
  id         uuid primary key default gen_random_uuid(),
  bundle_id  uuid not null references bundles(id) on delete cascade,
  product_id uuid not null references products(id),
  qty        integer not null check (qty > 0),
  unique (bundle_id, product_id)
);

-- Stok dilacak PER BATCH (untuk FEFO dan kedaluwarsa).
-- expiry_date boleh null hanya untuk batch baseline stok awal.
create table batches (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id),
  batch_code  text not null,
  expiry_date date,
  received_at timestamptz not null default now(),
  source      text not null default 'maklon',
  unique (product_id, batch_code)
);

-- ============================== STOCK LEDGER ================================
-- Jantung sistem. APPEND-ONLY. Tidak ada UPDATE/DELETE — koreksi = entri baru.

create table stock_ledger (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  product_id    uuid not null references products(id),
  batch_id      uuid not null references batches(id),
  qty_delta     integer not null check (qty_delta <> 0),
  movement_type movement_type not null,
  reason        ledger_reason not null,
  channel       channel not null,
  stock_state   stock_state not null default 'SELLABLE',
  ref_type      text,   -- 'order' | 'return_item' | 'opname_count' | 'inbound' | 'manual_out' | 'import'
  ref_id        uuid,   -- id dokumen sumber
  operator      text not null,
  note          text,
  correction_of bigint references stock_ledger(id),

  -- Kombinasi movement_type ↔ reason yang sah
  constraint valid_reason_for_type check (
    (movement_type = 'INBOUND_MAKLON'    and reason = 'maklon_receipt') or
    (movement_type = 'INITIAL_COUNT'     and reason = 'initial_baseline') or
    (movement_type = 'SALE_OUT'          and reason = 'sale') or
    (movement_type = 'MANUAL_OUT'        and reason in
        ('offline_sale', 'bonus', 'promo', 'sample', 'damaged', 'expired')) or
    (movement_type = 'RETURN_IN'         and reason in
        ('return_sellable', 'return_damaged')) or
    (movement_type = 'ADJUSTMENT_OPNAME' and reason = 'opname_correction') or
    (movement_type = 'WRITE_OFF'         and reason in
        ('lost_in_transit', 'disposal', 'expired', 'damaged'))
  ),

  -- Arah pergerakan yang sah per jenis
  constraint valid_sign_for_type check (
    (movement_type in ('INBOUND_MAKLON', 'INITIAL_COUNT', 'RETURN_IN') and qty_delta > 0) or
    (movement_type in ('SALE_OUT', 'MANUAL_OUT', 'WRITE_OFF')          and qty_delta < 0) or
    (movement_type = 'ADJUSTMENT_OPNAME')
  )
);

create index idx_ledger_product  on stock_ledger (product_id, created_at desc);
create index idx_ledger_batch    on stock_ledger (batch_id);
create index idx_ledger_ref      on stock_ledger (ref_type, ref_id);
create index idx_ledger_type     on stock_ledger (movement_type);
create index idx_ledger_reason   on stock_ledger (reason);
create index idx_ledger_created  on stock_ledger (created_at desc);

-- ---- Immutability: ledger tidak bisa di-UPDATE / DELETE / TRUNCATE ----
create or replace function trg_ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception
    'stock_ledger bersifat append-only: % dilarang. Buat entri pembalik (correction_of) sebagai koreksi.',
    TG_OP;
end $$;

create trigger ledger_no_update
  before update on stock_ledger
  for each row execute function trg_ledger_immutable();

create trigger ledger_no_delete
  before delete on stock_ledger
  for each row execute function trg_ledger_immutable();

create trigger ledger_no_truncate
  before truncate on stock_ledger
  execute function trg_ledger_immutable();

-- ---- Guard: saldo per (produk, batch, state) tidak boleh negatif ----
create or replace function trg_ledger_balance_guard() returns trigger
language plpgsql as $$
declare
  bad record;
begin
  select l.product_id, l.batch_id, l.stock_state, sum(l.qty_delta) as bal
    into bad
  from stock_ledger l
  where (l.product_id, l.batch_id, l.stock_state) in
        (select i.product_id, i.batch_id, i.stock_state from inserted i)
  group by l.product_id, l.batch_id, l.stock_state
  having sum(l.qty_delta) < 0
  limit 1;

  if found then
    raise exception
      'Saldo stok tidak boleh negatif (product=%, batch=%, state=%, saldo=%)',
      bad.product_id, bad.batch_id, bad.stock_state, bad.bal;
  end if;
  return null;
end $$;

create trigger ledger_balance_guard
  after insert on stock_ledger
  referencing new table as inserted
  for each statement execute function trg_ledger_balance_guard();

-- ============================== ORDERS ======================================

create table orders (
  id                   uuid primary key default gen_random_uuid(),
  marketplace_order_id text not null,
  channel              channel not null check (channel in ('shopee', 'tiktok')),
  status               order_status not null default 'CREATED',
  created_at           timestamptz not null default now(),
  shipped_at           timestamptz,
  delivered_at         timestamptz,
  cancelled_at         timestamptz,
  return_requested_at  timestamptz,
  raw_payload          jsonb,
  unique (channel, marketplace_order_id)
);

-- Jejak audit SEMUA event marketplace yang masuk (simulator/import/API asli).
-- Append-only juga: setiap transisi status pesanan tercatat di sini.
create table order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references orders(id),
  event_type  text not null,
  source      event_source not null,
  payload     jsonb,
  occurred_at timestamptz not null default now(),
  ingested_at timestamptz not null default now()
);

create index idx_order_events_order on order_events (order_id, occurred_at);

-- order_items = SETELAH bundle dipecah jadi produk satuan.
-- listing_sku menyimpan SKU listing asli marketplace untuk penelusuran.
create table order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid not null references products(id),
  qty         integer not null check (qty > 0),
  listing_sku text not null,
  bundle_id   uuid references bundles(id)
);

create index idx_order_items_order   on order_items (order_id);
create index idx_order_items_product on order_items (product_id);

-- Reservasi: pesanan dibuat = stok DIJANJIKAN, belum keluar fisik.
-- Available = sellable (ledger) − reservasi ACTIVE.
create table reservations (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references order_items(id),
  order_id       uuid not null references orders(id),
  product_id     uuid not null references products(id),
  qty            integer not null check (qty > 0),
  status         reservation_status not null default 'ACTIVE',
  created_at     timestamptz not null default now(),
  released_at    timestamptz,
  release_reason text
);

create index idx_reservations_product on reservations (product_id, status);
create index idx_reservations_order   on reservations (order_id);

-- ============================== RETURNS =====================================

create table returns (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id),
  channel       channel not null check (channel in ('shopee', 'tiktok')),
  status        return_status not null default 'IN_TRANSIT_BACK',
  reason        text,                    -- alasan dari marketplace/pembeli
  created_at    timestamptz not null default now(),
  received_at   timestamptz,
  inspected_at  timestamptz,
  inspected_by  text,
  -- TikTok: batas klaim 40 hari sejak retur dibuat
  claim_deadline date,
  claim_filed    boolean not null default false
);

create index idx_returns_status on returns (status);

create table return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references returns(id) on delete cascade,
  order_item_id uuid not null references order_items(id),
  product_id    uuid not null references products(id),
  qty           integer not null check (qty > 0),
  condition     return_condition  -- NULL sampai diinspeksi gudang secara manual
);

create index idx_return_items_return on return_items (return_id);

-- ============================== OPNAME ======================================

create table opname_sessions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  status     opname_status not null default 'OPEN',
  note       text,
  created_by text not null,
  started_at timestamptz not null default now(),
  posted_at  timestamptz
);

create table opname_counts (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references opname_sessions(id) on delete cascade,
  product_id   uuid not null references products(id),
  batch_id     uuid not null references batches(id),
  system_qty   integer not null,  -- snapshot saldo ledger saat dihitung
  physical_qty integer not null check (physical_qty >= 0),
  variance     integer generated always as (physical_qty - system_qty) stored,
  note         text,
  counted_at   timestamptz not null default now(),
  unique (session_id, batch_id)
);

create index idx_opname_counts_session on opname_counts (session_id);

-- ============================== ANOMALIES ===================================

create table anomalies (
  id              uuid primary key default gen_random_uuid(),
  detected_at     timestamptz not null default now(),
  type            text not null,
  severity        anomaly_severity not null default 'WARNING',
  title           text not null,
  description     text,
  ref_type        text,
  ref_id          uuid,
  status          anomaly_status not null default 'OPEN',
  resolved_at     timestamptz,
  resolution_note text,
  -- kunci dedup agar pemeriksaan harian tidak menduplikasi anomali yang masih OPEN
  dedupe_key      text not null unique
);

create index idx_anomalies_status on anomalies (status, severity);

-- ============================== VIEWS =======================================

-- Saldo per (produk, batch, state) — murni turunan ledger.
create view v_stock_balance as
select product_id, batch_id, stock_state, sum(qty_delta)::int as qty
from stock_ledger
group by product_id, batch_id, stock_state;

-- Saldo per batch (untuk FEFO & kedaluwarsa).
create view v_batch_stock as
select
  b.id as batch_id,
  b.product_id,
  b.batch_code,
  b.expiry_date,
  b.received_at,
  coalesce(sum(l.qty_delta) filter (where l.stock_state = 'SELLABLE'), 0)::int  as sellable_qty,
  coalesce(sum(l.qty_delta) filter (where l.stock_state = 'DAMAGED'), 0)::int   as damaged_qty,
  coalesce(sum(l.qty_delta) filter (where l.stock_state = 'QUARANTINE'), 0)::int as quarantine_qty
from batches b
left join stock_ledger l on l.batch_id = b.id
group by b.id;

-- Saldo per produk + reservasi aktif → available.
create view v_product_stock as
select
  p.id as product_id,
  p.sku,
  p.name,
  p.is_active,
  coalesce(sb.sellable, 0)::int   as sellable_qty,
  coalesce(sb.damaged, 0)::int    as damaged_qty,
  coalesce(sb.quarantine, 0)::int as quarantine_qty,
  coalesce(r.reserved, 0)::int    as reserved_qty,
  (coalesce(sb.sellable, 0) - coalesce(r.reserved, 0))::int as available_qty
from products p
left join (
  select product_id,
         sum(qty_delta) filter (where stock_state = 'SELLABLE')   as sellable,
         sum(qty_delta) filter (where stock_state = 'DAMAGED')    as damaged,
         sum(qty_delta) filter (where stock_state = 'QUARANTINE') as quarantine
  from stock_ledger
  group by product_id
) sb on sb.product_id = p.id
left join (
  select product_id, sum(qty) as reserved
  from reservations
  where status = 'ACTIVE'
  group by product_id
) r on r.product_id = p.id;

-- ============================== SECURITY ====================================
-- Aplikasi menulis lewat koneksi server (DATABASE_URL). RLS menutup akses
-- lewat API anon/authenticated key: hanya SELECT untuk user login.

alter table products        enable row level security;
alter table bundles         enable row level security;
alter table bundle_items    enable row level security;
alter table batches         enable row level security;
alter table stock_ledger    enable row level security;
alter table orders          enable row level security;
alter table order_events    enable row level security;
alter table order_items     enable row level security;
alter table reservations    enable row level security;
alter table returns         enable row level security;
alter table return_items    enable row level security;
alter table opname_sessions enable row level security;
alter table opname_counts   enable row level security;
alter table anomalies       enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'products','bundles','bundle_items','batches','stock_ledger',
    'orders','order_events','order_items','reservations',
    'returns','return_items','opname_sessions','opname_counts','anomalies'
  ] loop
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      'select_' || t, t
    );
  end loop;
end $$;

-- Cabut hak UPDATE/DELETE ledger dari SEMUA role aplikasi (lapisan kedua
-- setelah trigger — koreksi hanya lewat entri pembalik).
revoke update, delete, truncate on stock_ledger from anon, authenticated;
