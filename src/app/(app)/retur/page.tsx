import { sql } from "@/lib/db";
import { getReturns } from "@/lib/queries";
import { ReturClient } from "./retur-client";

export const dynamic = "force-dynamic";

export default async function ReturPage({
  searchParams,
}: {
  searchParams: Promise<{ fokus?: string }>;
}) {
  const { fokus } = await searchParams;
  const returns = await getReturns();
  const items = await sql`
    select ri.*, p.name as product_name, p.sku as product_sku
    from return_items ri
    join products p on p.id = ri.product_id
  `;
  return (
    <ReturClient
      returns={JSON.parse(JSON.stringify(returns))}
      items={JSON.parse(JSON.stringify(items))}
      fokusId={fokus ?? null}
    />
  );
}
