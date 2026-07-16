"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireOperator } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function createProduct(input: {
  sku: string;
  name: string;
}): Promise<ActionResult> {
  try {
    await requireOperator();
    const sku = input.sku.trim();
    const name = input.name.trim();
    if (!sku || !name) return { ok: false, message: "SKU dan nama wajib diisi." };
    await sql`insert into products ${sql({ sku, name })}`;
    revalidatePath("/produk");
    return { ok: true, message: `Produk ${name} ditambahkan.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate"))
      return { ok: false, message: `SKU ${input.sku} sudah dipakai.` };
    return { ok: false, message: msg };
  }
}

export async function updateProduct(input: {
  id: string;
  sku: string;
  name: string;
  is_active: boolean;
}): Promise<ActionResult> {
  try {
    await requireOperator();
    await sql`
      update products
      set sku = ${input.sku.trim()}, name = ${input.name.trim()},
          is_active = ${input.is_active}
      where id = ${input.id}
    `;
    revalidatePath("/produk");
    return { ok: true, message: "Produk diperbarui." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function createBundle(input: {
  sku: string;
  name: string;
  items: { product_id: string; qty: number }[];
}): Promise<ActionResult> {
  try {
    await requireOperator();
    const items = input.items.filter((i) => i.product_id && i.qty > 0);
    if (!input.sku.trim() || !input.name.trim())
      return { ok: false, message: "SKU dan nama bundle wajib diisi." };
    if (items.length === 0)
      return { ok: false, message: "Resep bundle minimal 1 produk satuan." };

    await sql.begin(async (tx) => {
      const [bundle] = await tx`
        insert into bundles ${tx({ sku: input.sku.trim(), name: input.name.trim() })}
        returning id
      `;
      for (const it of items) {
        await tx`
          insert into bundle_items ${tx({
            bundle_id: bundle.id,
            product_id: it.product_id,
            qty: it.qty,
          })}
        `;
      }
    });
    revalidatePath("/produk");
    return { ok: true, message: `Bundle ${input.name} dibuat (${items.length} produk satuan).` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate"))
      return { ok: false, message: `SKU ${input.sku} sudah dipakai.` };
    return { ok: false, message: msg };
  }
}

export async function toggleBundle(input: {
  id: string;
  is_active: boolean;
}): Promise<ActionResult> {
  try {
    await requireOperator();
    await sql`update bundles set is_active = ${input.is_active} where id = ${input.id}`;
    revalidatePath("/produk");
    return { ok: true, message: "Bundle diperbarui." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
