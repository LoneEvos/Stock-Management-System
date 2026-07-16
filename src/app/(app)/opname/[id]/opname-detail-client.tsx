"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtDateTime, fmtDelta, fmtQty } from "@/lib/format";
import { cancelOpnameSession, postOpnameSession, saveCount } from "../actions";
import { ArrowLeft, BookOpenText, Check, Search } from "lucide-react";

interface Session {
  id: string;
  code: string;
  status: string;
  started_at: string;
  posted_at: string | null;
  created_by: string;
}

interface Row {
  batch_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  batch_code: string;
  expiry_date: string | null;
  current_system_qty: number;
  count_id: string | null;
  system_qty: number | null;
  physical_qty: number | null;
  variance: number | null;
  counted_at: string | null;
}

export function OpnameDetailClient({
  session,
  rows,
}: {
  session: Session;
  rows: Row[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pendingPost, startPost] = useTransition();
  const isOpen = session.status === "OPEN";

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.product_name.toLowerCase().includes(q) ||
        r.product_sku.toLowerCase().includes(q) ||
        r.batch_code.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const counted = rows.filter((r) => r.count_id);
  const withVariance = counted.filter((r) => (r.variance ?? 0) !== 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Kembali"
            render={<Link href="/opname" />}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              {session.code}
              <Badge
                variant={
                  session.status === "OPEN"
                    ? "default"
                    : session.status === "POSTED"
                      ? "secondary"
                      : "outline"
                }
              >
                {session.status === "OPEN"
                  ? "Berlangsung"
                  : session.status === "POSTED"
                    ? "Diposting"
                    : "Dibatalkan"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {fmtDateTime(session.started_at)} · {session.created_by}
            </p>
          </div>
        </div>

        {isOpen && (
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="outline" size="sm" />}
              >
                Batalkan Sesi
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Batalkan sesi opname?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Hasil hitung dibuang, tidak ada koreksi apa pun yang
                    ditulis ke buku besar.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Kembali</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const res = await cancelOpnameSession(session.id);
                      if (res.ok) {
                        toast.success(res.message);
                        router.push("/opname");
                      } else toast.error(res.message);
                    }}
                  >
                    Ya, batalkan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    size="sm"
                    disabled={counted.length === 0 || pendingPost}
                  />
                }
              >
                Posting Koreksi ({withVariance.length} selisih)
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Posting koreksi opname?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {counted.length} batch dihitung, {withVariance.length} punya
                    selisih. Setiap selisih ditulis sebagai entri
                    ADJUSTMENT_OPNAME baru (bukan edit) dan masuk worklist
                    anomali untuk ditelusuri penyebabnya.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Kembali</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      startPost(async () => {
                        const res = await postOpnameSession(session.id);
                        if (res.ok) {
                          toast.success(res.message);
                          router.refresh();
                        } else toast.error(res.message);
                      })
                    }
                  >
                    Ya, posting
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-x-8 gap-y-2 py-4 text-sm">
          <span>
            Batch dihitung:{" "}
            <b className="font-mono">
              {counted.length}/{rows.length}
            </b>
          </span>
          <span>
            Selisih ditemukan:{" "}
            <b
              className={`font-mono ${withVariance.length > 0 ? "text-destructive" : "text-emerald-600"}`}
            >
              {withVariance.length}
            </b>
          </span>
          <span className="text-muted-foreground">
            Hitung fisik hanya stok layak jual. Lakukan saat tidak ada
            pergerakan barang.
          </span>
        </CardContent>
      </Card>

      <div className="relative w-full max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari produk / batch…"
          className="pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>ED</TableHead>
              <TableHead className="text-right">Catatan Sistem</TableHead>
              <TableHead className="text-right">Hitung Fisik</TableHead>
              <TableHead className="text-right">Selisih</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <CountRow key={r.batch_id} row={r} sessionId={session.id} editable={isOpen} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CountRow({
  row,
  sessionId,
  editable,
}: {
  row: Row;
  sessionId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(
    row.physical_qty !== null ? String(row.physical_qty) : ""
  );
  const [pending, startTransition] = useTransition();

  const baseline = row.system_qty ?? row.current_system_qty;
  const variance =
    row.count_id && row.variance !== null
      ? row.variance
      : value !== ""
        ? Number(value) - baseline
        : null;

  function save() {
    if (value === "" || !editable) return;
    startTransition(async () => {
      const res = await saveCount({
        session_id: sessionId,
        batch_id: row.batch_id,
        physical_qty: Number(value),
      });
      if (res.ok) {
        toast.success(`${row.product_name} (${row.batch_code}): ${res.message}`);
        router.refresh();
      } else toast.error(res.message);
    });
  }

  return (
    <TableRow className={row.count_id ? "bg-muted/40" : ""}>
      <TableCell>
        <p className="font-medium">{row.product_name}</p>
        <p className="text-xs text-muted-foreground">{row.product_sku}</p>
      </TableCell>
      <TableCell className="font-mono text-sm">{row.batch_code}</TableCell>
      <TableCell className="text-xs">{fmtDate(row.expiry_date)}</TableCell>
      <TableCell className="text-right font-mono">
        <Link
          href={`/ledger?batch=${row.batch_id}`}
          className="text-primary underline-offset-2 hover:underline"
          title="Telusuri pergerakan pembentuk angka ini"
        >
          {fmtQty(baseline)}
        </Link>
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            className="ml-auto w-24 text-right font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            onBlur={() => {
              if (
                value !== "" &&
                Number(value) !== row.physical_qty
              )
                save();
            }}
            placeholder="—"
          />
        ) : (
          <span className="font-mono">
            {row.physical_qty !== null ? fmtQty(row.physical_qty) : "—"}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {variance === null ? (
          <span className="text-muted-foreground">—</span>
        ) : variance === 0 ? (
          <Badge variant="secondary" className="gap-1">
            <Check className="size-3" />
            Cocok
          </Badge>
        ) : (
          <Link href={`/ledger?batch=${row.batch_id}`}>
            <Badge variant="destructive" className="gap-1 font-mono">
              {fmtDelta(variance)}
              <BookOpenText className="size-3" />
            </Badge>
          </Link>
        )}
      </TableCell>
      <TableCell>
        {editable && value !== "" && Number(value) !== row.physical_qty && (
          <Button size="sm" variant="outline" disabled={pending} onClick={save}>
            {pending ? "…" : "Simpan"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
