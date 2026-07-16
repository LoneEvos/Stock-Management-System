// ============================================================================
// Jalankan satu file migrasi SQL pada database (DATABASE_URL di .env.local):
//   npm run migrate supabase/migrations/0003_phase2.sql
// Seluruh file dieksekusi sebagai satu simple query = transaksi implisit —
// semua-atau-tidak-sama-sekali.
// ============================================================================

import { readFileSync } from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("Pemakaian: npm run migrate <path-file-sql>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  max: 1,
  prepare: false,
});

async function main() {
  const ddl = readFileSync(file, "utf8");
  await sql.unsafe(ddl);
  console.log(`${file}: OK`);
  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`${file}: GAGAL —`, e.message);
  await sql.end();
  process.exit(1);
});
