/** Hex values mirroring the theme tokens in globals.css, for passing to SVG
 *  charts (which need literal colors, not Tailwind classes). Keep in sync. */
export const HEX = {
  primary: "#0d4f4a",
  accent: "#b1791f",
  gain: "#15803d",
  tax: "#b3361f",
  deferred: "#b45309",
  roth: "#6d28d9",
  taxable: "#0e7490",
  ss: "#1d4ed8",
} as const;

/** Bucket → chart color. */
export const BUCKET_HEX = {
  pretax: HEX.deferred,
  taxable: HEX.taxable,
  roth: HEX.roth,
} as const;
