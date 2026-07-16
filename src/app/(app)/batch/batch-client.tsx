"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { daysUntil, fmtDate, fmtQty } from "@/lib/format";
import type { BatchStockRow } from "@/lib/queries";

/** Tier kedaluwarsa: lewat → merah, ≤30 hari → merah, ≤90 hari → kuning. */
export function ExpiryBadge({ expiry }: { expiry: string | null }) {
  if (!expiry)
    return <Badge variant="outline">Baseline — tanpa data ED</Badge>;
  const d = daysUntil(expiry);
  if (d < 0) return <Badge variant="destructive">Kedaluwarsa {-d} hari lalu</Badge>;
  if (d <= 30) return <Badge variant="destructive">{d} hari lagi</Badge>;
  if (d <= 90)
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
        {d} hari lagi
      </Badge>
    );
  return <Badge variant="secondary">{d} hari lagi</Badge>;
}

export function BatchClient({ batches }: { batches: BatchStockRow[] }) {
  const columns = useMemo<ColumnDef<BatchStockRow>[]>(
    () => [
      {
        accessorKey: "product_name",
        header: "Produk",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.product_name}</span>
        ),
      },
      { accessorKey: "batch_code", header: "Kode Batch" },
      {
        accessorKey: "expiry_date",
        header: "Kedaluwarsa",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="text-sm">{fmtDate(row.original.expiry_date)}</span>
            <ExpiryBadge expiry={row.original.expiry_date} />
          </div>
        ),
      },
      {
        accessorKey: "sellable_qty",
        header: "Layak Jual",
        cell: ({ row }) => (
          <Link
            href={`/ledger?batch=${row.original.batch_id}`}
            className="font-mono font-semibold text-primary underline-offset-2 hover:underline"
            title="Telusuri pergerakan batch ini"
          >
            {fmtQty(row.original.sellable_qty)}
          </Link>
        ),
      },
      {
        accessorKey: "damaged_qty",
        header: "Rusak",
        cell: ({ row }) => (
          <span className="font-mono">{fmtQty(row.original.damaged_qty)}</span>
        ),
      },
      {
        accessorKey: "received_at",
        header: "Diterima",
        cell: ({ row }) => fmtDate(row.original.received_at),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Batch & Kedaluwarsa</h1>
        <p className="text-sm text-muted-foreground">
          Alokasi keluar selalu FEFO — batch dengan kedaluwarsa terdekat keluar
          lebih dulu. Operator tidak pernah memilih batch.
        </p>
      </div>
      <DataTable
        columns={columns}
        data={batches}
        searchPlaceholder="Cari produk / kode batch…"
        pageSize={20}
      />
    </div>
  );
}
