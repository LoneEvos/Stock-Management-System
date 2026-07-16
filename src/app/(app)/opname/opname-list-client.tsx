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
import { fmtDateTime } from "@/lib/format";
import { createOpnameSession } from "./actions";
import { ClipboardCheck, Plus } from "lucide-react";

interface SessionRow {
  id: string;
  code: string;
  status: string;
  note: string | null;
  created_by: string;
  started_at: string;
  posted_at: string | null;
  count_rows: number;
  variance_rows: number;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Berlangsung",
  POSTED: "Diposting",
  CANCELLED: "Dibatalkan",
};

export function OpnameListClient({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stok Opname</h1>
          <p className="text-sm text-muted-foreground">
            Hitung fisik per batch, bandingkan dengan catatan, posting koreksi
            sebagai entri baru — tidak pernah mengedit riwayat.
          </p>
        </div>
        <Button
          size="lg"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await createOpnameSession();
              if (res.ok && res.session_id) {
                toast.success(res.message);
                router.push(`/opname/${res.session_id}`);
              } else toast.error(res.message);
            })
          }
        >
          <Plus className="size-4" />
          Mulai Sesi Opname
        </Button>
      </div>

      <div className="grid gap-3">
        {sessions.length === 0 && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Belum ada sesi opname.
          </p>
        )}
        {sessions.map((s) => (
          <Link key={s.id} href={`/opname/${s.id}`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="size-4 text-primary" />
                  {s.code}
                  <Badge
                    variant={
                      s.status === "OPEN"
                        ? "default"
                        : s.status === "POSTED"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {STATUS_LABEL[s.status]}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Dimulai {fmtDateTime(s.started_at)} oleh {s.created_by}
                  {s.posted_at ? ` · diposting ${fmtDateTime(s.posted_at)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {s.count_rows} batch dihitung ·{" "}
                <span
                  className={
                    s.variance_rows > 0 ? "font-medium text-destructive" : ""
                  }
                >
                  {s.variance_rows} selisih
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
