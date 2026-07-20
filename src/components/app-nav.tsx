"use client";

// ============================================================================
// Shell navigasi — bahasa desain StokTrace: sidebar gelap (#0f1b1b) dengan
// label seksi kecil, item aktif teal, badge anomali; topbar putih dengan
// tombol pemeriksaan harian + lonceng anomali. Fungsi identik dengan
// sebelumnya — hanya desain yang berubah.
// ============================================================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { runChecksNow } from "@/app/(app)/anomali/actions";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
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
  Search,
  ShoppingCart,
  Timer,
} from "lucide-react";

const NAV = [
  {
    group: "Ringkasan",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/anomali", label: "Anomali", icon: AlertTriangle, showBadge: true },
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
      { href: "/keluar", label: "Barang Keluar", icon: ArrowUpFromLine },
      { href: "/opname", label: "Stok Opname", icon: ClipboardCheck },
    ],
  },
  {
    group: "Marketplace",
    items: [
      { href: "/pesanan", label: "Pesanan", icon: ShoppingCart },
      { href: "/retur", label: "Retur", icon: RotateCcw },
      { href: "/simulator", label: "Simulasi", icon: FlaskConical },
    ],
  },
  {
    group: "Data",
    items: [{ href: "/impor", label: "Impor Data", icon: FileUp }],
  },
];

function NavLinks({
  anomalyCount,
  onNavigate,
}: {
  anomalyCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-2.5 pb-6">
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="px-2.5 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#5f7676]">
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
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-[#8fa5a5] hover:bg-white/[.06] hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="size-[17px] shrink-0 opacity-95" />
                  <span className="flex-1">{item.label}</span>
                  {item.showBadge && anomalyCount > 0 && (
                    <span className="min-w-[18px] rounded-full bg-destructive px-1.5 py-px text-center text-[10.5px] font-bold text-white">
                      {anomalyCount}
                    </span>
                  )}
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
    <button
      title="Keluar"
      aria-label="Keluar"
      className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground transition-colors hover:bg-[#26403f]"
      onClick={async () => {
        await createSupabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" />
    </button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-[18px]">
      <div className="flex size-[30px] items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <PackageSearch className="size-[17px]" />
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-bold tracking-[-0.2px] text-white">
          Rekonsiliasi Stok
        </p>
        <p className="text-[10.5px] text-[#6f8686]">setiap pergerakan berjejak</p>
      </div>
    </div>
  );
}

function UserFooter({ userEmail }: { userEmail: string }) {
  const initials = userEmail.slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border px-3.5 py-3">
      <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#26403f] text-xs font-semibold text-[#8fb5b3]">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-[#e7eeed]">
          {userEmail}
        </p>
        <p className="text-[10.5px] text-[#6f8686]">Admin Gudang</p>
      </div>
      <LogoutButton />
    </div>
  );
}

export function AppSidebar({
  userEmail,
  anomalyCount,
}: {
  userEmail: string;
  anomalyCount: number;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar lg:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto">
        <NavLinks anomalyCount={anomalyCount} />
      </div>
      <UserFooter userEmail={userEmail} />
    </aside>
  );
}

/**
 * Topbar desktop — tombol "Jalankan Pemeriksaan Harian" memicu 11 pemeriksaan
 * rekonsiliasi yang sama dengan cron; lonceng menautkan ke worklist anomali.
 */
export function TopBar({ anomalyCount }: { anomalyCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const today = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <header className="sticky top-0 z-20 hidden h-[60px] items-center gap-4 border-b border-border bg-card px-6 lg:flex">
      <p className="text-[13px] text-muted-foreground">{today} · Gudang Pusat</p>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("cmdk-open"))}
        className="flex h-[38px] w-60 items-center gap-2 rounded-[9px] border border-border bg-secondary px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Cari produk / halaman…</span>
        <kbd className="rounded border bg-card px-1.5 py-0.5 text-[10px] font-semibold">
          Ctrl K
        </kbd>
      </button>
      <Button
        size="sm"
        className="h-[38px] gap-2 rounded-[9px] px-4 text-[13px] font-semibold"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await runChecksNow();
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
            router.refresh();
          })
        }
      >
        <Timer className="size-[15px]" />
        {pending ? "Memeriksa…" : "Jalankan Pemeriksaan Harian"}
      </Button>
      <Link
        href="/anomali"
        title="Anomali terbuka"
        className="relative flex size-[38px] items-center justify-center rounded-[9px] border border-border bg-secondary transition-colors hover:bg-muted"
      >
        <Bell className="size-[17px] text-secondary-foreground" />
        {anomalyCount > 0 && (
          <span className="animate-pulse-red absolute -right-1.5 -top-1.5 min-w-[17px] rounded-full border-2 border-card bg-destructive px-1 text-center text-[10px] font-bold leading-4 text-white">
            {anomalyCount}
          </span>
        )}
      </Link>
    </header>
  );
}

/** Pemeriksaan harian dari sheet mobile — paritas dengan topbar desktop. */
function MobileDailyCheck({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="border-t border-sidebar-border px-3.5 py-3">
      <Button
        size="sm"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await runChecksNow();
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
            router.refresh();
            onDone();
          })
        }
      >
        <Timer className="size-4" />
        {pending ? "Memeriksa…" : "Jalankan Pemeriksaan Harian"}
      </Button>
    </div>
  );
}

export function MobileNav({
  userEmail,
  anomalyCount,
}: {
  userEmail: string;
  anomalyCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button
          variant="outline"
          size="icon"
          aria-label="Menu"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <SheetContent
          side="left"
          className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigasi</SheetTitle>
          <Brand />
          <div className="flex-1 overflow-y-auto">
            <NavLinks
              anomalyCount={anomalyCount}
              onNavigate={() => setOpen(false)}
            />
          </div>
          <MobileDailyCheck onDone={() => setOpen(false)} />
          <UserFooter userEmail={userEmail} />
        </SheetContent>
      </Sheet>
      <div className="flex flex-1 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <PackageSearch className="size-4" />
        </div>
        <span className="text-sm font-bold">Rekonsiliasi Stok</span>
      </div>
      <button
        type="button"
        aria-label="Cari"
        onClick={() => window.dispatchEvent(new Event("cmdk-open"))}
        className="flex size-9 items-center justify-center rounded-lg border border-border bg-secondary"
      >
        <Search className="size-4 text-secondary-foreground" />
      </button>
      <Link
        href="/anomali"
        title="Anomali terbuka"
        className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-secondary"
      >
        <Bell className="size-4 text-secondary-foreground" />
        {anomalyCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full border-2 border-card bg-destructive px-0.5 text-center text-[9px] font-bold leading-3 text-white">
            {anomalyCount}
          </span>
        )}
      </Link>
    </header>
  );
}
