"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CHANNEL_LABEL,
  MOVEMENT_LABEL,
  REASON_LABEL,
  STATE_LABEL,
  fmtDateTime,
  fmtDelta,
  fmtQty,
} from "@/lib/format";
import type { LedgerRow } from "@/lib/queries";
import { ExternalLink, X } from "lucide-react";

/** Tautan ke dokumen sumber sebuah entri ledger — inti penelusuran. */
function RefLink({ row }: { row: LedgerRow }) {
  if (!row.ref_type || !row.ref_id)
    return <span className="text-muted-foreground">—</span>;
  const href =
    row.ref_type === "order"
      ? `/pesanan/${row.ref_id}`
      : row.ref_type === "return_item" || row.ref_type === "return"
        ? `/retur?fokus=${row.ref_id}`
        : row.ref_type === "opname_count" || row.ref_type === "opname"
          ? `/opname`
          : null;
  const label =
    row.ref_type === "order"
      ? "Pesanan"
      : row.ref_type.startsWith("return")
        ? "Retur"
        : row.ref_type.startsWith("opname")
          ? "Opname"
          : row.ref_type === "manual_out"
            ? "Keluar manual"
            : row.ref_type === "inbound"
              ? "Penerimaan"
              : row.ref_type;
  if (!href) return <span className="text-xs text-muted-foreground">{label}</span>;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
    >
      {label}
      <ExternalLink className="size-3" />
    </Link>
  );
}

export function LedgerClient({
  rows,
  contextLabel,
  filteredSum,
  activeFilters,
}: {
  rows: LedgerRow[];
  contextLabel: string | null;
  filteredSum: number;
  activeFilters: Record<string, string | undefined>;
}) {
  const hasFilter = Object.values(activeFilters).some(Boolean);

  const columns = useMemo<ColumnDef<LedgerRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Waktu",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {fmtDateTime(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: "product_name",
        header: "Produk",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.product_name}</p>
            <p className="text-xs text-muted-foreground">
              batch {row.original.batch_code}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "qty_delta",
        header: "Δ Qty",
        cell: ({ row }) => {
          const v = row.original.qty_delta;
          return (
            <span
              className={`font-mono font-bold ${v > 0 ? "text-emerald-600" : "text-destructive"}`}
            >
              {fmtDelta(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "movement_type",
        header: "Jenis",
        cell: ({ row }) => (
          <Badge variant="outline">
            {MOVEMENT_LABEL[row.original.movement_type]}
          </Badge>
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "reason",
        header: "Alasan",
        cell: ({ row }) => REASON_LABEL[row.original.reason],
        filterFn: "equals",
      },
      {
        accessorKey: "channel",
        header: "Kanal",
        cell: ({ row }) => CHANNEL_LABEL[row.original.channel],
        filterFn: "equals",
      },
      {
        accessorKey: "stock_state",
        header: "Kondisi",
        cell: ({ row }) => STATE_LABEL[row.original.stock_state],
        filterFn: "equals",
      },
      {
        id: "sumber",
        header: "Dokumen Sumber",
        cell: ({ row }) => <RefLink row={row.original} />,
      },
      {
        accessorKey: "operator",
        header: "Operator",
        cell: ({ row }) => (
          <span className="text-xs">{row.original.operator}</span>
        ),
      },
      {
        accessorKey: "note",
        header: "Catatan",
        cell: ({ row }) => (
          <span
            className="block max-w-52 truncate text-xs text-muted-foreground"
            title={row.original.note ?? ""}
          >
            {row.original.note ?? "—"}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Buku Besar Stok</h1>
          <p className="text-sm text-muted-foreground">
            Append-only — koreksi selalu berupa entri baru, tidak pernah edit.
            Setiap baris menunjuk dokumen sumbernya.
          </p>
        </div>
        {hasFilter && (
          <Button variant="outline" size="sm" render={<Link href="/ledger" />}>
            <X className="size-4" />
            Hapus filter
          </Button>
        )}
      </div>

      {hasFilter && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-sm">
            <span>
              Penelusuran:{" "}
              <b>{contextLabel ?? "filter aktif"}</b>
            </span>
            <span>
              Jumlah baris: <b className="font-mono">{fmtQty(rows.length)}</b>
            </span>
            <span>
              Total pergerakan terfilter:{" "}
              <b className="font-mono">{fmtDelta(filteredSum)}</b>
            </span>
            <span className="text-xs text-muted-foreground">
              Baris-baris di bawah adalah pergerakan pembentuk angka tersebut.
            </span>
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Cari produk / batch / operator / catatan…"
        pageSize={25}
        facetFilters={[
          {
            columnId: "movement_type",
            placeholder: "Jenis",
            options: Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            columnId: "reason",
            placeholder: "Alasan",
            options: Object.entries(REASON_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            columnId: "channel",
            placeholder: "Kanal",
            options: Object.entries(CHANNEL_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
        emptyText="Tidak ada pergerakan yang cocok."
      />
    </div>
  );
}
