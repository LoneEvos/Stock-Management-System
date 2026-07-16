// ============================================================================
// Koneksi Postgres (Supabase) via connection pooler — mendukung TRANSAKSI
// sungguhan untuk alur multi-tabel (ship, retur, opname).
// ============================================================================

import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL belum di-set. Gunakan connection string Supabase (Transaction pooler, port 6543)."
    );
  }
  return postgres(url, {
    ssl: "require",
    max: 5,
    // Supabase transaction pooler tidak mendukung prepared statements
    prepare: false,
  });
}

/** Singleton di dev (hot reload), instance baru per lambda di produksi. */
export const sql = global.__sql ?? createClient();
if (process.env.NODE_ENV !== "production") global.__sql = sql;

export type Sql = typeof sql;
export type TransactionSql = Parameters<Parameters<Sql["begin"]>[1]>[0];
