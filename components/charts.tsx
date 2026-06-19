"use client";

/**
 * Lightweight, dependency-free SVG charts tuned for a modern, Robinhood-style
 * feel: clean lines, rounded caps, subtle mount animations. Light-mode only.
 * Colors are passed as CSS-variable hex via the theme tokens (see globals.css).
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  duration = 650,
  className = "",
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  // Start AT the value (no count-up from 0 on mount/remount → no flicker when a
  // parent memo recomputes or a step re-keys). Animate only real changes, from
  // the last DISPLAYED number (captured before the RAF), and skip tiny deltas so
  // dragging a slider doesn't re-roll the count.
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || Math.abs(value - from) < 1) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
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

/**
 * Monte-Carlo fan chart: a shaded P10–P90 envelope with a P50 median line, over
 * the projection years. Reads {year, p10, p50, p90} per year.
 */
export function FanChart({
  band,
  height = 200,
  color = "var(--color-gain)",
  lineColor = "var(--color-primary)",
  yLabel,
  startAge,
}: {
  band: { year: number; p10: number; p50: number; p90: number; p25?: number; p75?: number }[];
  height?: number;
  color?: string;
  lineColor?: string;
  yLabel?: (n: number) => string;
  /** Age at the FIRST band year — when given, the x-axis shows age under the year. */
  startAge?: number;
}) {
  const [shown, setShown] = useState(false);
  const [hoverI, setHoverI] = useState<number | null>(null);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const width = 360;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = startAge != null ? 32 : 22;
  const n = band.length;
  if (n === 0) return null;
  const rawMax = Math.max(1, ...band.map((b) => b.p90));
  // Auto-size the y-axis: pick a "nice" gridline step targeting ~5 lines, then set
  // the top to the nearest step at or above the data. (The old ladder jumped 5→10×,
  // so a $51M peak ballooned the axis to $100M — half the chart was empty.)
  const rawStep = rawMax / 5;
  const stepPow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const sf = rawStep / stepPow;
  const niceStep = (sf <= 1 ? 1 : sf <= 1.5 ? 1.5 : sf <= 2 ? 2 : sf <= 2.5 ? 2.5 : sf <= 3 ? 3 : sf <= 5 ? 5 : 10) * stepPow;
  const maxY = Math.ceil(rawMax / niceStep) * niceStep;
  const fmt = yLabel ?? ((x: number) => `${Math.round(x)}`);
  const xAt = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL - padR);
  const yAt = (v: number) => padT + (1 - v / maxY) * (height - padT - padB);
  const areaBetween = (hi: (b: (typeof band)[number]) => number, lo: (b: (typeof band)[number]) => number) => {
    const top = band.map((b, i) => `${xAt(i)},${yAt(hi(b))}`).join(" L ");
    const bot = band.map((b, i) => `${xAt(i)},${yAt(lo(b))}`).reverse().join(" L ");
    return `M ${top} L ${bot} Z`;
  };
  const line = (sel: (b: (typeof band)[number]) => number) => `M ${band.map((b, i) => `${xAt(i)},${yAt(sel(b))}`).join(" L ")}`;
  const outer = areaBetween((b) => b.p90, (b) => b.p10); // 10–90 full range
  const hasInner = band.every((b) => b.p25 != null && b.p75 != null);
  const inner = hasInner ? areaBetween((b) => b.p75!, (b) => b.p25!) : null; // 25–75 likely range
  const median = line((b) => b.p50);
  const gridVals: number[] = [];
  for (let v = 0; v <= maxY + niceStep * 1e-6; v += niceStep) gridVals.push(v);
  const tickCount = Math.min(5, n);
  const tickIdx =
    tickCount <= 1 ? [0] : Array.from({ length: tickCount }, (_, k) => Math.round((k * (n - 1)) / (tickCount - 1)));
  const ageAt = (i: number) => (startAge != null ? startAge + (band[i].year - band[0].year) : null);

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vbX = ((e.clientX - r.left) / r.width) * width;
    const frac = (vbX - padL) / (width - padL - padR);
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHoverI(i);
  };
  const hb = hoverI != null ? band[hoverI] : null;
  const hoverLeftPct = hoverI != null ? (xAt(hoverI) / width) * 100 : 0;
  const hoverNearRight = hoverLeftPct > 62;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        style={{ opacity: shown ? 1 : 0, transition: "opacity 500ms ease" }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHoverI(null)}
      >
        {/* y-axis dollar gridlines + labels */}
        {gridVals.map((v, k) => (
          <g key={k}>
            <line x1={padL} y1={yAt(v)} x2={width - padR} y2={yAt(v)} stroke="var(--color-foreground)" strokeOpacity={k === 0 ? 0.18 : 0.08} strokeWidth="1" />
            <text x={padL - 4} y={yAt(v) + 3} fontSize="8.5" textAnchor="end" fill="var(--color-foreground)" opacity="0.45">
              {fmt(v)}
            </text>
          </g>
        ))}
        <path d={outer} fill={color} fillOpacity={0.13} />
        {inner && <path d={inner} fill={color} fillOpacity={0.28} />}
        {/* boundary percentile lines (more reference lines) */}
        <path d={line((b) => b.p90)} fill="none" stroke={color} strokeWidth="1" strokeOpacity={0.5} strokeDasharray="3 3" />
        <path d={line((b) => b.p10)} fill="none" stroke={color} strokeWidth="1" strokeOpacity={0.5} strokeDasharray="3 3" />
        <path d={median} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* x-axis ticks: year (+ age). First/last anchored inward so edge labels don't clip. */}
        {tickIdx.map((i, k) => {
          const anchor = k === 0 ? "start" : k === tickIdx.length - 1 ? "end" : "middle";
          const tx = k === 0 ? xAt(i) - 2 : k === tickIdx.length - 1 ? xAt(i) + 2 : xAt(i);
          return (
            <g key={i}>
              <line x1={xAt(i)} y1={height - padB} x2={xAt(i)} y2={height - padB + 3} stroke="var(--color-foreground)" strokeOpacity={0.3} strokeWidth="1" />
              <text x={tx} y={height - padB + 12} fontSize="8.5" textAnchor={anchor} fill="var(--color-foreground)" opacity="0.5">
                {band[i].year}
              </text>
              {startAge != null && (
                <text x={tx} y={height - padB + 22} fontSize="8" textAnchor={anchor} fill="var(--color-foreground)" opacity="0.38">
                  age {ageAt(i)}
                </text>
              )}
            </g>
          );
        })}
        {/* hover crosshair + dots */}
        {hb && hoverI != null && (
          <g>
            <line x1={xAt(hoverI)} y1={padT} x2={xAt(hoverI)} y2={height - padB} stroke="var(--color-foreground)" strokeOpacity={0.35} strokeWidth="1" />
            <circle cx={xAt(hoverI)} cy={yAt(hb.p90)} r="2.5" fill={color} />
            {hb.p75 != null && <circle cx={xAt(hoverI)} cy={yAt(hb.p75)} r="2.5" fill={color} fillOpacity={0.95} />}
            <circle cx={xAt(hoverI)} cy={yAt(hb.p50)} r="3" fill={lineColor} />
            {hb.p25 != null && <circle cx={xAt(hoverI)} cy={yAt(hb.p25)} r="2.5" fill={color} fillOpacity={0.95} />}
            <circle cx={xAt(hoverI)} cy={yAt(hb.p10)} r="2.5" fill={color} />
          </g>
        )}
      </svg>
      {hb && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-card/95 px-2 py-1 text-[10px] leading-tight shadow-sm backdrop-blur"
          style={{ left: `${hoverLeftPct}%`, transform: hoverNearRight ? "translateX(-100%)" : "translateX(8px)" }}
        >
          <div className="font-semibold text-foreground/80">
            {band[hoverI!].year}
            {startAge != null ? ` · age ${ageAt(hoverI!)}` : ""}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-foreground/60"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color, opacity: 0.55 }} /> best 10%: {fmt(hb.p90)}</div>
          {hb.p25 != null && hb.p75 != null && (
            <div className="flex items-center gap-1 text-foreground/70">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: color, opacity: 0.45 }} /> middle 50%: {fmt(hb.p25)}–{fmt(hb.p75)}
            </div>
          )}
          <div className="flex items-center gap-1 font-semibold" style={{ color: lineColor }}><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: lineColor }} /> typical: {fmt(hb.p50)}</div>
          <div className="flex items-center gap-1 text-foreground/60"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color, opacity: 0.55 }} /> worst 10%: {fmt(hb.p10)}</div>
        </div>
      )}
    </div>
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

