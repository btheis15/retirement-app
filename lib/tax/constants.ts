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
 *  - IRMAA tiers use the published 2026 CMS thresholds and Part B/D surcharge
 *    amounts; only the combined household figures are rounded for display.
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

/**
 * Social Security retirement earnings test — 2026 exempt amounts (SSA 2026 COLA
 * fact sheet / ssa.gov/oact/cola/rtea.html). Claim before FRA while earning and
 * $1 of benefits is withheld per $2 over the annual amount; in the calendar
 * year FRA is reached the (much higher) FRA-year amount applies at $1 per $3,
 * counting only pre-FRA months. Statutorily these index with the national
 * Average Wage Index — approximated here by the plan's price level.
 */
export const SS_EARNINGS_TEST_2026 = {
  annualExemptUnderFra: 24_480,
  annualExemptFraYear: 65_160,
  withholdRatioUnderFra: 1 / 2,
  withholdRatioFraYear: 1 / 3,
} as const;

/** Employee share of FICA on W-2 wages: 6.2% OASDI + 1.45% Medicare. Payroll
 *  tax, not income tax — the planner subtracts it from a worker's cash in hand
 *  but keeps it out of totalTax (set-aside/withholding guidance stays honest).
 *  Simplified: no SS wage-base cap, no 0.9% additional-Medicare surtax — both
 *  overstate the bite slightly for very high earners (errs conservative). */
export const FICA_RATE = 0.0765;
/** Self-employment tax (both halves): 12.4% OASDI + 2.9% Medicare. Same stated
 *  simplifications as FICA_RATE (plus no 92.35% factor / half-SE deduction). */
export const SE_TAX_RATE = 0.153;

/** Net Investment Income Tax (statutory, not indexed). */
export const NIIT_RATE = 0.038;
export const NIIT_THRESHOLD_MFJ = 250_000;

/**
 * IRMAA — Medicare Part B/D income surcharge tiers for 2026 (MFJ, based on MAGI
 * from two years prior). `upTo` is the top of each tier's MAGI range. The surcharge
 * is split into its `partB` and `partD` components (the EXTRA above the standard
 * premium, per person, per month) so each can be reconciled against Medicare's two
 * separate published tables; `monthlyPerPerson` is their sum (what the engine uses).
 * Verified against official 2026 CMS figures (standard Part B premium $202.90; Part B
 * surcharges 81.20/202.90/324.60/446.30/487.00; Part D surcharges 14.50/37.50/60.40/
 * 83.30/91.00). Note the Part B piece dominates — Part D alone tops out near $91/mo.
 */
export interface IrmaaTier {
  upTo: number;
  /** Combined (Part B + Part D) monthly surcharge per person — what the engine bills. */
  monthlyPerPerson: number;
  /** Monthly Part B IRMAA surcharge per person (the extra above the standard premium). */
  partB: number;
  /** Monthly Part D IRMAA surcharge per person. */
  partD: number;
  label: string;
}
export const IRMAA_TIERS_MFJ: IrmaaTier[] = [
  { upTo: 218_000, monthlyPerPerson: 0, partB: 0, partD: 0, label: "Standard premium" },
  { upTo: 274_000, monthlyPerPerson: 96, partB: 81.2, partD: 14.5, label: "Tier 1 surcharge" },
  { upTo: 342_000, monthlyPerPerson: 240, partB: 202.9, partD: 37.5, label: "Tier 2 surcharge" },
  { upTo: 410_000, monthlyPerPerson: 385, partB: 324.6, partD: 60.4, label: "Tier 3 surcharge" },
  { upTo: 750_000, monthlyPerPerson: 530, partB: 446.3, partD: 83.3, label: "Tier 4 surcharge" },
  { upTo: Infinity, monthlyPerPerson: 578, partB: 487, partD: 91, label: "Top tier surcharge" },
];

// ─── SINGLE-filer 2026 figures (for the surviving-spouse "widow's penalty") ───
// Verified against IRS Rev. Proc. 2025-32 / OBBBA, June 2026. A survivor files
// Single, with roughly half-width brackets and deductions — the same income is
// taxed harder, which is why converting while both spouses are alive (wide MFJ
// brackets) is so valuable.

