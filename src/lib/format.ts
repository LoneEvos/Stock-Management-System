// Label Bahasa Indonesia untuk enum + util format. Satu sumber kebenaran
// agar istilah konsisten di seluruh UI.

import { format, formatDistanceToNow, differenceInCalendarDays } from "date-fns";
import { id as localeId } from "date-fns/locale";

export const MOVEMENT_LABEL: Record<string, string> = {
  INBOUND_MAKLON: "Masuk dari Maklon",
  INITIAL_COUNT: "Stok Awal (Baseline)",
  SALE_OUT: "Keluar — Penjualan",
  MANUAL_OUT: "Keluar — Manual",
  RETURN_IN: "Masuk — Retur",
  ADJUSTMENT_OPNAME: "Koreksi Opname",
  WRITE_OFF: "Penghapusan",
};

export const REASON_LABEL: Record<string, string> = {
  maklon_receipt: "Penerimaan maklon",
  initial_baseline: "Stok awal (baseline)",
  sale: "Penjualan marketplace",
  offline_sale: "Penjualan offline",
  bonus: "Bonus",
  promo: "Promo",
  sample: "Sampel",
  damaged: "Barang rusak",
  expired: "Kedaluwarsa",
  return_sellable: "Retur layak jual",
  return_damaged: "Retur rusak",
  lost_in_transit: "Hilang di ekspedisi",
  opname_correction: "Koreksi hasil opname",
  disposal: "Pemusnahan",
};

export const CHANNEL_LABEL: Record<string, string> = {
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  offline: "Offline",
  internal: "Internal",
};

export const STATE_LABEL: Record<string, string> = {
  SELLABLE: "Layak jual",
  DAMAGED: "Rusak",
  QUARANTINE: "Karantina",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  CREATED: "Dibuat (reservasi)",
  SHIPPED: "Dikirim",
  DELIVERED: "Sampai",
  CANCELLED: "Dibatalkan",
  RETURN_REQUESTED: "Retur diajukan",
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  IN_TRANSIT_BACK: "Dalam perjalanan kembali",
  RECEIVED: "Tiba — menunggu inspeksi",
  INSPECTED: "Sudah diinspeksi",
  CLOSED: "Selesai",
};

export const CONDITION_LABEL: Record<string, string> = {
  SELLABLE: "Layak jual",
  DAMAGED: "Rusak",
  LOST: "Hilang di ekspedisi",
};

export const ANOMALY_STATUS_LABEL: Record<string, string> = {
  OPEN: "Terbuka",
  INVESTIGATING: "Diinvestigasi",
  RESOLVED: "Selesai",
};

export const SEVERITY_LABEL: Record<string, string> = {
  INFO: "Info",
  WARNING: "Perhatian",
  CRITICAL: "Kritis",
};

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM yyyy HH:mm", { locale: localeId });
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM yyyy", { locale: localeId });
}

export function fmtAgo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return formatDistanceToNow(new Date(d), { addSuffix: true, locale: localeId });
}

export function fmtQty(n: number): string {
  return new Intl.NumberFormat("id-ID").format(n);
}

export function fmtDelta(n: number): string {
  return n > 0 ? `+${fmtQty(n)}` : fmtQty(n);
}

/** Hari tersisa menuju sebuah tanggal (negatif = sudah lewat). */
export function daysUntil(d: string | Date): number {
  return differenceInCalendarDays(new Date(d), new Date());
}
