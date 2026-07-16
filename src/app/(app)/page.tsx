import Link from "next/link";
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
import { sql } from "@/lib/db";
import {
  MOVEMENT_LABEL,
  REASON_LABEL,
  fmtDate,
  fmtDateTime,
  fmtDelta,
  fmtQty,
} from "@/lib/format";
import { getExpiringBatches, getLedger } from "@/lib/queries";
import { DashboardCharts } from "./dashboard-charts";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  Boxes,
  ClipboardCheck,
  RotateCcw,
  Timer,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats] = await sql`
    select
      (select count(*)::int from products where is_active) as active_products,
      (select coalesce(sum(qty_delta), 0)::int from stock_ledger where stock_state = 'SELLABLE') as sellable_units,
      (select coalesce(sum(qty_delta), 0)::int from stock_ledger where stock_state = 'DAMAGED') as damaged_units,
      (select coalesce(sum(qty), 0)::int from reservations where status = 'ACTIVE') as reserved_units,
      (select count(*)::int from anomalies where status <> 'RESOLVED') as open_anomalies,
      (select count(*)::int from anomalies where status <> 'RESOLVED' and severity = 'CRITICAL') as critical_anomalies,
      (select count(*)::int from returns where status = 'RECEIVED') as returns_waiting,
      (select count(*)::int from returns r where r.channel = 'tiktok' and r.claim_filed = false
        and r.claim_deadline is not null and r.claim_deadline - current_date <= 10
        and (r.status = 'IN_TRANSIT_BACK' or exists
          (select 1 from return_items ri where ri.return_id = r.id and ri.condition = 'LOST'))) as claims_near
  `;

  // Pergerakan 14 hari terakhir: masuk vs keluar per hari
  const daily = await sql`
    select d::date::text as day,
      coalesce((select sum(l.qty_delta) from stock_ledger l
        where l.qty_delta > 0 and l.created_at::date = d::date), 0)::int as masuk,
      coalesce((select -sum(l.qty_delta) from stock_ledger l
        where l.qty_delta < 0 and l.created_at::date = d::date), 0)::int as keluar
    from generate_series(current_date - interval '13 days', current_date, interval '1 day') d
    order by d
  `;

  // Top movers 7 hari (unit keluar)
  const topMovers = await sql`
    select p.id as product_id, p.name, sum(-l.qty_delta)::int as keluar
    from stock_ledger l
    join products p on p.id = l.product_id
    where l.qty_delta < 0 and l.created_at > now() - interval '7 days'
    group by p.id, p.name
    order by keluar desc
    limit 8
  `;

  const [expiring, recent] = await Promise.all([
    getExpiringBatches(),
    getLedger({ limit: 8 }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Semua angka di halaman ini turunan buku besar — klik untuk menelusuri
          pergerakan pembentuknya.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/produk">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <Boxes className="size-4" />
                Stok Layak Jual
              </CardDescription>
              <CardTitle className="font-mono text-2xl">
                {fmtQty(stats.sellable_units as number)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {stats.active_products as number} SKU aktif ·{" "}
              {fmtQty(stats.reserved_units as number)} direservasi
            </CardContent>
          </Card>
        </Link>

        <Link href="/anomali">
          <Card
            className={`h-full transition-colors hover:bg-muted/50 ${(stats.critical_anomalies as number) > 0 ? "border-destructive/60" : ""}`}
          >
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <AlertTriangle className="size-4" />
                Anomali Terbuka
              </CardDescription>
              <CardTitle
                className={`font-mono text-2xl ${(stats.open_anomalies as number) > 0 ? "text-destructive" : ""}`}
              >
                {stats.open_anomalies as number}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {stats.critical_anomalies as number} kritis — worklist harian
            </CardContent>
          </Card>
        </Link>

        <Link href="/retur">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <RotateCcw className="size-4" />
                Retur Menunggu Inspeksi
              </CardDescription>
              <CardTitle className="font-mono text-2xl">
                {stats.returns_waiting as number}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {stats.claims_near as number} klaim TikTok mendekati batas 40 hari
            </CardContent>
          </Card>
        </Link>

        <Link href="/ledger?state=DAMAGED">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5">
                <Boxes className="size-4" />
                Stok Rusak
              </CardDescription>
              <CardTitle className="font-mono text-2xl">
                {fmtQty(stats.damaged_units as number)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              terpisah dari layak jual — tidak pernah tercampur
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Charts */}
      <DashboardCharts
        daily={JSON.parse(JSON.stringify(daily))}
        topMovers={JSON.parse(JSON.stringify(topMovers))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Expiring batches */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Timer className="size-4 text-amber-500" />
                Mendekati Kedaluwarsa (≤ 90 hari)
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/batch">
                  Semua batch
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expiring.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tidak ada batch mendekati kedaluwarsa.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk / Batch</TableHead>
                    <TableHead>ED</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiring.slice(0, 6).map((b) => {
                    const days = b.days_left as number;
                    return (
                      <TableRow key={b.batch_id as string}>
                        <TableCell>
                          <p className="text-sm font-medium">
                            {b.product_name as string}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            batch {b.batch_code as string}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={days < 30 ? "destructive" : "outline"}
                            className={
                              days >= 30
                                ? "border-amber-500 text-amber-600"
                                : ""
                            }
                          >
                            {days < 0
                              ? `lewat ${-days} hr`
                              : `${days} hr lagi`}
                          </Badge>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {fmtDate(b.expiry_date as string)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/ledger?batch=${b.batch_id}`}
                            className="font-mono text-primary underline-offset-2 hover:underline"
                          >
                            {fmtQty(b.sellable_qty as number)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent movements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <BookOpenText className="size-4 text-primary" />
                Pergerakan Terbaru
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/ledger">
                  Buku besar
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada pergerakan — mulai dari Impor Data atau Simulator.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead>Jenis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateTime(l.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">{l.product_name}</TableCell>
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

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/opname">
            <ClipboardCheck className="size-4" />
            Mulai Stok Opname
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/simulator">Jalankan Simulasi Marketplace</Link>
        </Button>
      </div>
    </div>
  );
}
