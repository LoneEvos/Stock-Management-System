"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChannelBadge } from "@/components/channel-badge";
import {
  CONDITION_LABEL,
  RETURN_STATUS_LABEL,
  daysUntil,
  fmtDate,
  fmtDateTime,
} from "@/lib/format";
import { inspectReturn, markClaimFiled } from "./actions";
import {
  AlertTriangle,
  ClipboardCheck,
  ExternalLink,
  PackageSearch,
  Timer,
} from "lucide-react";

interface ReturnRow {
  id: string;
  order_id: string;
  marketplace_order_id: string;
  channel: string;
  status: string;
  reason: string | null;
  created_at: string;
  received_at: string | null;
  inspected_at: string | null;
  inspected_by: string | null;
  claim_deadline: string | null;
  claim_filed: boolean;
  total_qty: number;
}

interface ReturnItem {
  id: string;
  return_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  qty: number;
  condition: string | null;
}

/** Pengingat klaim TikTok — urgensi meningkat mendekati batas 40 hari. */
export function ClaimBadge({ ret }: { ret: ReturnRow }) {
  if (!ret.claim_deadline) return null;
  if (ret.claim_filed)
    return <Badge variant="secondary">Klaim diajukan</Badge>;
  const d = daysUntil(ret.claim_deadline);
  if (d < 0)
    return (
      <Badge variant="destructive">
        Batas klaim LEWAT {-d} hari
      </Badge>
    );
  if (d <= 7)
    return (
      <Badge variant="destructive" className="animate-pulse">
        Klaim: {d} hari lagi!
      </Badge>
    );
  if (d <= 14)
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
        Klaim: {d} hari lagi
      </Badge>
    );
  return <Badge variant="outline">Klaim: {d} hari lagi</Badge>;
}

