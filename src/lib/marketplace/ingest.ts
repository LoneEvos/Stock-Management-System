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

/** Pecah baris listing menjadi (product_id, qty, listing_sku, bundle_id, versi resep). */
async function explodeLines(
  tx: TransactionSql,
  lines: ListingLine[]
): Promise<
  {
    product_id: string;
    qty: number;
    listing_sku: string;
    bundle_id: string | null;
    bundle_version: number | null;
  }[]
> {
  const out: {
    product_id: string;
    qty: number;
    listing_sku: string;
    bundle_id: string | null;
    bundle_version: number | null;
  }[] = [];

  for (const line of lines) {
    // 1) SKU bundle? → pecah lewat resep admin VERSI AKTIF. Tidak ada stok
    //    bundle. Versi resep dicatat di order_items — edit resep di kemudian
    //    hari TIDAK mengubah pesanan lama (resep di-versioning, Phase 2).
    const bundle = await tx`
      select b.id, b.active_version from bundles b
      where b.sku = ${line.listing_sku} and b.is_active
    `;
    if (bundle.length > 0) {
      const items = await tx`
        select product_id, qty from bundle_items
        where bundle_id = ${bundle[0].id}
          and version = ${bundle[0].active_version}
      `;
      if (items.length === 0) {
        throw new Error(
          `Bundle ${line.listing_sku} tidak punya resep (versi aktif kosong).`
        );
      }
      for (const it of items) {
        out.push({
          product_id: it.product_id as string,
          qty: (it.qty as number) * line.qty,
          listing_sku: line.listing_sku,
          bundle_id: bundle[0].id as string,
          bundle_version: bundle[0].active_version as number,
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
      bundle_version: null,
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
          bundle_version: it.bundle_version,
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

      // Kirim SESUAI RESERVASI AKTIF (bukan order_items mentah): pembatalan
      // parsial sebelum kirim sudah mengurangi janji — yang keluar fisik
      // hanyalah yang masih dijanjikan.
      const items = await tx`
        select product_id, sum(qty)::int as qty
        from reservations
        where order_id = ${order.id} and status = 'ACTIVE'
        group by product_id
      `;
      if (items.length === 0) {
        return {
          ok: false,
          message: `Pesanan ${event.marketplace_order_id} tidak punya reservasi aktif — seluruh item sudah dibatalkan.`,
        };
      }

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
      const [order] = await sql`
        select id from orders
        where channel = ${event.channel}
          and marketplace_order_id = ${event.marketplace_order_id}
      `;
      await sql`
        insert into anomalies ${sql({
          type: "SHIP_FAILED_INSUFFICIENT_STOCK",
          severity: "CRITICAL",
          title: `Kirim gagal: stok catatan tidak cukup (${event.marketplace_order_id})`,
          description: `${e.message} Pesanan ${event.channel} ${event.marketplace_order_id} gagal diposting SALE_OUT. Periksa stok fisik vs catatan.`,
          ref_type: order ? "order" : "order_external",
          ref_id: order ? order.id : randomUUID(),
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

    const isPartial = !!event.lines && event.lines.length > 0;

    if (order.status === "CREATED") {
      // ---- Batal SEBELUM kirim: stok fisik tidak pernah bergerak. ----
      // Reservasi dilepas; jejak audit di reservations + order_events.
      if (isPartial) {
        // PARSIAL per item (Phase 2 #4): hanya baris yang disebut yang
        // dilepas. Bundle dipecah dulu → dihitung per produk satuan.
        const cancelled = await explodeLines(tx, event.lines!);
        for (const c of cancelled) {
          let remaining = c.qty;
          const resv = await tx`
            select id, qty from reservations
            where order_id = ${order.id} and product_id = ${c.product_id}
              and status = 'ACTIVE'
            order by created_at
            for update
          `;
          for (const r of resv) {
            if (remaining === 0) break;
            const take = Math.min(remaining, r.qty as number);
            await tx`
              update reservations
              set status = 'RELEASED', released_at = now(),
                  release_reason = ${"cancelled_partial: " + (event.reason ?? "-")}
              where id = ${r.id}
            `;
            if (take < (r.qty as number)) {
              // Sisa janji tetap hidup sebagai reservasi baru (berjejak,
              // bukan edit qty diam-diam).
              const [oi] = await tx`
                select order_item_id from reservations where id = ${r.id}
              `;
              await tx`
                insert into reservations ${tx({
                  order_item_id: oi.order_item_id,
                  order_id: order.id,
                  product_id: c.product_id,
                  qty: (r.qty as number) - take,
                  status: "ACTIVE",
                })}
              `;
            }
            remaining -= take;
          }
          if (remaining > 0) {
            throw new Error(
              `Qty batal melebihi reservasi aktif untuk produk pada pesanan ini.`
            );
          }
        }

        const [{ n: activeLeft }] = await tx`
          select count(*)::int as n from reservations
          where order_id = ${order.id} and status = 'ACTIVE'
        `;
        if ((activeLeft as number) === 0) {
          await tx`
            update orders set status = 'CANCELLED',
              cancelled_at = ${event.occurred_at ?? new Date().toISOString()}
            where id = ${order.id}
          `;
        }
        await logEvent(tx, {
          order_id: order.id as string,
          event_type: "CANCELLED_PARTIAL_BEFORE_SHIP",
          source,
          payload: event,
          occurred_at: event.occurred_at,
        });
        return {
          ok: true,
          message: `Pembatalan parsial ${event.marketplace_order_id} — reservasi item terkait dilepas, stok fisik tidak berubah.`,
          order_id: order.id as string,
        };
      }

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
      // diinspeksi gudang. Kebocoran klasik tertutup di sini. Parsial =
      // dokumen retur hanya untuk item yang dibatalkan. ----
      const returnId = await createReturnForOrder(tx, {
        order_id: order.id as string,
        channel: order.channel as "shopee" | "tiktok",
        reason: `Batal setelah kirim: ${event.reason ?? "-"}`,
        occurred_at: event.occurred_at,
        lines: isPartial ? event.lines : undefined,
      });
      if (!isPartial) {
        await tx`
          update orders set status = 'CANCELLED',
            cancelled_at = ${event.occurred_at ?? new Date().toISOString()}
          where id = ${order.id}
        `;
      }
      await logEvent(tx, {
        order_id: order.id as string,
        event_type: isPartial ? "CANCELLED_PARTIAL_AFTER_SHIP" : "CANCELLED_AFTER_SHIP",
        source,
        payload: event,
        occurred_at: event.occurred_at,
      });
      return {
        ok: true,
        message: `Pesanan ${event.marketplace_order_id} batal ${isPartial ? "PARSIAL " : ""}SESUDAH kirim — dokumen retur dibuat, stok pulih hanya lewat inspeksi retur.`,
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

    const isPartial = !!event.lines && event.lines.length > 0;
    const returnId = await createReturnForOrder(tx, {
      order_id: order.id as string,
      channel: order.channel as "shopee" | "tiktok",
      reason: event.reason ?? null,
      occurred_at: event.occurred_at,
      lines: isPartial ? event.lines : undefined,
    });

    await tx`
      update orders set status = 'RETURN_REQUESTED',
        return_requested_at = ${event.occurred_at ?? new Date().toISOString()}
      where id = ${order.id}
    `;
    await logEvent(tx, {
      order_id: order.id as string,
      event_type: isPartial ? "RETURN_CREATED_PARTIAL" : "RETURN_CREATED",
      source,
      payload: event,
      occurred_at: event.occurred_at,
    });
    return {
      ok: true,
      message: `Retur ${isPartial ? "parsial " : ""}dibuat untuk ${event.marketplace_order_id} — status IN_TRANSIT_BACK, menunggu barang tiba.`,
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

/**
 * Buat dokumen retur + itemnya. Tanpa `lines` = seluruh item pesanan.
 * Dengan `lines` (Phase 2 #4) = retur PARSIAL: bundle dipecah per produk
 * satuan, dan qty divalidasi terhadap yang dipesan − yang sudah pernah diretur.
 */
async function createReturnForOrder(
  tx: TransactionSql,
  params: {
    order_id: string;
    channel: "shopee" | "tiktok";
    reason: string | null;
    occurred_at?: string;
    lines?: ListingLine[];
  }
): Promise<string> {
  const createdAt = params.occurred_at ?? new Date().toISOString();
  // Batas klaim TikTok: 40 hari sejak RETUR DIAJUKAN — created_at retur,
  // bukan sejak IN_TRANSIT atau diterima pembeli (keputusan klien #1).
  const claimDeadline =
    params.channel === "tiktok"
      ? new Date(
          new Date(createdAt).getTime() + TIKTOK_CLAIM_DAYS * 86_400_000
        )
          .toISOString()
          .slice(0, 10)
      : null;

  const orderItems = await tx`
    select id, product_id, qty from order_items where order_id = ${params.order_id}
  `;

  // Item yang diretur: seluruh pesanan, atau subset (per produk satuan).
  let toReturn: { order_item_id: string; product_id: string; qty: number }[];

  if (!params.lines) {
    toReturn = orderItems.map((it) => ({
      order_item_id: it.id as string,
      product_id: it.product_id as string,
      qty: it.qty as number,
    }));
  } else {
    const exploded = await explodeLines(tx, params.lines);
    // Gabung per produk (retur bundle sebagian = per produk satuan).
    const perProduct = new Map<string, number>();
    for (const e of exploded) {
      perProduct.set(e.product_id, (perProduct.get(e.product_id) ?? 0) + e.qty);
    }

    // Validasi: qty retur ≤ dipesan − sudah pernah diretur (semua dokumen).
    const prior = await tx`
      select ri.product_id, coalesce(sum(ri.qty), 0)::int as qty
      from return_items ri
      join returns r on r.id = ri.return_id
      where r.order_id = ${params.order_id}
      group by ri.product_id
    `;
    const priorMap = new Map(prior.map((p) => [p.product_id as string, p.qty as number]));

    toReturn = [];
    for (const [productId, qty] of perProduct) {
      const ordered = orderItems
        .filter((it) => it.product_id === productId)
        .reduce((s, it) => s + (it.qty as number), 0);
      if (ordered === 0) {
        throw new Error(`Produk tidak ada di pesanan ini — retur ditolak.`);
      }
      const already = priorMap.get(productId) ?? 0;
      if (qty + already > ordered) {
        throw new Error(
          `Qty retur (${qty}) + retur sebelumnya (${already}) melebihi yang dipesan (${ordered}).`
        );
      }
      const anchor = orderItems.find((it) => it.product_id === productId)!;
      toReturn.push({
        order_item_id: anchor.id as string,
        product_id: productId,
        qty,
      });
    }
  }

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

  for (const it of toReturn) {
    await tx`
      insert into return_items ${tx({
        return_id: ret.id,
        order_item_id: it.order_item_id,
        product_id: it.product_id,
        qty: it.qty,
        condition: null, // NULL sampai gudang menginspeksi
      })}
    `;
  }
  return ret.id as string;
}
