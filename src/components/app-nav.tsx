"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpenText,
  Boxes,
  ClipboardCheck,
  FileUp,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  RotateCcw,
  ShoppingCart,
  Timer,
} from "lucide-react";

const NAV = [
  {
    group: "Ringkasan",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/anomali", label: "Anomali", icon: AlertTriangle },
    ],
  },
  {
    group: "Stok",
    items: [
      { href: "/produk", label: "Produk & Bundle", icon: Boxes },
      { href: "/batch", label: "Batch & Kedaluwarsa", icon: Timer },
      { href: "/ledger", label: "Buku Besar Stok", icon: BookOpenText },
    ],
  },
  {
    group: "Pergerakan",
    items: [
      { href: "/masuk", label: "Barang Masuk", icon: ArrowDownToLine },
      { href: "/keluar", label: "Keluar Manual", icon: ArrowUpFromLine },
      { href: "/opname", label: "Stok Opname", icon: ClipboardCheck },
    ],
  },
  {
    group: "Marketplace",
    items: [
      { href: "/pesanan", label: "Pesanan", icon: ShoppingCart },
      { href: "/retur", label: "Retur", icon: RotateCcw },
      { href: "/simulator", label: "Simulator", icon: FlaskConical },
      { href: "/impor", label: "Impor Data", icon: FileUp },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4 px-3 pb-6">
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.group}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-3 px-3 text-muted-foreground"
      onClick={async () => {
        await createSupabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" />
      Keluar
    </Button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-6 py-5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <PackageSearch className="size-5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold">Rekonsiliasi Stok</p>
        <p className="text-[11px] text-muted-foreground">
          setiap pergerakan berjejak
        </p>
      </div>
    </div>
  );
}

export function AppSidebar({ userEmail }: { userEmail: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background lg:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto">
        <NavLinks />
      </div>
      <div className="border-t p-3">
        <p className="truncate px-3 pb-1 text-xs text-muted-foreground">
          {userEmail}
        </p>
        <LogoutButton />
      </div>
    </aside>
  );
}

export function MobileNav({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigasi</SheetTitle>
          <Brand />
          <div className="flex-1 overflow-y-auto">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t p-3">
            <p className="truncate px-3 pb-1 text-xs text-muted-foreground">
              {userEmail}
            </p>
            <LogoutButton />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex items-center gap-2">
        <PackageSearch className="size-5 text-primary" />
        <span className="text-sm font-bold">Rekonsiliasi Stok</span>
      </div>
    </header>
  );
}
