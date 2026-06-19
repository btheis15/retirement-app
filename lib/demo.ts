/**
 * The built-in example household(s).
 *
 * Two flavors share one entry point, `demoHousehold(seed?)`:
 *  - seed null/0  → the CLASSIC fixed example: a couple (Robert & Linda) with
 *    ~$5M spread across every account type, each account broken into realistic
 *    holdings (stocks, ETFs, mutual funds, bond funds, cash) with shares, price,
 *    value, and — in the taxable brokerage — cost basis. This is what a first-time
 *    visitor sees, so the onboarding is always the same familiar picture.
 *  - any other seed → a RANDOMIZED-but-realistic example (see randomDemoHousehold):
 *    a fresh couple, $5M–$10M, a different account make-up (401(k)/IRA/Roth split
 *    across both spouses), different Social Security claim ages, spending, etc. The
 *    "New example" button hands a new seed so you can sanity-check how the planner
 *    behaves across a wide range of situations.
 *
 * Everything is DETERMINISTIC in the seed (same seed → byte-identical household),
 * so the example stays put across navigation and reloads until you ask for another.
 * Balances/basis are DERIVED from the holdings (see syncAccountFromHoldings), so the
 * line items always foot to the account total.
 *
 * ⚠️ Educational estimates only.
 */

import { Account, AccountKind, Holding, HoldingType, Household, syncAccountFromHoldings } from "./accounts";
import { dividendBreakdown } from "./dividends";

const RAW_ACCOUNTS: Account[] = [
  // ── Pre-tax — the big RMD-bearing bucket (~$3.0M) ──────────────────────────
  {
    id: "d1",
    label: "Robert — Rollover 401(k)",
    kind: "rollover_401k",
    owner: "self",
    balance: 0,
    holdings: [
      { ticker: "FXAIX", name: "Fidelity 500 Index", type: "mutual_fund", shares: 4000, price: 195 }, // 780k
      { ticker: "VTSAX", name: "Vanguard Total Stock Mkt", type: "mutual_fund", shares: 3000, price: 130 }, // 390k
      { ticker: "FXNAX", name: "Fidelity US Bond Index", type: "bond_fund", shares: 30000, price: 11 }, // 330k
    ],
  },
  {
    id: "d2",
    label: "Robert — Traditional IRA",
    kind: "traditional_ira",
    owner: "self",
    balance: 0,
    holdings: [
      { ticker: "AAPL", name: "Apple Inc.", type: "stock", shares: 1500, price: 230 }, // 345k
      { ticker: "MSFT", name: "Microsoft Corp.", type: "stock", shares: 900, price: 420 }, // 378k
      { ticker: "VYM", name: "Vanguard High Dividend ETF", type: "etf", shares: 1416, price: 125 }, // 177k
    ],
  },
  {
    id: "d3",
    label: "Linda — Traditional IRA",
    kind: "traditional_ira",
    owner: "spouse",
    balance: 0,
    holdings: [
      { ticker: "VOO", name: "Vanguard S&P 500 ETF", type: "etf", shares: 800, price: 500 }, // 400k
      { ticker: "AGG", name: "iShares Core US Aggregate Bond", type: "bond_fund", shares: 2000, price: 100 }, // 200k
    ],
  },
  // ── Roth — tax-free, no RMDs (~$700K) ──────────────────────────────────────
  {
    id: "d4",
    label: "Robert — Roth IRA",
    kind: "roth_ira",
    owner: "self",
    balance: 0,
    holdings: [
      { ticker: "QQQ", name: "Invesco QQQ Trust", type: "etf", shares: 625, price: 480 }, // 300k
      { ticker: "VUG", name: "Vanguard Growth ETF", type: "etf", shares: 400, price: 375 }, // 150k
    ],
  },
  {
    id: "d5",
    label: "Linda — Roth IRA",
    kind: "roth_ira",
    owner: "spouse",
    balance: 0,
    holdings: [
      { ticker: "SCHG", name: "Schwab US Large-Cap Growth", type: "etf", shares: 6000, price: 25 }, // 150k
      { ticker: "AVUV", name: "Avantis US Small Cap Value", type: "etf", shares: 1000, price: 100 }, // 100k
    ],
  },
  // ── Taxable — brokerage with big embedded gains + cash (~$1.3M) ────────────
  {
    id: "d6",
    label: "Joint Brokerage",
    kind: "brokerage",
    owner: "self",
    balance: 0,
    holdings: [
      { ticker: "NVDA", name: "NVIDIA Corp.", type: "stock", shares: 1000, price: 170, costPerShare: 35, dividendPerShare: 0.04, dividendGrowthRate: 0.15 }, // 170k / basis 35k
      { ticker: "AAPL", name: "Apple Inc.", type: "stock", shares: 1000, price: 230, costPerShare: 95, dividendPerShare: 1.05, dividendGrowthRate: 0.05 }, // 230k / 95k
      { ticker: "VTI", name: "Vanguard Total Stock Mkt ETF", type: "etf", shares: 1000, price: 290, costPerShare: 245, dividendPerShare: 3.77, dividendGrowthRate: 0.06 }, // 290k / 245k
      { ticker: "VOO", name: "Vanguard S&P 500 ETF", type: "etf", shares: 500, price: 500, costPerShare: 250, dividendPerShare: 6.8, dividendGrowthRate: 0.06 }, // 250k / 125k
      { ticker: "VXUS", name: "Vanguard Total Intl Stock ETF", type: "etf", shares: 1000, price: 160, costPerShare: 100, dividendPerShare: 3.4, dividendGrowthRate: 0.04 }, // 160k / 100k
    ],
  },
  {
    id: "d7",
    label: "Savings / CDs",
    kind: "cash",
    owner: "self",
    balance: 0,
    holdings: [
      { ticker: "CASH", name: "High-Yield Savings", type: "cash", shares: 100000, price: 1, costPerShare: 1 }, // 100k
      { ticker: "CD", name: "12-month CD", type: "cash", shares: 100000, price: 1, costPerShare: 1 }, // 100k
    ],
  },
];

