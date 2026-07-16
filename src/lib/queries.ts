// ============================================================================
// Kueri baca bersama (server-only). Semua angka stok SELALU turunan ledger —
// tidak ada tabel "stok saat ini" yang bisa diedit.
// ============================================================================

import { sql } from "@/lib/db";

export interface ProductStockRow {
  product_id: string;
  sku: string;
  name: string;
  is_active: boolean;
  sellable_qty: number;
  damaged_qty: number;
  quarantine_qty: number;
  reserved_qty: number;
  available_qty: number;
  /** true = stok awal masih perkiraan (belum tersentuh opname terposting). */
  baseline_unverified: boolean;
}

export async function getProductStock(): Promise<ProductStockRow[]> {
  const rows = await sql`
    select * from v_product_stock order by name
  `;
  return rows as unknown as ProductStockRow[];
}

export interface BatchStockRow {
  batch_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  batch_code: string;
  expiry_date: string | null;
  received_at: string;
  sellable_qty: number;
  damaged_qty: number;
  quarantine_qty: number;
}

export async function getBatchStock(): Promise<BatchStockRow[]> {
  const rows = await sql`
    select vb.*, p.name as product_name, p.sku as product_sku
    from v_batch_stock vb
    join products p on p.id = vb.product_id
    order by vb.expiry_date asc nulls last, p.name
  `;
  return rows as unknown as BatchStockRow[];
}

export interface LedgerRow {
  id: number;
  created_at: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  batch_id: string;
  batch_code: string;
  qty_delta: number;
  movement_type: string;
  reason: string;
  channel: string;
  stock_state: string;
  ref_type: string | null;
  ref_id: string | null;
  operator: string;
  note: string | null;
  reference: string | null;
  correction_of: number | null;
  /** id entri pembalik bila baris ini SUDAH dikoreksi (Koreksi Entri). */
  corrected_by: number | null;
}

export interface LedgerFilter {
  product_id?: string;
  batch_id?: string;
  movement_type?: string;
  reason?: string;
  channel?: string;
  stock_state?: string;
  ref_type?: string;
  ref_id?: string;
  limit?: number;
}

export async function getLedger(f: LedgerFilter = {}): Promise<LedgerRow[]> {
  const limit = Math.min(f.limit ?? 500, 2000);
  const rows = await sql`
    select l.*, p.name as product_name, p.sku as product_sku, b.batch_code,
           c.id as corrected_by
    from stock_ledger l
    join products p on p.id = l.product_id
    join batches b on b.id = l.batch_id
    left join stock_ledger c on c.correction_of = l.id
    where true
      ${f.product_id ? sql`and l.product_id = ${f.product_id}` : sql``}
      ${f.batch_id ? sql`and l.batch_id = ${f.batch_id}` : sql``}
      ${f.movement_type ? sql`and l.movement_type = ${f.movement_type}` : sql``}
      ${f.reason ? sql`and l.reason = ${f.reason}` : sql``}
      ${f.channel ? sql`and l.channel = ${f.channel}` : sql``}
      ${f.stock_state ? sql`and l.stock_state = ${f.stock_state}` : sql``}
      ${f.ref_type ? sql`and l.ref_type = ${f.ref_type}` : sql``}
      ${f.ref_id ? sql`and l.ref_id = ${f.ref_id}` : sql``}
    order by l.created_at desc, l.id desc
    limit ${limit}
  `;
  return rows as unknown as LedgerRow[];
}

export async function getProducts() {
  return sql`select * from products order by name`;
}

export async function getBundlesWithItems() {
  // Hanya resep VERSI AKTIF yang ditampilkan/dipakai. Versi lama tetap
  // tersimpan — order lama tidak berubah saat resep diedit (Phase 2).
  return sql`
    select bd.id, bd.sku, bd.name, bd.is_active, bd.active_version,
      coalesce(json_agg(json_build_object(
        'product_id', bi.product_id,
        'product_name', p.name,
        'product_sku', p.sku,
        'qty', bi.qty
      ) order by p.name) filter (where bi.id is not null), '[]') as items
    from bundles bd
    left join bundle_items bi
      on bi.bundle_id = bd.id and bi.version = bd.active_version
    left join products p on p.id = bi.product_id
    group by bd.id
    order by bd.name
  `;
}

export async function getOrders(limit = 300) {
  return sql`
    select o.*,
      (select count(*)::int from order_items oi where oi.order_id = o.id) as item_count,
      (select coalesce(sum(oi.qty), 0)::int from order_items oi where oi.order_id = o.id) as total_qty
    from orders o
    order by o.created_at desc
    limit ${limit}
  `;
}

export async function getOrderDetail(orderId: string) {
  const [order] = await sql`select * from orders where id = ${orderId}`;
  if (!order) return null;
  const items = await sql`
    select oi.*, p.name as product_name, p.sku as product_sku,
           bd.name as bundle_name
    from order_items oi
    join products p on p.id = oi.product_id
    left join bundles bd on bd.id = oi.bundle_id
    where oi.order_id = ${orderId}
  `;
  const events = await sql`
    select * from order_events where order_id = ${orderId} order by occurred_at
  `;
  const reservations = await sql`
    select r.*, p.name as product_name from reservations r
    join products p on p.id = r.product_id
    where r.order_id = ${orderId} order by r.created_at
  `;
  const ledger = await getLedger({ ref_type: "order", ref_id: orderId });
  const returns = await sql`
    select * from returns where order_id = ${orderId} order by created_at
  `;
  return { order, items, events, reservations, ledger, returns };
}

export async function getReturns() {
  return sql`
    select r.*, o.marketplace_order_id,
      (select coalesce(sum(ri.qty),0)::int from return_items ri where ri.return_id = r.id) as total_qty
    from returns r
    join orders o on o.id = r.order_id
    order by
      case r.status when 'RECEIVED' then 0 when 'IN_TRANSIT_BACK' then 1 else 2 end,
      r.created_at desc
  `;
}

export async function getReturnDetail(returnId: string) {
  const [ret] = await sql`
    select r.*, o.marketplace_order_id, o.id as order_id
    from returns r join orders o on o.id = r.order_id
    where r.id = ${returnId}
  `;
  if (!ret) return null;
  const items = await sql`
    select ri.*, p.name as product_name, p.sku as product_sku
    from return_items ri
    join products p on p.id = ri.product_id
    where ri.return_id = ${returnId}
  `;
  return { ret, items };
}

export async function getOpnameSessions() {
  return sql`
    select s.*,
      (select count(*)::int from opname_counts c where c.session_id = s.id) as count_rows,
      (select count(*)::int from opname_counts c where c.session_id = s.id and c.variance <> 0) as variance_rows
    from opname_sessions s
    order by s.started_at desc
  `;
}

export async function getAnomalies() {
  return sql`
    select * from anomalies
    order by
      case status when 'OPEN' then 0 when 'INVESTIGATING' then 1 else 2 end,
      case severity when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end,
      detected_at desc
  `;
}

/** Batch mendekati kedaluwarsa: tier ≤30 hari (kritis), ≤90 hari (perhatian), lewat. */
export async function getExpiringBatches() {
  return sql`
    select vb.*, p.name as product_name, p.sku as product_sku,
      (vb.expiry_date - current_date) as days_left
    from v_batch_stock vb
    join products p on p.id = vb.product_id
    where vb.expiry_date is not null
      and vb.sellable_qty > 0
      and vb.expiry_date <= current_date + interval '90 days'
    order by vb.expiry_date
  `;
}
