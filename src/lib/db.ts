// ============================================================================
// Koneksi Postgres (Supabase) via connection pooler — mendukung TRANSAKSI
// sungguhan untuk alur multi-tabel (ship, retur, opname).
// Inisialisasi LAZY agar build/prerender tidak butuh DATABASE_URL.
// ============================================================================

import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;
export type TransactionSql = postgres.TransactionSql<Record<string, unknown>>;

declare global {
  var __sql: Sql | undefined;
}

function createClient(): Sql {
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

function getSql(): Sql {
  if (!global.__sql) {
    global.__sql = createClient();
  }
  return global.__sql;
}

/** Proxy lazy: koneksi baru dibuat saat kueri pertama, bukan saat import. */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  get(_target, prop) {
    const client = getSql();
    const value = client[prop as keyof Sql];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
  apply(_target, _thisArg, args) {
    return (getSql() as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as Sql;
