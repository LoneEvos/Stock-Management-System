"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { buildInbound } from "@/lib/ledger/postings";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Terima barang dari maklon: buat/temukan batch → tulis ledger INBOUND. */
export async function postInbound(input: {
  product_id: string;
  qty: number;
  batch_code: string;
  expiry_date: string; // yyyy-mm-dd
  note?: string;
}): Promise<ActionResult> {
  try {
    const operator = await requireOperator();
    const qty = Math.floor(Number(input.qty));
    if (!input.product_id) return { ok: false, message: "Pilih produk." };
    if (!Number.isFinite(qty) || qty <= 0)
      return { ok: false, message: "Qty harus bilangan bulat positif." };
    if (!input.batch_code.trim())
      return { ok: false, message: "Kode batch wajib diisi." };
    if (!input.expiry_date)
      return { ok: false, message: "Tanggal kedaluwarsa wajib diisi (per batch)." };

    const receiptId = randomUUID();

    const result = await withStockTransaction(async (tx) => {
      await lockProduct(tx, input.product_id);

      // find-or-create batch untuk produk+kode ini
      const existing = await tx`
        select id, expiry_date::text as expiry_date from batches
        where product_id = ${input.product_id}
          and batch_code = ${input.batch_code.trim()}
      `;
      let batchId: string;
      if (existing.length > 0) {
        if (existing[0].expiry_date !== input.expiry_date) {
          throw new Error(
            `Batch ${input.batch_code} sudah ada dengan ED ${existing[0].expiry_date} — satu batch satu tanggal kedaluwarsa.`
          );
        }
        batchId = existing[0].id as string;
      } else {
        const [b] = await tx`
          insert into batches ${tx({
            product_id: input.product_id,
            batch_code: input.batch_code.trim(),
            expiry_date: input.expiry_date,
            source: "maklon",
          })}
          returning id
        `;
        batchId = b.id as string;
      }

      const entries = buildInbound({
        product_id: input.product_id,
        batch_id: batchId,
        qty,
        operator,
        note: input.note?.trim() || null,
        ref: { ref_type: "inbound", ref_id: receiptId },
      });
      await insertEntries(tx, entries);
      return batchId;
    });

    revalidatePath("/batch");
    revalidatePath("/ledger");
    revalidatePath("/");
    return {
      ok: true,
      message: `Masuk ${qty} unit ke batch ${input.batch_code} (id ${result.slice(0, 8)}…) — tercatat di buku besar.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