/** A single-series value line (brokerage-style): gradient area + line, an
 *  end dot marking "today", and min/max-aware scaling so movement is visible. */
export function PriceLine({
  points,
  height = 180,
  color = "var(--color-primary)",
  format = (n) => moneyCompact(n),
}: {
  points: { date: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const width = 340;
  const padL = 4;
  const padR = 4;
  const padT = 8;
  const padB = 18;
  const n = points.length;
  if (n < 2) return <div className="py-8 text-center text-[12px] text-foreground/45">Not enough price history yet.</div>;

  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1, maxV - minV);
  const xAt = (i: number) => padL + (i / (n - 1)) * (width - padL - padR);
  const yAt = (v: number) => padT + (1 - (v - minV) / span) * (height - padT - padB);

  const linePts = points.map((p, i) => `${xAt(i)},${yAt(p.value)}`);
  const linePath = `M ${linePts.join(" L ")}`;
  const areaPath = `${linePath} L ${xAt(n - 1)},${height - padB} L ${xAt(0)},${height - padB} Z`;
  const up = values[n - 1] >= values[0];
  const stroke = color;
  const gradId = "pl-grad";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ opacity: shown ? 1 : 0, transition: "opacity 500ms ease" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* "today" marker */}
      <circle cx={xAt(n - 1)} cy={yAt(values[n - 1])} r="3.5" fill={stroke} />
      <text x={width - padR} y={12} fontSize="9" fill={stroke} textAnchor="end" opacity={up ? 0.9 : 0.5}>
        today
      </text>
      <text x={padL} y={height - 5} fontSize="9" fill="var(--color-foreground)" opacity="0.45">
        {points[0].date}
      </text>
      <text x={width - padR} y={height - 5} fontSize="9" fill="var(--color-foreground)" opacity="0.45" textAnchor="end">
        {format(maxV)} high
      </text>
    </svg>
  );
}
