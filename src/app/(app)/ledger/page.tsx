import { sql } from "@/lib/db";
import { getLedger } from "@/lib/queries";
import { LedgerClient } from "./ledger-client";

export const dynamic = "force-dynamic";

interface SearchParams {
  product?: string;
  batch?: string;
  type?: string;
  reason?: string;
  channel?: string;
  state?: string;
  ref_type?: string;
  ref?: string;
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const rows = await getLedger({
    product_id: sp.product,
    batch_id: sp.batch,
    movement_type: sp.type,
    reason: sp.reason,
    channel: sp.channel,
    stock_state: sp.state,
    ref_type: sp.ref_type,
    ref_id: sp.ref,
    limit: 1000,
  });

  // Konteks filter (untuk header drill-down)
  let contextLabel: string | null = null;
  if (sp.product) {
    const [p] = await sql`select name, sku from products where id = ${sp.product}`;
    if (p) contextLabel = `${p.name} (${p.sku})`;
  } else if (sp.batch) {
    const [b] = await sql`
      select b.batch_code, p.name from batches b
      join products p on p.id = b.product_id where b.id = ${sp.batch}
    `;
    if (b) contextLabel = `${b.name} — batch ${b.batch_code}`;
  }

  const filteredSum = rows.reduce((s, r) => s + r.qty_delta, 0);

  return (
    <LedgerClient
      rows={JSON.parse(JSON.stringify(rows))}
      contextLabel={contextLabel}
      filteredSum={filteredSum}
      activeFilters={sp}
    />
  );
}
