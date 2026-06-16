"use client";

/**
 * Lightweight, dependency-free SVG charts tuned for a modern, Robinhood-style
 * feel: clean lines, rounded caps, subtle mount animations. Light-mode only.
 * Colors are passed as CSS-variable hex via the theme tokens (see globals.css).
 */

import { useEffect, useRef, useState } from "react";
import { money, moneyCompact } from "@/lib/format";

export interface Segment {
  label: string;
  value: number;
  color: string; // hex
}

/** Animated donut with a center label. Segments animate in on mount. */
export function Donut({
  segments,
  size = 184,
  thickness = 22,
  centerTop,
  centerMain,
  centerSub,
}: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerMain?: string;
  centerSub?: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let offset = 0;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-foreground)" strokeOpacity={0.06} strokeWidth={thickness} />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const len = frac * c;
          const dash = shown ? len : 0;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0, dash - 2)} ${c}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)", transitionDelay: `${i * 90}ms` }}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {centerTop && <span className="text-[10px] uppercase tracking-wide text-foreground/45">{centerTop}</span>}
        {centerMain && <span className="tabular text-2xl font-bold">{centerMain}</span>}
        {centerSub && <span className="text-[11px] text-foreground/50">{centerSub}</span>}
      </div>
    </div>
  );
}

export function Legend({ segments, total }: { segments: Segment[]; total?: number }) {
  const sum = (total ?? segments.reduce((s, x) => s + x.value, 0)) || 1;
  return (
    <ul className="mt-3 space-y-1.5">
      {segments.map((s, i) => (
        <li key={i} className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="tabular text-foreground/70">
            {money(s.value)} <span className="text-foreground/40">· {Math.round((s.value / sum) * 100)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Count-up animated number. Pass a formatter. */
export function AnimatedNumber({
  value,
  format = (n) => money(n),
  duration = 800,
  className = "",
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={`tabular ${className}`}>{format(display)}</span>;
}

/**
 * Stacked area chart over time (e.g. account balances by bucket across years).
 * `series` are drawn bottom-to-top in order. x is the row index.
 */
export function StackedArea({
  rows,
  series,
  height = 180,
  yLabel,
}: {
  rows: { x: number }[];
  series: { key: string; color: string; values: number[] }[];
  height?: number;
  yLabel?: (n: number) => string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const width = 340;
  const padL = 6;
  const padR = 6;
  const padB = 18;
  const n = rows.length;
  if (n === 0) return null;

  const stackedTotals = rows.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0));
  const maxY = Math.max(1, ...stackedTotals);
  const xAt = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL - padR);
  const yAt = (v: number) => height - padB - (v / maxY) * (height - padB - 6);

  // Build cumulative band paths.
  const cumulative: number[][] = [];
  let running = new Array(n).fill(0);
  for (const ser of series) {
    const top = running.map((base, i) => base + (ser.values[i] || 0));
    cumulative.push(top);
    running = top;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ opacity: shown ? 1 : 0, transition: "opacity 500ms ease" }}>
      {series.map((ser, si) => {
        const top = cumulative[si];
        const bottom = si === 0 ? new Array(n).fill(0) : cumulative[si - 1];
        const topPts = top.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" L ");
        const botPts = bottom.map((v, i) => `${xAt(i)},${yAt(v)}`).reverse().join(" L ");
        const d = `M ${topPts} L ${botPts} Z`;
        return <path key={ser.key} d={d} fill={ser.color} fillOpacity={0.85} style={{ transition: "all 700ms ease" }} />;
      })}
      {yLabel && (
        <text x={padL} y={12} fontSize="9" fill="var(--color-foreground)" opacity="0.4">
          {yLabel(maxY)}
        </text>
      )}
      <text x={padL} y={height - 4} fontSize="9" fill="var(--color-foreground)" opacity="0.45">
        {rows[0].x}
      </text>
      <text x={width - padR} y={height - 4} fontSize="9" fill="var(--color-foreground)" opacity="0.45" textAnchor="end">
        {rows[n - 1].x}
      </text>
    </svg>
  );
}

/** Simple vertical bars (e.g. RMDs by year, or tax by year). */
export function Bars({
  data,
  height = 150,
  color = "var(--color-deferred)",
  format = (n) => moneyCompact(n),
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end justify-between gap-1" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="tabular text-[9px] text-foreground/50">{d.value > 0 ? format(d.value) : ""}</span>
          <div
            className="w-full rounded-t-md"
            style={{
              background: color,
              height: shown ? `${(d.value / max) * (height - 30)}px` : 0,
              transition: `height 700ms cubic-bezier(0.22,1,0.36,1) ${i * 18}ms`,
            }}
          />
          <span className="text-[9px] text-foreground/45">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Two-bar comparison (e.g. lifetime tax: smart vs conventional). */
export function CompareBars({
  items,
  format = (n) => money(n),
}: {
  items: { label: string; value: number; color: string }[];
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="font-medium">{it.label}</span>
            <span className="tabular font-semibold">{format(it.value)}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-foreground/5">
            <div
              className="h-full rounded-full"
              style={{
                background: it.color,
                width: shown ? `${(it.value / max) * 100}%` : 0,
                transition: `width 800ms cubic-bezier(0.22,1,0.36,1) ${i * 120}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
