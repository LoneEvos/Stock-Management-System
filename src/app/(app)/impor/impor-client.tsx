"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
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
import { fmtQty } from "@/lib/format";
import { importInitialStock, importOrders, type ImportResult } from "./actions";
import { Download, FileSpreadsheet, FileUp, Upload } from "lucide-react";

type Cell = string | number | null | undefined;

export interface KnownProduct {
  sku: string;
  name: string;
  has_baseline: boolean;
}

/** Hasil validasi satu baris pratinjau. */
interface RowStatus {
  tone: "ok" | "warn" | "error";
  label: string;
}

const STATUS_TEXT: Record<RowStatus["tone"], string> = {
  ok: "text-emerald-600 font-medium",
  warn: "text-amber-600 font-medium",
  error: "text-red-600 font-medium",
};

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

/** Unduh CSV di sisi klien (BOM agar Excel membaca UTF-8 dengan benar). */
function downloadCsv(filename: string, header: string[], lines: string[][]) {
  const esc = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const csv = [header, ...lines].map((l) => l.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImporClient({
  knownProducts,
  orderSkus,
}: {
  knownProducts: KnownProduct[];
  orderSkus: string[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Impor Data</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Jalur masuk data kedua di samping simulator/API. Format CSV atau
          Excel (.xlsx). Setiap file divalidasi per baris sebelum diimpor.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <InitialStockCard knownProducts={knownProducts} />
        <OrdersCard orderSkus={orderSkus} />
      </div>
    </div>
  );
}

/** Log pratinjau pemetaan kolom ala StokTrace: baris bermasalah ditandai. */
function PreviewLog({
  headers,
  rows,
  total,
}: {
  headers: { label: string; align?: "right" }[];
  rows: { cells: (string | number)[]; status: RowStatus }[];
  total: number;
}) {
  const errorCount = rows.filter((r) => r.status.tone === "error").length;
  const warnCount = rows.filter((r) => r.status.tone === "warn").length;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <p className="text-sm font-semibold">Pratinjau pemetaan kolom</p>
        {errorCount > 0 ? (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {errorCount} baris bermasalah
          </span>
        ) : warnCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {warnCount} produk baru
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            Semua baris valid
          </span>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Baris</th>
              {headers.map((h) => (
                <th
                  key={h.label}
                  className={`px-3 py-2 font-medium ${h.align === "right" ? "text-right" : ""}`}
                >
                  {h.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Validasi</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r, i) => (
              <tr
                key={i}
                className={`border-b last:border-0 ${
                  r.status.tone === "error"
                    ? "bg-red-50 dark:bg-red-500/10"
                    : ""
                }`}
              >
                <td className="tnum px-3 py-2 text-muted-foreground">
                  {i + 1}
                </td>
                {r.cells.map((c, j) => (
                  <td
                    key={j}
                    className={`px-3 py-2 ${headers[j]?.align === "right" ? "tnum text-right" : ""}`}
                  >
                    {c === "" ? "—" : c}
                  </td>
                ))}
                <td className={`px-3 py-2 text-xs ${STATUS_TEXT[r.status.tone]}`}>
                  {r.status.tone === "ok" ? "✓ Valid" : r.status.label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 100 && (
        <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          Menampilkan 100 baris pertama dari {fmtQty(total)}.
        </p>
      )}
    </div>
  );
}

function InitialStockCard({ knownProducts }: { knownProducts: KnownProduct[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ name: string; qty: number }[]>([]);
  const [createMissing, setCreateMissing] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const lookup = useMemo(() => {
    const m = new Map<string, KnownProduct>();
    for (const p of knownProducts) {
      m.set(p.name.toLowerCase(), p);
      m.set(p.sku.toLowerCase(), p);
    }
    return m;
  }, [knownProducts]);

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

  // Validasi per baris — cermin aturan server (baseline sekali per produk).
  const statuses = useMemo<RowStatus[]>(
    () =>
      rows.map((r) => {
        if (!Number.isFinite(r.qty) || r.qty <= 0)
          return { tone: "error", label: "Qty tidak valid" };
        const known = lookup.get(r.name.toLowerCase());
        if (known) {
          if (known.has_baseline)
            return { tone: "error", label: "Sudah ada baseline" };
          return { tone: "ok", label: "Valid" };
        }
        return createMissing
          ? { tone: "warn", label: "Produk baru — dibuat otomatis" }
          : { tone: "error", label: "Produk tidak dikenal" };
      }),
    [rows, lookup, createMissing]
  );

  const validRows = rows.filter((_, i) => statuses[i].tone !== "error");
  const errorCount = rows.length - validRows.length;

  function downloadErrors() {
    downloadCsv(
      "impor-stok-awal-error.csv",
      ["baris", "nama produk", "qty", "alasan"],
      rows
        .map((r, i) => ({ r, i, s: statuses[i] }))
        .filter((x) => x.s.tone === "error")
        .map((x) => [
          String(x.i + 1),
          x.r.name,
          Number.isFinite(x.r.qty) ? String(x.r.qty) : "",
          x.s.label,
        ])
    );
  }

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

            <PreviewLog
              headers={[
                { label: "Nama Produk" },
                { label: "Qty", align: "right" },
              ]}
              rows={rows.map((r, i) => ({
                cells: [
                  r.name,
                  Number.isFinite(r.qty) && r.qty > 0 ? fmtQty(r.qty) : "—",
                ],
                status: statuses[i],
              }))}
              total={rows.length}
            />

            <div className="flex flex-wrap justify-end gap-2">
              {errorCount > 0 && (
                <Button variant="outline" onClick={downloadErrors}>
                  <Download className="size-4" />
                  Unduh error
                </Button>
              )}
              <Button
                disabled={pending || validRows.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    const res = await importInitialStock(
                      validRows,
                      createMissing
                    );
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
                  : `Impor ${validRows.length} baris valid`}
              </Button>
            </div>
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

function OrdersCard({ orderSkus }: { orderSkus: string[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<
    { order_id: string; channel: string; sku: string; qty: number }[]
  >([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const skuSet = useMemo(() => new Set(orderSkus), [orderSkus]);

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
        .filter((r) => r.order_id || r.sku);
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

  // Validasi per baris — cermin pipeline ingest (SKU produk/bundle aktif).
  const statuses = useMemo<RowStatus[]>(
    () =>
      rows.map((r) => {
        if (!r.order_id) return { tone: "error", label: "Order ID kosong" };
        const ch = r.channel.toLowerCase();
        if (ch !== "shopee" && ch !== "tiktok")
          return { tone: "error", label: "Kanal tidak dikenal" };
        if (!r.sku) return { tone: "error", label: "SKU kosong" };
        if (!skuSet.has(r.sku))
          return { tone: "error", label: "SKU tidak dikenal" };
        if (!Number.isFinite(r.qty) || r.qty <= 0)
          return { tone: "error", label: "Qty tidak valid" };
        return { tone: "ok", label: "Valid" };
      }),
    [rows, skuSet]
  );

  const validRows = rows.filter((_, i) => statuses[i].tone === "ok");
  const errorCount = rows.length - validRows.length;

  function downloadErrors() {
    downloadCsv(
      "impor-pesanan-error.csv",
      ["baris", "order_id", "channel", "sku", "qty", "alasan"],
      rows
        .map((r, i) => ({ r, i, s: statuses[i] }))
        .filter((x) => x.s.tone === "error")
        .map((x) => [
          String(x.i + 1),
          x.r.order_id,
          x.r.channel,
          x.r.sku,
          Number.isFinite(x.r.qty) ? String(x.r.qty) : "",
          x.s.label,
        ])
    );
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
            <PreviewLog
              headers={[
                { label: "Order" },
                { label: "Kanal" },
                { label: "SKU" },
                { label: "Qty", align: "right" },
              ]}
              rows={rows.map((r, i) => ({
                cells: [
                  r.order_id,
                  r.channel,
                  r.sku,
                  Number.isFinite(r.qty) ? fmtQty(r.qty) : "—",
                ],
                status: statuses[i],
              }))}
              total={rows.length}
            />

            <div className="flex flex-wrap justify-end gap-2">
              {errorCount > 0 && (
                <Button variant="outline" onClick={downloadErrors}>
                  <Download className="size-4" />
                  Unduh error
                </Button>
              )}
              <Button
                disabled={pending || validRows.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    const res = await importOrders(validRows);
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
                  : `Impor ${validRows.length} baris valid`}
              </Button>
            </div>
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