export const DEMO_HOUSEHOLD: Household = {
  self: {
    label: "Robert",
    birthYear: 1961, // ~age 65 in 2026; RMDs begin at 75 (SECURE 2.0)
    socialSecurityAnnual: 48_000, // claimed at 67
    ssClaimAge: 67,
  },
  spouse: {
    label: "Linda",
    birthYear: 1963, // ~age 63 in 2026
    socialSecurityAnnual: 30_000,
    ssClaimAge: 67,
  },
  pensionAnnual: 0,
  annualSpending: 180_000, // desired after-tax spending
  brokerageDividendsAnnual: 18_000, // qualified dividends thrown off by brokerage
  state: "IL",
  accounts: RAW_ACCOUNTS.map(syncAccountFromHoldings),
};

function cloneHousehold(h: Household): Household {
  return {
    ...h,
    self: { ...h.self },
    spouse: { ...h.spouse },
    accounts: h.accounts.map((a) => ({
      ...a,
      holdings: a.holdings?.map((hh) => ({ ...hh })),
    })),
  };
}

/**
 * The example household.
 *  - `seed` null/0 → the classic fixed example (deep-copied so demo edits never
 *    mutate the constant).
 *  - any other `seed` → a deterministic randomized example for that seed.
 */
export function demoHousehold(seed?: number | null): Household {
  if (seed == null || seed === 0) return cloneHousehold(DEMO_HOUSEHOLD);
  return randomDemoHousehold(seed);
}

// ════════════════════════════ randomized examples ════════════════════════════
//
// A deterministic, seedable generator that produces a realistic retired couple so
// you can stress-test the planner across many situations with the "New example"
// button. Every draw is reproducible from the seed.

