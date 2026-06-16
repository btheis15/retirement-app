/**
 * 2026 federal tax constants — Married Filing Jointly (MFJ).
 *
 * This is the single source of truth for every number the planner uses. It is
 * deliberately isolated so it can be updated each year (or corrected) in one
 * place without touching the engine in `engine.ts`.
 *
 * SOURCES / NOTES (as of the 2026 tax year):
 *  - Ordinary brackets, standard deduction, and LTCG breakpoints reflect the
 *    IRS inflation-adjusted 2026 figures (Rev. Proc. 2025-32) under the TCJA
 *    rates made permanent by the 2025 budget law (OBBBA).
 *  - The "senior bonus deduction" ($6,000 per filer age 65+, 2025–2028, phased
 *    out at higher MAGI) is an OBBBA addition layered on top of the long-standing
 *    additional standard deduction for age 65+.
 *  - Social Security taxability thresholds ($32,000 / $44,000 MFJ) and the NIIT
 *    threshold ($250,000 MFJ) are set by statute and are NOT inflation-indexed.
 *  - IRMAA tiers are approximate 2026 figures and are surfaced as awareness
 *    flags, not exact premium math.
 *
 * ⚠️ Educational estimates only — not tax advice. State taxes are not modeled.
 */

/** Ordinary-income brackets (MFJ). `upTo` is the top of each bracket's range. */
export const ORDINARY_BRACKETS_MFJ: { rate: number; upTo: number }[] = [
  { rate: 0.10, upTo: 24_800 },
  { rate: 0.12, upTo: 100_800 },
  { rate: 0.22, upTo: 211_400 },
  { rate: 0.24, upTo: 403_550 },
  { rate: 0.32, upTo: 512_450 },
  { rate: 0.35, upTo: 768_700 },
  { rate: 0.37, upTo: Infinity },
];

/** Long-term capital gains / qualified dividend breakpoints (MFJ taxable income). */
export const LTCG_BRACKETS_MFJ: { rate: number; upTo: number }[] = [
  { rate: 0.0, upTo: 98_900 },
  { rate: 0.15, upTo: 613_700 },
  { rate: 0.20, upTo: Infinity },
];

/** Base standard deduction (MFJ). */
export const STANDARD_DEDUCTION_MFJ = 32_200;

/** Additional standard deduction per spouse who is age 65+ (MFJ). */
export const ADDL_STD_DEDUCTION_65 = 1_650;

/** OBBBA "senior bonus" deduction (2025–2028): per filer age 65+. */
export const SENIOR_BONUS_DEDUCTION = 6_000;
/** Senior bonus phaseout: reduced by this rate on MAGI above the threshold. */
export const SENIOR_BONUS_PHASEOUT_RATE = 0.06;
export const SENIOR_BONUS_PHASEOUT_START_MFJ = 150_000;

/** Social Security taxability thresholds (MFJ, statutory, not indexed). */
export const SS_BASE_MFJ = 32_000;
export const SS_SECOND_MFJ = 44_000;

/** Net Investment Income Tax (statutory, not indexed). */
export const NIIT_RATE = 0.038;
export const NIIT_THRESHOLD_MFJ = 250_000;

/**
 * IRMAA — Medicare Part B/D income surcharge tiers for 2026 (MFJ, based on MAGI
 * from two years prior). `upTo` is the top of each tier's MAGI range; the
 * monthly add-on is the *combined* Part B + Part D surcharge PER PERSON.
 * Approximate — surfaced as an awareness flag in the planner.
 */
export const IRMAA_TIERS_MFJ: { upTo: number; monthlyPerPerson: number; label: string }[] = [
  { upTo: 218_000, monthlyPerPerson: 0, label: "Standard premium" },
  { upTo: 272_000, monthlyPerPerson: 86, label: "Tier 1 surcharge" },
  { upTo: 340_000, monthlyPerPerson: 215, label: "Tier 2 surcharge" },
  { upTo: 408_000, monthlyPerPerson: 344, label: "Tier 3 surcharge" },
  { upTo: 750_000, monthlyPerPerson: 473, label: "Tier 4 surcharge" },
  { upTo: Infinity, monthlyPerPerson: 516, label: "Top tier surcharge" },
];

/**
 * Required Minimum Distribution age under SECURE 2.0, by birth year.
 *  - 1950 or earlier: 72 (already in RMDs)
 *  - 1951–1959: 73
 *  - 1960 or later: 75
 */
export function rmdStartAge(birthYear: number): number {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

/**
 * IRS Uniform Lifetime Table (post-2022 update), used for lifetime RMDs of an
 * account owner (or owner whose spouse is not >10 years younger). Maps age →
 * distribution period (divisor). Prior year-end balance ÷ factor = that year's
 * RMD. Ages below the table's start have no factor (no RMD yet).
 */
export const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
};

/** Distribution-period factor for a given age (0 = no RMD this year). */
export function uniformLifetimeFactor(age: number): number {
  if (age >= 120) return UNIFORM_LIFETIME_TABLE[120];
  return UNIFORM_LIFETIME_TABLE[age] ?? 0;
}
