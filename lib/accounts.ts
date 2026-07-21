/**
 * Account + household model for the planner.
 *
 * Three tax "buckets" drive every withdrawal decision:
 *  - pretax    : Traditional IRA, rollover 401(k), Traditional 401(k).
 *                Every dollar out is ordinary income. SUBJECT TO RMDs.
 *  - roth      : Roth IRA / Roth 401(k). Tax-free out, NO lifetime RMDs for the
 *                owner. The most valuable dollars — spend them last when you can.
 *  - taxable   : Brokerage / bank. Only the GAIN portion of a sale is taxed, at
 *                preferential long-term capital-gains rates. No RMDs.
 */

export type AccountKind =
  | "traditional_ira"
  | "rollover_401k"
  | "traditional_401k"
  | "traditional_403b"
  | "govt_457b"
  | "tsp_traditional"
  | "sep_ira"
  | "simple_ira"
  | "solo_401k"
  | "roth_ira"
  | "roth_401k"
  | "roth_403b"
  | "tsp_roth"
  | "brokerage"
  | "cash";

export type TaxBucket = "pretax" | "roth" | "taxable";

export type HoldingType = "stock" | "etf" | "mutual_fund" | "bond_fund" | "cash";

export interface Holding {
  ticker: string;
  name: string;
  type: HoldingType;
  shares: number;
  /** Current price per share. */
  price: number;
  /** What you paid per share (taxable accounts) — drives the gain on a sale. */
  costPerShare?: number;
  /** Trailing-12-month dividend per share. Auto-filled from the market feed,
   *  user-overridable. Undefined → fall back to an asset-type default yield. */
  dividendPerShare?: number;
  /** Recent annual dividend-growth rate (e.g. ~5y CAGR), as a decimal. Drives the
   *  dividend-growth model. Auto-filled, overridable. Undefined → type default. */
  dividendGrowthRate?: number;
  /** True once the user has hand-edited the dividend figures — the live market
   *  feed then leaves this holding's DPS/growth alone (auto-fetch + override). */
  dividendManual?: boolean;
  /** Override the dividend tax character: true → taxed as ORDINARY (non-qualified)
   *  income (e.g. REITs, many bond funds), false → QUALIFIED (preferential rate).
   *  Undefined → defaulted by holding type. Only matters in taxable accounts. */
  dividendOrdinary?: boolean;
  /** Estimated annual CAPITAL-GAINS DISTRIBUTION per share (a fund passing through
   *  realized gains). Auto-filled from the market feed as a multi-year average —
   *  these swing wildly year to year, so it's a smoothed estimate, NOT grown like
   *  the income dividend. Taxed as a long-term capital gain (preferential) in
   *  taxable accounts. ~0 for stocks and most ETFs. User-overridable. */
  capGainDistPerShare?: number;
}

export interface Account {
  id: string;
  label: string;
  kind: AccountKind;
  /** Whose account — drives RMD timing (each owner has their own RMD age). */
  owner: "self" | "spouse";
  balance: number;
  /**
   * Brokerage/cash only: cost basis. The unrealized gain = balance − basis is
   * what gets taxed (pro-rata) on a sale. Ignored for IRA/401k buckets.
   */
  costBasis?: number;
  /** Optional line-item holdings (shares × price). When present, `balance` and
   *  `costBasis` are kept in sync with the sum of the holdings. */
  holdings?: Holding[];
}

export const HOLDING_TYPE_LABEL: Record<HoldingType, string> = {
  stock: "Stock",
  etf: "ETF",
  mutual_fund: "Mutual fund",
  bond_fund: "Bond fund",
  cash: "Cash",
};

export function holdingValue(h: Holding): number {
  return h.shares * h.price;
}

function holdingBasis(h: Holding): number {
  return h.shares * (h.costPerShare ?? h.price);
}

/** Recompute an account's balance/costBasis from its holdings, if any. */
export function syncAccountFromHoldings(a: Account): Account {
  if (!a.holdings || a.holdings.length === 0) return a;
  const balance = a.holdings.reduce((s, h) => s + holdingValue(h), 0);
  const isTaxable = bucketOf(a.kind) === "taxable";
  return {
    ...a,
    balance,
    costBasis: isTaxable ? a.holdings.reduce((s, h) => s + holdingBasis(h), 0) : a.costBasis,
  };
}

