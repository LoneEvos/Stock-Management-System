// ============================================================================
// FEFO (First Expired, First Out) — alokasi batch otomatis.
// Operator TIDAK PERNAH memilih batch; fungsi murni ini yang memutuskan.
// ============================================================================

import type { BatchBalance, FefoAllocation } from "./types";

export class InsufficientStockError extends Error {
  readonly requested: number;
  readonly available: number;
  constructor(requested: number, available: number) {
    super(
      `Stok tidak cukup: diminta ${requested}, tersedia ${available} (sellable).`
    );
    this.name = "InsufficientStockError";
    this.requested = requested;
    this.available = available;
  }
}

/**
 * Urutkan batch untuk FEFO:
 * 1. Kedaluwarsa terdekat lebih dulu.
 * 2. Batch tanpa kedaluwarsa (baseline stok awal) SETELAH semua batch
 *    berkedaluwarsa — barang lama tanpa data expiry dianggap paling akhir
 *    agar barang dengan tenggat jelas keluar duluan.
 * 3. Seri terakhir: batch_code, agar deterministik & bisa diuji.
 */
export function sortFefo(batches: BatchBalance[]): BatchBalance[] {
  return [...batches].sort((a, b) => {
    if (a.expiry_date === null && b.expiry_date === null)
      return a.batch_code.localeCompare(b.batch_code);
    if (a.expiry_date === null) return 1;
    if (b.expiry_date === null) return -1;
    const cmp = a.expiry_date.localeCompare(b.expiry_date);
    return cmp !== 0 ? cmp : a.batch_code.localeCompare(b.batch_code);
  });
}

/**
 * Alokasikan `qty` unit keluar dari batch-batch yang tersedia, FEFO.
 * Memecah lintas batch bila perlu. Fungsi murni — tidak menyentuh database.
 *
 * @throws InsufficientStockError bila total sellable tidak mencukupi.
 */
export function allocateFefo(
  qty: number,
  batches: BatchBalance[]
): FefoAllocation[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`Qty alokasi harus bilangan bulat positif, dapat: ${qty}`);
  }

  const usable = sortFefo(batches).filter((b) => b.sellable_qty > 0);
  const totalAvailable = usable.reduce((s, b) => s + b.sellable_qty, 0);
  if (totalAvailable < qty) {
    throw new InsufficientStockError(qty, totalAvailable);
  }

  const allocations: FefoAllocation[] = [];
  let remaining = qty;
  for (const b of usable) {
    if (remaining === 0) break;
    const take = Math.min(remaining, b.sellable_qty);
    allocations.push({ batch_id: b.batch_id, batch_code: b.batch_code, qty: take });
    remaining -= take;
  }
  return allocations;
}
