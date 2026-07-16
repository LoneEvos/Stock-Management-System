-- ============================================================================
-- 0002 — Pengerasan keamanan (menjawab Supabase Security Advisor)
--
-- AMAN untuk aplikasi: semua kueri app membaca view lewat koneksi server
-- (DATABASE_URL / role `postgres`) yang tetap bypass RLS. Perubahan di sini
-- HANYA menutup jalur API anon/authenticated (yang tidak dipakai app untuk
-- data — hanya untuk auth). Jalankan setelah 0001_init.sql.
-- ============================================================================

-- ---- 1. VIEWS → SECURITY INVOKER (jangan bypass RLS) -----------------------
-- Default sebuah view = berjalan sebagai PEMILIK (postgres) → MEMBYPASS RLS
-- tabel di baliknya. Karena anon key bersifat publik, ini berarti stok bisa
-- dibaca lewat REST API TANPA login. security_invoker membuat view mengikuti
-- RLS sesuai role pemanggil → anon (belum login) tidak dapat baris apa pun.
alter view public.v_stock_balance set (security_invoker = on);
alter view public.v_batch_stock   set (security_invoker = on);
alter view public.v_product_stock set (security_invoker = on);

-- Sabuk pengaman kedua: cabut hak baca view dari role anon (belum login).
revoke select on
  public.v_stock_balance,
  public.v_batch_stock,
  public.v_product_stock
from anon;

-- ---- 2. FUNGSI TRIGGER → pin search_path (hilangkan "mutable") -------------
-- trg_ledger_immutable hanya raise exception (tak menyentuh tabel) → aman
-- dengan search_path kosong.
alter function public.trg_ledger_immutable() set search_path = '';

-- trg_ledger_balance_guard mereferensi stock_ledger → skema dikualifikasi
-- eksplisit (public.stock_ledger) agar search_path kosong tetap berfungsi.
create or replace function public.trg_ledger_balance_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bad record;
begin
  select l.product_id, l.batch_id, l.stock_state, sum(l.qty_delta) as bal
    into bad
  from public.stock_ledger l
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
