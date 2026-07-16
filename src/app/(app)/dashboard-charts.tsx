"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fmtQty } from "@/lib/format";

// Palet tervalidasi (CVD-safe, kontras ≥3:1 di light & dark):
const MASUK = "#2563eb"; // biru — barang masuk
const KELUAR = "#ea580c"; // oranye — barang keluar

interface DailyRow {
  day: string;
  masuk: number;
  keluar: number;
}

interface MoverRow {
  product_id: string;
  name: string;
  keluar: number;
}

function shortDay(d: string): string {
  const date = new Date(d);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export function DashboardCharts({
  daily,
  topMovers,
}: {
  daily: DailyRow[];
  topMovers: MoverRow[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Pergerakan 14 Hari Terakhir
          </CardTitle>
          <CardDescription className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: MASUK }}
              />
              Masuk (unit)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: KELUAR }}
              />
              Keluar (unit)
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={shortDay}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value, name) => [
                  fmtQty(Number(value)),
                  name === "masuk" ? "Masuk" : "Keluar",
                ]}
                labelFormatter={(l) => `Tanggal ${shortDay(String(l))}`}
              />
              <Line
                type="monotone"
                dataKey="masuk"
                stroke={MASUK}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="keluar"
                stroke={KELUAR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Produk Terlaris — Unit Keluar 7 Hari
          </CardTitle>
          <CardDescription className="text-xs">
            Klik batang untuk menelusuri pergerakannya di buku besar.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {topMovers.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Belum ada barang keluar 7 hari terakhir.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topMovers}
                layout="vertical"
                margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value) => [fmtQty(Number(value)), "Unit keluar"]}
                />
                <Bar
                  dataKey="keluar"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={18}
                  label={{
                    position: "right",
                    fontSize: 11,
                    formatter: (v) => fmtQty(Number(v)),
                  }}
                >
                  {topMovers.map((m) => (
                    <Cell key={m.product_id} fill={MASUK} cursor="pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="sr-only">
            {topMovers.map((m) => (
              <Link key={m.product_id} href={`/ledger?product=${m.product_id}`}>
                {m.name}: {m.keluar} unit
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
