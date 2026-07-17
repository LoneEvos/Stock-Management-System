import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { ChannelBadge } from "@/components/channel-badge";
import {
  MOVEMENT_LABEL,
  ORDER_STATUS_LABEL,
  REASON_LABEL,
  RETURN_STATUS_LABEL,
  fmtDateTime,
  fmtDelta,
} from "@/lib/format";
import { getOrderDetail } from "@/lib/queries";
import { ArrowLeft, BookOpenText, RotateCcw } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PesananDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const { order, items, events, reservations, ledger, returns } = detail;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Kembali"
              render={<Link href="/pesanan" />}
            >
              <ArrowLeft className="size-5" />
            </Button>
            <h1 className="font-mono text-xl font-bold">
              {order.marketplace_order_id as string}
            </h1>
            <Badge variant="outline">
              <ChannelBadge channel={order.channel as string} />
            </Badge>
            <Badge variant="outline">
              {ORDER_STATUS_LABEL[order.status as string]}
            </Badge>
          </div>
          <p className="ml-12 text-sm text-muted-foreground">
            Dibuat {fmtDateTime(order.created_at as string)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/ledger?ref_type=order&ref=${order.id}`} />}
        >
          <BookOpenText className="size-4" />
          Lihat di Buku Besar
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Item pesanan (setelah bundle dipecah) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Item Pesanan (produk satuan)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>SKU Listing</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id as string}>
                    <TableCell className="font-medium">
                      {it.product_name as string}
                      {it.bundle_name ? (
                        <Badge variant="secondary" className="ml-2">
                          dari bundle: {it.bundle_name as string}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {it.listing_sku as string}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {it.qty as number}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Timeline event */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat Event</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.map((ev) => (
              <div key={ev.id as string} className="flex items-start gap-3">
                <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="text-sm font-medium">{ev.event_type as string}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(ev.occurred_at as string)} · sumber:{" "}
                    {ev.source as string}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Reservasi */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reservasi</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((r) => (
                  <TableRow key={r.id as string}>
                    <TableCell>{r.product_name as string}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.qty as number}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "ACTIVE"
                            ? "default"
                            : r.status === "CONVERTED"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {r.status === "ACTIVE"
                          ? "Aktif"
                          : r.status === "CONVERTED"
                            ? "Terkonversi (dikirim)"
                            : "Dilepas"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                      {(r.release_reason as string) ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="pt-2 text-xs text-muted-foreground">
              Reservasi bukan pergerakan fisik — stok keluar hanya lewat entri
              buku besar di panel sebelah.
            </p>
          </CardContent>
        </Card>

        {/* Entri ledger pesanan ini */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Pergerakan Fisik (Buku Besar)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada pergerakan fisik — pesanan masih reservasi.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Produk / Batch</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead>Jenis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateTime(l.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {l.product_name}
                        <span className="block text-xs text-muted-foreground">
                          batch {l.batch_code}
                        </span>
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-bold ${l.qty_delta > 0 ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {fmtDelta(l.qty_delta)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {MOVEMENT_LABEL[l.movement_type]}
                        <span className="block text-muted-foreground">
                          {REASON_LABEL[l.reason]}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {returns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="size-4" />
              Retur Terkait
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {returns.map((r) => (
              <Link
                key={r.id as string}
                href={`/retur?fokus=${r.id}`}
                className="rounded-lg border p-3 text-sm transition-colors hover:bg-muted"
              >
                <p className="font-medium">
                  {RETURN_STATUS_LABEL[r.status as string]}
                </p>
                <p className="text-xs text-muted-foreground">
                  Dibuat {fmtDateTime(r.created_at as string)}
                  {r.claim_deadline
                    ? ` · batas klaim ${r.claim_deadline}`
                    : ""}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
