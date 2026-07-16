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
| 1 | **Pesanan batal** — barang tercatat keluar, pesanan batal, stok tak pernah dikembalikan | Pesanan = **reservasi**, bukan pengurangan. Stok fisik baru berkurang saat kirim (Shopee `SHIPPED` / TikTok `IN_TRANSIT`). Batal **sebelum** kirim → reservasi dilepas, stok tak pernah bergerak. Batal **sesudah** kirim → otomatis terbit **dokumen retur** yang menunggu barang kembali. Pembatalan **parsial per item** didukung — hanya baris yang batal yang dilepas. |
| 2 | **Retur dengan berbagai nasib** | Semua retur mulai `IN_TRANSIT_BACK`. Gudang menginspeksi fisik lalu memutuskan **manual**: `SELLABLE` (masuk ke **batch baru bertanda "retur"** — bukan batch asal, karena ED asal tak bisa dipastikan; batch tanpa ED otomatis di urutan FEFO paling akhir), `DAMAGED` / `LOST` (**tanpa pergerakan stok kedua** — stok sudah terpotong saat kirim; dicatat sebagai record audit/klaim, dipisah karena proses klaimnya berbeda). Retur **parsial per item** didukung; retur sebagian dari bundle dihitung per produk satuan. Retur TikTok punya **pengingat klaim 40 hari sejak retur diajukan**. |
| 3 | **Bonus, promo, sampel** (kebocoran terbesar) | Alur **Keluar Manual** dengan **alasan wajib** (`offline_sale`, `bonus`, `promo`, `sample`, `damaged`, `expired`). **Alasan ≠ kanal** — dua kolom terpisah di ledger. Phase 2: bonus/promo/sampel **wajib ber-referensi** (nama campaign / catatan approval) — kebocoran terbesar bukan cuma tercatat, tapi bisa **dijelaskan ke siapa & kenapa**. |
| 4 | **Stok awal perkiraan** | Stok awal diimpor sebagai entri `INITIAL_COUNT` (baseline) yang **eksplisit dan bertanggal** di batch `AWAL`, ditandai **"belum terverifikasi"** sampai produk tersentuh opname pertama. Selisih diukur dari titik nol yang diketahui. |
| 5 | **Salah input admin** | **Koreksi Entri**: reversal cepat saat operator sadar salah input — entri **pembalik** baru ber-`correction_of` (cermin persis, divalidasi trigger DB, satu entri hanya bisa dikoreksi sekali), **dibedakan** dari Penyesuaian Opname. Keduanya entri baru berjejak, tidak pernah edit/hapus. |

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

- **Stok tidak pernah disimpan sebagai angka yang di-update manual.** Ledger =
  satu-satunya sumber kebenaran. Saldo dibaca **O(1)** dari summary
  `stock_balances` yang di-maintain **trigger DB** dari ledger (bukan SUM
  full-scan — ledger akan tumbuh jutaan baris), dan **diverifikasi ulang tiap
  hari**: pemeriksaan #11 membandingkan summary vs `SUM(ledger)`; selisih =
  anomali `CRITICAL`. Summary tak bisa ditulis lewat API — hanya trigger.
- **Ledger dilindungi berlapis:** (1) fungsi murni ber-unit-test membangun
  entri; (2) advisory lock per produk mencegah race alokasi; (3) CHECK
  constraint kombinasi jenis↔alasan & arah qty; (4) trigger Postgres menolak
  `UPDATE`/`DELETE`/`TRUNCATE`; (5) trigger saldo non-negatif per
  (produk, batch, kondisi); (6) trigger validasi koreksi (cermin persis,
  sekali per entri). Koreksi = entri pembalik baru, tidak pernah edit.
- **Dua jalur koreksi yang dibedakan:** **Koreksi Entri** (salah input admin —
  reversal cepat dari halaman ledger, ber-`correction_of`) vs **Penyesuaian
  Opname** (`ADJUSTMENT_OPNAME`, dari hitung fisik). Keduanya berjejak penuh.
