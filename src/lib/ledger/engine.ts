// ============================================================================
// Ledger Engine — SATU-SATUNYA gerbang penulisan stok ke database.
// Logika (FEFO, arah, alasan) dihitung fungsi murni di postings.ts;
// modul ini mengeksekusinya secara ATOMIK (transaksi + advisory lock).
//
// Pertahanan berlapis terhadap angka salah:
//  1. Fungsi murni yang teruji unit test (postings.ts, fefo.ts)
//  2. Advisory lock per produk → tidak ada race alokasi ganda
//  3. CHECK constraint di Postgres (kombinasi type↔reason, arah qty)
//  4. Trigger append-only (UPDATE/DELETE ditolak database)
//  5. Trigger saldo non-negatif per (produk, batch, state)
// ============================================================================

import { sql, type TransactionSql } from "@/lib/db";
import type { BatchBalance, LedgerEntry } from "./types";

/**
 * Kunci advisory per produk di dalam transaksi — mencegah dua proses
 * mengalokasikan stok yang sama secara bersamaan (read-then-write race).
 */
export async function lockProduct(
  tx: TransactionSql,
  productId: string
): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${productId}))`;
}

/** Saldo sellable per batch sebuah produk — input FEFO. Panggil SETELAH lockProduct. */
export async function getBatchBalances(
  tx: TransactionSql,
  productId: string
): Promise<BatchBalance[]> {
  const rows = await tx`
    select b.id as batch_id,
           b.batch_code,
           b.expiry_date::text as expiry_date,
           coalesce(sum(l.qty_delta) filter (where l.stock_state = 'SELLABLE'), 0)::int as sellable_qty
    from batches b
    left join stock_ledger l on l.batch_id = b.id
    where b.product_id = ${productId}
    group by b.id, b.batch_code, b.expiry_date
  `;
  return rows as unknown as BatchBalance[];
}

/** Tulis entri-entri ledger dalam satu INSERT (atomik per statement). */
export async function insertEntries(
  tx: TransactionSql,
  entries: LedgerEntry[]
): Promise<number[]> {
  if (entries.length === 0) return [];
  const rows = await tx`
    insert into stock_ledger ${tx(
      entries.map((e) => ({
        product_id: e.product_id,
        batch_id: e.batch_id,
        qty_delta: e.qty_delta,
        movement_type: e.movement_type,
        reason: e.reason,
        channel: e.channel,
        stock_state: e.stock_state,
        ref_type: e.ref_type,
        ref_id: e.ref_id,
        operator: e.operator,
        note: e.note,
        correction_of: e.correction_of ?? null,
        created_at: e.created_at ?? new Date().toISOString(),
      }))
    )}
    returning id
  `;
  return rows.map((r) => Number(r.id));
}

/**
 * Jalankan operasi stok dalam satu transaksi. `fn` menerima tx dan util —
 * seluruh alur (baca saldo → bangun entri → tulis ledger → update dokumen)
 * commit atau rollback BERSAMA-SAMA.
 */
export async function withStockTransaction<T>(
  fn: (tx: TransactionSql) => Promise<T>
): Promise<T> {
  return (await sql.begin(fn)) as T;
}
