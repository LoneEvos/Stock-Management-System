"use server";

// ============================================================================
// KOREKSI ENTRI (Phase 2 — sumber selisih ke-5: salah input admin).
// Reversal cepat tanpa menunggu opname: entri CERMIN ber-correction_of.
// Ledger tetap append-only; trigger DB memvalidasi cermin persis dan menolak
// koreksi kedua atas entri yang sama. Dibedakan dari ADJUSTMENT_OPNAME.
// ============================================================================

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { buildCorrection } from "@/lib/ledger/postings";
import type { StoredLedgerRow } from "@/lib/ledger/types";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface CorrectionPreview {
  ok: boolean;
  message?: string;
  product_name?: string;
  batch_code?: string;
  qty_delta?: number;
  /** Available produk SEKARANG dan SETELAH koreksi diposting. */
  available_before?: number;
  available_after?: number;
}

/**
 * Preview dampak koreksi — layar konfirmasi WAJIB menampilkan produk, qty,
 * dan dampak ke available stock sebelum tombol final (arah Phase 2).
 */
export async function getCorrectionPreview(
  ledgerId: number
): Promise<CorrectionPreview> {
  try {
    await requireOperator();
    const [row] = await sql`
      select l.id, l.product_id, l.qty_delta, l.movement_type, l.stock_state,
             p.name as product_name, b.batch_code,
             (select c.id from stock_ledger c where c.correction_of = l.id limit 1) as corrected_by
      from stock_ledger l
      join products p on p.id = l.product_id
      join batches b on b.id = l.batch_id
      where l.id = ${ledgerId}
    `;
    if (!row) return { ok: false, message: "Entri tidak ditemukan." };
    if (row.corrected_by)
      return { ok: false, message: "Entri ini sudah pernah dikoreksi." };
    if (row.movement_type === "SALE_OUT")
      return {
        ok: false,
        message:
          "SALE_OUT dikoreksi lewat alur batal/retur pesanan, bukan koreksi manual.",
      };

    const [stock] = await sql`
      select available_qty from v_product_stock where product_id = ${row.product_id}
    `;
    const available = (stock?.available_qty as number) ?? 0;
    const delta =
      row.stock_state === "SELLABLE" ? -(row.qty_delta as number) : 0;

    return {
      ok: true,
      product_name: row.product_name as string,
      batch_code: row.batch_code as string,
      qty_delta: row.qty_delta as number,
      available_before: available,
      available_after: available + delta,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function postCorrection(input: {
  ledger_id: number;
  note: string;
}): Promise<ActionResult> {
  try {
    const operator = await requireOperator();
    if (!input.note?.trim())
      return { ok: false, message: "Catatan alasan koreksi wajib diisi." };

    const result = await withStockTransaction(async (tx) => {
      const [orig] = await tx`
        select id, product_id, batch_id, qty_delta, movement_type, reason,
               channel, stock_state, ref_type, ref_id, reference
        from stock_ledger where id = ${input.ledger_id}
      `;
      if (!orig) throw new Error("Entri tidak ditemukan.");

      await lockProduct(tx, orig.product_id as string);
      const entries = buildCorrection({
        original: orig as unknown as StoredLedgerRow,
        operator,
        note: input.note,
      });
      // Trigger DB menolak bila sudah pernah dikoreksi / cermin tidak persis;
      // guard saldo menolak bila hasilnya membuat stok negatif.
      await insertEntries(tx, entries);
      return entries[0].qty_delta;
    });

    revalidatePath("/ledger");
    revalidatePath("/produk");
    revalidatePath("/");
    return {
      ok: true,
      message: `Koreksi diposting: ${result > 0 ? "+" : ""}${result} unit (entri pembalik baru — entri asal tetap tercatat).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
