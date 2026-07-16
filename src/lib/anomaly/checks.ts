// ============================================================================
// Rekonsiliasi harian — sistem memeriksa KONSISTENSI CATATANNYA SENDIRI dan
// menandai kejanggalan sebagai worklist. Ritme kedua (opname) membandingkan
// catatan dengan hitung fisik — lihat modul opname.
//
// Setiap anomali membawa ref ke dokumen sumbernya sehingga bisa di-drill.
// dedupe_key mencegah anomali yang sama menumpuk di worklist.
// ============================================================================

import { sql } from "@/lib/db";

export interface CheckSummary {
  check: string;
  found: number;
}

export async function runDailyChecks(): Promise<CheckSummary[]> {
  const results: CheckSummary[] = [];

  // 1. Saldo negatif per (produk, batch, state) — seharusnya mustahil berkat
  //    trigger; kalau sampai muncul berarti ada yang menulis di luar sistem.
  const negative = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'NEGATIVE_STOCK', 'CRITICAL',
      'Saldo negatif: ' || p.name || ' (' || b.batch_code || ', ' || v.stock_state || ') = ' || v.qty,
      'Jumlah ledger untuk kombinasi ini negatif — periksa entri terakhir batch ini. Tidak ada pergerakan yang sah menghasilkan saldo minus.',
      'batch', v.batch_id,
      'negative_stock:' || v.batch_id || ':' || v.stock_state
    from v_stock_balance v
    join products p on p.id = v.product_id
    join batches b on b.id = v.batch_id
    where v.qty < 0
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Saldo negatif", found: negative.length });

  // 2. Oversell: reservasi aktif melebihi stok layak jual.
  const oversell = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'OVERSELL_RESERVATION', 'CRITICAL',
      'Reservasi melebihi stok: ' || vp.name || ' (tersedia ' || vp.available_qty || ')',
      'Pesanan aktif menjanjikan ' || vp.reserved_qty || ' unit padahal layak jual hanya ' || vp.sellable_qty || '. Pengiriman berikutnya akan gagal — tambah stok atau batalkan pesanan.',
      'product', vp.product_id,
      'oversell:' || vp.product_id || ':' || current_date
    from v_product_stock vp
    where vp.available_qty < 0
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Oversell reservasi", found: oversell.length });

  // 3. Pesanan terkirim tapi menggantung > 14 hari (tidak sampai / tidak retur).
  const stuck = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'STUCK_SHIPMENT', 'WARNING',
      'Kiriman menggantung: ' || o.marketplace_order_id || ' (' || o.channel || ')',
      'Dikirim ' || to_char(o.shipped_at, 'DD Mon YYYY') || ' dan belum sampai/retur setelah 14 hari. Barang sudah keluar dari catatan — pastikan nasib paket (sampai, hilang, atau retur).',
      'order', o.id,
      'stuck_shipment:' || o.id
    from orders o
    where o.status = 'SHIPPED'
      and o.shipped_at < now() - interval '14 days'
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Kiriman menggantung", found: stuck.length });

  // 4. Retur sudah tiba tapi belum diinspeksi > 3 hari — stok belum pulih.
  const uninspected = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'UNINSPECTED_RETURN', 'WARNING',
      'Retur belum diinspeksi: ' || o.marketplace_order_id,
      'Paket retur tiba ' || to_char(r.received_at, 'DD Mon YYYY') || ' tapi kondisinya belum diputuskan. Stok tidak akan pulih sampai inspeksi dilakukan.',
      'return', r.id,
      'uninspected_return:' || r.id
    from returns r
    join orders o on o.id = r.order_id
    where r.status = 'RECEIVED'
      and r.received_at < now() - interval '3 days'
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Retur belum diinspeksi", found: uninspected.length });

  // 5. Retur "dalam perjalanan" terlalu lama > 14 hari — kemungkinan hilang.
  const staleTransit = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'RETURN_STALE_IN_TRANSIT', 'WARNING',
      'Retur tak kunjung tiba: ' || o.marketplace_order_id,
      'Retur dibuat ' || to_char(r.created_at, 'DD Mon YYYY') || ' dan belum tiba setelah 14 hari — kemungkinan hilang di ekspedisi. ' ||
      case when r.channel = 'tiktok' then 'Siapkan klaim TikTok sebelum ' || coalesce(to_char(r.claim_deadline, 'DD Mon YYYY'), '-') || '.' else '' end,
      'return', r.id,
      'return_stale:' || r.id
    from returns r
    join orders o on o.id = r.order_id
    where r.status = 'IN_TRANSIT_BACK'
      and r.created_at < now() - interval '14 days'
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Retur tak kunjung tiba", found: staleTransit.length });

  // 6. Batas klaim TikTok mendekat (≤ 10 hari) dan klaim belum diajukan.
  const claims = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'TIKTOK_CLAIM_DEADLINE',
      case when r.claim_deadline - current_date <= 7 then 'CRITICAL' else 'WARNING' end::anomaly_severity,
      'Klaim TikTok ' || (r.claim_deadline - current_date) || ' hari lagi: ' || o.marketplace_order_id,
      'Batas klaim 40 hari jatuh pada ' || to_char(r.claim_deadline, 'DD Mon YYYY') || '. Ajukan klaim sekarang atau kerugian tidak bisa dipulihkan.',
      'return', r.id,
      'tiktok_claim:' || r.id
    from returns r
    join orders o on o.id = r.order_id
    where r.channel = 'tiktok'
      and r.claim_deadline is not null
      and r.claim_filed = false
      and r.claim_deadline - current_date <= 10
      and (
        r.status = 'IN_TRANSIT_BACK'
        or exists (select 1 from return_items ri
                   where ri.return_id = r.id and ri.condition = 'LOST')
      )
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Deadline klaim TikTok", found: claims.length });

  // 7. Kebocoran reservasi: reservasi masih ACTIVE padahal pesanan sudah
  //    tidak CREATED — pelanggaran invarian internal (self-audit).
  const leak = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'RESERVATION_LEAK', 'CRITICAL',
      'Kebocoran reservasi: ' || o.marketplace_order_id,
      'Reservasi masih aktif padahal status pesanan ' || o.status || '. Angka "tersedia" tercemar — lepaskan/konversi reservasi ini dan cari tahu kenapa bisa terjadi.',
      'order', o.id,
      'reservation_leak:' || r.id
    from reservations r
    join orders o on o.id = r.order_id
    where r.status = 'ACTIVE' and o.status <> 'CREATED'
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Kebocoran reservasi", found: leak.length });

  // 8. Pesanan CREATED menggantung > 7 hari — reservasi mengunci stok.
  const staleRes = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'STALE_ORDER', 'INFO',
      'Pesanan menggantung: ' || o.marketplace_order_id,
      'Dibuat ' || to_char(o.created_at, 'DD Mon YYYY') || ' dan belum dikirim/dibatalkan. Reservasinya mengunci stok tersedia.',
      'order', o.id,
      'stale_order:' || o.id
    from orders o
    where o.status = 'CREATED'
      and o.created_at < now() - interval '7 days'
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Pesanan menggantung", found: staleRes.length });

  // 9. Stok kedaluwarsa masih berstatus layak jual — harus dikeluarkan.
  const expiredSellable = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'EXPIRED_STILL_SELLABLE', 'CRITICAL',
      'Kedaluwarsa masih layak jual: ' || p.name || ' (' || vb.batch_code || ') — ' || vb.sellable_qty || ' unit',
      'Batch lewat ED ' || to_char(vb.expiry_date, 'DD Mon YYYY') || ' tapi masih tercatat layak jual. Keluarkan lewat Keluar Manual (alasan: kedaluwarsa) agar tidak terjual.',
      'batch', vb.batch_id,
      'expired_sellable:' || vb.batch_id
    from v_batch_stock vb
    join products p on p.id = vb.product_id
    where vb.expiry_date < current_date and vb.sellable_qty > 0
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Kedaluwarsa masih sellable", found: expiredSellable.length });

  // 10. Batch mendekati kedaluwarsa (≤ 30 hari) dengan stok — info dini.
  const expiring = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'EXPIRING_SOON', 'INFO',
      'ED ≤ 30 hari: ' || p.name || ' (' || vb.batch_code || ') — ' || vb.sellable_qty || ' unit',
      'Kedaluwarsa ' || to_char(vb.expiry_date, 'DD Mon YYYY') || '. FEFO akan menghabiskan batch ini lebih dulu; pertimbangkan promo untuk mempercepat.',
      'batch', vb.batch_id,
      'expiring_soon:' || vb.batch_id
    from v_batch_stock vb
    join products p on p.id = vb.product_id
    where vb.expiry_date >= current_date
      and vb.expiry_date <= current_date + interval '30 days'
      and vb.sellable_qty > 0
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Mendekati kedaluwarsa", found: expiring.length });

  // 11. VERIFIKASI SALDO O(1): summary (stock_balances) harus SELALU sama
  //     dengan SUM(ledger). Summary hanyalah cache berkinerja — ledger tetap
  //     satu-satunya sumber kebenaran, dan di sinilah itu dibuktikan tiap hari.
  const summaryMismatch = await sql`
    insert into anomalies (type, severity, title, description, ref_type, ref_id, dedupe_key)
    select 'SUMMARY_LEDGER_MISMATCH', 'CRITICAL',
      'Saldo summary ≠ ledger: ' || p.name || ' (' || b.batch_code || ', ' || m.stock_state || ')',
      'stock_balances mencatat ' || m.summary_qty || ' tapi SUM(ledger) = ' || m.ledger_qty ||
      '. Ada penulisan di luar jalur resmi atau trigger gagal — audit segera.',
      'batch', m.batch_id,
      'summary_mismatch:' || m.batch_id || ':' || m.stock_state
    from (
      select coalesce(sb.product_id, l.product_id) as product_id,
             coalesce(sb.batch_id, l.batch_id) as batch_id,
             coalesce(sb.stock_state, l.stock_state) as stock_state,
             coalesce(sb.qty, 0) as summary_qty,
             coalesce(l.qty, 0) as ledger_qty
      from stock_balances sb
      full outer join (
        select product_id, batch_id, stock_state, sum(qty_delta)::int as qty
        from stock_ledger
        group by product_id, batch_id, stock_state
      ) l on l.product_id = sb.product_id
         and l.batch_id = sb.batch_id
         and l.stock_state = sb.stock_state
    ) m
    join products p on p.id = m.product_id
    join batches b on b.id = m.batch_id
    where m.summary_qty <> m.ledger_qty
    on conflict (dedupe_key) do nothing
    returning id
  `;
  results.push({ check: "Verifikasi summary vs ledger", found: summaryMismatch.length });

  return results;
}
