"use client";

import { BarList, LineChart, type Point } from "@/components/charts/line-chart";

/** Client wrapper so server pages can pass plain data (formatters live on the client). */
export function AnalyticsCharts(
  props:
    | { kind: "trend"; data: Point[]; label: string; integer?: boolean }
    | { kind: "bars"; rows: { key: string; label: string; value: number | null; note?: string; highlight?: boolean }[]; integer?: boolean },
) {
  const fmt = props.integer ? (v: number) => Math.round(v).toLocaleString() : (v: number) => `${(v * 100).toFixed(1)}%`;
  if (props.kind === "trend") return <LineChart points={props.data} label={props.label} format={fmt} height={200} />;
  return <BarList rows={props.rows} format={fmt} />;
}
