/**
 * The built-in example household: ~$5M spread across every account type, with
 * each account broken into realistic holdings (stocks, ETFs, mutual funds, bond
 * funds, cash) showing shares, price, value, and — in the taxable brokerage —
 * cost basis. So you can see how the planner behaves on a full picture without
 * entering your own numbers.
 *
 * Modeled on the user's described situation: a couple about to retire, filing
 * jointly, with old rollover 401(k)s, Roth IRAs, Traditional IRAs, a brokerage,
 * and Social Security.
 *
 * Balances/basis are DERIVED from the holdings (see syncAccountFromHoldings), so
 * the line items always foot to the account total.
 */

import { Account, Household, syncAccountFromHoldings } from "./accounts";

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

export function demoHousehold(): Household {
  // deep copy so edits in demo mode don't mutate the constant
  return {
    ...DEMO_HOUSEHOLD,
    self: { ...DEMO_HOUSEHOLD.self },
    spouse: { ...DEMO_HOUSEHOLD.spouse },
    accounts: DEMO_HOUSEHOLD.accounts.map((a) => ({
      ...a,
      holdings: a.holdings?.map((h) => ({ ...h })),
    })),
  };
}
