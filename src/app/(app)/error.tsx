"use client";

// Error boundary untuk semua halaman di dalam (app). Sidebar tetap tampil;
// hanya area konten yang menampilkan fallback ini. Next 16 memakai
// `unstable_retry` (me-fetch & render ulang segmen) — bukan `reset` lama.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold">Terjadi kesalahan memuat halaman</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Buku besar stok tetap aman — sistem append-only, tidak ada angka yang
          berubah karena error ini. Coba muat ulang halaman.
        </p>
        {error.digest && (
          <p className="pt-1 font-mono text-xs text-muted-foreground">
            Kode error: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={() => unstable_retry()}>
        <RotateCcw className="size-4" />
        Coba lagi
      </Button>
    </div>
  );
}