import type { StateCode } from "./tax/state";

/** Earned income (a job, self-employment, part-time/consulting work) for one
 *  person — the thing a just-retired or still-working household needs modeled:
 *  it funds spending before withdrawals do, it's taxed (federal AND Illinois,
 *  unlike retirement income), it raises MAGI/IRMAA and the taxable share of
 *  Social Security, and claiming SS before full retirement age while earning
 *  triggers the earnings test. All fields optional → old saves load unchanged. */
export interface WorkIncome {
  /** Gross annual wages at the full-year rate, in today's dollars. Assumed to
   *  grow with inflation (raises track prices — a stated simplification). */
  annualWages: number;
  /** Last calendar year with earnings (inclusive). Unset → falls back to the
   *  household's retirementYear, else earnings stop after the current year. */
  lastWorkYear?: number;
  /** Last month worked in lastWorkYear, 1–12 (inclusive). Unset → December.
   *  The stop year's wages are prorated by this month. */
  lastWorkMonth?: number;
  /** Override for the CURRENT calendar year only: what this person will actually
   *  earn this year in total (already-received pay + the rest of the year —
   *  bonuses, severance, a mid-year raise). Ignored in every other year, so it
   *  can never go stale when the calendar rolls. */
  thisYearWages?: number;
  /** True → self-employment: the full 15.3% SE tax is modeled instead of the
   *  7.65% employee share of FICA. (Simplified: no SS wage-base cap, no 92.35%
   *  net-earnings factor, no half-SE-tax deduction — slightly overstates the
   *  bite, i.e. errs conservative.) */
  selfEmployed?: boolean;
}

export interface Person {
  label: string;
  birthYear: number;
  /** Annual gross Social Security benefit once claimed (today's dollars). */
  socialSecurityAnnual: number;
  /** Age Social Security starts (benefit assumed 0 before this age). */
  ssClaimAge: number;
  /** Earned income while (still) working. Unset → not working. */
  work?: WorkIncome;
}

export type OtherIncomeKind = "rental" | "annuity" | "other";

/** A recurring UNEARNED income stream beyond the single pension field — rental
 *  property, an annuity, royalties… (Part-time work or consulting is EARNED
 *  income and belongs in Person.work, where payroll tax and the Social Security
 *  earnings test apply.) Tax character by kind:
 *   - rental  : federal ordinary income, Illinois-taxable, AND net investment
 *               income for the 3.8% NIIT;
 *   - annuity : ordinary income treated like the pension — Illinois-exempt
 *               retirement income, not NIIT;
 *   - other   : federal ordinary income and Illinois-taxable, not NIIT.
 *  Streams pass to a survivor unchanged — a stated simplification (real
 *  annuities/pensions often step down; this errs toward overstating survivor
 *  income). */
export interface OtherIncomeStream {
  id: string;
  kind: OtherIncomeKind;
  /** Short user label, e.g. "Duplex on Main St". */
  label?: string;
  /** Gross annual amount in today's dollars. */
  annual: number;
  /** True → grows with inflation each year; false/unset → flat nominal for life
   *  (like the pension field — most private annuities have no COLA). */
  colaAdjusted?: boolean;
  /** First calendar year it pays (inclusive). Unset → already paying. */
  startYear?: number;
  /** Last calendar year it pays (inclusive). Unset → for life. */
  endYear?: number;
}

