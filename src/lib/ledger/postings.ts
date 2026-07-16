// ============================================================================
// Pembuat entri ledger — FUNGSI MURNI, tanpa database.
// Setiap operasi stok diterjemahkan di sini menjadi baris-baris ledger.
// Semua penulisan stok di aplikasi WAJIB lewat modul ini (via engine.ts).
// ============================================================================

import { allocateFefo } from "./fefo";
import type {
  BatchBalance,
  Channel,
  FefoAllocation,
  LedgerEntry,
  ManualOutReason,
  StockState,
} from "./types";

interface Ref {
  ref_type: string;
  ref_id: string;
}

/** Barang masuk dari maklon → +qty SELLABLE ke batch yang baru diterima. */
export function buildInbound(params: {
  product_id: string;
  batch_id: string;
  qty: number;
  operator: string;
  note?: string | null;
  ref?: Ref;
}): LedgerEntry[] {
  assertPositiveInt(params.qty);
  return [
    {
      product_id: params.product_id,
      batch_id: params.batch_id,
      qty_delta: params.qty,
      movement_type: "INBOUND_MAKLON",
      reason: "maklon_receipt",
      channel: "internal",
      stock_state: "SELLABLE",
      ref_type: params.ref?.ref_type ?? "inbound",
      ref_id: params.ref?.ref_id ?? null,
      operator: params.operator,
      note: params.note ?? null,
    },
  ];
}

/** Stok awal (baseline) — titik nol yang eksplisit dan bertanggal. */
export function buildInitialCount(params: {
  product_id: string;
  batch_id: string;
  qty: number;
  operator: string;
  note?: string | null;
  ref?: Ref;
}): LedgerEntry[] {
  assertPositiveInt(params.qty);
  return [
    {
      product_id: params.product_id,
      batch_id: params.batch_id,
      qty_delta: params.qty,
      movement_type: "INITIAL_COUNT",
      reason: "initial_baseline",
      channel: "internal",
      stock_state: "SELLABLE",
      ref_type: params.ref?.ref_type ?? "import",
      ref_id: params.ref?.ref_id ?? null,
      operator: params.operator,
      note: params.note ?? null,
    },
  ];
}

/**
 * Keluar fisik saat pengiriman marketplace (Shopee SHIPPED / TikTok IN_TRANSIT).
 * Alokasi FEFO otomatis — bisa terpecah ke beberapa batch.
 */
export function buildSaleOut(params: {
  product_id: string;
  qty: number;
  channel: Channel;
  batches: BatchBalance[];
  operator: string;
  ref: Ref;
  note?: string | null;
}): { entries: LedgerEntry[]; allocations: FefoAllocation[] } {
  const allocations = allocateFefo(params.qty, params.batches);
  const entries = allocations.map<LedgerEntry>((a) => ({
    product_id: params.product_id,
    batch_id: a.batch_id,
    qty_delta: -a.qty,
    movement_type: "SALE_OUT",
    reason: "sale",
    channel: params.channel,
    stock_state: "SELLABLE",
    ref_type: params.ref.ref_type,
    ref_id: params.ref.ref_id,
    operator: params.operator,
    note: params.note ?? null,
  }));
  return { entries, allocations };
}

/**
 * Keluar manual — penjualan offline, bonus, promo, sampel, rusak, kedaluwarsa.
 * ALASAN wajib dan TERPISAH dari kanal: offline_sale ≠ bonus meski sama-sama
 * manual. Inilah penutup kebocoran terbesar (barang keluar tanpa pesanan).
 */
export function buildManualOut(params: {
  product_id: string;
  qty: number;
  reason: ManualOutReason;
  channel: Channel;
  batches: BatchBalance[];
  operator: string;
  ref: Ref;
  note?: string | null;
}): { entries: LedgerEntry[]; allocations: FefoAllocation[] } {
  const allocations = allocateFefo(params.qty, params.batches);
  const entries = allocations.map<LedgerEntry>((a) => ({
    product_id: params.product_id,
    batch_id: a.batch_id,
    qty_delta: -a.qty,
    movement_type: "MANUAL_OUT",
    reason: params.reason,
    channel: params.channel,
    stock_state: "SELLABLE",
    ref_type: params.ref.ref_type,
    ref_id: params.ref.ref_id,
    operator: params.operator,
    note: params.note ?? null,
  }));
  return { entries, allocations };
}

