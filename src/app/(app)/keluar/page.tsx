import { getProductStock } from "@/lib/queries";
import { KeluarClient } from "./keluar-client";

export const dynamic = "force-dynamic";

export default async function KeluarPage() {
  const products = await getProductStock();
  return (
    <KeluarClient
      products={JSON.parse(JSON.stringify(products)).filter(
        (p: { is_active: boolean }) => p.is_active
      )}
    />
  );
}
