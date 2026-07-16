// Rekonsiliasi harian via Vercel Cron (vercel.json) — juga bisa dipicu manual
// dari halaman Anomali. Dilindungi CRON_SECRET.

import { NextResponse } from "next/server";
import { runDailyChecks } from "@/lib/anomaly/checks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runDailyChecks();
  const total = results.reduce((s, r) => s + r.found, 0);
  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    new_anomalies: total,
    checks: results,
  });
}
