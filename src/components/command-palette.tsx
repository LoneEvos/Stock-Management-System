"use client";

// ============================================================================
// Palet perintah (Ctrl+K / ⌘K): lompat ke halaman mana pun atau cari produk
// dan langsung mendarat di buku besarnya (drill-down + saldo berjalan).
// Tanpa dependensi tambahan — dibangun di atas Dialog yang sudah ada.
// Dibuka lewat pintasan keyboard atau event window "cmdk-open" (topbar).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  RotateCcw,
  Search,
  ShoppingCart,
  Timer,
  type LucideIcon,
} from "lucide-react";

export interface PaletteProduct {
  id: string;
  sku: string;
  name: string;
}

const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/anomali", label: "Anomali", icon: AlertTriangle },
  { href: "/produk", label: "Produk & Bundle", icon: Boxes },
  { href: "/batch", label: "Batch & Kedaluwarsa", icon: Timer },
  { href: "/ledger", label: "Buku Besar Stok", icon: BookOpenText },
  { href: "/masuk", label: "Barang Masuk", icon: ArrowDownToLine },
  { href: "/keluar", label: "Barang Keluar", icon: ArrowUpFromLine },
  { href: "/opname", label: "Stok Opname", icon: ClipboardCheck },
  { href: "/pesanan", label: "Pesanan", icon: ShoppingCart },
  { href: "/retur", label: "Retur", icon: RotateCcw },
  { href: "/simulator", label: "Simulasi Marketplace", icon: FlaskConical },
  { href: "/impor", label: "Impor Data", icon: FileUp },
];

interface Hit {
  key: string;
  icon: LucideIcon;
  label: string;
  sub: string | null;
  href: string;
}

export function CommandPalette({ products }: { products: PaletteProduct[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("cmdk-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cmdk-open", onOpen);
    };
  }, []);

  // reset saat dibuka
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    const prods = s
      ? products
          .filter(
            (p) =>
              p.name.toLowerCase().includes(s) ||
              p.sku.toLowerCase().includes(s)
          )
          .slice(0, 8)
          .map((p) => ({
            key: `p:${p.id}`,
            icon: BookOpenText,
            label: p.name,
            sub: `${p.sku} · buku besar + saldo berjalan`,
            href: `/ledger?product=${p.id}`,
          }))
      : [];
    const pages = PAGES.filter(
      (pg) => !s || pg.label.toLowerCase().includes(s)
    ).map((pg) => ({
      key: `g:${pg.href}`,
      icon: pg.icon,
      label: pg.label,
      sub: null,
      href: pg.href,
    }));
    return [...prods, ...pages];
  }, [q, products]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[idx]) {
      e.preventDefault();
      go(hits[idx].href);
    }
  }

  // jaga item terpilih tetap terlihat saat navigasi keyboard
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${idx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-24 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Cari</DialogTitle>
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Cari produk / SKU, atau lompat ke halaman…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {hits.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Tidak ada hasil untuk &ldquo;{q}&rdquo;.
            </p>
          )}
          {hits.map((h, i) => {
            const Icon = h.icon;
            return (
              <button
                key={h.key}
                type="button"
                data-idx={i}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(h.href)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                  i === idx ? "bg-muted" : ""
                }`}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.label}</span>
                  {h.sub && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {h.sub}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <p className="border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          ↑↓ navigasi · Enter buka · produk langsung menuju buku besarnya
        </p>
      </DialogContent>
    </Dialog>
  );
}