export function ReturClient({
  returns,
  items,
  fokusId,
}: {
  returns: ReturnRow[];
  items: ReturnItem[];
  fokusId: string | null;
}) {
  const queue = returns.filter(
    (r) => r.status === "RECEIVED" || r.status === "IN_TRANSIT_BACK"
  );
  const done = returns.filter(
    (r) => r.status !== "RECEIVED" && r.status !== "IN_TRANSIT_BACK"
  );
  const claims = returns.filter(
    (r) =>
      r.claim_deadline &&
      !r.claim_filed &&
      items.some((i) => i.return_id === r.id && i.condition === "LOST")
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Retur</h1>
        <p className="text-sm text-muted-foreground">
          Setiap retur punya nasib: layak jual, rusak, atau hilang — diputuskan
          gudang setelah inspeksi fisik, bukan otomatis dari marketplace.
        </p>
      </div>

      <Tabs defaultValue="antrean">
        <TabsList>
          <TabsTrigger value="antrean">
            <PackageSearch className="mr-1.5 size-4" />
            Antrean Inspeksi ({queue.length})
          </TabsTrigger>
          <TabsTrigger value="klaim">
            <Timer className="mr-1.5 size-4" />
            Klaim TikTok ({claims.length})
          </TabsTrigger>
          <TabsTrigger value="selesai">Riwayat ({done.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="antrean" className="space-y-3 pt-2">
          {queue.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Tidak ada retur menunggu — antrean bersih.
            </p>
          )}
          {queue.map((r) => (
            <ReturnCard
              key={r.id}
              ret={r}
              items={items.filter((i) => i.return_id === r.id)}
              highlight={r.id === fokusId}
            />
          ))}
        </TabsContent>

        <TabsContent value="klaim" className="space-y-3 pt-2">
          {claims.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Tidak ada klaim TikTok yang menunggu.
            </p>
          )}
          {claims.map((r) => (
            <ClaimCard key={r.id} ret={r} />
          ))}
        </TabsContent>

        <TabsContent value="selesai" className="space-y-3 pt-2">
          {done.map((r) => (
            <ReturnCard
              key={r.id}
              ret={r}
              items={items.filter((i) => i.return_id === r.id)}
              highlight={r.id === fokusId}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReturnCard({
  ret,
  items,
  highlight,
}: {
  ret: ReturnRow;
  items: ReturnItem[];
  highlight: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary ring-2 ring-primary/30" : ""}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Link
              href={`/pesanan/${ret.order_id}`}
              className="inline-flex items-center gap-1 font-mono text-primary underline-offset-2 hover:underline"
            >
              {ret.marketplace_order_id}
              <ExternalLink className="size-3.5" />
            </Link>
            <Badge variant="outline">
              <ChannelBadge channel={ret.channel} />
            </Badge>
            <Badge
              variant={ret.status === "RECEIVED" ? "default" : "outline"}
            >
              {RETURN_STATUS_LABEL[ret.status]}
            </Badge>
            <ClaimBadge ret={ret} />
          </CardTitle>
          {ret.status === "RECEIVED" && <InspectDialog ret={ret} items={items} />}
        </div>
        <CardDescription>
          Dibuat {fmtDateTime(ret.created_at)}
          {ret.received_at ? ` · tiba ${fmtDateTime(ret.received_at)}` : ""}
          {ret.inspected_at
            ? ` · diinspeksi ${fmtDateTime(ret.inspected_at)} oleh ${ret.inspected_by}`
            : ""}
          {ret.reason ? ` · alasan: ${ret.reason}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {items.map((it) => (
          <Badge key={it.id} variant="secondary" className="gap-1.5">
            {it.qty}× {it.product_name}
            {it.condition && (
              <span
                className={
                  it.condition === "SELLABLE"
                    ? "text-emerald-600"
                    : it.condition === "DAMAGED"
                      ? "text-destructive"
                      : "text-amber-600"
                }
              >
                — {CONDITION_LABEL[it.condition]}
              </span>
            )}
          </Badge>
        ))}
        {ret.status === "IN_TRANSIT_BACK" && (
          <p className="w-full text-xs text-muted-foreground">
            Barang masih dalam perjalanan kembali — stok belum berubah. Tandai
            tiba lewat Simulator (atau event marketplace).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InspectDialog({ ret, items }: { ret: ReturnRow; items: ReturnItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [decisions, setDecisions] = useState<Record<string, string>>({});

  const undecided = useMemo(
    () => items.filter((i) => !i.condition),
    [items]
  );
  const allSet = undecided.every((i) => decisions[i.id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <ClipboardCheck className="size-4" />
        Inspeksi Sekarang
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Inspeksi Retur — {ret.marketplace_order_id}</DialogTitle>
          <DialogDescription>
            Periksa fisik tiap item, lalu putuskan nasibnya. Keputusan menulis
            entri buku besar dan tidak bisa diedit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {undecided.map((it) => (
            <div
              key={it.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <p className="text-sm font-medium">{it.product_name}</p>
                <p className="text-xs text-muted-foreground">
                  {it.qty} unit · {it.product_sku}
                </p>
              </div>
              <Select
                items={{
                  SELLABLE: "Layak jual — kembali ke stok",
                  DAMAGED: "Rusak — masuk stok rusak",
                  LOST: "Hilang di ekspedisi",
                }}
                value={decisions[it.id] ?? null}
                onValueChange={(v) =>
                  setDecisions((d) => ({ ...d, [it.id]: v ?? "" }))
                }
              >
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Kondisi…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SELLABLE">
                    Layak jual — kembali ke stok
                  </SelectItem>
                  <SelectItem value="DAMAGED">
                    Rusak — masuk stok rusak
                  </SelectItem>
                  <SelectItem value="LOST">
                    Hilang di ekspedisi
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          {Object.values(decisions).includes("LOST") &&
            ret.channel === "tiktok" && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Item hilang di TikTok: ajukan klaim sebelum{" "}
                <b>{fmtDate(ret.claim_deadline)}</b> — pengingat akan muncul di
                tab Klaim & dashboard.
              </p>
            )}
          <Button
            className="w-full"
            size="lg"
            disabled={!allSet || pending}
            onClick={() =>
              startTransition(async () => {
                const res = await inspectReturn({
                  return_id: ret.id,
                  decisions: undecided.map((i) => ({
                    return_item_id: i.id,
                    condition: decisions[i.id] as
                      | "SELLABLE"
                      | "DAMAGED"
                      | "LOST",
                  })),
                });
                if (res.ok) {
                  toast.success(res.message);
                  setOpen(false);
                  router.refresh();
                } else toast.error(res.message);
              })
            }
          >
            {pending ? "Menyimpan…" : "Simpan Keputusan Inspeksi"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClaimCard({ ret }: { ret: ReturnRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const d = ret.claim_deadline ? daysUntil(ret.claim_deadline) : null;

  return (
    <Card className={d !== null && d <= 7 ? "border-destructive" : ""}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Link
              href={`/pesanan/${ret.order_id}`}
              className="font-mono text-primary underline-offset-2 hover:underline"
            >
              {ret.marketplace_order_id}
            </Link>
            <ClaimBadge ret={ret} />
          </p>
          <p className="text-sm text-muted-foreground">
            Barang hilang di ekspedisi — batas klaim TikTok{" "}
            {fmtDate(ret.claim_deadline)}.
          </p>
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await markClaimFiled(ret.id);
              if (res.ok) {
                toast.success(res.message);
                router.refresh();
              } else toast.error(res.message);
            })
          }
        >
          Tandai Klaim Diajukan
        </Button>
      </CardContent>
    </Card>
  );
}
