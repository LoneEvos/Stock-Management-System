"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChannelBadge } from "@/components/channel-badge";
import { fmtQty } from "@/lib/format";
import type { IngestResult, MarketplaceChannel } from "@/lib/marketplace/types";
import {
  simBusyDay,
  simCancel,
  simDeliver,
  simNewOrder,
  simNewOrderCustom,
  simReturnCreate,
  simReturnPartial,
  simReturnReceive,
  simShip,
} from "./actions";
import {
  ArrowRightLeft,
  CirclePlus,
  Dices,
  PackagePlus,
  Send,
  Zap,
} from "lucide-react";

interface SimOrder {
  id: string;
  marketplace_order_id: string;
  channel: MarketplaceChannel;
  status: string;
  created_at: string;
  total_qty: number;
  items_label: string | null;
  has_return_in_transit: boolean;
}

interface ProductOption {
  sku: string;
  name: string;
  available_qty: number;
}

/** Chip status ringkas ala mockup: Reservasi / Dikirim / Sampai / Batal. */
const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  CREATED: { label: "Reservasi", cls: "bg-blue-100 text-blue-700" },
  SHIPPED: { label: "Dikirim", cls: "bg-amber-100 text-amber-700" },
  DELIVERED: { label: "Sampai", cls: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Batal", cls: "bg-red-100 text-red-700" },
  RETURN_REQUESTED: { label: "Retur diajukan", cls: "bg-violet-100 text-violet-700" },
};

export function SimulatorClient({
  orders,
  products,
  bundles,
}: {
  orders: SimOrder[];
  products: ProductOption[];
  bundles: { sku: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState<MarketplaceChannel>("shopee");
  const [sku, setSku] = useState<string | null>(products[0]?.sku ?? null);
  const [qty, setQty] = useState("1");

  const items = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of products)
      m[p.sku] = `${p.name} — stok ${fmtQty(p.available_qty)}`;
    for (const b of bundles) m[b.sku] = `${b.name} (bundle)`;
    return m;
  }, [products, bundles]);

  function run(fn: () => Promise<IngestResult>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Simulasi Marketplace</h1>
          <p className="text-sm text-muted-foreground">
            Semua event lewat pipeline ingest yang sama dengan API asli.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          setiap perubahan stok punya jejak
        </span>
      </div>

      {/* Form buat order — pengganti sementara webhook marketplace */}
      <Card className="gap-3">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="size-4 text-primary" />
            Pengganti sementara API asli
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Tombol ini menyuntik event seolah datang dari marketplace. Logika
            inti sama persis dengan yang nanti dipakai webhook asli — tinggal
            ganti sumbernya.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Channel</Label>
              <div className="inline-flex items-center rounded-lg border bg-card p-0.5">
                {(["shopee", "tiktok"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      channel === ch
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ChannelBadge channel={ch} />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid min-w-56 gap-1.5">
              <Label className="text-xs">Produk</Label>
              <Select items={items} value={sku} onValueChange={(v) => setSku(v)}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Pilih produk / bundle…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(items).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid w-20 gap-1.5">
              <Label className="text-xs">Qty</Label>
              <Input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>

            <Button
              disabled={pending || !sku}
              onClick={() =>
                run(() => simNewOrderCustom(channel, sku!, Number(qty)))
              }
            >
              <CirclePlus className="size-4" />
              Buat Order
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Order baru = <b>reservasi</b>, belum menyentuh ledger. Stok baru
            terpotong saat <b>Set Dikirim</b> (Shopee: SHIPPED · TikTok:
            IN_TRANSIT).
          </p>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Suntik cepat:</span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => simNewOrder(channel))}
            >
              <Dices className="size-3.5" />
              Order Acak (1–3 produk)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => simNewOrder(channel, { forceBundle: true }))}
            >
              <PackagePlus className="size-3.5" />
              Order Bundle
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => simBusyDay())}
            >
              <Zap className="size-3.5" />
              Skenario Hari Sibuk
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Order berjalan */}
      <Card className="gap-3">
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Order berjalan</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-20 text-center text-muted-foreground"
                  >
                    Belum ada order — buat lewat form di atas.
                  </TableCell>
                </TableRow>
              )}
              {orders.map((o) => {
                const chip = STATUS_CHIP[o.status] ?? {
                  label: o.status,
                  cls: "bg-muted text-muted-foreground",
                };
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        href={`/pesanan/${o.id}`}
                        className="font-mono text-sm font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {o.marketplace_order_id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ChannelBadge channel={o.channel} />
                    </TableCell>
                    <TableCell
                      className="max-w-56 truncate text-sm"
                      title={o.items_label ?? ""}
                    >
                      {o.items_label ?? "—"}
                    </TableCell>
                    <TableCell className="tnum text-right">
                      {o.total_qty}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}
                      >
                        {chip.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {o.status === "CREATED" && (
                          <>
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  simShip(o.channel, o.marketplace_order_id)
                                )
                              }
                            >
                              Set Dikirim
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  simCancel(o.channel, o.marketplace_order_id)
                                )
                              }
                            >
                              Batalkan
                            </Button>
                          </>
                        )}
                        {o.status === "SHIPPED" && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  simDeliver(o.channel, o.marketplace_order_id)
                                )
                              }
                            >
                              Sampai
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  simReturnCreate(
                                    o.channel,
                                    o.marketplace_order_id
                                  )
                                )
                              }
                            >
                              Ajukan Retur
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  simCancel(o.channel, o.marketplace_order_id)
                                )
                              }
                            >
                              Batalkan
                            </Button>
                          </>
                        )}
                        {o.status === "DELIVERED" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  simReturnCreate(
                                    o.channel,
                                    o.marketplace_order_id
                                  )
                                )
                              }
                            >
                              Ajukan Retur
                            </Button>
                            {o.total_qty > 1 && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                title="Retur parsial: 1 unit dari 1 produk — bundle dihitung per produk satuan"
                                onClick={() =>
                                  run(() =>
                                    simReturnPartial(
                                      o.channel,
                                      o.marketplace_order_id
                                    )
                                  )
                                }
                              >
                                Retur Sebagian
                              </Button>
                            )}
                          </>
                        )}
                        {o.has_return_in_transit && (
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                simReturnReceive(
                                  o.channel,
                                  o.marketplace_order_id
                                )
                              )
                            }
                          >
                            <Send className="size-3.5" />
                            Paket retur tiba
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
