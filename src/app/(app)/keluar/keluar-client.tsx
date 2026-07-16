"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABEL, REASON_LABEL, fmtQty } from "@/lib/format";
import type { ProductStockRow } from "@/lib/queries";
import { postManualOut } from "./actions";
import { ArrowUpFromLine, Gift, HandCoins, Megaphone, PackageX, Pill, Timer } from "lucide-react";

// Alasan = MAKNA pergerakan; kanal = LEWAT MANA. Keduanya wajib & terpisah.
const REASONS = [
  { value: "offline_sale", icon: HandCoins, hint: "Penjualan di luar marketplace" },
  { value: "bonus", icon: Gift, hint: "Barang gratis penyerta pesanan" },
  { value: "promo", icon: Megaphone, hint: "Keperluan promosi / giveaway" },
  { value: "sample", icon: Pill, hint: "Sampel untuk reseller / konten" },
  { value: "damaged", icon: PackageX, hint: "Rusak di gudang — dikeluarkan" },
  { value: "expired", icon: Timer, hint: "Kedaluwarsa — dikeluarkan" },
] as const;

export function KeluarClient({ products }: { products: ProductStockRow[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [channel, setChannel] = useState("offline");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const product = products.find((p) => p.product_id === productId);
  const valid = productId && Number(qty) > 0 && reason;

  function submit() {
    startTransition(async () => {
      const res = await postManualOut({
        product_id: productId,
        qty: Number(qty),
        reason,
        channel,
        note,
      });
      setConfirm(false);
      if (res.ok) {
        toast.success(res.message);
        setProductId("");
        setQty("");
        setReason("");
        setChannel("offline");
        setNote("");
        router.refresh();
      } else toast.error(res.message);
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Keluar Manual</h1>
        <p className="text-sm text-muted-foreground">
          Bonus, promo, dan sampel adalah sumber selisih terbesar — di sini
          semuanya WAJIB tercatat dengan alasan yang jelas. Batch dialokasikan
          otomatis (FEFO).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpFromLine className="size-5 text-primary" />
            Pengeluaran Baru
          </CardTitle>
          <CardDescription>
            Alasan dan kanal terpisah: penjualan offline ≠ bonus meski sama-sama
            manual.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Produk</Label>
            <Select
              items={Object.fromEntries(
                products.map((p) => [
                  p.product_id,
                  `${p.name} — tersedia ${fmtQty(p.available_qty)}`,
                ])
              )}
              value={productId || null}
              onValueChange={(v) => setProductId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih produk…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.product_id} value={p.product_id}>
                    {p.name} — tersedia {fmtQty(p.available_qty)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Alasan (wajib — makna pergerakan)</Label>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map((r) => {
                const Icon = r.icon;
                const active = reason === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10"
                        : "hover:bg-muted"
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 size-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {REASON_LABEL[r.value]}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {r.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Jumlah (unit)</Label>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="grid gap-2">
              <Label>Kanal (lewat mana)</Label>
              <Select
                items={CHANNEL_LABEL}
                value={channel}
                onValueChange={(v) => setChannel(v ?? "offline")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Catatan (opsional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Untuk siapa / acara apa…"
              rows={2}
            />
          </div>

          {product && Number(qty) > product.available_qty && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              Melebihi stok tersedia ({fmtQty(product.available_qty)}). Sistem
              akan menolak jika saldo batch tidak mencukupi.
            </p>
          )}

          <Button size="lg" disabled={!valid} onClick={() => setConfirm(true)}>
            Lanjut — Periksa Ringkasan
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Pengeluaran</DialogTitle>
            <DialogDescription>
              Entri buku besar tidak bisa diedit — pastikan benar sebelum
              menyimpan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 rounded-lg bg-muted p-4 text-sm">
            <p>
              Produk: <b>{product?.name}</b>
            </p>
            <p>
              Jumlah:{" "}
              <b className="font-mono text-destructive">
                −{fmtQty(Number(qty) || 0)}
              </b>{" "}
              unit
            </p>
            <p>
              Alasan: <b>{REASON_LABEL[reason] ?? "—"}</b>
            </p>
            <p>
              Kanal: <b>{CHANNEL_LABEL[channel]}</b>
            </p>
            <p className="text-xs text-muted-foreground">
              Batch dipilih otomatis — kedaluwarsa terdekat keluar lebih dulu
              (FEFO).
            </p>
            {note && <p>Catatan: {note}</p>}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirm(false)}
            >
              Kembali
            </Button>
            <Button className="flex-1" disabled={pending} onClick={submit}>
              {pending ? "Menyimpan…" : "Simpan ke Buku Besar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