export interface Household {
  self: Person;
  spouse: Person;
  /** Combined annual pension / annuity income (fully taxable ordinary). */
  pensionAnnual: number;
  /** Desired annual after-tax spending (today's dollars). */
  annualSpending: number;
  /** Annual QUALIFIED dividends thrown off by the brokerage (preferential rate). */
  brokerageDividendsAnnual: number;
  /** Annual ordinary/non-qualified dividends (e.g. REITs, bond funds) — taxed as
   *  ordinary income and counted as net investment income for NIIT. */
  ordinaryDividendsAnnual?: number;
  /** Annual CAPITAL-GAINS DISTRIBUTIONS from funds in taxable accounts — realized
   *  gains a fund passes through each year (taxable even when reinvested). Taxed as
   *  long-term capital gains (preferential). Derived from taxable holdings' per-share
   *  cap-gain distributions; a smoothed multi-year average, not grown year to year. */
  capGainDistributionsAnnual?: number;
  /** Annual taxable interest (CDs, Treasuries, savings, money-market) — ordinary
   *  income + net investment income. */
  taxableInterestAnnual?: number;
  /** Annual tax-exempt (municipal) interest — NOT taxed, but still raises MAGI for
   *  Medicare IRMAA and the taxability of Social Security. */
  taxExemptInterestAnnual?: number;
  /** State of residence for state income tax (defaults to Illinois). */
  state?: StateCode;
  /** Rough MAGI from the two years BEFORE the plan starts (usually working-year
   *  income — the AGI line on those returns is close enough). Medicare's IRMAA
   *  looks back two years, so these set the plan's first two premium years: a
   *  brand-new retiree's actual first bill comes from their old paycheck, not
   *  their retirement income. Optional — unset falls back to same-year MAGI. */
  priorMagi?: { twoYearsAgo?: number; lastYear?: number };
  /** Calendar year the household plans to start retirement. Drives the model:
   *  it's the default last year of wages for anyone with work income who hasn't
   *  set their own stop date (WorkIncome.lastWorkYear). The projection itself
   *  still begins at the present year — working years are modeled as retirement
   *  years WITH wages, which is also what makes a mid-year retirement honest
   *  (this calendar year's tax return really does include the January–June pay). */
  retirementYear?: number;
  /** Recurring unearned income streams beyond the pension (rental, annuity, …).
   *  Optional — old saves load unchanged. */
  otherIncome?: OtherIncomeStream[];
  accounts: Account[];
}

/** A sensible default planned-retirement year for someone born in `birthYear`:
 *  the year they turn 65, but never earlier than this year (you can't plan to have
 *  retired in the past). Used to seed the input when none is set. */
export function defaultRetirementYear(birthYear: number): number {
  const thisYear = new Date().getFullYear();
  return Math.max(thisYear, birthYear + 65);
}

/**
 * This person's gross earned income for a calendar year, in that year's nominal
 * dollars. The one wage formula every consumer (tax engine, withdrawal solver,
 * earnings-test warnings, UI read-outs) must share:
 *  - 0 when they don't work, or after their last work year;
 *  - prorated by lastWorkMonth in the stop year (retired end of June → half);
 *  - thisYearWages override honored in the CURRENT calendar year only;
 *  - otherwise annualWages (today's dollars) × inflationFactor — wages are
 *    assumed to keep pace with inflation, like spending and the brackets.
 * `currentYear` is injectable for tests; callers use the default.
 */
export function wageForYear(
  person: Person,
  household: Household,
  year: number,
  inflationFactor = 1,
  currentYear = new Date().getFullYear(),
): number {
  const w = person.work;
  if (!w || w.annualWages <= 0) return 0;
  const lastYear = w.lastWorkYear ?? household.retirementYear ?? currentYear;
  if (year > lastYear) return 0;
  if (year === currentYear && w.thisYearWages != null) return Math.max(0, w.thisYearWages);
  const monthsWorked = year === lastYear ? Math.min(12, Math.max(1, w.lastWorkMonth ?? 12)) : 12;
  return Math.max(0, w.annualWages) * inflationFactor * (monthsWorked / 12);
}

/** Sum the active other-income streams for a calendar year, split by tax
 *  character (see OtherIncomeStream). COLA'd streams scale with the price
 *  level; the rest stay flat nominal. One formula for engine and UI alike. */
