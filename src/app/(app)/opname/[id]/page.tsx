import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { OpnameDetailClient } from "./opname-detail-client";

export const dynamic = "force-dynamic";

export default async function OpnameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session] = await sql`
    select * from opname_sessions where id = ${id}
  `;
  if (!session) notFound();

  // Semua batch produk aktif + saldo sellable saat ini + hasil hitung sesi ini
  const rows = await sql`
    select
      b.id as batch_id,
      p.id as product_id,
      p.name as product_name,
      p.sku as product_sku,
      b.batch_code,
      b.expiry_date::text as expiry_date,
      coalesce((select sum(l.qty_delta)::int from stock_ledger l
        where l.batch_id = b.id and l.stock_state = 'SELLABLE'), 0) as current_system_qty,
      c.id as count_id,
      c.system_qty,
      c.physical_qty,
      c.variance,
      c.counted_at
    from batches b
    join products p on p.id = b.product_id and p.is_active
    left join opname_counts c on c.batch_id = b.id and c.session_id = ${id}
    order by p.name, b.expiry_date asc nulls last
  `;

  return (
    <OpnameDetailClient
      session={JSON.parse(JSON.stringify(session))}
      rows={JSON.parse(JSON.stringify(rows))}
    />
  );
}
