"use server";

// ============================================================================
// Inspeksi retur — nasib barang diputuskan MANUAL oleh gudang, bukan otomatis
// dari marketplace. Arah Phase 2 (Sync Update v2):
//   SELLABLE → RETURN_IN ke BATCH BARU bertanda "retur" (bukan batch asal:
//              expiry batch asal sering tak bisa dipastikan; batch baru tanpa
//              ED berada di urutan FEFO paling akhir → akurasi FEFO terjaga).
//   DAMAGED  → TANPA entri ledger. Stok sudah terpotong saat SHIPPED; entri
//              kedua = pengurangan ganda. Dicatat sebagai record audit di
//              return_items (kondisi RUSAK) untuk klaim/penjelasan.
//   LOST     → TANPA entri ledger, alasan sama. Statusnya DIPISAH dari rusak
//              karena proses klaimnya berbeda (klaim ekspedisi/marketplace).
// ============================================================================

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { buildReturnIn } from "@/lib/ledger/postings";
import type { Channel } from "@/lib/ledger/types";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function inspectReturn(input: {
  return_id: string;
  decisions: { return_item_id: string; condition: "SELLABLE" | "DAMAGED" | "LOST" }[];
}): Promise<ActionResult> {
  try {
    const operator = await requireOperator();
    if (input.decisions.length === 0)
      return { ok: false, message: "Tentukan kondisi setiap item terlebih dahulu." };

    const summary = await withStockTransaction(async (tx) => {
      const [ret] = await tx`
        select r.id, r.status, r.channel, r.order_id, o.marketplace_order_id
        from returns r
        join orders o on o.id = r.order_id
        where r.id = ${input.return_id}
        for update of r
      `;
      if (!ret) throw new Error("Dokumen retur tidak ditemukan.");
      if (ret.status !== "RECEIVED" && ret.status !== "IN_TRANSIT_BACK") {
        throw new Error(
          `Retur berstatus ${ret.status} — inspeksi hanya untuk retur yang belum diputuskan.`
        );
      }

      const items = await tx`
        select ri.id, ri.product_id, ri.qty, ri.condition, p.name as product_name
        from return_items ri
        join products p on p.id = ri.product_id
        where ri.return_id = ${input.return_id}
      `;

      const lines: string[] = [];
      for (const decision of input.decisions) {
        const item = items.find((i) => i.id === decision.return_item_id);
        if (!item) throw new Error("Item retur tidak ditemukan.");
        if (item.condition)
          throw new Error(`Item ${item.product_name} sudah pernah diputuskan.`);

        if (decision.condition === "SELLABLE") {
          // Batch BARU bertanda retur; satu batch per (produk, pesanan) —
          // retur lain produk sama di pesanan sama memakai batch yang sama.
          await lockProduct(tx, item.product_id as string);
          const batchCode = `RET-${ret.marketplace_order_id}`;
          const [batch] = await tx`
            insert into batches ${tx({
              product_id: item.product_id,
              batch_code: batchCode,
              expiry_date: null, // ED tak bisa dipastikan → FEFO paling akhir
              source: "retur",
            })}
            on conflict (product_id, batch_code)
            do update set source = 'retur'
            returning id
          `;
          const entries = buildReturnIn({
            product_id: item.product_id as string,
            batch_id: batch.id as string,
            qty: item.qty as number,
            channel: ret.channel as Channel,
            operator,
            ref: { ref_type: "return_item", ref_id: decision.return_item_id },
            note: `Inspeksi retur ${ret.marketplace_order_id} — layak jual, masuk batch retur`,
          });
          await insertEntries(tx, entries);
          lines.push(
            `${item.product_name}: layak jual → batch ${batchCode} (+${item.qty})`
          );
        } else {
          // DAMAGED / LOST: tanpa ledger (anti double-count) — record audit.
          lines.push(
            decision.condition === "DAMAGED"
              ? `${item.product_name}: RUSAK — record audit, tanpa pergerakan stok`
              : `${item.product_name}: HILANG di ekspedisi — record klaim, tanpa pergerakan stok`
          );
        }

        await tx`
          update return_items set condition = ${decision.condition}
          where id = ${decision.return_item_id}
        `;
      }

      // Semua item sudah diputuskan?
      const undecided = await tx`
        select count(*)::int as n from return_items
        where return_id = ${input.return_id} and condition is null
      `;
      if ((undecided[0].n as number) === 0) {
        await tx`
          update returns
          set status = 'INSPECTED', inspected_at = now(), inspected_by = ${operator}
          where id = ${input.return_id}
        `;
      }

      return lines;
    });

    revalidatePath("/retur");
    revalidatePath("/ledger");
    revalidatePath("/batch");
    revalidatePath("/");
    return { ok: true, message: `Inspeksi tersimpan — ${summary.join(" · ")}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Tandai klaim TikTok sudah diajukan (menghentikan pengingat deadline). */
export async function markClaimFiled(returnId: string): Promise<ActionResult> {
  try {
    await requireOperator();
    await sql`update returns set claim_filed = true where id = ${returnId}`;
    revalidatePath("/retur");
    return { ok: true, message: "Klaim ditandai sudah diajukan." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
