import { redirect } from "next/navigation";
import { AppSidebar, MobileNav } from "@/components/app-nav";
import { createSupabaseServer } from "@/lib/supabase/server";

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

  return (
    <div className="min-h-dvh bg-muted/30 lg:min-h-screen">
      <AppSidebar userEmail={user.email ?? ""} />
      <MobileNav userEmail={user.email ?? ""} />
      <main className="px-4 py-6 lg:ml-60 lg:px-8">{children}</main>
    </div>
  );
}
