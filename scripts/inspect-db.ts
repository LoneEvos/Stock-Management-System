// Inspeksi cepat: bagian mana dari 0003 yang sudah/belum terpasang di DB.
import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });

async function main() {
  const cols = await sql`
    select column_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_balances'
    order by ordinal_position
  `;
  console.log("stock_balances columns:", cols.map((c) => `${c.column_name}:${c.data_type}`).join(", ") || "(none)");

  const [rowCount] = await sql`select count(*)::int as n from stock_balances`;
  console.log("stock_balances rows:", rowCount.n);

  const triggers = await sql`
    select tgname from pg_trigger
    where tgrelid = 'public.stock_ledger'::regclass and not tgisinternal
    order by tgname
  `;
  console.log("stock_ledger triggers:", triggers.map((t) => t.tgname).join(", "));

  const ledgerCols = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_ledger'
      and column_name in ('reference')
  `;
  console.log("ledger.reference exists:", ledgerCols.length > 0);

  const bundleCols = await sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'bundles' and column_name = 'active_version')
        or (table_name = 'bundle_items' and column_name = 'version')
        or (table_name = 'order_items' and column_name = 'bundle_version'))
  `;
  console.log("versioning columns:", bundleCols.map((c) => `${c.table_name}.${c.column_name}`).join(", ") || "(none)");

  const constraints = await sql`
    select conname from pg_constraint
    where conrelid = 'public.stock_ledger'::regclass
    order by conname
  `;
  console.log("ledger constraints:", constraints.map((c) => c.conname).join(", "));

  const idx = await sql`
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'stock_ledger'
      and indexname in ('idx_ledger_key', 'idx_ledger_correction')
  `;
  console.log("new indexes:", idx.map((i) => i.indexname).join(", ") || "(none)");

  const fn = await sql`
    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and proname in ('trg_ledger_apply_summary', 'trg_validate_correction', 'trg_ledger_balance_guard', 'rls_auto_enable')
  `;
  console.log("functions:", fn.map((f) => f.proname).join(", "));

  const [vDef] = await sql`
    select definition from pg_views where schemaname='public' and viewname='v_product_stock'
  `;
  console.log("v_product_stock includes baseline_unverified:", vDef.definition.includes("baseline_unverified"));

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("GAGAL:", e.message);
  await sql.end();
  process.exit(1);
});
