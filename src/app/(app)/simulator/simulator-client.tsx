"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL, fmtDateTime } from "@/lib/format";
import type { IngestResult, MarketplaceChannel } from "@/lib/marketplace/types";
import {
  simBusyDay,
  simCancel,
  simDeliver,
  simNewOrder,
  simReturnCreate,
  simReturnReceive,
  simShip,
} from "./actions";
import {
  FlaskConical,
  PackageCheck,
  PackagePlus,
  PackageX,
  RotateCcw,
  Send,
  ShoppingBag,
  Truck,
  Zap,
} from "lucide-react";

interface SimOrder {
  id: string;
  marketplace_order_id: string;
  channel: MarketplaceChannel;
  status: string;
  created_at: string;
  total_qty: number;
  has_return_in_transit: boolean;
}

export function SimulatorClient({ orders }: { orders: SimOrder[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FlaskConical className="size-6 text-primary" />
          Simulator Marketplace
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pengganti API Shopee/TikTok untuk demo. Setiap tombol menyuntik event
          dummy ke <b>pipeline ingest yang sama</b> dengan yang kelak dipakai
          API asli — mengganti simulator dengan API sungguhan tidak mengubah
          logika inti (adapter pattern).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShoppingBag className="size-4 text-orange-500" />
              Pesanan Baru Shopee
            </CardTitle>
            <CardDescription className="text-xs">
              1–3 produk acak → reservasi, stok fisik belum bergerak
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => run(() => simNewOrder("shopee"))}
            >
              Suntik Event
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShoppingBag className="size-4 text-slate-900 dark:text-slate-100" />
              Pesanan Baru TikTok
            </CardTitle>
            <CardDescription className="text-xs">
              1–3 produk acak → reservasi, stok fisik belum bergerak
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => run(() => simNewOrder("tiktok"))}
            >
              Suntik Event
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PackagePlus className="size-4 text-violet-500" />
              Pesanan Bundle
            </CardTitle>
            <CardDescription className="text-xs">
              SKU paket → dipecah jadi produk satuan sesuai resep
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => simNewOrder("shopee", { forceBundle: true }))
              }
            >
              Suntik Event
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="size-4 text-amber-500" />
              Skenario: Hari Sibuk
            </CardTitle>
            <CardDescription className="text-xs">
              5 pesanan, 3 kirim, batal sebelum & sesudah kirim, 1 retur
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="default"
              disabled={pending}
              onClick={() => run(() => simBusyDay())}
            >
              Jalankan Skenario
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pesanan Aktif — lanjutkan siklus hidupnya
          </CardTitle>
          <CardDescription>
            Aksi yang tersedia mengikuti status: kirim (stok keluar FEFO), batal
            (sebelum kirim = lepas reservasi; sesudah = dokumen retur), retur.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. Pesanan</TableHead>
                <TableHead>Kanal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Aksi Simulasi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-20 text-center text-muted-foreground"
                  >
                    Belum ada pesanan — suntik event di atas.
                  </TableCell>
                </TableRow>
              )}
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link
                      href={`/pesanan/${o.id}`}
                      className="font-mono text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {o.marketplace_order_id}
                    </Link>
                  </TableCell>
                  <TableCell>{CHANNEL_LABEL[o.channel]}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        o.status === "CREATED"
                          ? "outline"
                          : o.status === "SHIPPED"
                            ? "default"
                            : o.status === "DELIVERED"
                              ? "secondary"
                              : "destructive"
                      }
                    >
                      {ORDER_STATUS_LABEL[o.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{o.total_qty}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDateTime(o.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
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
                            <Truck className="size-3.5" />
                            {o.channel === "tiktok"
                              ? "IN_TRANSIT"
                              : "SHIPPED"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                simCancel(o.channel, o.marketplace_order_id)
                              )
                            }
                          >
                            <PackageX className="size-3.5" />
                            Batal (pra-kirim)
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
                            <PackageCheck className="size-3.5" />
                            Sampai
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                simCancel(o.channel, o.marketplace_order_id)
                              )
                            }
                          >
                            <PackageX className="size-3.5" />
                            Batal (pasca-kirim)
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
                            <RotateCcw className="size-3.5" />
                            Retur
                          </Button>
                        </>
                      )}
                      {o.status === "DELIVERED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              simReturnCreate(o.channel, o.marketplace_order_id)
                            )
                          }
                        >
                          <RotateCcw className="size-3.5" />
                          Retur
                        </Button>
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
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