export function otherIncomeForYear(
  streams: OtherIncomeStream[] | undefined,
  year: number,
  inflationFactor = 1,
): { annuity: number; rental: number; other: number; total: number } {
  const out = { annuity: 0, rental: 0, other: 0, total: 0 };
  if (!streams) return out;
  for (const s of streams) {
    if (s.annual <= 0) continue;
    if (s.startYear != null && year < s.startYear) continue;
    if (s.endYear != null && year > s.endYear) continue;
    const amt = s.annual * (s.colaAdjusted ? inflationFactor : 1);
    out[s.kind] += amt;
    out.total += amt;
  }
  return out;
}

/** Months this person works in `year` (12 before the stop year, lastWorkMonth in
 *  it, 0 after) — the earnings test's grace-year rule needs this. */
export function monthsWorkedInYear(person: Person, household: Household, year: number, currentYear = new Date().getFullYear()): number {
  const w = person.work;
  if (!w || w.annualWages <= 0) return 0;
  const lastYear = w.lastWorkYear ?? household.retirementYear ?? currentYear;
  if (year > lastYear) return 0;
  return year === lastYear ? Math.min(12, Math.max(1, w.lastWorkMonth ?? 12)) : 12;
}

export const ACCOUNT_KIND_META: Record<
  AccountKind,
  { label: string; bucket: TaxBucket; hasRmd: boolean; emoji: string }
> = {
  traditional_ira: { label: "Traditional IRA", bucket: "pretax", hasRmd: true, emoji: "🏦" },
  rollover_401k: { label: "Rollover 401(k)", bucket: "pretax", hasRmd: true, emoji: "🔁" },
  traditional_401k: { label: "Traditional 401(k)", bucket: "pretax", hasRmd: true, emoji: "🏢" },
  traditional_403b: { label: "403(b) / TSA", bucket: "pretax", hasRmd: true, emoji: "🎓" },
  govt_457b: { label: "457(b) (govt)", bucket: "pretax", hasRmd: true, emoji: "🏛️" },
  tsp_traditional: { label: "TSP (Traditional)", bucket: "pretax", hasRmd: true, emoji: "🦅" },
  sep_ira: { label: "SEP-IRA", bucket: "pretax", hasRmd: true, emoji: "💼" },
  simple_ira: { label: "SIMPLE IRA", bucket: "pretax", hasRmd: true, emoji: "📋" },
  solo_401k: { label: "Solo 401(k)", bucket: "pretax", hasRmd: true, emoji: "🧑‍💼" },
  roth_ira: { label: "Roth IRA", bucket: "roth", hasRmd: false, emoji: "🌱" },
  roth_401k: { label: "Roth 401(k)", bucket: "roth", hasRmd: false, emoji: "🌿" },
  roth_403b: { label: "Roth 403(b)", bucket: "roth", hasRmd: false, emoji: "🌾" },
  tsp_roth: { label: "TSP (Roth)", bucket: "roth", hasRmd: false, emoji: "🪶" },
  brokerage: { label: "Brokerage", bucket: "taxable", hasRmd: false, emoji: "📈" },
  cash: { label: "Cash / Savings", bucket: "taxable", hasRmd: false, emoji: "💵" },
};

export function bucketOf(kind: AccountKind): TaxBucket {
  return ACCOUNT_KIND_META[kind].bucket;
}

export interface BucketTotals {
  pretax: number;
  roth: number;
  taxable: number;
  /** Unrealized gain across taxable accounts (basis-aware). */
  taxableGain: number;
  total: number;
}

export function sumBuckets(accounts: Account[]): BucketTotals {
  const t: BucketTotals = { pretax: 0, roth: 0, taxable: 0, taxableGain: 0, total: 0 };
  for (const a of accounts) {
    const bucket = bucketOf(a.kind);
    t[bucket] += a.balance;
    t.total += a.balance;
    if (bucket === "taxable") {
      t.taxableGain += Math.max(0, a.balance - (a.costBasis ?? a.balance));
    }
  }
  return t;
}

/** Fraction of a taxable account that is unrealized gain (0–1). */
export function gainFraction(accounts: Account[]): number {
  const t = sumBuckets(accounts);
  return t.taxable > 0 ? Math.min(1, t.taxableGain / t.taxable) : 0;
}

export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}
