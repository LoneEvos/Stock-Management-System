"use server";

// ============================================================================
// Impor file — jalur masuk data kedua di samping simulator/API.
//  1) Stok awal dari spreadsheet klien (nama produk + sisa stok) →
//     entri INITIAL_COUNT (baseline eksplisit & bertanggal) per produk,
//     di batch "AWAL" tanpa ED. Selisih berikutnya diukur dari titik ini.
//  2) Ekspor pesanan marketplace → pipeline ingest yang sama dengan simulator.
// ============================================================================

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { buildInitialCount } from "@/lib/ledger/postings";
import { ingestEvent } from "@/lib/marketplace/ingest";
import type { MarketplaceChannel } from "@/lib/marketplace/types";
import { requireOperator } from "@/lib/supabase/server";

export interface ImportResult {
  ok: boolean;
  message: string;
  detail?: string[];
}

function slugSku(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function importInitialStock(
  rows: { name: string; qty: number }[],
  createMissing: boolean
): Promise<ImportResult> {
  try {
    const operator = await requireOperator();
    const importId = randomUUID();
    const detail: string[] = [];
    let imported = 0,
      skipped = 0,
      created = 0;

    await withStockTransaction(async (tx) => {
      for (const raw of rows) {
        const name = raw.name?.trim();
        const qty = Math.floor(Number(raw.qty));
        if (!name) continue;
        if (!Number.isFinite(qty) || qty <= 0) {
          skipped++;
          detail.push(`Lewati "${name}": qty ${raw.qty} tidak valid/nol.`);
          continue;
        }

        // cocokkan nama (atau SKU) tanpa peduli kapital
        let [product] = await tx`
          select id, name from products
          where lower(name) = lower(${name}) or lower(sku) = lower(${name})
        `;
        if (!product) {
          if (!createMissing) {
            skipped++;
            detail.push(`Lewati "${name}": produk tidak dikenal.`);
            continue;
          }
          [product] = await tx`
            insert into products ${tx({ sku: slugSku(name), name })}
            returning id, name
          `;
          created++;
        }

        // baseline hanya sekali per produk — cegah dobel impor
        const [existing] = await tx`
          select 1 from stock_ledger
          where product_id = ${product.id} and movement_type = 'INITIAL_COUNT'
          limit 1
        `;
        if (existing) {
          skipped++;
          detail.push(
            `Lewati "${name}": sudah punya baseline stok awal — gunakan opname untuk koreksi.`
          );
          continue;
        }

        await lockProduct(tx, product.id as string);
        // batch baseline "AWAL" (tanpa ED — barang lama tanpa data)
        let [batch] = await tx`
          select id from batches
          where product_id = ${product.id} and batch_code = 'AWAL'
        `;
        if (!batch) {
          [batch] = await tx`
            insert into batches ${tx({
              product_id: product.id,
              batch_code: "AWAL",
              expiry_date: null,
              source: "stok-awal",
            })}
            returning id
          `;
        }

        const entries = buildInitialCount({
          product_id: product.id as string,
          batch_id: batch.id as string,
          qty,
          operator,
          note: "Impor stok awal dari spreadsheet",
          ref: { ref_type: "import", ref_id: importId },
        });
        await insertEntries(tx, entries);
        imported++;
      }
    });

    revalidatePath("/produk");
    revalidatePath("/ledger");
    revalidatePath("/");
    return {
      ok: true,
      message: `Impor stok awal selesai: ${imported} produk masuk baseline${created ? `, ${created} produk baru dibuat` : ""}${skipped ? `, ${skipped} dilewati` : ""}.`,
      detail,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function importOrders(
  rows: { order_id: string; channel: string; sku: string; qty: number }[]
): Promise<ImportResult> {
  try {
    const operator = await requireOperator();

    // kelompokkan baris per pesanan
    const grouped = new Map<
      string,
      { channel: MarketplaceChannel; lines: { listing_sku: string; qty: number }[] }
    >();
    for (const r of rows) {
      const channel = r.channel?.trim().toLowerCase();
      if (channel !== "shopee" && channel !== "tiktok") continue;
      const key = `${channel}:${r.order_id?.trim()}`;
      if (!r.order_id?.trim() || !r.sku?.trim()) continue;
      const qty = Math.floor(Number(r.qty));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!grouped.has(key)) grouped.set(key, { channel, lines: [] });
      grouped.get(key)!.lines.push({ listing_sku: r.sku.trim(), qty });
    }

    if (grouped.size === 0)
      return {
        ok: false,
        message:
          "Tidak ada baris valid. Kolom wajib: order_id, channel (shopee/tiktok), sku, qty.",
      };

    const detail: string[] = [];
    let okCount = 0,
      failCount = 0;
    for (const [key, order] of grouped) {
      const marketplace_order_id = key.split(":").slice(1).join(":");
      const res = await ingestEvent(
        {
          type: "ORDER_CREATED",
          channel: order.channel,
          marketplace_order_id,
          lines: order.lines,
        },
        "import",
        operator
      );
      if (res.ok) okCount++;
      else {
        failCount++;
        detail.push(res.message);
      }
    }

    revalidatePath("/pesanan");
    revalidatePath("/");
    return {
      ok: true,
      message: `Impor pesanan selesai: ${okCount} pesanan masuk sebagai reservasi${failCount ? `, ${failCount} gagal/duplikat` : ""}.`,
      detail,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
