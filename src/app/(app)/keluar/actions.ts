"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  getBatchBalances,
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { buildManualOut } from "@/lib/ledger/postings";
import { MANUAL_OUT_REASONS, type Channel, type ManualOutReason } from "@/lib/ledger/types";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Keluar manual — penutup kebocoran terbesar: bonus/promo/sampel yang dulu
 * "tak terlihat" kini WAJIB tercatat dengan alasan + kanal + operator.
 * Alokasi batch FEFO otomatis; operator tidak memilih batch.
 */
export async function postManualOut(input: {
  product_id: string;
  qty: number;
  reason: string;
  channel: string;
  note?: string;
}): Promise<ActionResult> {
  try {
    const operator = await requireOperator();
    const qty = Math.floor(Number(input.qty));
    if (!input.product_id) return { ok: false, message: "Pilih produk." };
    if (!Number.isFinite(qty) || qty <= 0)
      return { ok: false, message: "Qty harus bilangan bulat positif." };
    if (!MANUAL_OUT_REASONS.includes(input.reason as ManualOutReason))
      return { ok: false, message: "Alasan tidak valid — alasan wajib dipilih." };
    if (!["shopee", "tiktok", "offline", "internal"].includes(input.channel))
      return { ok: false, message: "Kanal tidak valid." };

    const outId = randomUUID();

    const allocationNote = await withStockTransaction(async (tx) => {
      await lockProduct(tx, input.product_id);
      const balances = await getBatchBalances(tx, input.product_id);
      const { entries, allocations } = buildManualOut({
        product_id: input.product_id,
        qty,
        reason: input.reason as ManualOutReason,
        channel: input.channel as Channel,
        batches: balances,
        operator,
        ref: { ref_type: "manual_out", ref_id: outId },
        note: input.note?.trim() || null,
      });
      await insertEntries(tx, entries);
      return allocations.map((a) => `${a.batch_code}×${a.qty}`).join(", ");
    });

    revalidatePath("/ledger");
    revalidatePath("/batch");
    revalidatePath("/");
    return {
      ok: true,
      message: `Keluar ${qty} unit — FEFO: ${allocationNote}. Tercatat dengan alasan & kanal.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
