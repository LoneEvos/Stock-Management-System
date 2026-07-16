"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { runChecksNow, updateAnomalyStatus } from "./actions";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  PlayCircle,
  SearchCheck,
} from "lucide-react";

interface Anomaly {
  id: string;
  detected_at: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  ref_type: string | null;
  ref_id: string | null;
  status: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

function refHref(a: Anomaly): string | null {
  if (!a.ref_type || !a.ref_id) return null;
  switch (a.ref_type) {
    case "order":
      return `/pesanan/${a.ref_id}`;
    case "return":
      return `/retur?fokus=${a.ref_id}`;
    case "batch":
      return `/ledger?batch=${a.ref_id}`;
    case "product":
      return `/ledger?product=${a.ref_id}`;
    case "opname_count":
      return `/opname`;
    default:
      return null;
  }
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "CRITICAL")
    return <Badge variant="destructive">Kritis</Badge>;
  if (severity === "WARNING")
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
        Perhatian
      </Badge>
    );
  return <Badge variant="secondary">Info</Badge>;
}

export function AnomaliClient({ anomalies }: { anomalies: Anomaly[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const open = anomalies.filter((a) => a.status !== "RESOLVED");
  const resolved = anomalies.filter((a) => a.status === "RESOLVED");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Worklist Anomali</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Hasil rekonsiliasi harian: sistem memeriksa konsistensi catatannya
            sendiri. Setiap kejanggalan bisa di-drill ke dokumen dan pergerakan
            pembentuknya.
          </p>
        </div>
        <Button
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
          <PlayCircle className="size-4" />
          {pending ? "Memeriksa…" : "Jalankan Pemeriksaan Sekarang"}
        </Button>
      </div>

      <Tabs defaultValue="terbuka">
        <TabsList>
          <TabsTrigger value="terbuka">
            <AlertTriangle className="mr-1.5 size-4" />
            Terbuka ({open.length})
          </TabsTrigger>
          <TabsTrigger value="selesai">
            <CheckCircle2 className="mr-1.5 size-4" />
            Selesai ({resolved.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="terbuka" className="space-y-3 pt-2">
          {open.length === 0 && (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Tidak ada anomali terbuka — catatan konsisten. 🎉
            </p>
          )}
          {open.map((a) => (
            <AnomalyCard key={a.id} anomaly={a} />
          ))}
        </TabsContent>

        <TabsContent value="selesai" className="space-y-3 pt-2">
          {resolved.map((a) => (
            <AnomalyCard key={a.id} anomaly={a} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AnomalyCard({ anomaly }: { anomaly: Anomaly }) {
  const router = useRouter();
  const href = refHref(anomaly);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Card
      className={
        anomaly.status === "RESOLVED"
          ? "opacity-70"
          : anomaly.severity === "CRITICAL"
            ? "border-destructive/50"
            : ""
      }
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <SeverityBadge severity={anomaly.severity} />
          {anomaly.title}
          {anomaly.status === "INVESTIGATING" && (
            <Badge variant="outline" className="gap-1">
              <SearchCheck className="size-3" />
              Diinvestigasi
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Terdeteksi {fmtDateTime(anomaly.detected_at)} · {anomaly.type}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {anomaly.description && (
          <p className="text-sm text-muted-foreground">{anomaly.description}</p>
        )}
        {anomaly.resolution_note && (
          <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            Penyelesaian: {anomaly.resolution_note}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {href && (
            <Button variant="outline" size="sm" render={<Link href={href} />}>
              <ExternalLink className="size-3.5" />
              Telusuri Sumber
            </Button>
          )}
          {anomaly.status === "OPEN" && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await updateAnomalyStatus({
                    id: anomaly.id,
                    status: "INVESTIGATING",
                  });
                  if (res.ok) {
                    toast.success(res.message);
                    router.refresh();
                  } else toast.error(res.message);
                })
              }
            >
              <SearchCheck className="size-3.5" />
              Mulai Investigasi
            </Button>
          )}
          {anomaly.status !== "RESOLVED" && (
            <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
              <Button size="sm" onClick={() => setResolveOpen(true)}>
                <CheckCircle2 className="size-3.5" />
                Tandai Selesai
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Selesaikan Anomali</DialogTitle>
                  <DialogDescription>
                    Tulis apa penyebabnya dan apa yang dilakukan — selisih harus
                    punya cerita, bukan sekadar ditutup.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Contoh: bonus livestream 3 unit tidak dicatat; sudah diposting lewat Keluar Manual, SOP diperbaiki."
                  rows={3}
                />
                <Button
                  disabled={pending || !note.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await updateAnomalyStatus({
                        id: anomaly.id,
                        status: "RESOLVED",
                        resolution_note: note,
                      });
                      if (res.ok) {
                        toast.success(res.message);
                        setResolveOpen(false);
                        router.refresh();
                      } else toast.error(res.message);
                    })
                  }
                >
                  {pending ? "Menyimpan…" : "Simpan Penyelesaian"}
                </Button>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
