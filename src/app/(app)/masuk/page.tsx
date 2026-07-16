import { getProducts } from "@/lib/queries";
import { MasukClient } from "./masuk-client";

export const dynamic = "force-dynamic";

export default async function MasukPage() {
  const products = await getProducts();
  return (
    <MasukClient
      products={JSON.parse(JSON.stringify(products)).filter(
        (p: { is_active: boolean }) => p.is_active
      )}
    />
  );
}