/** mulberry32 — a tiny, fast, well-distributed seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUSBAND_NAMES = [
  "Robert", "James", "William", "Charles", "Richard", "Thomas", "David", "George",
  "Frank", "Donald", "Ronald", "Kenneth", "Paul", "Edward", "Gary", "Stephen", "Larry", "Dennis",
];
const WIFE_NAMES = [
  "Linda", "Margaret", "Susan", "Patricia", "Barbara", "Carol", "Sandra", "Nancy",
  "Karen", "Betty", "Helen", "Joan", "Dorothy", "Ruth", "Diane", "Janet", "Sharon", "Judith",
];

// Realistic holding pools, with current-ish prices and trailing dividend data.
interface PoolEntry { ticker: string; name: string; dps: number; g: number; price: number }
const EQUITY_STOCKS: PoolEntry[] = [
  { ticker: "AAPL", name: "Apple Inc.", price: 230, dps: 1.05, g: 0.05 },
  { ticker: "MSFT", name: "Microsoft Corp.", price: 420, dps: 3.32, g: 0.1 },
  { ticker: "NVDA", name: "NVIDIA Corp.", price: 170, dps: 0.04, g: 0.15 },
  { ticker: "GOOGL", name: "Alphabet Inc.", price: 175, dps: 0.84, g: 0.06 },
  { ticker: "AMZN", name: "Amazon.com Inc.", price: 185, dps: 0, g: 0 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", price: 200, dps: 5.0, g: 0.07 },
  { ticker: "JNJ", name: "Johnson & Johnson", price: 155, dps: 4.96, g: 0.05 },
  { ticker: "PG", name: "Procter & Gamble", price: 165, dps: 4.03, g: 0.05 },
  { ticker: "KO", name: "Coca-Cola Co.", price: 62, dps: 1.94, g: 0.05 },
  { ticker: "XOM", name: "Exxon Mobil Corp.", price: 110, dps: 3.96, g: 0.04 },
  { ticker: "HD", name: "Home Depot Inc.", price: 360, dps: 9.2, g: 0.08 },
];
const EQUITY_ETFS: PoolEntry[] = [
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", price: 500, dps: 6.8, g: 0.06 },
  { ticker: "VTI", name: "Vanguard Total Stock Mkt ETF", price: 290, dps: 3.77, g: 0.06 },
  { ticker: "QQQ", name: "Invesco QQQ Trust", price: 480, dps: 2.6, g: 0.08 },
  { ticker: "SCHD", name: "Schwab US Dividend Equity", price: 28, dps: 1.05, g: 0.08 },
  { ticker: "VYM", name: "Vanguard High Dividend ETF", price: 125, dps: 3.6, g: 0.06 },
  { ticker: "VUG", name: "Vanguard Growth ETF", price: 375, dps: 2.0, g: 0.08 },
  { ticker: "SCHG", name: "Schwab US Large-Cap Growth", price: 28, dps: 0.2, g: 0.08 },
  { ticker: "VXUS", name: "Vanguard Total Intl Stock ETF", price: 60, dps: 1.7, g: 0.04 },
  { ticker: "AVUV", name: "Avantis US Small Cap Value", price: 100, dps: 1.2, g: 0.05 },
];
const MUTUAL_FUNDS: PoolEntry[] = [
  { ticker: "FXAIX", name: "Fidelity 500 Index", price: 195, dps: 3.6, g: 0.06 },
  { ticker: "VTSAX", name: "Vanguard Total Stock Mkt", price: 130, dps: 2.4, g: 0.06 },
  { ticker: "FCNTX", name: "Fidelity Contrafund", price: 22, dps: 0.1, g: 0.07 },
  { ticker: "VFIAX", name: "Vanguard 500 Index Admiral", price: 540, dps: 7.0, g: 0.06 },
];
const BOND_FUNDS: PoolEntry[] = [
  { ticker: "BND", name: "Vanguard Total Bond Market ETF", price: 72, dps: 2.5, g: 0 },
  { ticker: "AGG", name: "iShares Core US Aggregate Bond", price: 100, dps: 3.4, g: 0 },
  { ticker: "FXNAX", name: "Fidelity US Bond Index", price: 11, dps: 0.36, g: 0 },
  { ticker: "VBTLX", name: "Vanguard Total Bond Market Index", price: 9.6, dps: 0.31, g: 0 },
];
/** Employer/self-employed pre-tax plan kinds — varied so examples show the planner
 *  handling more than just a rollover 401(k). */
