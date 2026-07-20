"use server";

// ============================================================================
// Server actions Simulator — menyuntik event dummy ke pipeline ingest YANG
// SAMA dengan yang kelak dipakai API Shopee/TikTok asli (adapter pattern).
// ============================================================================

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { ingestEvent } from "@/lib/marketplace/ingest";
import {
  orderCancelled,
  orderCreated,
  orderDelivered,
  orderShipped,
  randomLines,
  returnCreated,
  returnReceived,
} from "@/lib/marketplace/simulator";
import type { IngestResult, MarketplaceChannel } from "@/lib/marketplace/types";
import { requireOperator } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/simulator");
  revalidatePath("/pesanan");
  revalidatePath("/retur");
  revalidatePath("/ledger");
  revalidatePath("/");
}

/** SKU kandidat pesanan: produk aktif dengan stok tersedia + bundle aktif. */
async function candidateSkus(): Promise<{ sku: string; maxQty: number }[]> {
  const prods = await sql`
    select sku, available_qty from v_product_stock
    where is_active and available_qty > 0
    order by random() limit 20
  `;
  const bundles = await sql`
    select sku from bundles where is_active order by random() limit 3
  `;
  return [
    ...prods.map((p) => ({
      sku: p.sku as string,
      maxQty: Math.min(3, p.available_qty as number),
    })),
    ...bundles.map((b) => ({ sku: b.sku as string, maxQty: 2 })),
  ];
}

export async function simNewOrder(
  channel: MarketplaceChannel,
  opts?: { forceBundle?: boolean }
): Promise<IngestResult> {
  const operator = await requireOperator();
  let lines;
  if (opts?.forceBundle) {
    const bundles = await sql`
      select sku from bundles where is_active order by random() limit 1
    `;
    if (bundles.length === 0)
      return { ok: false, message: "Belum ada bundle aktif — buat resep bundle dulu." };
    lines = [{ listing_sku: bundles[0].sku as string, qty: 1 + Math.floor(Math.random() * 2) }];
  } else {
    const skus = await candidateSkus();
    if (skus.length === 0)
      return { ok: false, message: "Tidak ada produk dengan stok tersedia." };
    lines = randomLines(skus, 3);
  }
  const res = await ingestEvent(orderCreated(channel, lines), "simulator", operator);
  refresh();
  return res;
}

/** Order dengan produk & qty pilihan operator (form "Buat Order"). */
export async function simNewOrderCustom(
  channel: MarketplaceChannel,
  listing_sku: string,
  qty: number
): Promise<IngestResult> {
  const operator = await requireOperator();
  if (!listing_sku) return { ok: false, message: "Pilih produk dulu." };
  const q = Math.floor(Number(qty));
  if (!Number.isFinite(q) || q <= 0)
    return { ok: false, message: "Qty harus angka positif." };
  const res = await ingestEvent(
    orderCreated(channel, [{ listing_sku, qty: q }]),
    "simulator",
    operator
  );
  refresh();
  return res;
}

export async function simShip(
  channel: MarketplaceChannel,
  marketplaceOrderId: string
): Promise<IngestResult> {
  const operator = await requireOperator();
  const res = await ingestEvent(
    orderShipped(channel, marketplaceOrderId),
    "simulator",
    operator
  );
  refresh();
  return res;
}

export async function simDeliver(
  channel: MarketplaceChannel,
  marketplaceOrderId: string
): Promise<IngestResult> {
  const operator = await requireOperator();
  const res = await ingestEvent(
    orderDelivered(channel, marketplaceOrderId),
    "simulator",
    operator
  );
  refresh();
  return res;
}

export async function simCancel(
  channel: MarketplaceChannel,
  marketplaceOrderId: string
): Promise<IngestResult> {
  const operator = await requireOperator();
  const res = await ingestEvent(
    orderCancelled(channel, marketplaceOrderId),
    "simulator",
    operator
  );
  refresh();
  return res;
}

export async function simReturnCreate(
  channel: MarketplaceChannel,
  marketplaceOrderId: string
): Promise<IngestResult> {
  const operator = await requireOperator();
  const res = await ingestEvent(
    returnCreated(channel, marketplaceOrderId),
    "simulator",
    operator
  );
  refresh();
  return res;
}

/**
 * Retur PARSIAL (Phase 2 #4): meretur 1 unit dari produk satuan pertama
 * pesanan — bundle dihitung per produk satuan, bukan seluruh bundle.
 */
