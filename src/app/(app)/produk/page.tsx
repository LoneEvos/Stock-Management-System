import { getBundlesWithItems, getProductStock } from "@/lib/queries";
import { ProdukClient } from "./produk-client";

export const dynamic = "force-dynamic";

export default async function ProdukPage() {
  const [products, bundles] = await Promise.all([
    getProductStock(),
    getBundlesWithItems(),
  ]);

  return (
    <ProdukClient
      products={products}
      bundles={JSON.parse(JSON.stringify(bundles))}
    />
  );
}
