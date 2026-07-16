"use server";

import { revalidatePath } from "next/cache";
import { runDailyChecks } from "@/lib/anomaly/checks";
import { sql } from "@/lib/db";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Jalankan pemeriksaan harian SEKARANG (selain jadwal cron). */
export async function runChecksNow(): Promise<ActionResult> {
  try {
    await requireOperator();
    const results = await runDailyChecks();
    const total = results.reduce((s, r) => s + r.found, 0);
    revalidatePath("/anomali");
    revalidatePath("/");
    return {
      ok: true,
      message:
        total === 0
          ? "Pemeriksaan selesai — tidak ada kejanggalan baru. Catatan konsisten."
          : `Pemeriksaan selesai — ${total} anomali baru: ${results
              .filter((r) => r.found > 0)
              .map((r) => `${r.check} (${r.found})`)
              .join(", ")}.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateAnomalyStatus(input: {
  id: string;
  status: "OPEN" | "INVESTIGATING" | "RESOLVED";
  resolution_note?: string;
}): Promise<ActionResult> {
  try {
    const operator = await requireOperator();
    if (input.status === "RESOLVED" && !input.resolution_note?.trim()) {
      return {
        ok: false,
        message:
          "Catatan penyelesaian wajib diisi — selisih harus punya cerita, bukan sekadar ditutup.",
      };
    }
    await sql`
      update anomalies set
        status = ${input.status},
        resolved_at = ${input.status === "RESOLVED" ? new Date().toISOString() : null},
        resolution_note = ${
          input.status === "RESOLVED"
            ? `${input.resolution_note!.trim()} — ${operator}`
            : (input.resolution_note?.trim() ?? null)
        }
      where id = ${input.id}
    `;
    revalidatePath("/anomali");
    revalidatePath("/");
    return { ok: true, message: "Status anomali diperbarui." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
