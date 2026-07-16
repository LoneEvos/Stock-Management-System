import { getOrders } from "@/lib/queries";
import { PesananClient } from "./pesanan-client";

export const dynamic = "force-dynamic";

export default async function PesananPage() {
  const orders = await getOrders();
  return <PesananClient orders={JSON.parse(JSON.stringify(orders))} />;
}