/** Ordinary-income brackets (Single). */
export const ORDINARY_BRACKETS_SINGLE: { rate: number; upTo: number }[] = [
  { rate: 0.10, upTo: 12_400 },
  { rate: 0.12, upTo: 50_400 },
  { rate: 0.22, upTo: 105_700 },
  { rate: 0.24, upTo: 201_775 },
  { rate: 0.32, upTo: 256_225 },
  { rate: 0.35, upTo: 640_600 },
  { rate: 0.37, upTo: Infinity },
];

/** Long-term capital gains breakpoints (Single taxable income). */
export const LTCG_BRACKETS_SINGLE: { rate: number; upTo: number }[] = [
  { rate: 0.0, upTo: 49_450 },
  { rate: 0.15, upTo: 545_500 },
  { rate: 0.20, upTo: Infinity },
];

export const STANDARD_DEDUCTION_SINGLE = 16_100;
/** Additional standard deduction for a single filer age 65+ (larger than the MFJ per-spouse amount). */
export const ADDL_STD_DEDUCTION_65_SINGLE = 2_050;
export const SENIOR_BONUS_PHASEOUT_START_SINGLE = 75_000;
/** SS taxability thresholds (Single, statutory, not indexed). */
export const SS_BASE_SINGLE = 25_000;
export const SS_SECOND_SINGLE = 34_000;
/** NIIT threshold (Single, statutory, not indexed). */
export const NIIT_THRESHOLD_SINGLE = 200_000;
/** IRMAA tiers for Single — same per-person surcharge dollars as MFJ, lower MAGI bounds. */
export const IRMAA_TIERS_SINGLE: IrmaaTier[] = [
  { upTo: 109_000, monthlyPerPerson: 0, partB: 0, partD: 0, label: "Standard premium" },
  { upTo: 137_000, monthlyPerPerson: 96, partB: 81.2, partD: 14.5, label: "Tier 1 surcharge" },
  { upTo: 171_000, monthlyPerPerson: 240, partB: 202.9, partD: 37.5, label: "Tier 2 surcharge" },
  { upTo: 205_000, monthlyPerPerson: 385, partB: 324.6, partD: 60.4, label: "Tier 3 surcharge" },
  { upTo: 500_000, monthlyPerPerson: 530, partB: 446.3, partD: 83.3, label: "Tier 4 surcharge" },
  { upTo: Infinity, monthlyPerPerson: 578, partB: 487, partD: 91, label: "Top tier surcharge" },
];

export type FilingStatus = "mfj" | "single";

export interface FilingConstants {
  ordinary: { rate: number; upTo: number }[];
  ltcg: { rate: number; upTo: number }[];
  stdDeduction: number;
  addlStd65: number;
  seniorBonusStart: number;
  ssBase: number;
  ssSecond: number;
  niitThreshold: number;
  irmaaTiers: IrmaaTier[];
  /** Number of people on the return — scales the household IRMAA surcharge. */
  people: number;
}

/** Single source of truth for status-dependent federal constants. */
export const FILING_CONSTANTS: Record<FilingStatus, FilingConstants> = {
  mfj: {
    ordinary: ORDINARY_BRACKETS_MFJ,
    ltcg: LTCG_BRACKETS_MFJ,
    stdDeduction: STANDARD_DEDUCTION_MFJ,
    addlStd65: ADDL_STD_DEDUCTION_65,
    seniorBonusStart: SENIOR_BONUS_PHASEOUT_START_MFJ,
    ssBase: SS_BASE_MFJ,
    ssSecond: SS_SECOND_MFJ,
    niitThreshold: NIIT_THRESHOLD_MFJ,
    irmaaTiers: IRMAA_TIERS_MFJ,
    people: 2,
  },
  single: {
    ordinary: ORDINARY_BRACKETS_SINGLE,
    ltcg: LTCG_BRACKETS_SINGLE,
    stdDeduction: STANDARD_DEDUCTION_SINGLE,
    addlStd65: ADDL_STD_DEDUCTION_65_SINGLE,
    seniorBonusStart: SENIOR_BONUS_PHASEOUT_START_SINGLE,
    ssBase: SS_BASE_SINGLE,
    ssSecond: SS_SECOND_SINGLE,
    niitThreshold: NIIT_THRESHOLD_SINGLE,
    irmaaTiers: IRMAA_TIERS_SINGLE,
    people: 1,
  },
};

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
