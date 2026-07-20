import { sql } from "@/lib/db";
import { listSimOrders } from "./actions";
import { SimulatorClient } from "./simulator-client";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const [orders, products, bundles] = await Promise.all([
    listSimOrders(),
    sql`
      select sku, name, available_qty from v_product_stock
      where is_active and available_qty > 0
      order by name
    `,
    sql`select sku, name from bundles where is_active order by name`,
  ]);
  return (
    <SimulatorClient
      orders={orders}
      products={
        JSON.parse(JSON.stringify(products)) as {
          sku: string;
          name: string;
          available_qty: number;
        }[]
      }
      bundles={
        JSON.parse(JSON.stringify(bundles)) as { sku: string; name: string }[]
      }
    />
  );
}
