import { getBatchStock } from "@/lib/queries";
import { BatchClient } from "./batch-client";

export const dynamic = "force-dynamic";

export default async function BatchPage() {
  const batches = await getBatchStock();
  return <BatchClient batches={JSON.parse(JSON.stringify(batches))} />;
}
