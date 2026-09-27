"use client";

import { useFormatter } from "next-intl";
import { BarList, LineChart, type Point } from "@/components/charts/line-chart";

/**
 * Client wrapper so server pages can pass plain data. Numbers go through
 * next-intl's formatter so server and client render identical digits.
 */
export function AnalyticsCharts(
  props:
    | { kind: "trend"; data: Point[]; label: string; integer?: boolean }
    | { kind: "bars"; rows: { key: string; label: string; value: number | null; note?: string; highlight?: boolean }[]; integer?: boolean },
) {
  const format = useFormatter();
  const fmt = props.integer ? (v: number) => format.number(Math.round(v)) : (v: number) => format.number(v, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (props.kind === "trend") return <LineChart points={props.data} label={props.label} format={fmt} height={200} />;
  return <BarList rows={props.rows} format={fmt} />;
}
