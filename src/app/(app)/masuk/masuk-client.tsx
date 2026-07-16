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
import { fmtDate, fmtQty } from "@/lib/format";
import { postInbound } from "./actions";
import { ArrowDownToLine } from "lucide-react";

interface Product {
  id: string;
  sku: string;
  name: string;
}

export function MasukClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const product = products.find((p) => p.id === productId);
  const valid =
    productId && Number(qty) > 0 && batchCode.trim() !== "" && expiry !== "";

  function submit() {
    startTransition(async () => {
      const res = await postInbound({
        product_id: productId,
        qty: Number(qty),
        batch_code: batchCode,
        expiry_date: expiry,
        note,
      });
      setConfirm(false);
      if (res.ok) {
        toast.success(res.message);
        setProductId("");
        setQty("");
        setBatchCode("");
        setExpiry("");
        setNote("");
        router.refresh();
      } else toast.error(res.message);
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Barang Masuk dari Maklon</h1>
        <p className="text-sm text-muted-foreground">
          Setiap penerimaan tercatat per batch dengan tanggal kedaluwarsa —
          dasar alokasi FEFO.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowDownToLine className="size-5 text-primary" />
            Penerimaan Baru
          </CardTitle>
          <CardDescription>
            Isi sesuai surat jalan maklon. Semua kolom kecuali catatan wajib.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Produk</Label>
            <Select value={productId || undefined} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih produk…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.sku}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <Label>Kode Batch</Label>
              <Input
                value={batchCode}
                onChange={(e) => setBatchCode(e.target.value.toUpperCase())}
                placeholder="MKL-2607-A"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Tanggal Kedaluwarsa</Label>
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Catatan (opsional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="No. surat jalan, kondisi kiriman…"
              rows={2}
            />
          </div>
          <Button size="lg" disabled={!valid} onClick={() => setConfirm(true)}>
            Lanjut — Periksa Ringkasan
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Penerimaan</DialogTitle>
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
              Jumlah: <b className="font-mono">+{fmtQty(Number(qty) || 0)}</b>{" "}
              unit (layak jual)
            </p>
            <p>
              Batch: <b>{batchCode}</b> — kedaluwarsa <b>{fmtDate(expiry)}</b>
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
