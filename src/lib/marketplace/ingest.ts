// ============================================================================
// Pipeline ingest event marketplace — SATU pintu untuk simulator, impor file,
// dan (kelak) API asli. Menerjemahkan event menjadi:
//   dokumen (orders/returns) + reservasi + entri stock_ledger.
//
// Prinsip klien yang ditegakkan di sini:
//  • Pesanan dibuat = RESERVASI. Stok fisik belum bergerak.
//  • Barang dihitung keluar saat FISIK meninggalkan gudang
//    (Shopee SHIPPED / TikTok IN_TRANSIT) → SALE_OUT via FEFO.
//  • Batal SEBELUM kirim → reservasi dilepas, tidak ada pergerakan fisik.
//  • Batal SESUDAH kirim → otomatis membuat dokumen retur (barang akan
//    kembali) — kebocoran "pesanan batal tak pernah dikembalikan" tertutup.
//  • Bundle dipecah menjadi produk satuan DI SINI, saat data masuk.
// ============================================================================

import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import {
  getBatchBalances,
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { InsufficientStockError } from "@/lib/ledger/fefo";
import { buildSaleOut } from "@/lib/ledger/postings";
import type { TransactionSql } from "@/lib/db";
import type {
  EventSource,
  IngestResult,
  ListingLine,
  MarketplaceEvent,
} from "./types";

const TIKTOK_CLAIM_DAYS = 40;

export async function ingestEvent(
  event: MarketplaceEvent,
  source: EventSource,
  operator: string
): Promise<IngestResult> {
  try {
    switch (event.type) {
      case "ORDER_CREATED":
        return await handleOrderCreated(event, source);
      case "ORDER_SHIPPED":
        return await handleOrderShipped(event, source, operator);
      case "ORDER_DELIVERED":
        return await handleOrderDelivered(event, source);
      case "ORDER_CANCELLED":
        return await handleOrderCancelled(event, source);
      case "RETURN_CREATED":
        return await handleReturnCreated(event, source);
      case "RETURN_RECEIVED":
        return await handleReturnReceived(event, source);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

// ---------------------------------------------------------------------------

/** Pecah baris listing menjadi (product_id, qty, listing_sku, bundle_id). */
async function explodeLines(
  tx: TransactionSql,
  lines: ListingLine[]
): Promise<
  { product_id: string; qty: number; listing_sku: string; bundle_id: string | null }[]
> {
  const out: {
    product_id: string;
    qty: number;
    listing_sku: string;
    bundle_id: string | null;
  }[] = [];

  for (const line of lines) {
    // 1) SKU bundle? → pecah lewat resep admin. Tidak ada stok bundle.
    const bundle = await tx`
      select b.id from bundles b where b.sku = ${line.listing_sku} and b.is_active
    `;
    if (bundle.length > 0) {
      const items = await tx`
        select product_id, qty from bundle_items where bundle_id = ${bundle[0].id}
      `;
      if (items.length === 0) {
        throw new Error(
          `Bundle ${line.listing_sku} tidak punya resep (bundle_items kosong).`
        );
      }
      for (const it of items) {
        out.push({
          product_id: it.product_id as string,
          qty: (it.qty as number) * line.qty,
          listing_sku: line.listing_sku,
          bundle_id: bundle[0].id as string,
        });
      }
      continue;
    }

    // 2) SKU produk satuan
    const prod = await tx`
      select id from products where sku = ${line.listing_sku} and is_active
    `;
    if (prod.length === 0) {
      throw new Error(
        `SKU tidak dikenal: ${line.listing_sku}. Daftarkan produk atau resep bundle terlebih dahulu.`
      );
    }
    out.push({
      product_id: prod[0].id as string,
      qty: line.qty,
      listing_sku: line.listing_sku,
      bundle_id: null,
    });
  }
  return out;
}

async function logEvent(
  tx: TransactionSql,
  params: {
    order_id: string | null;
    event_type: string;
    source: EventSource;
    payload: unknown;
    occurred_at?: string;
  }
) {
  await tx`
    insert into order_events ${tx({
      order_id: params.order_id,
      event_type: params.event_type,
      source: params.source,
      payload: JSON.stringify(params.payload),
      occurred_at: params.occurred_at ?? new Date().toISOString(),
    })}
  `;
}

// ---------------------------------------------------------------------------

async function handleOrderCreated(
  event: Extract<MarketplaceEvent, { type: "ORDER_CREATED" }>,
  source: EventSource
): Promise<IngestResult> {
  return withStockTransaction(async (tx) => {
    const existing = await tx`
      select id from orders
      where channel = ${event.channel}
        and marketplace_order_id = ${event.marketplace_order_id}
    `;
    if (existing.length > 0) {
      return {
        ok: false,
        message: `Pesanan ${event.marketplace_order_id} (${event.channel}) sudah ada — event diabaikan.`,
      };
    }

    const items = await explodeLines(tx, event.lines);

    const [order] = await tx`
      insert into orders ${tx({
        marketplace_order_id: event.marketplace_order_id,
        channel: event.channel,
        status: "CREATED",
        created_at: event.occurred_at ?? new Date().toISOString(),
        raw_payload: JSON.stringify(event),
      })}
      returning id
    `;

    for (const it of items) {
      const [orderItem] = await tx`
        insert into order_items ${tx({
          order_id: order.id,
          product_id: it.product_id,
          qty: it.qty,
          listing_sku: it.listing_sku,
          bundle_id: it.bundle_id,
        })}
        returning id
      `;
      // RESERVASI — stok dijanjikan, belum keluar fisik.
      // Sengaja TIDAK ditolak bila available < 0: marketplace sudah menjualnya;
      // oversell adalah fakta yang harus MUNCUL sebagai anomali, bukan disembunyikan.
      await tx`
        insert into reservations ${tx({
          order_item_id: orderItem.id,
          order_id: order.id,
          product_id: it.product_id,
          qty: it.qty,
          status: "ACTIVE",
        })}
      `;
    }

    await logEvent(tx, {
      order_id: order.id as string,
      event_type: "ORDER_CREATED",
      source,
      payload: event,
      occurred_at: event.occurred_at,
    });

    return {
      ok: true,
      message: `Pesanan ${event.marketplace_order_id} dibuat — ${items.length} item direservasi (stok fisik belum bergerak).`,
      order_id: order.id as string,
    };
  });
}

async function handleOrderShipped(
  event: Extract<MarketplaceEvent, { type: "ORDER_SHIPPED" }>,
  source: EventSource,
  operator: string
): Promise<IngestResult> {
  try {
    return await withStockTransaction(async (tx) => {
      const [order] = await tx`
        select id, status from orders
        where channel = ${event.channel}
          and marketplace_order_id = ${event.marketplace_order_id}
        for update
      `;
      if (!order) throw new Error(`Pesanan ${event.marketplace_order_id} tidak ditemukan.`);
      if (order.status !== "CREATED") {
        return {
          ok: false,
          message: `Pesanan berstatus ${order.status} — tidak bisa dikirim (harus CREATED).`,
        };
      }

      const items = await tx`
        select id, product_id, qty from order_items where order_id = ${order.id}
      `;

      const batchNotes: string[] = [];
      for (const it of items) {
        await lockProduct(tx, it.product_id as string);
        const balances = await getBatchBalances(tx, it.product_id as string);
        const { entries, allocations } = buildSaleOut({
          product_id: it.product_id as string,
          qty: it.qty as number,
          channel: event.channel,
          batches: balances,
          operator,
          ref: { ref_type: "order", ref_id: order.id as string },
          note: `Kirim ${event.channel.toUpperCase()} ${event.marketplace_order_id}`,
        });
        await insertEntries(tx, entries);
        batchNotes.push(
          allocations.map((a) => `${a.batch_code}×${a.qty}`).join(", ")
        );
      }

      // Reservasi → CONVERTED (janji dipenuhi, kini tercatat sebagai keluar fisik)
      await tx`
        update reservations
        set status = 'CONVERTED', released_at = now(),
            release_reason = 'converted_on_ship'
        where order_id = ${order.id} and status = 'ACTIVE'
      `;

      await tx`
        update orders
        set status = 'SHIPPED', shipped_at = ${event.occurred_at ?? new Date().toISOString()}
        where id = ${order.id}
      `;

      await logEvent(tx, {
        order_id: order.id as string,
        event_type:
          event.channel === "tiktok" ? "IN_TRANSIT" : "SHIPPED",
        source,
        payload: event,
        occurred_at: event.occurred_at,
      });

      return {
        ok: true,
        message: `Pesanan ${event.marketplace_order_id} dikirim — SALE_OUT FEFO: ${batchNotes.join(" | ")}.`,
        order_id: order.id as string,
      };
    });
  } catch (e) {
    if (e instanceof InsufficientStockError) {
      // Marketplace bilang barang terkirim, catatan bilang stok kurang —
      // ini SELISIH NYATA yang harus muncul, bukan disembunyikan.
      await sql`
        insert into anomalies ${sql({
          type: "SHIP_FAILED_INSUFFICIENT_STOCK",
          severity: "CRITICAL",
          title: `Kirim gagal: stok catatan tidak cukup (${event.marketplace_order_id})`,
          description: `${e.message} Pesanan ${event.channel} ${event.marketplace_order_id} gagal diposting SALE_OUT. Periksa stok fisik vs catatan.`,
          ref_type: "order_external",
          ref_id: randomUUID(),
          dedupe_key: `ship_failed:${event.channel}:${event.marketplace_order_id}`,
        })}
        on conflict (dedupe_key) do nothing
      `;
      return {
        ok: false,
        message: `${e.message} — Anomali CRITICAL dicatat: stok catatan tidak cukup untuk pengiriman nyata.`,
      };
    }
    throw e;
  }
}

async function handleOrderDelivered(
  event: Extract<MarketplaceEvent, { type: "ORDER_DELIVERED" }>,
  source: EventSource
): Promise<IngestResult> {
  return withStockTransaction(async (tx) => {
    const [order] = await tx`
      select id, status from orders
      where channel = ${event.channel}
        and marketplace_order_id = ${event.marketplace_order_id}
      for update
    `;
    if (!order) throw new Error(`Pesanan ${event.marketplace_order_id} tidak ditemukan.`);
    if (order.status !== "SHIPPED") {
      return {
        ok: false,
        message: `Pesanan berstatus ${order.status} — DELIVERED hanya sah dari SHIPPED.`,
      };
    }
    await tx`
      update orders set status = 'DELIVERED',
        delivered_at = ${event.occurred_at ?? new Date().toISOString()}
      where id = ${order.id}
    `;
    await logEvent(tx, {
      order_id: order.id as string,
      event_type: "DELIVERED",
      source,
      payload: event,
      occurred_at: event.occurred_at,
    });
    return {
      ok: true,
      message: `Pesanan ${event.marketplace_order_id} sampai di pembeli.`,
      order_id: order.id as string,
    };
  });
}

async function handleOrderCancelled(
  event: Extract<MarketplaceEvent, { type: "ORDER_CANCELLED" }>,
  source: EventSource
): Promise<IngestResult> {
  return withStockTransaction(async (tx) => {
    const [order] = await tx`
      select id, status, channel from orders
      where channel = ${event.channel}
        and marketplace_order_id = ${event.marketplace_order_id}
      for update
    `;
    if (!order) throw new Error(`Pesanan ${event.marketplace_order_id} tidak ditemukan.`);

    if (order.status === "CREATED") {
      // ---- Batal SEBELUM kirim: stok fisik tidak pernah bergerak. ----
      // Reservasi dilepas; jejak audit di reservations + order_events.
      await tx`
        update reservations
        set status = 'RELEASED', released_at = now(),
            release_reason = ${"cancelled_before_ship: " + (event.reason ?? "-")}
        where order_id = ${order.id} and status = 'ACTIVE'
      `;
      await tx`
        update orders set status = 'CANCELLED',
          cancelled_at = ${event.occurred_at ?? new Date().toISOString()}
        where id = ${order.id}
      `;
      await logEvent(tx, {
        order_id: order.id as string,
        event_type: "CANCELLED_BEFORE_SHIP",
        source,
        payload: event,
        occurred_at: event.occurred_at,
      });
      return {
        ok: true,
        message: `Pesanan ${event.marketplace_order_id} batal SEBELUM kirim — reservasi dilepas, stok fisik tidak berubah.`,
        order_id: order.id as string,
      };
    }

    if (order.status === "SHIPPED") {
      // ---- Batal SESUDAH kirim: barang sudah keluar → WAJIB ada dokumen
      // retur yang menunggu barang kembali. Stok baru pulih saat retur
      // diinspeksi gudang. Kebocoran klasik tertutup di sini. ----
      const returnId = await createReturnForOrder(tx, {
        order_id: order.id as string,
        channel: order.channel as "shopee" | "tiktok",
        reason: `Batal setelah kirim: ${event.reason ?? "-"}`,
        occurred_at: event.occurred_at,
      });
      await tx`
        update orders set status = 'CANCELLED',
          cancelled_at = ${event.occurred_at ?? new Date().toISOString()}
        where id = ${order.id}
      `;
      await logEvent(tx, {
        order_id: order.id as string,
        event_type: "CANCELLED_AFTER_SHIP",
        source,
        payload: event,
        occurred_at: event.occurred_at,
      });
      return {
        ok: true,
        message: `Pesanan ${event.marketplace_order_id} batal SESUDAH kirim — dokumen retur dibuat, stok pulih hanya lewat inspeksi retur.`,
        order_id: order.id as string,
        return_id: returnId,
      };
    }

    return {
      ok: false,
      message: `Pesanan berstatus ${order.status} — tidak bisa dibatalkan.`,
    };
  });
}

async function handleReturnCreated(
  event: Extract<MarketplaceEvent, { type: "RETURN_CREATED" }>,
  source: EventSource
): Promise<IngestResult> {
  return withStockTransaction(async (tx) => {
    const [order] = await tx`
      select id, status, channel from orders
      where channel = ${event.channel}
        and marketplace_order_id = ${event.marketplace_order_id}
      for update
    `;
    if (!order) throw new Error(`Pesanan ${event.marketplace_order_id} tidak ditemukan.`);
    if (order.status !== "SHIPPED" && order.status !== "DELIVERED") {
      return {
        ok: false,
        message: `Retur hanya sah untuk pesanan SHIPPED/DELIVERED (sekarang: ${order.status}).`,
      };
    }

    const returnId = await createReturnForOrder(tx, {
      order_id: order.id as string,
      channel: order.channel as "shopee" | "tiktok",
      reason: event.reason ?? null,
      occurred_at: event.occurred_at,
    });

    await tx`
      update orders set status = 'RETURN_REQUESTED',
        return_requested_at = ${event.occurred_at ?? new Date().toISOString()}
      where id = ${order.id}
    `;
    await logEvent(tx, {
      order_id: order.id as string,
      event_type: "RETURN_CREATED",
      source,
      payload: event,
      occurred_at: event.occurred_at,
    });
    return {
      ok: true,
      message: `Retur dibuat untuk ${event.marketplace_order_id} — status IN_TRANSIT_BACK, menunggu barang tiba.`,
      order_id: order.id as string,
      return_id: returnId,
    };
  });
}

async function handleReturnReceived(
  event: Extract<MarketplaceEvent, { type: "RETURN_RECEIVED" }>,
  source: EventSource
): Promise<IngestResult> {
  return withStockTransaction(async (tx) => {
    const [order] = await tx`
      select id from orders
      where channel = ${event.channel}
        and marketplace_order_id = ${event.marketplace_order_id}
    `;
    if (!order) throw new Error(`Pesanan ${event.marketplace_order_id} tidak ditemukan.`);

    const [ret] = await tx`
      select id, status from returns
      where order_id = ${order.id} and status = 'IN_TRANSIT_BACK'
      order by created_at desc limit 1
      for update
    `;
    if (!ret) {
      return {
        ok: false,
        message: `Tidak ada retur IN_TRANSIT_BACK untuk pesanan ${event.marketplace_order_id}.`,
      };
    }

    // Barang tiba — TETAPI stok belum berubah. Kondisi (layak jual / rusak /
    // hilang) diputuskan MANUAL oleh gudang setelah inspeksi (keputusan klien).
    await tx`
      update returns set status = 'RECEIVED',
        received_at = ${event.occurred_at ?? new Date().toISOString()}
      where id = ${ret.id}
    `;
    await logEvent(tx, {
      order_id: order.id as string,
      event_type: "RETURN_RECEIVED",
      source,
      payload: event,
      occurred_at: event.occurred_at,
    });
    return {
      ok: true,
      message: `Paket retur ${event.marketplace_order_id} tiba di gudang — masuk antrean inspeksi.`,
      order_id: order.id as string,
      return_id: ret.id as string,
    };
  });
}

// ---------------------------------------------------------------------------

/** Buat dokumen retur + itemnya dari seluruh item pesanan. */
async function createReturnForOrder(
  tx: TransactionSql,
  params: {
    order_id: string;
    channel: "shopee" | "tiktok";
    reason: string | null;
    occurred_at?: string;
  }
): Promise<string> {
  const createdAt = params.occurred_at ?? new Date().toISOString();
  // Batas klaim TikTok: 40 hari sejak retur dibuat (keputusan klien).
  const claimDeadline =
    params.channel === "tiktok"
      ? new Date(
          new Date(createdAt).getTime() + TIKTOK_CLAIM_DAYS * 86_400_000
        )
          .toISOString()
          .slice(0, 10)
      : null;

  const [ret] = await tx`
    insert into returns ${tx({
      order_id: params.order_id,
      channel: params.channel,
      status: "IN_TRANSIT_BACK",
      reason: params.reason,
      created_at: createdAt,
      claim_deadline: claimDeadline,
    })}
    returning id
  `;

  const items = await tx`
    select id, product_id, qty from order_items where order_id = ${params.order_id}
  `;
  for (const it of items) {
    await tx`
      insert into return_items ${tx({
        return_id: ret.id,
        order_item_id: it.id,
        product_id: it.product_id,
        qty: it.qty,
        condition: null, // NULL sampai gudang menginspeksi
      })}
    `;
  }
  return ret.id as string;
}