/**
 * Retur diterima & diinspeksi gudang — nasib ditentukan MANUAL oleh gudang:
 *  - SELLABLE → masuk kembali ke stok layak jual
 *  - DAMAGED  → masuk ke stok rusak/karantina (tidak pernah sellable)
 * (LOST tidak lewat sini — pakai buildReturnLost, karena barang tak pernah kembali.)
 */
export function buildReturnIn(params: {
  product_id: string;
  batch_id: string;
  qty: number;
  condition: "SELLABLE" | "DAMAGED";
  channel: Channel;
  operator: string;
  ref: Ref;
  note?: string | null;
}): LedgerEntry[] {
  assertPositiveInt(params.qty);
  const state: StockState =
    params.condition === "SELLABLE" ? "SELLABLE" : "DAMAGED";
  return [
    {
      product_id: params.product_id,
      batch_id: params.batch_id,
      qty_delta: params.qty,
      movement_type: "RETURN_IN",
      reason:
        params.condition === "SELLABLE" ? "return_sellable" : "return_damaged",
      channel: params.channel,
      stock_state: state,
      ref_type: params.ref.ref_type,
      ref_id: params.ref.ref_id,
      operator: params.operator,
      note: params.note ?? null,
    },
  ];
}

/**
 * Retur hilang di ekspedisi. Barang sudah keluar saat kirim (SALE_OUT) dan
 * tidak pernah kembali — secara fisik stok memang tidak berubah lagi.
 * Namun kejadiannya WAJIB berjejak: kita catat write-off 0-efek? TIDAK.
 * Desain: barang hilang TIDAK menghasilkan entri ledger (stok fisik sudah
 * benar), tapi return_item.condition = LOST + anomali klaim TikTok yang
 * menandai unit tersebut hilang — jejak ada di dokumen retur, bukan ledger.
 * Fungsi ini dipertahankan untuk kasus write-off stok DAMAGED (pemusnahan).
 */
export function buildWriteOff(params: {
  product_id: string;
  batch_id: string;
  qty: number;
  reason: "disposal" | "expired" | "damaged";
  from_state: StockState;
  operator: string;
  ref: Ref;
  note?: string | null;
}): LedgerEntry[] {
  assertPositiveInt(params.qty);
  return [
    {
      product_id: params.product_id,
      batch_id: params.batch_id,
      qty_delta: -params.qty,
      movement_type: "WRITE_OFF",
      reason: params.reason,
      channel: "internal",
      stock_state: params.from_state,
      ref_type: params.ref.ref_type,
      ref_id: params.ref.ref_id,
      operator: params.operator,
      note: params.note ?? null,
    },
  ];
}

/**
 * Koreksi opname: selisih hitung fisik vs catatan diposting sebagai
 * penyesuaian BARU (bukan edit). variance = fisik − sistem; bisa + atau −.
 */
export function buildOpnameAdjustment(params: {
  product_id: string;
  batch_id: string;
  variance: number;
  operator: string;
  ref: Ref;
  note?: string | null;
}): LedgerEntry[] {
  if (!Number.isInteger(params.variance) || params.variance === 0) {
    throw new Error(
      `Variance harus bilangan bulat ≠ 0, dapat: ${params.variance}`
    );
  }
  return [
    {
      product_id: params.product_id,
      batch_id: params.batch_id,
      qty_delta: params.variance,
      movement_type: "ADJUSTMENT_OPNAME",
      reason: "opname_correction",
      channel: "internal",
      stock_state: "SELLABLE",
      ref_type: params.ref.ref_type,
      ref_id: params.ref.ref_id,
      operator: params.operator,
      note: params.note ?? null,
    },
  ];
}

function assertPositiveInt(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`Qty harus bilangan bulat positif, dapat: ${qty}`);
  }
}
