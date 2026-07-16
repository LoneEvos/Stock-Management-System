import { getAnomalies } from "@/lib/queries";
import { AnomaliClient } from "./anomali-client";

export const dynamic = "force-dynamic";

export default async function AnomaliPage() {
  const anomalies = await getAnomalies();
  return <AnomaliClient anomalies={JSON.parse(JSON.stringify(anomalies))} />;
}
