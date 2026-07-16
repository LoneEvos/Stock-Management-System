import { listSimOrders } from "./actions";
import { SimulatorClient } from "./simulator-client";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const orders = await listSimOrders();
  return <SimulatorClient orders={orders} />;
}
