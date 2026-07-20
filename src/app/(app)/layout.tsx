import { redirect } from "next/navigation";
import { AppSidebar, MobileNav, TopBar } from "@/components/app-nav";
import {
  CommandPalette,
  type PaletteProduct,
} from "@/components/command-palette";
import { createSupabaseServer } from "@/lib/supabase/server";
import { sql } from "@/lib/db";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Badge anomali di sidebar + lonceng topbar (desain StokTrace).
  const [[{ n: anomalyCount }], paletteProducts] = await Promise.all([
    sql`select count(*)::int as n from anomalies where status <> 'RESOLVED'`,
    sql`select id, sku, name from products where is_active order by name`,
  ]);

  return (
    <div className="min-h-dvh bg-background lg:min-h-screen">
      <CommandPalette
        products={JSON.parse(JSON.stringify(paletteProducts)) as PaletteProduct[]}
      />
      <AppSidebar
        userEmail={user.email ?? ""}
        anomalyCount={anomalyCount as number}
      />
      <MobileNav
        userEmail={user.email ?? ""}
        anomalyCount={anomalyCount as number}
      />
      <div className="lg:ml-60">
        <TopBar anomalyCount={anomalyCount as number} />
        <main className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
