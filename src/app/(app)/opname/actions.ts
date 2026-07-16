"use server";

// ============================================================================
// Stok opname — hitung fisik vs catatan.
// Koreksi TIDAK PERNAH mengedit ledger: selisih diposting sebagai entri
// ADJUSTMENT_OPNAME baru yang menunjuk baris hitung (opname_count) sumbernya.
// ============================================================================

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  insertEntries,
  lockProduct,
  withStockTransaction,
} from "@/lib/ledger/engine";
import { buildOpnameAdjustment } from "@/lib/ledger/postings";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
  session_id?: string;
}

export async function createOpnameSession(note?: string): Promise<ActionResult> {
  try {
    const operator = await requireOperator();
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const [{ n }] = await sql`
      select count(*)::int as n from opname_sessions where code like ${"OPN-" + stamp + "%"}
    `;
    const code = `OPN-${stamp}-${String((n as number) + 1).padStart(2, "0")}`;
    const [session] = await sql`
      insert into opname_sessions ${sql({
        code,
        note: note?.trim() || null,
        created_by: operator,
      })}
      returning id
    `;
    revalidatePath("/opname");
    return {
      ok: true,
      message: `Sesi opname ${code} dibuat.`,
      session_id: session.id as string,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Simpan hasil hitung fisik satu batch. system_qty di-snapshot SAAT INI —
 * lakukan opname ketika tidak ada pergerakan agar perbandingan apel-ke-apel.
 */
export async function saveCount(input: {
  session_id: string;
  batch_id: string;
  physical_qty: number;
  note?: string;
}): Promise<ActionResult> {
  try {
    await requireOperator();
    const qty = Math.floor(Number(input.physical_qty));
    if (!Number.isFinite(qty) || qty < 0)
      return { ok: false, message: "Hasil hitung harus angka ≥ 0." };

    const result = await withStockTransaction(async (tx) => {
      const [session] = await tx`
        select status from opname_sessions where id = ${input.session_id} for update
      `;
      if (!session || session.status !== "OPEN")
        throw new Error("Sesi opname tidak terbuka.");

      const [batch] = await tx`
        select b.id, b.product_id,
          coalesce((select sum(l.qty_delta)::int from stock_ledger l
            where l.batch_id = b.id and l.stock_state = 'SELLABLE'), 0) as system_qty
        from batches b where b.id = ${input.batch_id}
      `;
      if (!batch) throw new Error("Batch tidak ditemukan.");

      await tx`
        insert into opname_counts ${tx({
          session_id: input.session_id,
          batch_id: input.batch_id,
          product_id: batch.product_id,
          system_qty: batch.system_qty,
          physical_qty: qty,
          note: input.note?.trim() || null,
        })}
        on conflict (session_id, batch_id) do update
        set physical_qty = ${qty},
            system_qty = ${batch.system_qty},
            note = ${input.note?.trim() || null},
            counted_at = now()
      `;
      return qty - (batch.system_qty as number);
    });

    revalidatePath("/opname");
    return {
      ok: true,
      message:
        result === 0
          ? "Cocok — fisik = catatan."
          : `Selisih ${result > 0 ? "+" : ""}${result} unit tercatat (belum diposting).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Posting koreksi: setiap baris dengan selisih ≠ 0 menjadi entri
 * ADJUSTMENT_OPNAME. Selisih besar otomatis masuk worklist anomali —
 * angka boleh dikoreksi, tapi CERITANYA harus dikejar.
 */
export async function postOpnameSession(sessionId: string): Promise<ActionResult> {
  try {
    const operator = await requireOperator();

    const summary = await withStockTransaction(async (tx) => {
      const [session] = await tx`
        select id, code, status from opname_sessions
        where id = ${sessionId} for update
      `;
      if (!session) throw new Error("Sesi tidak ditemukan.");
      if (session.status !== "OPEN")
        throw new Error(`Sesi berstatus ${session.status} — hanya sesi OPEN yang bisa diposting.`);

      const counts = await tx`
        select c.id, c.batch_id, c.product_id, c.variance, p.name as product_name,
               b.batch_code
        from opname_counts c
        join products p on p.id = c.product_id
        join batches b on b.id = c.batch_id
        where c.session_id = ${sessionId}
      `;
      if (counts.length === 0)
        throw new Error("Belum ada hasil hitung — isi dulu sebelum posting.");

      let adjusted = 0;
      for (const c of counts) {
        const variance = c.variance as number;
        if (variance === 0) continue;

        await lockProduct(tx, c.product_id as string);
        const entries = buildOpnameAdjustment({
          product_id: c.product_id as string,
          batch_id: c.batch_id as string,
          variance,
          operator,
          ref: { ref_type: "opname_count", ref_id: c.id as string },
          note: `Opname ${session.code}: fisik vs catatan batch ${c.batch_code}`,
        });
        await insertEntries(tx, entries);
        adjusted++;

        // Selisih = pertanyaan yang harus dijawab → masuk worklist.
        await tx`
          insert into anomalies ${tx({
            type: "OPNAME_VARIANCE",
            severity: Math.abs(variance) >= 10 ? "CRITICAL" : "WARNING",
            title: `Selisih opname ${variance > 0 ? "+" : ""}${variance} — ${c.product_name} (${c.batch_code})`,
            description: `Sesi ${session.code}: hitung fisik berbeda ${variance} unit dari catatan. Koreksi sudah diposting; telusuri pergerakan batch untuk menemukan penyebab.`,
            ref_type: "opname_count",
            ref_id: c.id,
            dedupe_key: `opname_variance:${c.id}`,
          })}
          on conflict (dedupe_key) do nothing
        `;
      }

      await tx`
        update opname_sessions set status = 'POSTED', posted_at = now()
        where id = ${sessionId}
      `;
      return { total: counts.length, adjusted };
    });

    revalidatePath("/opname");
    revalidatePath("/ledger");
    revalidatePath("/anomali");
    revalidatePath("/");
    return {
      ok: true,
      message: `Opname diposting — ${summary.total} batch dihitung, ${summary.adjusted} koreksi ditulis ke buku besar.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function cancelOpnameSession(sessionId: string): Promise<ActionResult> {
  try {
    await requireOperator();
    await sql`
      update opname_sessions set status = 'CANCELLED'
      where id = ${sessionId} and status = 'OPEN'
    `;
    revalidatePath("/opname");
    return { ok: true, message: "Sesi opname dibatalkan (tanpa koreksi apa pun)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
