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
  | "roth_ira"
  | "roth_401k"
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

export interface Person {
  label: string;
  birthYear: number;
  /** Annual gross Social Security benefit once claimed (today's dollars). */
  socialSecurityAnnual: number;
  /** Age Social Security starts (benefit assumed 0 before this age). */
  ssClaimAge: number;
}

export interface Household {
  self: Person;
  spouse: Person;
  /** Combined annual pension / annuity income (fully taxable ordinary). */
  pensionAnnual: number;
  /** Desired annual after-tax spending (today's dollars). */
  annualSpending: number;
  /** Annual qualified dividends thrown off by the brokerage (taxable each year). */
  brokerageDividendsAnnual: number;
  accounts: Account[];
}

export const ACCOUNT_KIND_META: Record<
  AccountKind,
  { label: string; bucket: TaxBucket; hasRmd: boolean; emoji: string }
> = {
  traditional_ira: { label: "Traditional IRA", bucket: "pretax", hasRmd: true, emoji: "🏦" },
  rollover_401k: { label: "Rollover 401(k)", bucket: "pretax", hasRmd: true, emoji: "🔁" },
  traditional_401k: { label: "Traditional 401(k)", bucket: "pretax", hasRmd: true, emoji: "🏢" },
  roth_ira: { label: "Roth IRA", bucket: "roth", hasRmd: false, emoji: "🌱" },
  roth_401k: { label: "Roth 401(k)", bucket: "roth", hasRmd: false, emoji: "🌿" },
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
