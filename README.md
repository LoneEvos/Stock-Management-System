# Sistem Rekonsiliasi Stok — Brand Skincare Indonesia

Sistem pencatatan & rekonsiliasi stok mandiri untuk brand skincare (±70 SKU,
maklon, jualan di Shopee & TikTok Shop). Ini **bukan aplikasi CRUD inventori**
— ini sistem audit forensik untuk stok.

> **Prinsip inti: tidak ada angka stok yang berubah tanpa jejak.**
> Semua pergerakan lewat SATU buku besar (stock ledger) append-only.
> Setiap selisih bisa di-drill sampai ketemu penyebabnya.

**Stack:** Next.js (App Router) + TypeScript · Supabase (Postgres + Auth) ·
Tailwind + shadcn/ui · Recharts · deploy Vercel.

---

## Kenapa selisih stok terjadi — dan bagaimana sistem ini menutupnya

| # | Kebocoran | Mekanisme penutup |
|---|-----------|-------------------|
| 1 | **Pesanan batal** — barang tercatat keluar, pesanan batal, stok tak pernah dikembalikan | Pesanan = **reservasi**, bukan pengurangan. Stok fisik baru berkurang saat kirim (Shopee `SHIPPED` / TikTok `IN_TRANSIT`). Batal **sebelum** kirim → reservasi dilepas, stok tak pernah bergerak. Batal **sesudah** kirim → otomatis terbit **dokumen retur** yang menunggu barang kembali — tidak ada lagi "batal lalu hilang dari cerita". |
| 2 | **Retur dengan berbagai nasib** | Semua retur mulai `IN_TRANSIT_BACK`. Gudang menginspeksi fisik lalu memutuskan **manual**: `SELLABLE` (masuk lagi ke stok layak jual, ke batch asalnya), `DAMAGED` (masuk stok rusak — tak pernah tercampur layak jual), `LOST` (hilang di ekspedisi). Retur TikTok punya **pengingat klaim 40 hari** dengan urgensi meningkat. Retur yang lama tak diinspeksi muncul di worklist anomali. |
| 3 | **Bonus, promo, sampel** (kebocoran terbesar) | Alur **Keluar Manual** dengan **alasan wajib** (`offline_sale`, `bonus`, `promo`, `sample`, `damaged`, `expired`). **Alasan ≠ kanal** — dua kolom terpisah di ledger: penjualan offline dan bonus sama-sama manual tapi artinya beda, dan bisa difilter terpisah selamanya. |
| 4 | **Stok awal perkiraan** | Stok awal diimpor dari spreadsheet klien sebagai entri `INITIAL_COUNT` (baseline) yang **eksplisit dan bertanggal** di batch `AWAL` — selisih berikutnya diukur dari titik nol yang diketahui, bukan dari angka misterius. Hanya bisa sekali per produk; koreksi berikutnya lewat opname. |

## Arsitektur

```
Simulator ──┐
Impor file ─┤→ MarketplaceEvent → pipeline ingest (satu pintu)
API asli* ──┘        │
                     ├─ pesanan → reservations (janji, bukan stok)
                     ├─ kirim   → SALE_OUT via FEFO  ──┐
                     └─ retur   → dokumen retur        │
                                                       ▼
   Masuk maklon / Keluar manual / Opname  ──────→  STOCK LEDGER (append-only)
                                                       │
                     saldo = SUM(qty_delta) ───────────┤
                     worklist anomali harian ──────────┤
                     drill-down semua angka ───────────┘
```
\* API Shopee/TikTok asli tinggal menggantikan simulator sebagai penghasil
`MarketplaceEvent` — pipeline dan logika inti tidak berubah (adapter pattern,
lihat `src/lib/marketplace/types.ts`).

### Keputusan desain penting (dan alasannya)

- **Stok tidak pernah disimpan sebagai angka yang di-update.** Saldo selalu
  `SUM(qty_delta)` dari ledger (view `v_product_stock`, `v_batch_stock`).
  Tidak ada tabel "stok saat ini" yang bisa diedit diam-diam.
- **Ledger dilindungi berlapis:** (1) fungsi murni ber-unit-test membangun
  entri; (2) advisory lock per produk mencegah race alokasi; (3) CHECK
  constraint kombinasi jenis↔alasan & arah qty; (4) trigger Postgres menolak
  `UPDATE`/`DELETE`/`TRUNCATE`; (5) trigger saldo non-negatif per
  (produk, batch, kondisi). Koreksi = entri pembalik baru (`correction_of`),
  tidak pernah edit.
- **FEFO otomatis.** Operator tidak pernah memilih batch; setiap keluar
  dialokasikan ke batch ber-ED terdekat, terpecah lintas batch bila perlu,
  tercatat per batch di ledger (`src/lib/ledger/fefo.ts`, teruji unit test).
