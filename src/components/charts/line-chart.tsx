"use client";

import { useId, useMemo, useState } from "react";

export type Point = { x: string; label: string; y: number | null };

/**
 * Single-series line/area chart: 2px line, recessive grid, crosshair + tooltip
 * on hover/focus, and a visually hidden data table for screen readers.
 */
export function LineChart({
  points,
  height = 220,
  format = (v: number) => v.toLocaleString(),
  label,
  color = "var(--accent)",
}: {
  points: Point[];
  height?: number;
  format?: (v: number) => string;
  label: string;
  color?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { t: 12, r: 8, b: 26, l: 8 };
  const values = points.map((p) => p.y).filter((v): v is number => v != null);
  const max = values.length ? Math.max(...values) * 1.1 || 1 : 1;
  const min = 0;
  const step = points.length > 1 ? (W - pad.l - pad.r) / (points.length - 1) : 0;
  const xy = useMemo(
    () => points.map((p, i) => (p.y == null ? null : { x: pad.l + i * step, y: pad.t + (1 - (p.y - min) / (max - min)) * (H - pad.t - pad.b) })),
    [points, step, max, H, pad.l, pad.t, pad.b],
  );
  const line = xy.reduce((d, p, i) => (p ? `${d}${d && xy[i - 1] ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}` : d), "");
  const first = xy.find(Boolean);
  const last = [...xy].reverse().find(Boolean);
  const area = first && last ? `${line}L${last.x},${H - pad.b}L${first.x},${H - pad.b}Z` : "";
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => pad.t + (1 - f) * (H - pad.t - pad.b));
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round((x - pad.l) / (step || 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((y) => (
          <line key={y} x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4" />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-strong)" />
        {area && <path d={area} fill={`url(#${id}-fill)`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.x} x={pad.l + i * step} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-[var(--ink-3)] text-[11px]">
              {p.label}
            </text>
          ) : null,
        )}
        {hover != null && xy[hover] && (
          <g>
            <line x1={xy[hover]!.x} x2={xy[hover]!.x} y1={pad.t} y2={H - pad.b} stroke="var(--ink-4)" />
            <circle cx={xy[hover]!.x} cy={xy[hover]!.y} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover != null && points[hover]?.y != null && xy[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-md"
          style={{ left: `${(xy[hover]!.x / W) * 100}%` }}
          dir="ltr"
        >
          <div className="text-ink-3">{points[hover].label}</div>
          <div className="font-semibold tabular text-ink">{format(points[hover].y!)}</div>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.x}>
              <th scope="row">{p.label}</th>
              <td>{p.y == null ? "—" : format(p.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Ranked horizontal bars (one measure, one color) with labels — readable as a table. */
export function BarList({ rows, format, max: maxOverride }: { rows: { key: string; label: string; value: number | null; note?: string; highlight?: boolean }[]; format: (v: number) => string; max?: number }) {
  const max = maxOverride ?? Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="group" title={r.value != null ? `${r.label}: ${format(r.value)}` : r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-2">{r.label}</span>
            <span className="shrink-0 font-semibold tabular text-ink">{r.value == null ? "—" : format(r.value)}{r.note && <span className="ms-2 text-xs font-normal text-ink-3">{r.note}</span>}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-sunken">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, ((r.value ?? 0) / max) * 100)}%`, background: r.highlight ? "var(--accent)" : "var(--ink-3)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