const PRETAX_EMPLOYER_KINDS: AccountKind[] = [
  "rollover_401k", "traditional_401k", "traditional_401k", "rollover_401k",
  "traditional_403b", "govt_457b", "sep_ira", "tsp_traditional",
];

// Account-kind display labels (a local subset map; avoids importing the full meta
// map just for the few strings the generator needs).
const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  traditional_ira: "Traditional IRA",
  rollover_401k: "Rollover 401(k)",
  traditional_401k: "Traditional 401(k)",
  traditional_403b: "403(b)",
  govt_457b: "457(b)",
  tsp_traditional: "TSP (Traditional)",
  sep_ira: "SEP-IRA",
  simple_ira: "SIMPLE IRA",
  solo_401k: "Solo 401(k)",
  roth_ira: "Roth IRA",
  roth_401k: "Roth 401(k)",
  roth_403b: "Roth 403(b)",
  tsp_roth: "TSP (Roth)",
  brokerage: "Brokerage",
  cash: "Cash / Savings",
};

interface Rng {
  next: () => number;
  range: (lo: number, hi: number) => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
}
function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

const round = (n: number, to: number) => Math.round(n / to) * to;

/**
 * Build holdings totaling ~`target` dollars from a weighted mix of asset pools.
 * `mix` weights are over the pools in order [stocks, etfs, funds, bonds]. Shares are
 * whole (real prices), so the account total lands *close* to target — like a real
 * portfolio, not a round number.
 */
function buildHoldings(
  rng: Rng,
  target: number,
  mix: { stocks: number; etfs: number; funds: number; bonds: number },
  taxable: boolean,
): Holding[] {
  if (target < 1000) return [];
  // More dollars → more line items (capped), like a real diversified account.
  const n = target > 900_000 ? rng.int(3, 4) : target > 300_000 ? rng.int(2, 3) : rng.int(1, 2);

  const allPools: { entries: PoolEntry[]; weight: number; type: HoldingType }[] = [
    { entries: EQUITY_STOCKS, weight: mix.stocks, type: "stock" },
    { entries: EQUITY_ETFS, weight: mix.etfs, type: "etf" },
    { entries: MUTUAL_FUNDS, weight: mix.funds, type: "mutual_fund" },
    { entries: BOND_FUNDS, weight: mix.bonds, type: "bond_fund" },
  ];
  const pools = allPools.filter((p) => p.weight > 0);
  const totalW = pools.reduce((s, p) => s + p.weight, 0);

  // Allocate the target across n slots with mildly uneven weights.
  const slotW = Array.from({ length: n }, () => 0.6 + rng.next());
  const slotSum = slotW.reduce((s, w) => s + w, 0);

  const used = new Set<string>();
  const holdings: Holding[] = [];
  for (let i = 0; i < n; i++) {
    const slotDollars = (target * slotW[i]) / slotSum;
    // Pick a pool by weight, then an unused ticker from it.
    let r = rng.next() * totalW;
    let chosen = pools[0];
    for (const p of pools) {
      if (r < p.weight) { chosen = p; break; }
      r -= p.weight;
    }
    const avail = chosen.entries.filter((e) => !used.has(e.ticker));
    const entry = avail.length > 0 ? rng.pick(avail) : rng.pick(chosen.entries);
    used.add(entry.ticker);

    const shares = Math.max(1, Math.round(slotDollars / entry.price));
    const h: Holding = {
      ticker: entry.ticker,
      name: entry.name,
      type: chosen.type,
      shares,
      price: entry.price,
    };
    if (taxable) {
      // Embedded gain: equities carry a real unrealized gain (basis below price);
      // bonds barely move. So the brokerage shows a believable basis story.
      const gain = chosen.type === "bond_fund" ? rng.range(0, 0.08) : rng.range(0.18, 0.62);
      h.costPerShare = round(entry.price * (1 - gain), 0.01) || entry.price;
      h.dividendPerShare = entry.dps;
      h.dividendGrowthRate = entry.g;
    }
    holdings.push(h);
  }
  return holdings;
}

