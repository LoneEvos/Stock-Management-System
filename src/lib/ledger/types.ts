// ============================================================================
// Tipe domain untuk Stock Ledger — sinkron dengan enum di supabase/migrations.
// ============================================================================

export type MovementType =
  | "INBOUND_MAKLON"
  | "INITIAL_COUNT"
  | "SALE_OUT"
  | "MANUAL_OUT"
  | "RETURN_IN"
  | "ADJUSTMENT_OPNAME"
  | "WRITE_OFF";

export type LedgerReason =
  | "maklon_receipt"
  | "initial_baseline"
  | "sale"
  | "offline_sale"
  | "bonus"
  | "promo"
  | "sample"
  | "damaged"
  | "expired"
  | "return_sellable"
  | "return_damaged"
  | "lost_in_transit"
  | "opname_correction"
  | "disposal";

export type Channel = "shopee" | "tiktok" | "offline" | "internal";

export type StockState = "SELLABLE" | "DAMAGED" | "QUARANTINE";

/** Alasan yang sah untuk keluar manual — reason & channel TIDAK PERNAH dicampur. */
export const MANUAL_OUT_REASONS = [
  "offline_sale",
  "bonus",
  "promo",
  "sample",
  "damaged",
  "expired",
] as const satisfies readonly LedgerReason[];

export type ManualOutReason = (typeof MANUAL_OUT_REASONS)[number];

/** Satu baris ledger yang AKAN ditulis (belum punya id/created_at). */
export interface LedgerEntry {
  product_id: string;
  batch_id: string;
  qty_delta: number;
  movement_type: MovementType;
  reason: LedgerReason;
  channel: Channel;
  stock_state: StockState;
  ref_type: string | null;
  ref_id: string | null;
  operator: string;
  note: string | null;
  correction_of?: number | null;
  /** Hanya untuk seed/impor riwayat — default: waktu sekarang (DB). */
  created_at?: string;
}

/** Saldo sellable sebuah batch — input untuk alokasi FEFO. */
export interface BatchBalance {
  batch_id: string;
  batch_code: string;
  /** null hanya untuk batch baseline stok awal */
  expiry_date: string | null; // ISO date
  sellable_qty: number;
}

/** Hasil alokasi FEFO per batch. */
export interface FefoAllocation {
  batch_id: string;
  batch_code: string;
  qty: number;
}
