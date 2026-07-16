import { describe, expect, it } from "vitest";
import {
  buildInbound,
  buildInitialCount,
  buildManualOut,
  buildOpnameAdjustment,
  buildReturnIn,
  buildSaleOut,
  buildWriteOff,
} from "../postings";
import type { BatchBalance } from "../types";

const P = "11111111-1111-1111-1111-111111111111";
const B1 = "22222222-2222-2222-2222-222222222222";
const B2 = "33333333-3333-3333-3333-333333333333";
const REF = { ref_type: "order", ref_id: "44444444-4444-4444-4444-444444444444" };

const batches: BatchBalance[] = [
  { batch_id: B1, batch_code: "BT-01", expiry_date: "2026-08-01", sellable_qty: 10 },
  { batch_id: B2, batch_code: "BT-02", expiry_date: "2026-12-01", sellable_qty: 50 },
];

describe("buildInbound", () => {
  it("menghasilkan +qty SELLABLE dengan reason maklon_receipt", () => {
    const [e] = buildInbound({
      product_id: P, batch_id: B1, qty: 100, operator: "admin",
    });
    expect(e.qty_delta).toBe(100);
    expect(e.movement_type).toBe("INBOUND_MAKLON");
    expect(e.reason).toBe("maklon_receipt");
    expect(e.stock_state).toBe("SELLABLE");
    expect(e.channel).toBe("internal");
  });
});

describe("buildInitialCount", () => {
  it("baseline eksplisit dengan reason initial_baseline", () => {
    const [e] = buildInitialCount({
      product_id: P, batch_id: B1, qty: 41044, operator: "admin",
    });
    expect(e.movement_type).toBe("INITIAL_COUNT");
    expect(e.reason).toBe("initial_baseline");
    expect(e.qty_delta).toBe(41044);
  });
});

describe("buildSaleOut", () => {
  it("FEFO: keluar dari batch kedaluwarsa terdekat, pecah bila perlu", () => {
    const { entries, allocations } = buildSaleOut({
      product_id: P, qty: 15, channel: "shopee", batches, operator: "system", ref: REF,
    });
    expect(allocations).toEqual([
      { batch_id: B1, batch_code: "BT-01", qty: 10 },
      { batch_id: B2, batch_code: "BT-02", qty: 5 },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].qty_delta).toBe(-10);
    expect(entries[1].qty_delta).toBe(-5);
    for (const e of entries) {
      expect(e.movement_type).toBe("SALE_OUT");
      expect(e.reason).toBe("sale");
      expect(e.channel).toBe("shopee");
      expect(e.ref_type).toBe("order");
    }
  });
});

describe("buildManualOut — alasan & kanal terpisah", () => {
  it("bonus ≠ offline_sale meski kanal sama", () => {
    const bonus = buildManualOut({
      product_id: P, qty: 2, reason: "bonus", channel: "offline",
      batches, operator: "admin", ref: { ref_type: "manual_out", ref_id: REF.ref_id },
    });
    const sale = buildManualOut({
      product_id: P, qty: 2, reason: "offline_sale", channel: "offline",
      batches, operator: "admin", ref: { ref_type: "manual_out", ref_id: REF.ref_id },
    });
    expect(bonus.entries[0].reason).toBe("bonus");
    expect(sale.entries[0].reason).toBe("offline_sale");
    expect(bonus.entries[0].channel).toBe("offline");
    expect(sale.entries[0].channel).toBe("offline");
  });
});

describe("buildReturnIn — nasib retur diputuskan gudang", () => {
  it("SELLABLE → masuk stok layak jual", () => {
    const [e] = buildReturnIn({
      product_id: P, batch_id: B1, qty: 1, condition: "SELLABLE",
      channel: "tiktok", operator: "admin", ref: { ref_type: "return_item", ref_id: REF.ref_id },
    });
    expect(e.qty_delta).toBe(1);
    expect(e.stock_state).toBe("SELLABLE");
    expect(e.reason).toBe("return_sellable");
  });

  it("DAMAGED → masuk stok rusak, TIDAK menyentuh sellable", () => {
    const [e] = buildReturnIn({
      product_id: P, batch_id: B1, qty: 1, condition: "DAMAGED",
      channel: "shopee", operator: "admin", ref: { ref_type: "return_item", ref_id: REF.ref_id },
    });
    expect(e.stock_state).toBe("DAMAGED");
    expect(e.reason).toBe("return_damaged");
  });
});

describe("buildWriteOff", () => {
  it("pemusnahan stok rusak keluar dari state DAMAGED", () => {
    const [e] = buildWriteOff({
      product_id: P, batch_id: B1, qty: 3, reason: "disposal",
      from_state: "DAMAGED", operator: "admin", ref: { ref_type: "write_off", ref_id: REF.ref_id },
    });
    expect(e.qty_delta).toBe(-3);
    expect(e.stock_state).toBe("DAMAGED");
  });
});

describe("buildOpnameAdjustment", () => {
  it("variance positif dan negatif sama-sama sah", () => {
    const [plus] = buildOpnameAdjustment({
      product_id: P, batch_id: B1, variance: 4, operator: "admin",
      ref: { ref_type: "opname_count", ref_id: REF.ref_id },
    });
    const [minus] = buildOpnameAdjustment({
      product_id: P, batch_id: B1, variance: -7, operator: "admin",
      ref: { ref_type: "opname_count", ref_id: REF.ref_id },
    });
    expect(plus.qty_delta).toBe(4);
    expect(minus.qty_delta).toBe(-7);
    expect(plus.movement_type).toBe("ADJUSTMENT_OPNAME");
  });

  it("variance 0 ditolak — tidak ada entri tanpa makna", () => {
    expect(() =>
      buildOpnameAdjustment({
        product_id: P, batch_id: B1, variance: 0, operator: "admin",
        ref: { ref_type: "opname_count", ref_id: REF.ref_id },
      })
    ).toThrow();
  });
});
