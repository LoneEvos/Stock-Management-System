"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtQty } from "@/lib/format";
import type { ProductStockRow } from "@/lib/queries";
import {
  createBundle,
  createProduct,
  toggleBundle,
  updateBundleRecipe,
  updateProduct,
} from "./actions";
import { Package, PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";

interface BundleRow {
  id: string;
  sku: string;
  name: string;
  is_active: boolean;
  active_version: number;
  items: {
    product_id: string;
    product_name: string;
    product_sku: string;
    qty: number;
  }[];
}

export function ProdukClient({
  products,
  bundles,
}: {
  products: ProductStockRow[];
  bundles: BundleRow[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Produk & Bundle</h1>
        <p className="text-sm text-muted-foreground">
          Angka stok adalah turunan buku besar — klik untuk menelusuri
          pergerakan pembentuknya.
        </p>
      </div>

      <Tabs defaultValue="produk">
        <TabsList>
          <TabsTrigger value="produk">
            <Package className="mr-1.5 size-4" />
            Produk Satuan ({products.length})
          </TabsTrigger>
          <TabsTrigger value="bundle">
            <PackagePlus className="mr-1.5 size-4" />
            Resep Bundle ({bundles.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="produk" className="space-y-3 pt-2">
          <ProductTable products={products} />
        </TabsContent>
        <TabsContent value="bundle" className="space-y-3 pt-2">
          <BundleTable bundles={bundles} products={products} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================== PRODUK ======================================

function ProductTable({ products }: { products: ProductStockRow[] }) {
  const columns = useMemo<ColumnDef<ProductStockRow>[]>(
    () => [
      { accessorKey: "sku", header: "SKU" },
      {
        accessorKey: "name",
        header: "Nama Produk",
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{row.original.name}</span>
            {row.original.baseline_unverified && (
              <Badge
                variant="outline"
                className="border-amber-500 text-amber-600"
                title="Stok awal masih perkiraan dari spreadsheet — terverifikasi setelah produk ini tersentuh opname pertama."
              >
                Stok awal belum terverifikasi
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: "sellable_qty",
        header: "Layak Jual",
        cell: ({ row }) => (
          <Link
            href={`/ledger?product=${row.original.product_id}&state=SELLABLE`}
            className="font-mono font-semibold text-primary underline-offset-2 hover:underline"
            title="Telusuri pergerakan pembentuk angka ini"
          >
            {fmtQty(row.original.sellable_qty)}
          </Link>
        ),
      },
      {
        accessorKey: "reserved_qty",
        header: "Direservasi",
        cell: ({ row }) => (
          <span className="font-mono text-amber-600">
            {fmtQty(row.original.reserved_qty)}
          </span>
        ),
      },
      {
        accessorKey: "available_qty",
        header: "Tersedia",
        cell: ({ row }) => {
          const v = row.original.available_qty;
          return (
            <span
              className={`font-mono font-semibold ${v < 0 ? "text-destructive" : ""}`}
            >
              {fmtQty(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "damaged_qty",
        header: "Rusak",
        cell: ({ row }) =>
          row.original.damaged_qty > 0 ? (
            <Link
              href={`/ledger?product=${row.original.product_id}&state=DAMAGED`}
              className="font-mono text-destructive underline-offset-2 hover:underline"
            >
              {fmtQty(row.original.damaged_qty)}
            </Link>
          ) : (
            <span className="font-mono text-muted-foreground">0</span>
          ),
      },
      {
        accessorKey: "is_active",
        header: "Status",
        cell: ({ row }) =>
          row.original.is_active ? (
            <Badge variant="secondary">Aktif</Badge>
          ) : (
            <Badge variant="outline">Nonaktif</Badge>
          ),
      },
      {
        id: "aksi",
        header: "",
        cell: ({ row }) => <EditProductDialog product={row.original} />,
      },
    ],
    []
  );

  return (
    <>
      <div className="flex justify-end">
        <NewProductDialog />
      </div>
      <DataTable
        columns={columns}
        data={products}
        searchPlaceholder="Cari SKU / nama produk…"
        pageSize={15}
      />
    </>
  );
}

function NewProductDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Tambah Produk
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Produk Satuan</DialogTitle>
          <DialogDescription>
            Stok awal dicatat lewat Barang Masuk atau Impor Data — bukan di sini.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="np-sku">SKU</Label>
            <Input
              id="np-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="AURA-HYDRO-MASK"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-name">Nama Produk</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aura Hydrogel Mask"
            />
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await createProduct({ sku, name });
                if (res.ok) {
                  toast.success(res.message);
                  setOpen(false);
                  setSku("");
                  setName("");
                  router.refresh();
                } else toast.error(res.message);
              })
            }
          >
            {pending ? "Menyimpan…" : "Simpan Produk"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({ product }: { product: ProductStockRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState(product.sku);
  const [name, setName] = useState(product.name);
  const [active, setActive] = useState(product.is_active);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Ubah"
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Produk</DialogTitle>
          <DialogDescription>
            Mengubah nama/SKU tidak mengubah stok — riwayat ledger tetap utuh.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>SKU</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Nama Produk</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              items={{ "1": "Aktif", "0": "Nonaktif" }}
              value={active ? "1" : "0"}
              onValueChange={(v) => setActive(v === "1")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Aktif</SelectItem>
                <SelectItem value="0">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await updateProduct({
                  id: product.product_id,
                  sku,
                  name,
                  is_active: active,
                });
                if (res.ok) {
                  toast.success(res.message);
                  setOpen(false);
                  router.refresh();
                } else toast.error(res.message);
              })
            }
          >
            {pending ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================== BUNDLE ======================================

function BundleTable({
  bundles,
  products,
}: {
  bundles: BundleRow[];
  products: ProductStockRow[];
}) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<BundleRow>[]>(
    () => [
      { accessorKey: "sku", header: "SKU Listing" },
      {
        accessorKey: "name",
        header: "Nama Bundle",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        id: "resep",
        header: "Resep (dipecah saat data masuk)",
        cell: ({ row }) => (
          <div className="flex max-w-md flex-wrap items-center gap-1">
            <Badge variant="outline" title="Versi resep aktif — edit resep membuat versi baru; pesanan lama tidak berubah.">
              v{row.original.active_version}
            </Badge>
            {row.original.items.map((it) => (
              <Badge key={it.product_id} variant="secondary">
                {it.qty}× {it.product_name}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "edit",
        header: "",
        cell: ({ row }) => (
          <EditBundleRecipeDialog bundle={row.original} products={products} />
        ),
      },
      {
        accessorKey: "is_active",
        header: "Status",
        cell: ({ row }) => {
          const b = row.original;
          return (
            <Button
              variant={b.is_active ? "secondary" : "outline"}
              size="sm"
              onClick={async () => {
                const res = await toggleBundle({
                  id: b.id,
                  is_active: !b.is_active,
                });
                if (res.ok) {
                  toast.success(res.message);
                  router.refresh();
                } else toast.error(res.message);
              }}
            >
              {b.is_active ? "Aktif" : "Nonaktif"}
            </Button>
          );
        },
      },
    ],
    [router, products]
  );

  return (
    <>
      <div className="rounded-lg border border-dashed bg-background p-3 text-sm text-muted-foreground">
        Tidak ada stok bundle. Bundle hanyalah <b>resep</b>: saat pesanan berisi
        SKU bundle masuk, sistem memecahnya menjadi produk satuan sesuai resep
        di bawah — stok yang bergerak selalu stok satuan.
      </div>
      <div className="flex justify-end">
        <NewBundleDialog products={products} />
      </div>
      <DataTable
        columns={columns}
        data={bundles}
        searchPlaceholder="Cari bundle…"
        pageSize={10}
        emptyText="Belum ada resep bundle."
      />
    </>
  );
}

function NewBundleDialog({ products }: { products: ProductStockRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<{ product_id: string; qty: number }[]>([
    { product_id: "", qty: 1 },
  ]);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Buat Resep Bundle
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat Resep Bundle</DialogTitle>
          <DialogDescription>
            SKU listing paket di marketplace → dipecah otomatis menjadi produk
            satuan berikut saat pesanan masuk.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>SKU Listing Marketplace</Label>
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="PAKET-GLOWING"
            />
          </div>
          <div className="grid gap-2">
            <Label>Nama Bundle</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Paket Glowing"
            />
          </div>
          <div className="grid gap-2">
            <Label>Resep — produk satuan & jumlah per paket</Label>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2">
                <Select
                  items={Object.fromEntries(
                    products
                      .filter((p) => p.is_active)
                      .map((p) => [p.product_id, p.name])
                  )}
                  value={it.product_id || null}
                  onValueChange={(v) =>
                    setItems((arr) =>
                      arr.map((x, i) =>
                        i === idx ? { ...x, product_id: v ?? "" } : x
                      )
                    )
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pilih produk…" />
                  </SelectTrigger>
                  <SelectContent>
                    {products
                      .filter((p) => p.is_active)
                      .map((p) => (
                        <SelectItem key={p.product_id} value={p.product_id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  className="w-20"
                  value={it.qty}
                  onChange={(e) =>
                    setItems((arr) =>
                      arr.map((x, i) =>
                        i === idx ? { ...x, qty: Number(e.target.value) } : x
                      )
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hapus baris"
                  onClick={() =>
                    setItems((arr) => arr.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setItems((arr) => [...arr, { product_id: "", qty: 1 }])
              }
            >
              <Plus className="size-4" />
              Tambah produk
            </Button>
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await createBundle({ sku, name, items });
                if (res.ok) {
                  toast.success(res.message);
                  setOpen(false);
                  setSku("");
                  setName("");
                  setItems([{ product_id: "", qty: 1 }]);
                  router.refresh();
                } else toast.error(res.message);
              })
            }
          >
            {pending ? "Menyimpan…" : "Simpan Resep"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit resep = VERSI BARU (Phase 2). Versi lama tidak pernah diubah/dihapus —
 * pesanan yang sudah dipecah dengan versi lama tetap akurat selamanya.
 */
function EditBundleRecipeDialog({
  bundle,
  products,
}: {
  bundle: BundleRow;
  products: ProductStockRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ product_id: string; qty: number }[]>(
    bundle.items.map((it) => ({ product_id: it.product_id, qty: it.qty }))
  );
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setItems(
            bundle.items.map((it) => ({ product_id: it.product_id, qty: it.qty }))
          );
          setOpen(true);
        }}
      >
        <Pencil className="size-3.5" />
        Edit Resep
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit Resep — {bundle.name} (v{bundle.active_version} →{" "}
            v{bundle.active_version + 1})
          </DialogTitle>
          <DialogDescription>
            Menyimpan membuat VERSI BARU. Pesanan lama yang dipecah dengan
            v{bundle.active_version} tidak berubah — resep di-versioning.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Resep — produk satuan & jumlah per paket</Label>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2">
                <Select
                  items={Object.fromEntries(
                    products
                      .filter((p) => p.is_active)
                      .map((p) => [p.product_id, p.name])
                  )}
                  value={it.product_id || null}
                  onValueChange={(v) =>
                    setItems((arr) =>
                      arr.map((x, i) =>
                        i === idx ? { ...x, product_id: v ?? "" } : x
                      )
                    )
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pilih produk…" />
                  </SelectTrigger>
                  <SelectContent>
                    {products
                      .filter((p) => p.is_active)
                      .map((p) => (
                        <SelectItem key={p.product_id} value={p.product_id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  className="w-20"
                  value={it.qty}
                  onChange={(e) =>
                    setItems((arr) =>
                      arr.map((x, i) =>
                        i === idx ? { ...x, qty: Number(e.target.value) } : x
                      )
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hapus baris"
                  onClick={() =>
                    setItems((arr) => arr.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setItems((arr) => [...arr, { product_id: "", qty: 1 }])
              }
            >
              <Plus className="size-4" />
              Tambah produk
            </Button>
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await updateBundleRecipe({
                  bundle_id: bundle.id,
                  items,
                });
                if (res.ok) {
                  toast.success(res.message);
                  setOpen(false);
                  router.refresh();
                } else toast.error(res.message);
              })
            }
          >
            {pending ? "Menyimpan…" : `Simpan sebagai v${bundle.active_version + 1}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
