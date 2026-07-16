"use server";

// ============================================================================
// Inspeksi retur — nasib barang diputuskan MANUAL oleh gudang, bukan otomatis
// dari marketplace (keputusan klien):
//   SELLABLE → RETURN_IN ke stok layak jual (batch asal, sesuai SALE_OUT-nya)
//   DAMAGED  → RETURN_IN ke stok rusak (tidak pernah tercampur sellable)
//   LOST     → TANPA entri ledger: barang keluar saat kirim dan tidak pernah
//              kembali, jadi stok fisik memang sudah benar. Jejak ada di
//              dokumen retur + pengingat klaim TikTok. Menulis WRITE_OFF di
//              sini justru mengurangi stok DUA KALI — itulah bug yang sistem
//              ini berantas.
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
        select r.id, r.status, r.channel, r.order_id
        from returns r where r.id = ${input.return_id}
        for update
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

        if (decision.condition === "LOST") {
          // Tanpa ledger — lihat catatan desain di atas.
          await tx`
            update return_items set condition = 'LOST'
            where id = ${decision.return_item_id}
          `;
          lines.push(`${item.product_name}: HILANG di ekspedisi (tanpa pergerakan stok)`);
          continue;
        }

        // Kembalikan ke batch asal — dilacak dari SALE_OUT pesanan ini.
        await lockProduct(tx, item.product_id as string);
        const outRows = await tx`
          select l.batch_id, b.batch_code, sum(-l.qty_delta)::int as out_qty
          from stock_ledger l
          join batches b on b.id = l.batch_id
          where l.ref_type = 'order' and l.ref_id = ${ret.order_id}
            and l.product_id = ${item.product_id}
            and l.movement_type = 'SALE_OUT'
          group by l.batch_id, b.batch_code, b.expiry_date
          order by b.expiry_date asc nulls last
        `;
        if (outRows.length === 0) {
          throw new Error(
            `Tidak ditemukan SALE_OUT untuk ${item.product_name} di pesanan ini — tidak bisa menentukan batch asal.`
          );
        }

        let remaining = item.qty as number;
        const batchNotes: string[] = [];
        for (const row of outRows) {
          if (remaining === 0) break;
          const take = Math.min(remaining, row.out_qty as number);
          const entries = buildReturnIn({
            product_id: item.product_id as string,
            batch_id: row.batch_id as string,
            qty: take,
            condition: decision.condition,
            channel: ret.channel as Channel,
            operator,
            ref: { ref_type: "return_item", ref_id: decision.return_item_id },
            note: `Inspeksi retur — ${decision.condition === "SELLABLE" ? "layak jual" : "rusak"}`,
          });
          await insertEntries(tx, entries);
          batchNotes.push(`${row.batch_code}×${take}`);
          remaining -= take;
        }
        if (remaining > 0) {
          throw new Error(
            `Qty retur ${item.product_name} (${item.qty}) melebihi yang pernah keluar untuk pesanan ini.`
          );
        }

        await tx`
          update return_items set condition = ${decision.condition}
          where id = ${decision.return_item_id}
        `;
        lines.push(
          `${item.product_name}: ${decision.condition === "SELLABLE" ? "layak jual" : "rusak"} → ${batchNotes.join(", ")}`
        );
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
