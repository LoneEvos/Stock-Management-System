import { describe, expect, it } from "vitest";
import { allocateFefo, InsufficientStockError, sortFefo } from "../fefo";
import type { BatchBalance } from "../types";

const batch = (
  id: string,
  expiry: string | null,
  qty: number
): BatchBalance => ({
  batch_id: id,
  batch_code: id,
  expiry_date: expiry,
  sellable_qty: qty,
});

describe("sortFefo", () => {
  it("mengurutkan kedaluwarsa terdekat lebih dulu", () => {
    const sorted = sortFefo([
      batch("B", "2026-12-01", 10),
      batch("A", "2026-08-01", 10),
      batch("C", "2027-03-01", 10),
    ]);
    expect(sorted.map((b) => b.batch_id)).toEqual(["A", "B", "C"]);
  });

  it("menempatkan batch tanpa expiry (baseline) paling akhir", () => {
    const sorted = sortFefo([
      batch("AWAL", null, 10),
      batch("B1", "2026-08-01", 10),
    ]);
    expect(sorted.map((b) => b.batch_id)).toEqual(["B1", "AWAL"]);
  });

  it("deterministik: seri sama diurutkan berdasar batch_code", () => {
    const sorted = sortFefo([
      batch("Z", "2026-08-01", 10),
      batch("A", "2026-08-01", 10),
    ]);
    expect(sorted.map((b) => b.batch_id)).toEqual(["A", "Z"]);
  });
});

describe("allocateFefo", () => {
  it("mengambil dari batch kedaluwarsa terdekat", () => {
    const alloc = allocateFefo(5, [
      batch("LAMBAT", "2027-01-01", 100),
      batch("CEPAT", "2026-08-01", 100),
    ]);
    expect(alloc).toEqual([{ batch_id: "CEPAT", batch_code: "CEPAT", qty: 5 }]);
  });

  it("memecah lintas batch bila batch pertama tidak cukup", () => {
    const alloc = allocateFefo(15, [
      batch("B2", "2026-12-01", 100),
      batch("B1", "2026-08-01", 10),
    ]);
    expect(alloc).toEqual([
      { batch_id: "B1", batch_code: "B1", qty: 10 },
      { batch_id: "B2", batch_code: "B2", qty: 5 },
    ]);
  });

  it("melewati batch dengan saldo 0", () => {
    const alloc = allocateFefo(3, [
      batch("KOSONG", "2026-07-01", 0),
      batch("ISI", "2026-09-01", 5),
    ]);
    expect(alloc).toEqual([{ batch_id: "ISI", batch_code: "ISI", qty: 3 }]);
  });

  it("melempar InsufficientStockError bila total tidak cukup", () => {
    expect(() => allocateFefo(10, [batch("B1", "2026-08-01", 4)])).toThrow(
      InsufficientStockError
    );
    try {
      allocateFefo(10, [batch("B1", "2026-08-01", 4)]);
    } catch (e) {
      const err = e as InsufficientStockError;
      expect(err.requested).toBe(10);
      expect(err.available).toBe(4);
    }
  });

  it("total alokasi selalu = qty diminta", () => {
    const batches = [
      batch("B1", "2026-08-01", 7),
      batch("B2", "2026-09-01", 3),
      batch("B3", "2026-10-01", 9),
    ];
    const alloc = allocateFefo(12, batches);
    expect(alloc.reduce((s, a) => s + a.qty, 0)).toBe(12);
  });

  it("menolak qty nol/negatif/pecahan", () => {
    const b = [batch("B1", "2026-08-01", 10)];
    expect(() => allocateFefo(0, b)).toThrow();
    expect(() => allocateFefo(-1, b)).toThrow();
    expect(() => allocateFefo(1.5, b)).toThrow();
  });
});
