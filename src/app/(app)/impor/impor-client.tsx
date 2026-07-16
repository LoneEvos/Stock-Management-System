"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtQty } from "@/lib/format";
import { importInitialStock, importOrders, type ImportResult } from "./actions";
import { FileSpreadsheet, FileUp, Upload } from "lucide-react";

type Cell = string | number | null | undefined;

/** Parse CSV/XLSX menjadi array-of-rows generik. */
async function parseFile(file: File): Promise<Record<string, Cell>[]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, Cell>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data),
        error: reject,
      });
    });
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, Cell>>(ws, { defval: null });
}

/** Cari nilai kolom dengan beberapa kandidat nama (fleksibel thd header klien). */
function pick(row: Record<string, Cell>, candidates: string[]): Cell {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const key = keys.find((k) => k.trim().toLowerCase() === cand);
    if (key !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  // fallback: contains
  for (const cand of candidates) {
    const key = keys.find((k) => k.trim().toLowerCase().includes(cand));
    if (key !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
}

function parseQty(v: Cell): number {
  if (typeof v === "number") return Math.floor(v);
  if (!v) return NaN;
  // format Indonesia: 41,044 / 41.044 → 41044
  return Math.floor(Number(String(v).replace(/[.,\s]/g, "")));
}

export function ImporClient() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Impor Data</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Jalur masuk data kedua di samping simulator/API. Format CSV atau
          Excel (.xlsx).
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <InitialStockCard />
        <OrdersCard />
      </div>
    </div>
  );
}

function InitialStockCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ name: string; qty: number }[]>([]);
  const [createMissing, setCreateMissing] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    try {
      const raw = await parseFile(file);
      const parsed = raw
        .map((r) => ({
          name: String(pick(r, ["nama produk", "nama", "produk", "product", "name"]) ?? "").trim(),
          qty: parseQty(pick(r, ["sisa stok", "sisa", "stok", "qty", "jumlah", "stock"])),
        }))
        .filter((r) => r.name);
      if (parsed.length === 0) {
        toast.error(
          "Tidak menemukan kolom nama produk / sisa stok pada file ini."
        );
        return;
      }
      setRows(parsed);
      setResult(null);
    } catch {
      toast.error("Gagal membaca file — pastikan format CSV/XLSX.");
    }
  }

  const validRows = rows.filter((r) => Number.isFinite(r.qty) && r.qty > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="size-5 text-emerald-600" />
          Stok Awal (Baseline)
        </CardTitle>
        <CardDescription>
          Spreadsheet klien: kolom <b>nama produk</b> + <b>sisa stok</b>.
          Setiap produk masuk sebagai entri INITIAL_COUNT bertanggal di batch
          &quot;AWAL&quot; — titik nol yang eksplisit. Hanya sekali per produk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" />
          Pilih File CSV / Excel
        </Button>

        {rows.length > 0 && (
          <>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Produk</TableHead>
                    <TableHead className="text-right">Sisa Stok</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{r.name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Number.isFinite(r.qty) && r.qty > 0 ? (
                          fmtQty(r.qty)
                        ) : (
                          <Badge variant="outline">dilewati</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="create-missing"
                checked={createMissing}
                onCheckedChange={(v) => setCreateMissing(v === true)}
              />
              <Label htmlFor="create-missing" className="text-sm font-normal">
                Buat otomatis produk yang belum terdaftar
              </Label>
            </div>
            <Button
              className="w-full"
              disabled={pending || validRows.length === 0}
              onClick={() =>
                startTransition(async () => {
                  const res = await importInitialStock(rows, createMissing);
                  setResult(res);
                  if (res.ok) {
                    toast.success(res.message);
                    router.refresh();
                  } else toast.error(res.message);
                })
              }
            >
              <Upload className="size-4" />
              {pending
                ? "Mengimpor…"
                : `Impor ${validRows.length} Baris sebagai Baseline`}
            </Button>
          </>
        )}

        {result?.detail && result.detail.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            {result.detail.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrdersCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<
    { order_id: string; channel: string; sku: string; qty: number }[]
  >([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    try {
      const raw = await parseFile(file);
      const parsed = raw
        .map((r) => ({
          order_id: String(pick(r, ["order_id", "no pesanan", "order id", "nomor pesanan"]) ?? "").trim(),
          channel: String(pick(r, ["channel", "kanal", "marketplace"]) ?? "").trim(),
          sku: String(pick(r, ["sku", "listing_sku", "sku listing"]) ?? "").trim(),
          qty: parseQty(pick(r, ["qty", "jumlah", "quantity"])),
        }))
        .filter((r) => r.order_id && r.sku);
      if (parsed.length === 0) {
        toast.error(
          "Tidak menemukan kolom order_id / channel / sku / qty pada file ini."
        );
        return;
      }
      setRows(parsed);
      setResult(null);
    } catch {
      toast.error("Gagal membaca file — pastikan format CSV/XLSX.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="size-5 text-blue-600" />
          Ekspor Pesanan Marketplace
        </CardTitle>
        <CardDescription>
          Kolom: <b>order_id</b>, <b>channel</b> (shopee/tiktok), <b>sku</b>,{" "}
          <b>qty</b>. Baris dengan order_id sama digabung jadi satu pesanan dan
          melewati pipeline ingest yang sama dengan simulator — masuk sebagai
          reservasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" />
          Pilih File CSV / Excel
        </Button>

        {rows.length > 0 && (
          <>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Kanal</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {r.order_id}
                      </TableCell>
                      <TableCell className="text-sm">{r.channel}</TableCell>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Number.isFinite(r.qty) ? r.qty : "?"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await importOrders(rows);
                  setResult(res);
                  if (res.ok) {
                    toast.success(res.message);
                    router.refresh();
                  } else toast.error(res.message);
                })
              }
            >
              <Upload className="size-4" />
              {pending ? "Mengimpor…" : `Impor ${rows.length} Baris Pesanan`}
            </Button>
          </>
        )}

        {result?.detail && result.detail.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            {result.detail.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
