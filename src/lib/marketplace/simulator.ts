// ============================================================================
// Simulator marketplace — implementasi MarketplaceEventSource untuk demo.
//
// Menghasilkan event dummy yang REALISTIS (pesanan baru, kirim, batal, retur)
// dan menyuntikkannya ke pipeline ingest YANG SAMA dengan yang kelak dipakai
// API asli. Mengganti simulator dengan API Shopee/TikTok = menulis adapter
// baru penghasil MarketplaceEvent — logika inti tidak disentuh.
// ============================================================================

import type { ListingLine, MarketplaceChannel, MarketplaceEvent } from "./types";

let counter = 0;

/** Nomor pesanan bergaya marketplace: SPX-2607-4821 / TTS-2607-4822. */
export function generateOrderId(channel: MarketplaceChannel): string {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;
  counter = (counter + 1) % 10000;
  const rand = Math.floor(1000 + Math.random() * 9000) + counter;
  return `${channel === "shopee" ? "SPX" : "TTS"}-${stamp}-${rand}`;
}

/** Pilih 1–3 baris pesanan acak dari daftar SKU yang tersedia. */
export function randomLines(
  skus: { sku: string; maxQty: number }[],
  maxLines = 3
): ListingLine[] {
  const shuffled = [...skus].sort(() => Math.random() - 0.5);
  const n = Math.min(
    shuffled.length,
    1 + Math.floor(Math.random() * maxLines)
  );
  return shuffled.slice(0, n).map((s) => ({
    listing_sku: s.sku,
    qty: 1 + Math.floor(Math.random() * Math.min(3, Math.max(1, s.maxQty))),
  }));
}

export function orderCreated(
  channel: MarketplaceChannel,
  lines: ListingLine[],
  marketplace_order_id = generateOrderId(channel)
): MarketplaceEvent {
  return { type: "ORDER_CREATED", channel, marketplace_order_id, lines };
}

export function orderShipped(
  channel: MarketplaceChannel,
  marketplace_order_id: string
): MarketplaceEvent {
  return { type: "ORDER_SHIPPED", channel, marketplace_order_id };
}

export function orderDelivered(
  channel: MarketplaceChannel,
  marketplace_order_id: string
): MarketplaceEvent {
  return { type: "ORDER_DELIVERED", channel, marketplace_order_id };
}

const CANCEL_REASONS = [
  "Pembeli berubah pikiran",
  "Salah pilih varian",
  "Alamat tidak lengkap",
  "Tidak jadi butuh",
];

export function orderCancelled(
  channel: MarketplaceChannel,
  marketplace_order_id: string
): MarketplaceEvent {
  return {
    type: "ORDER_CANCELLED",
    channel,
    marketplace_order_id,
    reason: CANCEL_REASONS[Math.floor(Math.random() * CANCEL_REASONS.length)],
  };
}

const RETURN_REASONS = [
  "Barang tidak sesuai deskripsi",
  "Kemasan rusak saat diterima",
  "Pembeli menolak paket",
  "Produk bocor",
];

export function returnCreated(
  channel: MarketplaceChannel,
  marketplace_order_id: string
): MarketplaceEvent {
  return {
    type: "RETURN_CREATED",
    channel,
    marketplace_order_id,
    reason: RETURN_REASONS[Math.floor(Math.random() * RETURN_REASONS.length)],
  };
}

export function returnReceived(
  channel: MarketplaceChannel,
  marketplace_order_id: string
): MarketplaceEvent {
  return { type: "RETURN_RECEIVED", channel, marketplace_order_id };
}
