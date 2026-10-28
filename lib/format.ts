/** Shared formatters. Keep all display formatting here. */

export function money(n: number, opts?: { cents?: boolean }): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts?.cents ? 2 : 0,
    maximumFractionDigits: opts?.cents ? 2 : 0,
  });
}

/** Compact money for tight spots: $1.2M, $850K, $4,300. */
export function moneyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `$${Math.round(n / 1_000)}K`;
  return money(n);
}

/** Monte-Carlo odds as "X of 100 market futures". Never shows a perfect 100 unless
 *  every simulated future succeeded (to the nearest tenth of a percent) — rounding a
 *  real risk up to "100 of 100" would overstate certainty. */
export function of100(frac: number): number {
  if (frac >= 0.9995) return 100;
  return Math.max(0, Math.min(99, Math.round(frac * 100)));
}

export function percent(frac: number, digits = 1): string {
  return `${(frac * 100).toFixed(digits)}%`;
}
