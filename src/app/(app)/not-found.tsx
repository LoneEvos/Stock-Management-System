import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home, PackageSearch } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <PackageSearch className="size-7" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold">Halaman tidak ditemukan</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Tautan mungkin salah ketik atau datanya sudah dipindah. Periksa
          kembali alamatnya atau kembali ke dashboard.
        </p>
      </div>
      <Button render={<Link href="/" />}>
        <Home className="size-4" />
        Kembali ke Dashboard
      </Button>
    </div>
  );
}