- **Bundle = resep, bukan stok.** SKU paket dipecah menjadi produk satuan
  **saat data masuk**, sebelum menyentuh reservasi/ledger.
- **Batal sebelum kirim TIDAK menulis ledger** — stok fisik memang tidak
  bergerak. Jejaknya di `order_events` (append-only, semua event tercatat) +
  status reservasi `RELEASED`. Ledger dijaga tetap = kebenaran fisik.
- **Retur `LOST` TIDAK menulis ledger.** Barang keluar saat kirim dan tidak
  pernah kembali — stok fisik sudah benar. Menulis write-off justru mengurangi
  stok **dua kali** (bug klasik). Jejaknya di dokumen retur + klaim TikTok.
  (Ini penyimpangan sadar dari saran brief, dengan alasan di atas.)
- **Oversell tidak ditolak, tapi ditandai.** Marketplace sudah menjual barangnya;
  reservasi melebihi stok adalah **fakta yang harus muncul sebagai anomali**,
  bukan disembunyikan dengan menolak data. Kirim yang gagal karena stok catatan
  kurang otomatis jadi anomali `CRITICAL`.
- **Dua ritme rekonsiliasi.** Harian: sistem memeriksa konsistensi catatannya
  sendiri (10 pemeriksaan → worklist anomali; cron Vercel + tombol manual).
  Opname: hitung fisik vs catatan, selisih diposting sebagai koreksi baru dan
  ikut masuk worklist supaya **ceritanya** dikejar, bukan cuma angkanya dikoreksi.

## Menjalankan

### 1. Siapkan Supabase
1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, jalankan seluruh isi
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

### 2. Konfigurasi & seed
```bash
cp .env.example .env.local   # isi nilai dari dashboard Supabase
npm install
npm run seed                 # admin + 67 produk + riwayat demo lengkap
npm run dev
```
Login default (dibuat oleh seed): `admin@stokdemo.id` / `RekonStok2026!`
(ubah lewat `ADMIN_EMAIL` / `ADMIN_PASSWORD` sebelum seed).

### 3. Uji
```bash
npm test        # unit test FEFO & pembuat entri ledger
npm run build   # produksi
```

### 4. Deploy ke Vercel
1. Push repo ke GitHub → import di Vercel.
2. Set env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `DATABASE_URL`, `CRON_SECRET` (`SUPABASE_SERVICE_ROLE_KEY` tidak perlu
   di Vercel — hanya dipakai seed lokal).
3. `vercel.json` sudah berisi cron rekonsiliasi harian (04:00 WIB).

## Peta fitur → lokasi

| Fitur | Halaman | Logika |
|---|---|---|
| Buku besar + drill-down | `/ledger` | `src/lib/ledger/*` |
| Produk & resep bundle | `/produk` | `src/app/(app)/produk` |
| Batch & tier kedaluwarsa | `/batch` | view `v_batch_stock` |
| Masuk maklon | `/masuk` | `buildInbound` |
| Keluar manual (alasan wajib) | `/keluar` | `buildManualOut` |
| Pesanan & timeline event | `/pesanan` | `src/lib/marketplace/ingest.ts` |
| Simulator (pengganti API) | `/simulator` | `src/lib/marketplace/simulator.ts` |
| Impor stok awal & pesanan | `/impor` | `src/app/(app)/impor/actions.ts` |
| Antrean inspeksi retur + klaim | `/retur` | `src/app/(app)/retur/actions.ts` |
| Stok opname | `/opname` | `src/app/(app)/opname/actions.ts` |
| Worklist anomali (10 checks) | `/anomali` | `src/lib/anomaly/checks.ts` |
| Dashboard | `/` | semua angka bisa diklik |

## Checklist uji penerimaan

- Simulasi pesanan → stok **direservasi**, tidak berkurang (lihat kolom
  Direservasi di `/produk`). Kirim → `SALE_OUT` dengan batch FEFO di ledger.
- Batal sebelum kirim → reservasi dilepas, ledger tidak berubah. Batal sesudah
  kirim → dokumen retur muncul di `/retur`.
- Retur ditandai rusak → layak jual tak berubah, stok rusak +1, tertaut ke
  entri ledger `RETURN_IN`/`return_damaged`.
- Keluar manual `bonus` vs `offline_sale` tercatat berbeda dan bisa difilter
  di `/ledger` (filter Alasan).
- Pesanan `PAKET-GLOWING` ×2 → terpecah jadi produk satuan sesuai resep
  (lihat item pesanan: "dari bundle").
- Opname dengan selisih sengaja → variance tampil → drill-down ke pergerakan
  batch → koreksi diposting sebagai `ADJUSTMENT_OPNAME` baru, bukan edit.
- `UPDATE`/`DELETE` baris ledger ditolak database (trigger append-only).
- `SUM(ledger)` per produk/batch selalu = angka stok yang ditampilkan
  (semua tampilan membaca view yang sama).
