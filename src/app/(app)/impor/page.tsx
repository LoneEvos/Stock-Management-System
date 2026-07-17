import { sql } from "@/lib/db";
import { ImporClient } from "./impor-client";

export const dynamic = "force-dynamic";

export default async function ImporPage() {
  // Data referensi untuk validasi pratinjau di sisi klien — server tetap
  // memvalidasi ulang saat impor sesungguhnya.
  const [products, orderSkus] = await Promise.all([
    sql`
      select p.sku, p.name,
        exists(select 1 from stock_ledger l
               where l.product_id = p.id and l.movement_type = 'INITIAL_COUNT') as has_baseline
      from products p
    `,
    sql`
      select sku from products where is_active
      union
      select sku from bundles where is_active
    `,
  ]);

  return (
    <ImporClient
      knownProducts={JSON.parse(JSON.stringify(products))}
      orderSkus={(orderSkus as unknown as { sku: string }[]).map((r) => r.sku)}
    />
  );
}