export async function simReturnPartial(
  channel: MarketplaceChannel,
  marketplaceOrderId: string
): Promise<IngestResult> {
  const operator = await requireOperator();
  const [item] = await sql`
    select p.sku
    from order_items oi
    join orders o on o.id = oi.order_id
    join products p on p.id = oi.product_id
    where o.channel = ${channel} and o.marketplace_order_id = ${marketplaceOrderId}
    order by oi.qty desc
    limit 1
  `;
  if (!item)
    return { ok: false, message: "Pesanan tidak punya item untuk diretur." };
  const res = await ingestEvent(
    {
      type: "RETURN_CREATED",
      channel,
      marketplace_order_id: marketplaceOrderId,
      reason: "Retur sebagian (1 unit) — simulasi",
      lines: [{ listing_sku: item.sku as string, qty: 1 }],
    },
    "simulator",
    operator
  );
  refresh();
  return res;
}

export async function simReturnReceive(
  channel: MarketplaceChannel,
  marketplaceOrderId: string
): Promise<IngestResult> {
  const operator = await requireOperator();
  const res = await ingestEvent(
    returnReceived(channel, marketplaceOrderId),
    "simulator",
    operator
  );
  refresh();
  return res;
}

/**
 * Skenario "hari sibuk": beberapa pesanan masuk, sebagian dikirim, satu batal
 * sebelum kirim, satu batal sesudah kirim, satu retur — sekali klik untuk
 * mengisi demo dengan cerita lengkap.
 */
export async function simBusyDay(): Promise<IngestResult> {
  const operator = await requireOperator();
  const skus = await candidateSkus();
  if (skus.length < 3)
    return { ok: false, message: "Stok tersedia terlalu sedikit untuk skenario ini." };

  const log: string[] = [];
  const mk = async (channel: MarketplaceChannel) => {
    const ev = orderCreated(channel, randomLines(skus, 2));
    const r = await ingestEvent(ev, "simulator", operator);
    log.push(r.message);
    return ev.type === "ORDER_CREATED" ? ev.marketplace_order_id : "";
  };

  // 5 pesanan
  const o1 = await mk("shopee");
  const o2 = await mk("tiktok");
  const o3 = await mk("shopee");
  const o4 = await mk("tiktok");
  const o5 = await mk("shopee");

  // 3 dikirim
  for (const [ch, id] of [
    ["shopee", o1],
    ["tiktok", o2],
    ["shopee", o3],
  ] as const) {
    const r = await ingestEvent(orderShipped(ch, id), "simulator", operator);
    log.push(r.message);
  }
  // 1 batal sebelum kirim
  log.push((await ingestEvent(orderCancelled("tiktok", o4), "simulator", operator)).message);
  // 1 batal sesudah kirim → dokumen retur otomatis
  log.push((await ingestEvent(orderCancelled("shopee", o3), "simulator", operator)).message);
  // 1 sampai, lalu retur
  log.push((await ingestEvent(orderDelivered("tiktok", o2), "simulator", operator)).message);
  log.push((await ingestEvent(returnCreated("tiktok", o2), "simulator", operator)).message);
  // o5 dibiarkan CREATED (reservasi menggantung — bahan worklist)
  void o5;

  refresh();
  return {
    ok: true,
    message: `Skenario hari sibuk selesai — ${log.length} event diproses. Cek Pesanan, Retur, dan Buku Besar.`,
  };
}

/** Daftar pesanan untuk panel aksi simulator. */
export async function listSimOrders() {
  const rows = await sql`
    select o.id, o.marketplace_order_id, o.channel, o.status, o.created_at,
      (select coalesce(sum(oi.qty),0)::int from order_items oi where oi.order_id = o.id) as total_qty,
      (select string_agg(p.name || ' ×' || oi.qty, ', ' order by p.name)
         from order_items oi join products p on p.id = oi.product_id
         where oi.order_id = o.id) as items_label,
      exists(select 1 from returns r where r.order_id = o.id and r.status = 'IN_TRANSIT_BACK') as has_return_in_transit
    from orders o
    order by o.created_at desc
    limit 30
  `;
  return JSON.parse(JSON.stringify(rows)) as {
    id: string;
    marketplace_order_id: string;
    channel: MarketplaceChannel;
    status: string;
    created_at: string;
    total_qty: number;
    items_label: string | null;
    has_return_in_transit: boolean;
  }[];
}
