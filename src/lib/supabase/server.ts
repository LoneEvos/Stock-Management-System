import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client sisi server (RSC / server action / route handler). */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // dipanggil dari RSC — middleware yang akan menyegarkan sesi
          }
        },
      },
    }
  );
}

/** Email admin yang sedang login — dipakai sebagai `operator` di ledger. */
export async function requireOperator(): Promise<string> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Tidak terautentikasi.");
  return user.email;
}