let idSeq = 0;
const nextId = () => `r${++idSeq}`;

/** A randomized but realistic retired couple, fully determined by `seed`. */
export function randomDemoHousehold(seed: number): Household {
  idSeq = 0;
  const rng = makeRng(seed);
  const thisYear = new Date().getFullYear();

  // ── People ──────────────────────────────────────────────────────────────
  const selfName = rng.pick(HUSBAND_NAMES);
  const wifeName = rng.pick(WIFE_NAMES);
  const selfAge = rng.int(58, 73);
  const ageGap = rng.int(0, 6) * (rng.chance(0.5) ? 1 : -1);
  const spouseAge = Math.min(75, Math.max(56, selfAge + ageGap));

  // Social Security: a higher earner + a lower/secondary earner. Stored as the
  // FULL benefit at FRA; the engine adjusts for each spouse's own claim age.
  const ssClaimAges = [62, 63, 64, 65, 66, 67, 68, 69, 70] as const;
  const selfPiaHi = round(rng.range(30_000, 56_000), 1_000);
  const spousePia = round(rng.range(0, selfPiaHi), 1_000);
  const selfClaim = rng.pick(ssClaimAges);
  const spouseClaim = rng.pick(ssClaimAges);

  // ── Total wealth, split across the three tax buckets ──────────────────────
  const total = round(rng.range(5_000_000, 10_000_000), 50_000);
  const wPre = rng.range(3.0, 7.0);
  const wRoth = rng.range(0.5, 3.0);
  const wTax = rng.range(1.2, 4.5);
  const wSum = wPre + wRoth + wTax;
  const pretaxTotal = (total * wPre) / wSum;
  const rothTotal = (total * wRoth) / wSum;
  const taxableTotal = (total * wTax) / wSum;

  // Older couples tilt a bit more to bonds (a light glidepath).
  const bondTilt = Math.max(0.12, Math.min(0.5, (selfAge - 55) / 60 + rng.range(-0.05, 0.1)));
  const pretaxMix = { stocks: 1, etfs: 2.5, funds: 1.5, bonds: bondTilt * 6 };
  const rothMix = { stocks: 1.6, etfs: 2.4, funds: 1, bonds: 0 }; // Roth → growth-tilted
  const brokerageMix = { stocks: 1.5, etfs: 2, funds: 1, bonds: bondTilt * 2 };

  const accounts: Account[] = [];
  const add = (label: string, kind: AccountKind, owner: "self" | "spouse", holdings: Holding[]) => {
    if (holdings.length === 0) return;
    accounts.push(syncAccountFromHoldings({ id: nextId(), label, kind, owner, balance: 0, holdings }));
  };

  // ── Pre-tax: an employer plan + IRA for each spouse, split by an earner share.
  const selfPretaxShare = rng.range(0.35, 0.78);
  const selfPretax = pretaxTotal * selfPretaxShare;
  const spousePretax = pretaxTotal * (1 - selfPretaxShare);
  const buildPretaxFor = (owner: "self" | "spouse", name: string, amount: number) => {
    if (amount < 20_000) return;
    const employerKind = rng.pick(PRETAX_EMPLOYER_KINDS);
    const employerLabel = ACCOUNT_KIND_LABEL[employerKind];
    // Larger pre-tax balances split into an employer plan + a rollover/IRA.
    if (amount > 700_000 && rng.chance(0.8)) {
      const iraShare = rng.range(0.25, 0.5);
      add(`${name} — ${employerLabel}`, employerKind, owner, buildHoldings(rng, amount * (1 - iraShare), pretaxMix, false));
      add(`${name} — Traditional IRA`, "traditional_ira", owner, buildHoldings(rng, amount * iraShare, pretaxMix, false));
    } else if (rng.chance(0.5)) {
      add(`${name} — ${employerLabel}`, employerKind, owner, buildHoldings(rng, amount, pretaxMix, false));
    } else {
      add(`${name} — Traditional IRA`, "traditional_ira", owner, buildHoldings(rng, amount, pretaxMix, false));
    }
  };
  buildPretaxFor("self", selfName, selfPretax);
  buildPretaxFor("spouse", wifeName, spousePretax);

  // ── Roth: a Roth IRA for one or both spouses (sometimes only one has one).
  const selfRothShare = rng.range(0.3, 0.85);
  const bothHaveRoth = rng.chance(0.7);
  if (bothHaveRoth) {
    const selfKind: AccountKind = rng.chance(0.2) ? "roth_401k" : "roth_ira";
    add(`${selfName} — ${ACCOUNT_KIND_LABEL[selfKind]}`, selfKind, "self", buildHoldings(rng, rothTotal * selfRothShare, rothMix, false));
    add(`${wifeName} — Roth IRA`, "roth_ira", "spouse", buildHoldings(rng, rothTotal * (1 - selfRothShare), rothMix, false));
  } else {
    const owner: "self" | "spouse" = rng.chance(0.5) ? "self" : "spouse";
    add(`${owner === "self" ? selfName : wifeName} — Roth IRA`, "roth_ira", owner, buildHoldings(rng, rothTotal, rothMix, false));
  }

  // ── Taxable: a joint brokerage with embedded gains + a cash/CD account.
  const cashTotal = Math.min(taxableTotal * rng.range(0.08, 0.3), round(rng.range(50_000, 500_000), 10_000));
  const brokerageTotal = Math.max(0, taxableTotal - cashTotal);
  add("Joint Brokerage", "brokerage", "self", buildHoldings(rng, brokerageTotal, brokerageMix, true));
  if (cashTotal > 5_000) {
    const half = Math.round(cashTotal / 2);
    accounts.push(syncAccountFromHoldings({
      id: nextId(), label: "Savings / CDs", kind: "cash", owner: "self", balance: 0,
      holdings: [
        { ticker: "CASH", name: "High-Yield Savings", type: "cash", shares: cashTotal - half, price: 1, costPerShare: 1 },
        { ticker: "CD", name: "12-month CD", type: "cash", shares: half, price: 1, costPerShare: 1 },
      ],
    }));
  }

  // ── Derived income + spending ─────────────────────────────────────────────
  const taxableHoldings = accounts.filter((a) => a.kind === "brokerage" || a.kind === "cash").flatMap((a) => a.holdings ?? []);
  const bd = dividendBreakdown(taxableHoldings);
  const taxableInterest = round(cashTotal * rng.range(0.03, 0.045), 100);
  // Spending: a realistic 2.6%–4.6% of the portfolio, in a sensible band.
  const realizedTotal = accounts.reduce((s, a) => s + a.balance, 0);
  const annualSpending = Math.max(120_000, Math.min(420_000, round(realizedTotal * rng.range(0.026, 0.046), 5_000)));
  const pensionAnnual = rng.chance(0.25) ? round(rng.range(20_000, 70_000), 1_000) : 0;

  return {
    self: { label: selfName, birthYear: thisYear - selfAge, socialSecurityAnnual: selfPiaHi, ssClaimAge: selfClaim },
    spouse: { label: wifeName, birthYear: thisYear - spouseAge, socialSecurityAnnual: spousePia, ssClaimAge: spouseClaim },
    pensionAnnual,
    annualSpending,
    brokerageDividendsAnnual: Math.round(bd.qualifiedYear0),
    ordinaryDividendsAnnual: Math.round(bd.ordinaryYear0),
    taxableInterestAnnual: taxableInterest,
    state: "IL",
    accounts,
  };
}
