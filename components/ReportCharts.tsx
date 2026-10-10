/**
 * Static, print-first SVG charts for the client report. No animation or hover:
 * they render complete on the first paint so "Save as PDF" captures them, and
 * every value they show is also in a table in the report (the appendix).
 *
 * Bucket colors (validated as a categorical set — lightness band, chroma floor,
 * CVD and normal-vision separation, contrast): pre-tax amber, taxable cyan,
 * Roth violet. Taxable uses a more saturated cyan than the app's text token,
 * which reads gray as a fill.
 */

import { moneyCompact } from "@/lib/format";

export const REPORT_COLORS = {
  pretax: "#b45309",
  taxable: "#0891b2",
  roth: "#6d28d9",
  ink: "#0f1f24",
  muted: "#5b6b70",
  grid: "#e2e7e9",
  primary: "#0d4f4a",
} as const;

/** A "nice" axis: ~4–5 gridlines on round numbers. */
function niceAxis(max: number, target = 4): { top: number; step: number } {
  const raw = Math.max(1, max) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  return { top: Math.ceil(max / step) * step, step };
}

/** One horizontal bar split by bucket, with values in the legend. */
export function AllocationBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const shown = parts.filter((p) => p.value > 0.5);
  return (
    <div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {shown.map((p) => (
          <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#0f1f24]">
        {shown.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />
            {p.label} <strong className="tabular">{moneyCompact(p.value)}</strong>
            <span className="text-[#5b6b70]">({Math.round((p.value / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Account balances by tax bucket over the projection, stacked (pre-tax at the
 *  base, then taxable, then Roth), with $ gridlines and year/age ticks. */
export function BalancesChart({
  rows,
}: {
  rows: { year: number; age: number; pretax: number; taxable: number; roth: number }[];
}) {
  const W = 680;
  const H = 230;
  const L = 52;
  const R = 70; // room for direct labels
  const T = 10;
  const B = 34;
  const n = rows.length;
  if (n < 2) return null;
  const totals = rows.map((r) => r.pretax + r.taxable + r.roth);
  const { top, step } = niceAxis(Math.max(...totals));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const layers = [
    { key: "pretax", label: "Pre-tax", color: REPORT_COLORS.pretax, get: (r: (typeof rows)[number]) => r.pretax },
    { key: "taxable", label: "Taxable", color: REPORT_COLORS.taxable, get: (r: (typeof rows)[number]) => r.taxable },
    { key: "roth", label: "Roth", color: REPORT_COLORS.roth, get: (r: (typeof rows)[number]) => r.roth },
  ];
  let base = rows.map(() => 0);
  const bands = layers.map((l) => {
    const lo = base;
    const hi = rows.map((r, i) => lo[i] + l.get(r));
    base = hi;
    const d =
      `M ${hi.map((v, i) => `${x(i)},${y(v)}`).join(" L ")} ` +
      `L ${lo.map((v, i) => `${x(i)},${y(v)}`).reverse().join(" L ")} Z`;
    return { ...l, d, lastMid: (lo[n - 1] + hi[n - 1]) / 2, lastVal: hi[n - 1] - lo[n - 1] };
  });
  const grid: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) grid.push(v);
  const ticks = Array.from(new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1]));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected account balances by tax bucket">
        {grid.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={REPORT_COLORS.grid} strokeWidth={1} />
            <text x={L - 6} y={y(v) + 3} fontSize="9.5" textAnchor="end" fill={REPORT_COLORS.muted}>
              {moneyCompact(v)}
            </text>
          </g>
        ))}
        {bands.map((b) => (
          // 2px surface stroke = the gap between stacked fills
          <path key={b.key} d={b.d} fill={b.color} fillOpacity={0.88} stroke="#ffffff" strokeWidth={2} strokeLinejoin="round" />
        ))}
        {bands
          .filter((b) => b.lastVal > top * 0.04)
          .map((b) => (
            <text key={b.key} x={W - R + 6} y={y(b.lastMid) + 3} fontSize="10" fill={REPORT_COLORS.ink} fontWeight={600}>
              {b.label}
            </text>
          ))}
        {ticks.map((i) => (
          <g key={i}>
            <text x={x(i)} y={H - B + 14} fontSize="9.5" textAnchor="middle" fill={REPORT_COLORS.ink}>
              {rows[i].year}
            </text>
            <text x={x(i)} y={H - B + 26} fontSize="8.5" textAnchor="middle" fill={REPORT_COLORS.muted}>
              age {rows[i].age}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-[10.5px] text-[#5b6b70]">
        {layers.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        <span>· Nominal dollars, expected-return path. Year-by-year values: Appendix A.</span>
      </figcaption>
    </figure>
  );
}

/** Monte-Carlo range of total savings in today's dollars: the middle 50% and
 *  the 10th–90th band around the median path. */
export function OutcomeFan({
  band,
}: {
  band: { year: number; selfAge: number; p10: number; p25: number; p50: number; p75: number; p90: number }[];
}) {
  const W = 680;
  const H = 210;
  const L = 52;
  const R = 12;
  const T = 10;
  const B = 34;
  const n = band.length;
  if (n < 2) return null;
  const { top, step } = niceAxis(Math.max(...band.map((b) => b.p90)));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.max(0, v) / top) * (H - T - B);
  const area = (hi: (b: (typeof band)[number]) => number, lo: (b: (typeof band)[number]) => number) =>
    `M ${band.map((b, i) => `${x(i)},${y(hi(b))}`).join(" L ")} L ${band
      .map((b, i) => `${x(i)},${y(lo(b))}`)
      .reverse()
      .join(" L ")} Z`;
  const grid: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) grid.push(v);
  const ticks = Array.from(new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1]));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Range of simulated savings outcomes">
        {grid.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={REPORT_COLORS.grid} strokeWidth={1} />
            <text x={L - 6} y={y(v) + 3} fontSize="9.5" textAnchor="end" fill={REPORT_COLORS.muted}>
              {moneyCompact(v)}
            </text>
          </g>
        ))}
        <path d={area((b) => b.p90, (b) => b.p10)} fill={REPORT_COLORS.primary} fillOpacity={0.12} />
        <path d={area((b) => b.p75, (b) => b.p25)} fill={REPORT_COLORS.primary} fillOpacity={0.24} />
        <path d={`M ${band.map((b, i) => `${x(i)},${y(b.p50)}`).join(" L ")}`} fill="none" stroke={REPORT_COLORS.primary} strokeWidth={2} />
        {ticks.map((i) => (
          <g key={i}>
            <text x={x(i)} y={H - B + 14} fontSize="9.5" textAnchor="middle" fill={REPORT_COLORS.ink}>
              {band[i].year}
            </text>
            <text x={x(i)} y={H - B + 26} fontSize="8.5" textAnchor="middle" fill={REPORT_COLORS.muted}>
              age {band[i].selfAge}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-[10.5px] text-[#5b6b70]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4" style={{ background: REPORT_COLORS.primary }} /> Median outcome
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[2px]" style={{ background: REPORT_COLORS.primary, opacity: 0.35 }} /> Middle 50% of outcomes
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[2px]" style={{ background: REPORT_COLORS.primary, opacity: 0.14 }} /> 10th–90th percentile
        </span>
        <span>· Today&apos;s dollars.</span>
      </figcaption>
    </figure>
  );
}
