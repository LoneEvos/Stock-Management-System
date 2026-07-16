import { Skeleton } from "@/components/ui/skeleton";

// Ditampilkan SEKETIKA setiap pindah tab (Suspense fallback) — sidebar tetap
// interaktif, konten baru mengalir masuk begitu kueri database selesai.
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Bar progres tipis di atas konten — animasi indeterminate */}
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/10 lg:left-60">
        <div className="h-full w-2/5 animate-indeterminate rounded-full bg-primary" />
      </div>

      {/* Judul halaman */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Baris kartu ringkasan */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>

      {/* Tabel */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/6" />
              <Skeleton className="hidden h-4 w-1/6 sm:block" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
