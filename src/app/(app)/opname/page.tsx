import { getOpnameSessions } from "@/lib/queries";
import { OpnameListClient } from "./opname-list-client";

export const dynamic = "force-dynamic";

export default async function OpnamePage() {
  const sessions = await getOpnameSessions();
  return <OpnameListClient sessions={JSON.parse(JSON.stringify(sessions))} />;
}