- **FEFO otomatis.** Operator tidak pernah memilih batch; setiap keluar
  dialokasikan ke batch ber-ED terdekat, terpecah lintas batch bila perlu,
  tercatat per batch di ledger (`src/lib/ledger/fefo.ts`, teruji unit test).
  Batch retur (tanpa ED) otomatis di urutan paling akhir.
- **Bundle = resep ber-versi, bukan stok.** SKU paket dipecah menjadi produk
  satuan **saat data masuk** memakai **versi resep aktif**; versi yang dipakai
  tercatat di order item. Edit resep = **versi baru** — pesanan lama tak
  pernah berubah.
- **Batal sebelum kirim TIDAK menulis ledger** — stok fisik memang tidak
  bergerak. Jejaknya di `order_events` (append-only) + reservasi `RELEASED`.
  Pembatalan parsial melepas hanya reservasi item terkait.
- **Retur rusak/hilang TIDAK menulis ledger.** Barang keluar saat kirim;
  menulis pergerakan kedua = pengurangan ganda (bug klasik). Jejaknya sebagai
  record audit/klaim di dokumen retur — rusak dan hilang **dipisah** karena
  proses klaimnya berbeda. Retur layak jual masuk **batch baru "retur"**.
- **Oversell tidak ditolak, tapi ditandai.** Marketplace sudah menjual barangnya;
  reservasi melebihi stok adalah **fakta yang harus muncul sebagai anomali**,
  bukan disembunyikan dengan menolak data. Kirim yang gagal karena stok catatan
  kurang otomatis jadi anomali `CRITICAL`.
- **Layar konfirmasi sebelum commit permanen.** Keluar manual & Koreksi Entri
  menampilkan preview produk, qty, alasan, dan **dampak ke stok tersedia**
  sebelum tombol final — satu-satunya titik yang sengaja diberi friksi.
- **Dua ritme rekonsiliasi.** Harian: sistem memeriksa konsistensi catatannya
  sendiri (11 pemeriksaan → worklist anomali; cron Vercel + tombol manual).
  Opname: hitung fisik vs catatan, selisih diposting sebagai koreksi baru dan
  ikut masuk worklist supaya **ceritanya** dikejar, bukan cuma angkanya dikoreksi.

## Menjalankan

### 1. Siapkan Supabase
1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, jalankan BERURUTAN:
   [`0001_init.sql`](supabase/migrations/0001_init.sql) →
   [`0002_security_hardening.sql`](supabase/migrations/0002_security_hardening.sql) →
   [`0003_phase2.sql`](supabase/migrations/0003_phase2.sql).

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
  kirim → dokumen retur muncul di `/retur`. Pembatalan/retur **parsial per
  item** → hanya item terkait yang terpengaruh (tombol "Retur Sebagian" di
  simulator).
- Retur layak jual → masuk **batch baru `RET-...`** (lihat `/batch`), bukan
  batch asal. Retur rusak/hilang → **tanpa entri ledger**; tercatat sebagai
  record audit di `/retur` (rusak ≠ hilang — klaimnya beda).
- Keluar manual `bonus` tanpa referensi **ditolak**; dengan referensi campaign
  → tercatat dan tampil di kolom Referensi `/ledger`. `bonus` vs `offline_sale`
  bisa difilter terpisah (filter Alasan).
- **Koreksi Entri** di `/ledger` → preview dampak stok tersedia → entri
  pembalik ber-`correction_of`; entri asal berbadge "Dikoreksi"; koreksi kedua
  atas entri yang sama **ditolak database**.
- Pesanan `PAKET-GLOWING` ×2 → terpecah jadi produk satuan sesuai resep versi
  aktif. **Edit resep → versi baru (v2)** — item pesanan lama tetap v1.
- Produk hasil impor stok awal berbadge **"Stok awal belum terverifikasi"**
  sampai tersentuh opname terposting.
- Opname dengan selisih sengaja → variance tampil → drill-down ke pergerakan
  batch → koreksi diposting sebagai `ADJUSTMENT_OPNAME` baru, bukan edit.
- `UPDATE`/`DELETE` baris ledger ditolak database (trigger append-only).
- Saldo O(1): tampilan membaca `stock_balances` (via view); pemeriksaan harian
  #11 memverifikasi summary = `SUM(ledger)` — selisih = anomali `CRITICAL`.
