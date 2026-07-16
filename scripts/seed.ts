/* eslint-disable no-console */
// ============================================================================
// Seed data demo — jalankan SEKALI setelah migrasi:
//   npm run seed
//
// Mengisi: admin, ±67 produk (dari spreadsheet klien), baseline stok awal,
// batch maklon dengan ED bertingkat, bundle, riwayat pesanan/pergerakan 14
// hari, retur dalam berbagai nasib, sesi opname terposting, dan menjalankan
// pemeriksaan rekonsiliasi harian pertama.
// ============================================================================

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { sql } from "../src/lib/db";
import {
  getBatchBalances,
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "../src/lib/ledger/engine";
import {
  buildInbound,
  buildInitialCount,
  buildManualOut,
  buildOpnameAdjustment,
  buildReturnIn,
  buildSaleOut,
} from "../src/lib/ledger/postings";
import { ingestEvent } from "../src/lib/marketplace/ingest";
import type { ManualOutReason } from "../src/lib/ledger/types";
import { runDailyChecks } from "../src/lib/anomaly/checks";

const OPERATOR = "seed@sistem";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@stokdemo.id";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "RekonStok2026!";

// Nama & sisa stok dari spreadsheet klien (Juni 2026)
const PRODUCTS: [string, number][] = [
  ["Aura Hydrogel Mask", 41044],
  ["Aura Bloom Mask", 25260],
  ["Ampoule Tetong", 0],
  ["Amazing Jelly Booster", 3663],
  ["Body Mask Pink", 28634],
  ["Body Lotion Pink", 15405],
  ["Boost-8", 64],
  ["Boutskin", 1552],
  ["Beaute Milk", 3672],
  ["Brightening Booster", 293],
  ["Brightening Moisturizing", 1071],
  ["Coffee (L) New", 2971],
  ["Cocoa Chocolate", 3201],
  ["Collagen Wrinkle", 115],
  ["Cushion", 5],
  ["DNA Salmon", 27792],
  ["Daily Breast", 3574],
  ["Energizing", 19095],
  ["Exfoliating Overnight", 15744],
  ["F-Max", 153],
  ["Face Mist", 4874],
  ["Facial Wash", 2870],
  ["Feminine Wash", 9124],
  ["Go Flim New", 1749],
  ["Glicoluxe", 23420],
  ["Glowhite Gummy", 687],
  ["Glow Face Cream", 9036],
  ["Intimelogy", 3688],
  ["Korset", 103],
  ["Laxloss New", 22918],
  ["Lip Blushing Rose", 8161],
  ["Lip Cherry Crush", 6816],
  ["Lip Tomato Blast", 7285],
  ["Laxmi", 2038],
  ["Lip Berry Flame", 16355],
  ["Lip Coral Bliss", 17864],
  ["Love C", 5126],
  ["Masker Mugwort Hijau", 5969],
  ["Masker Volcanic Abu", 3115],
  ["Make Up Cream", 0],
  ["Moist Clarifying Gel", 34057],
  ["New Beauty Patch", 14104],
  ["Prime Blue Copper", 5221],
  ["Prime Red Energy", 999],
  ["Peachy", 8167],
  ["Princes Boom", 8518],
  ["Peel of Masker", 60769],
  ["Red Serum Boosting", 9904],
  ["Snowhite (L) Silver", 230],
  ["Snowhite (M) Silver", 1269],
  ["Skin Care Acne Green", 5445],
  ["Sabun Doosting Bar", 26899],
  ["Sabun Alpha Arbutin", 14529],
  ["Serum Merah", 1264],
  ["Serum Biru", 2749],
  ["Sweet Crush Peel of Lip", 5332],
  ["Sun Screen", 5120],
  ["Tone Up Cream", 5100],
  ["Whitening Skincare Set", 10896],
  ["Whitening Skincare Set (Big Size)", 5614],
  ["Whiteto", 1643],
  ["Red Body Lotion", 163],
  ["Daily Body Lotion", 113],
  ["Radiance Derma", 10102],
  ["Glass Skin PDRN", 1592],
];

function sku(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function daysAgo(n: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 50), 0, 0);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("== Seed Sistem Rekonsiliasi Stok ==");

  const [{ n }] = await sql`select count(*)::int as n from products`;
  if ((n as number) > 0) {
    console.log("Database sudah berisi produk — seed dibatalkan (tidak menimpa).");
    process.exit(0);
  }

  // ---------- 1. Admin ----------
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supaUrl && serviceKey) {
    const admin = createClient(supaUrl, serviceKey);
    const { error } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error && !error.message.includes("already")) {
      console.warn("Gagal membuat admin:", error.message);
    } else {
      console.log(`Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    }
  } else {
    console.warn("SUPABASE_SERVICE_ROLE_KEY tidak di-set — lewati pembuatan admin.");
  }

  // ---------- 2. Produk + baseline stok awal ----------
  console.log("Produk + baseline stok awal…");
  const productIds = new Map<string, string>();
  const importId = randomUUID();

  for (const [name, qty] of PRODUCTS) {
    const [p] = await sql`
      insert into products ${sql({ sku: sku(name), name })}
      returning id
    `;
    productIds.set(name, p.id as string);

    if (qty > 0) {
      const [batch] = await sql`
        insert into batches ${sql({
          product_id: p.id,
          batch_code: "AWAL",
          expiry_date: null,
          source: "stok-awal",
          received_at: daysAgo(45),
        })}
        returning id
      `;
      await withStockTransaction(async (tx) => {
        const entries = buildInitialCount({
          product_id: p.id as string,
          batch_id: batch.id as string,
          qty,
          operator: OPERATOR,
          note: "Impor stok awal dari spreadsheet (baseline Juni 2026)",
          ref: { ref_type: "import", ref_id: importId },
        });
        entries[0].created_at = daysAgo(45, 9);
        await insertEntries(tx, entries);
      });
    }
  }
  console.log(`  ${PRODUCTS.length} produk dibuat.`);

  // ---------- 3. Batch maklon dengan ED bertingkat ----------
  console.log("Batch maklon (FEFO & tier kedaluwarsa)…");
  const maklonPlan: { name: string; code: string; qty: number; edDays: number; receivedDaysAgo: number }[] = [
    { name: "Aura Hydrogel Mask", code: "MKL-2604-A", qty: 5000, edDays: 320, receivedDaysAgo: 30 },
    { name: "Aura Hydrogel Mask", code: "MKL-2606-B", qty: 8000, edDays: 500, receivedDaysAgo: 10 },
    { name: "DNA Salmon", code: "MKL-2605-S", qty: 4000, edDays: 250, receivedDaysAgo: 20 },
    { name: "Peel of Masker", code: "MKL-2606-P", qty: 10000, edDays: 400, receivedDaysAgo: 12 },
    { name: "Laxloss New", code: "MKL-2606-L", qty: 6000, edDays: 350, receivedDaysAgo: 8 },
    { name: "Sabun Doosting Bar", code: "MKL-2605-D", qty: 5000, edDays: 600, receivedDaysAgo: 25 },
    { name: "Lip Berry Flame", code: "MKL-2606-LB", qty: 3000, edDays: 450, receivedDaysAgo: 9 },
    { name: "Sun Screen", code: "MKL-2606-SS", qty: 2000, edDays: 280, receivedDaysAgo: 7 },
    { name: "Glow Face Cream", code: "MKL-2604-G", qty: 1500, edDays: 200, receivedDaysAgo: 35 },
    { name: "Body Mask Pink", code: "MKL-2606-BM", qty: 4000, edDays: 380, receivedDaysAgo: 11 },
    // tier peringatan: ≤90 hari & ≤30 hari
    { name: "Serum Merah", code: "MKL-2601-SM", qty: 400, edDays: 75, receivedDaysAgo: 40 },
    { name: "Face Mist", code: "MKL-2601-FM", qty: 350, edDays: 55, receivedDaysAgo: 40 },
    { name: "Glowhite Gummy", code: "MKL-2512-GG", qty: 150, edDays: 21, receivedDaysAgo: 42 },
    { name: "Boost-8", code: "MKL-2512-B8", qty: 80, edDays: 12, receivedDaysAgo: 42 },
    // sudah lewat ED tapi masih "layak jual" → anomali EXPIRED_STILL_SELLABLE
    { name: "Collagen Wrinkle", code: "MKL-2511-CW", qty: 60, edDays: -5, receivedDaysAgo: 44 },
  ];

  for (const plan of maklonPlan) {
    const pid = productIds.get(plan.name)!;
    const [batch] = await sql`
      insert into batches ${sql({
        product_id: pid,
        batch_code: plan.code,
        expiry_date: daysFromNow(plan.edDays),
        source: "maklon",
        received_at: daysAgo(plan.receivedDaysAgo),
      })}
      returning id
    `;
    await withStockTransaction(async (tx) => {
      const entries = buildInbound({
        product_id: pid,
        batch_id: batch.id as string,
        qty: plan.qty,
        operator: OPERATOR,
        note: `Penerimaan maklon ${plan.code}`,
        ref: { ref_type: "inbound", ref_id: randomUUID() },
      });
      entries[0].created_at = daysAgo(plan.receivedDaysAgo, 8);
      await insertEntries(tx, entries);
    });
  }
  console.log(`  ${maklonPlan.length} batch maklon diterima.`);

  // ---------- 4. Bundle ----------
  console.log("Resep bundle…");
  const bundles: { sku: string; name: string; items: [string, number][] }[] = [
    {
      sku: "PAKET-GLOWING",
      name: "Paket Glowing",
      items: [
        ["Aura Hydrogel Mask", 1],
        ["DNA Salmon", 1],
        ["Sun Screen", 1],
      ],
    },
    {
      sku: "PAKET-LIP-TRIO",
      name: "Paket Lip Trio",
      items: [
        ["Lip Berry Flame", 1],
        ["Lip Coral Bliss", 1],
        ["Lip Blushing Rose", 1],
      ],
    },
    {
      sku: "PAKET-BODY-CARE",
      name: "Paket Body Care",
      items: [
        ["Body Mask Pink", 1],
        ["Body Lotion Pink", 2],
      ],
    },
  ];
  for (const b of bundles) {
    const [bundle] = await sql`
      insert into bundles ${sql({ sku: b.sku, name: b.name })}
      returning id
    `;
    for (const [name, qty] of b.items) {
      await sql`
        insert into bundle_items ${sql({
          bundle_id: bundle.id,
          product_id: productIds.get(name)!,
          qty,
        })}
      `;
    }
  }

  // ---------- 5. Riwayat pesanan & pergerakan 14 hari ----------
  console.log("Riwayat pesanan 14 hari (via pipeline ingest)…");
  const popular = [
    "Aura Hydrogel Mask", "DNA Salmon", "Peel of Masker", "Laxloss New",
    "Sabun Doosting Bar", "Lip Berry Flame", "Sun Screen", "Glow Face Cream",
    "Body Mask Pink", "Moist Clarifying Gel", "Energizing", "Glicoluxe",
  ];
  let orderNo = 4000;

  for (let day = 13; day >= 1; day--) {
    const ordersToday = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < ordersToday; i++) {
      const channel = Math.random() < 0.5 ? "shopee" : "tiktok";
      const useBundle = Math.random() < 0.15;
      const lines = useBundle
        ? [{ listing_sku: bundles[Math.floor(Math.random() * bundles.length)].sku, qty: 1 }]
        : Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => ({
            listing_sku: sku(popular[Math.floor(Math.random() * popular.length)]),
            qty: 1 + Math.floor(Math.random() * 3),
          }));
      const mpId = `${channel === "shopee" ? "SPX" : "TTS"}-26-${orderNo++}`;
      const created = await ingestEvent(
        { type: "ORDER_CREATED", channel, marketplace_order_id: mpId, lines, occurred_at: daysAgo(day, 9) },
        "simulator",
        OPERATOR
      );
      if (!created.ok) continue;

      const fate = Math.random();
      if (fate < 0.75) {
        // dikirim (stok keluar FEFO), sebagian sampai
        await ingestEvent(
          { type: "ORDER_SHIPPED", channel, marketplace_order_id: mpId, occurred_at: daysAgo(day, 15) },
          "simulator",
          OPERATOR
        );
        if (day > 3 && Math.random() < 0.8) {
          await ingestEvent(
            { type: "ORDER_DELIVERED", channel, marketplace_order_id: mpId, occurred_at: daysAgo(Math.max(0, day - 2), 12) },
            "simulator",
            OPERATOR
          );
        }
      } else if (fate < 0.85) {
        // batal sebelum kirim — reservasi dilepas, stok tak bergerak
        await ingestEvent(
          { type: "ORDER_CANCELLED", channel, marketplace_order_id: mpId, reason: "Pembeli berubah pikiran", occurred_at: daysAgo(day, 13) },
          "simulator",
          OPERATOR
        );
      }
      // sisanya dibiarkan CREATED (reservasi aktif)
    }
  }

  // Keluar manual tersebar (bonus/promo/sampel/offline) — sumber selisih klasik
  console.log("Keluar manual (bonus, promo, sampel, offline)…");
  const manualPlan: { name: string; qty: number; reason: ManualOutReason; day: number; note: string }[] = [
    { name: "Aura Hydrogel Mask", qty: 24, reason: "bonus", day: 12, note: "Bonus checkout livestream TikTok" },
    { name: "DNA Salmon", qty: 12, reason: "promo", day: 10, note: "Giveaway anniversary" },
    { name: "Sun Screen", qty: 6, reason: "sample", day: 9, note: "Sampel reseller Surabaya" },
    { name: "Peel of Masker", qty: 150, reason: "offline_sale", day: 8, note: "PO bazar Jakarta" },
    { name: "Lip Berry Flame", qty: 10, reason: "bonus", day: 6, note: "Bonus paket >Rp200k" },
    { name: "Glow Face Cream", qty: 4, reason: "damaged", day: 5, note: "Pecah saat packing" },
    { name: "Sabun Doosting Bar", qty: 60, reason: "offline_sale", day: 3, note: "Penjualan kantor" },
    { name: "Body Mask Pink", qty: 8, reason: "sample", day: 2, note: "Konten kreator" },
  ];
  for (const m of manualPlan) {
    const pid = productIds.get(m.name)!;
    await withStockTransaction(async (tx) => {
      await lockProduct(tx, pid);
      const balances = await getBatchBalances(tx, pid);
      const { entries } = buildManualOut({
        product_id: pid,
        qty: m.qty,
        reason: m.reason,
        channel: m.reason === "offline_sale" ? "offline" : m.reason === "bonus" || m.reason === "promo" ? "tiktok" : "internal",
        batches: balances,
        operator: OPERATOR,
        ref: { ref_type: "manual_out", ref_id: randomUUID() },
        note: m.note,
      });
      for (const e of entries) e.created_at = daysAgo(m.day, 14);
      await insertEntries(tx, entries);
    });
  }

  // ---------- 6. Retur dengan berbagai nasib ----------
  console.log("Retur: layak jual, rusak, hilang (klaim TikTok)…");

  // a) retur SELESAI diinspeksi: 1 layak jual + 1 rusak
  const returnStories: { channel: "shopee" | "tiktok"; condition: "SELLABLE" | "DAMAGED"; day: number }[] = [
    { channel: "shopee", condition: "SELLABLE", day: 9 },
    { channel: "tiktok", condition: "DAMAGED", day: 7 },
  ];
  for (const story of returnStories) {
    const mpId = `${story.channel === "shopee" ? "SPX" : "TTS"}-26-${orderNo++}`;
    const item = popular[Math.floor(Math.random() * popular.length)];
    await ingestEvent(
      { type: "ORDER_CREATED", channel: story.channel, marketplace_order_id: mpId, lines: [{ listing_sku: sku(item), qty: 1 }], occurred_at: daysAgo(story.day + 4, 9) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "ORDER_SHIPPED", channel: story.channel, marketplace_order_id: mpId, occurred_at: daysAgo(story.day + 3, 15) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "RETURN_CREATED", channel: story.channel, marketplace_order_id: mpId, reason: "Tidak sesuai deskripsi", occurred_at: daysAgo(story.day + 2, 10) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "RETURN_RECEIVED", channel: story.channel, marketplace_order_id: mpId, occurred_at: daysAgo(story.day, 11) },
      "simulator", OPERATOR
    );
    // inspeksi manual (logika sama dengan action inspeksi)
    const [order] = await sql`select id from orders where marketplace_order_id = ${mpId}`;
    const [ret] = await sql`select id, channel, order_id from returns where order_id = ${order.id}`;
    const items = await sql`select id, product_id, qty from return_items where return_id = ${ret.id}`;
    await withStockTransaction(async (tx) => {
      for (const it of items) {
        const outRows = await tx`
          select l.batch_id, sum(-l.qty_delta)::int as out_qty
          from stock_ledger l
          where l.ref_type = 'order' and l.ref_id = ${ret.order_id}
            and l.product_id = ${it.product_id} and l.movement_type = 'SALE_OUT'
          group by l.batch_id limit 1
        `;
        const entries = buildReturnIn({
          product_id: it.product_id as string,
          batch_id: outRows[0].batch_id as string,
          qty: it.qty as number,
          condition: story.condition,
          channel: story.channel,
          operator: OPERATOR,
          ref: { ref_type: "return_item", ref_id: it.id as string },
          note: `Inspeksi retur — ${story.condition === "SELLABLE" ? "layak jual" : "rusak"}`,
        });
        entries[0].created_at = daysAgo(story.day, 13);
        await insertEntries(tx, entries);
        await tx`update return_items set condition = ${story.condition} where id = ${it.id}`;
      }
      await tx`
        update returns set status = 'INSPECTED', inspected_at = ${daysAgo(story.day, 13)}, inspected_by = ${OPERATOR}
        where id = ${ret.id}
      `;
    });
  }

  // b) retur TIBA, menunggu inspeksi (antrean demo)
  {
    const mpId = `SPX-26-${orderNo++}`;
    await ingestEvent(
      { type: "ORDER_CREATED", channel: "shopee", marketplace_order_id: mpId, lines: [{ listing_sku: "PAKET-GLOWING", qty: 1 }], occurred_at: daysAgo(6, 9) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "ORDER_SHIPPED", channel: "shopee", marketplace_order_id: mpId, occurred_at: daysAgo(5, 15) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "RETURN_CREATED", channel: "shopee", marketplace_order_id: mpId, reason: "Paket ditolak pembeli", occurred_at: daysAgo(4, 10) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "RETURN_RECEIVED", channel: "shopee", marketplace_order_id: mpId, occurred_at: daysAgo(0, 8) },
      "simulator", OPERATOR
    );
  }

  // c) retur TikTok hilang di ekspedisi — klaim mendekati batas 40 hari
  {
    const mpId = `TTS-26-${orderNo++}`;
    await ingestEvent(
      { type: "ORDER_CREATED", channel: "tiktok", marketplace_order_id: mpId, lines: [{ listing_sku: sku("Radiance Derma"), qty: 2 }], occurred_at: daysAgo(38, 9) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "ORDER_SHIPPED", channel: "tiktok", marketplace_order_id: mpId, occurred_at: daysAgo(37, 15) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "RETURN_CREATED", channel: "tiktok", marketplace_order_id: mpId, reason: "Paket tidak sampai — dikembalikan ekspedisi", occurred_at: daysAgo(34, 10) },
      "simulator", OPERATOR
    );
    // barang tak pernah tiba → inspeksi memutuskan HILANG (tanpa ledger)
    const [order] = await sql`select id from orders where marketplace_order_id = ${mpId}`;
    const [ret] = await sql`select id from returns where order_id = ${order.id}`;
    await sql`update return_items set condition = 'LOST' where return_id = ${ret.id}`;
    await sql`
      update returns set status = 'INSPECTED', inspected_at = ${daysAgo(2, 14)}, inspected_by = ${OPERATOR}
      where id = ${ret.id}
    `;
  }

  // d) batal SESUDAH kirim hari ini → dokumen retur menunggu barang kembali
  {
    const mpId = `SPX-26-${orderNo++}`;
    await ingestEvent(
      { type: "ORDER_CREATED", channel: "shopee", marketplace_order_id: mpId, lines: [{ listing_sku: sku("Energizing"), qty: 2 }], occurred_at: daysAgo(1, 9) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "ORDER_SHIPPED", channel: "shopee", marketplace_order_id: mpId, occurred_at: daysAgo(1, 15) },
      "simulator", OPERATOR
    );
    await ingestEvent(
      { type: "ORDER_CANCELLED", channel: "shopee", marketplace_order_id: mpId, reason: "Pembeli menolak paket", occurred_at: daysAgo(0, 9) },
      "simulator", OPERATOR
    );
  }

  // ---------- 7. Sesi opname terposting (dengan selisih & koreksi) ----------
  console.log("Sesi opname dengan selisih…");
  {
    const [session] = await sql`
      insert into opname_sessions ${sql({
        code: "OPN-DEMO-01",
        status: "OPEN",
        note: "Opname parsial gudang A (demo)",
        created_by: OPERATOR,
        started_at: daysAgo(1, 8),
      })}
      returning id, code
    `;

    // 3 batch: 1 cocok, 2 selisih (kurang & lebih)
    const opnamePlan: { name: string; code: string; diff: number }[] = [
      { name: "Aura Hydrogel Mask", code: "MKL-2604-A", diff: 0 },
      { name: "DNA Salmon", code: "MKL-2605-S", diff: -7 }, // fisik kurang 7
      { name: "Sun Screen", code: "MKL-2606-SS", diff: +3 }, // fisik lebih 3
    ];
    for (const plan of opnamePlan) {
      const pid = productIds.get(plan.name)!;
      const [batch] = await sql`
        select id from batches where product_id = ${pid} and batch_code = ${plan.code}
      `;
      const [{ system_qty }] = await sql`
        select coalesce(sum(qty_delta), 0)::int as system_qty
        from stock_ledger where batch_id = ${batch.id} and stock_state = 'SELLABLE'
      `;
      const physical = (system_qty as number) + plan.diff;
      const [count] = await sql`
        insert into opname_counts ${sql({
          session_id: session.id,
          product_id: pid,
          batch_id: batch.id,
          system_qty,
          physical_qty: physical,
          counted_at: daysAgo(1, 9),
        })}
        returning id
      `;
      if (plan.diff !== 0) {
        await withStockTransaction(async (tx) => {
          const entries = buildOpnameAdjustment({
            product_id: pid,
            batch_id: batch.id as string,
            variance: plan.diff,
            operator: OPERATOR,
            ref: { ref_type: "opname_count", ref_id: count.id as string },
            note: `Opname ${session.code}: fisik vs catatan batch ${plan.code}`,
          });
          entries[0].created_at = daysAgo(1, 10);
          await insertEntries(tx, entries);
        });
        await sql`
          insert into anomalies ${sql({
            type: "OPNAME_VARIANCE",
            severity: Math.abs(plan.diff) >= 10 ? "CRITICAL" : "WARNING",
            title: `Selisih opname ${plan.diff > 0 ? "+" : ""}${plan.diff} — ${plan.name} (${plan.code})`,
            description: `Sesi ${session.code}: hitung fisik berbeda ${plan.diff} unit dari catatan. Koreksi sudah diposting; telusuri pergerakan batch untuk menemukan penyebab.`,
            ref_type: "opname_count",
            ref_id: count.id,
            dedupe_key: `opname_variance:${count.id}`,
          })}
          on conflict (dedupe_key) do nothing
        `;
      }
    }
    await sql`
      update opname_sessions set status = 'POSTED', posted_at = ${daysAgo(1, 10)}
      where id = ${session.id}
    `;
  }

  // ---------- 8. Rekonsiliasi harian pertama ----------
  console.log("Menjalankan pemeriksaan rekonsiliasi harian…");
  const checks = await runDailyChecks();
  for (const c of checks) {
    if (c.found > 0) console.log(`  ${c.check}: ${c.found} anomali`);
  }

  const [{ ledger_rows }] = await sql`
    select count(*)::int as ledger_rows from stock_ledger
  `;
  console.log(`\nSelesai. ${ledger_rows} entri buku besar.`);
  console.log(`Login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed gagal:", e);
  process.exit(1);
});
