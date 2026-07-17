"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChannelBadge } from "@/components/channel-badge";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL, fmtDateTime } from "@/lib/format";
import { ExternalLink } from "lucide-react";

interface OrderRow {
  id: string;
  marketplace_order_id: string;
  channel: string;
  status: string;
  created_at: string;
  shipped_at: string | null;
  item_count: number;
  total_qty: number;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const variant =
    status === "CREATED"
      ? "outline"
      : status === "SHIPPED"
        ? "default"
        : status === "DELIVERED"
          ? "secondary"
          : "destructive";
  return <Badge variant={variant}>{ORDER_STATUS_LABEL[status] ?? status}</Badge>;
}

export function PesananClient({ orders }: { orders: OrderRow[] }) {
  const columns = useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        accessorKey: "marketplace_order_id",
        header: "No. Pesanan",
        cell: ({ row }) => (
          <Link
            href={`/pesanan/${row.original.id}`}
            className="inline-flex items-center gap-1 font-mono font-medium text-primary underline-offset-2 hover:underline"
          >
            {row.original.marketplace_order_id}
            <ExternalLink className="size-3" />
          </Link>
        ),
      },
      {
        accessorKey: "channel",
        header: "Kanal",
        cell: ({ row }) => <ChannelBadge channel={row.original.channel} />,
        filterFn: "equals",
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
        filterFn: "equals",
      },
      {
        accessorKey: "total_qty",
        header: "Unit",
        cell: ({ row }) => (
          <span className="font-mono">{row.original.total_qty}</span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Dibuat",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {fmtDateTime(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: "shipped_at",
        header: "Dikirim",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.shipped_at
              ? fmtDateTime(row.original.shipped_at)
              : "—"}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pesanan Marketplace</h1>
        <p className="text-sm text-muted-foreground">
          Pesanan baru = reservasi. Stok fisik baru keluar saat dikirim
          (Shopee SHIPPED / TikTok IN_TRANSIT).
        </p>
      </div>
      <DataTable
        columns={columns}
        data={orders}
        searchPlaceholder="Cari no. pesanan…"
        pageSize={20}
        facetFilters={[
          {
            columnId: "channel",
            placeholder: "Kanal",
            options: [
              { value: "shopee", label: "Shopee" },
              { value: "tiktok", label: "TikTok Shop" },
            ],
          },
          {
            columnId: "status",
            placeholder: "Status",
            options: Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
        emptyText="Belum ada pesanan — coba Simulator untuk menyuntik data demo."
      />
    </div>
  );
}
