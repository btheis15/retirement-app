/**
 * State income tax — currently Illinois only, structured so more states are just
 * another entry in STATE_TAX.
 *
 * ILLINOIS (verified against IL Dept. of Revenue Pub-120 R-12/25, IL-1040
 * instructions, and the IDOR Q&A, June 2026):
 *  - Flat 4.95% individual income tax (no brackets, no short/long-gain split).
 *  - Illinois starts from federal AGI, then SUBTRACTS (IL-1040 Line 5) the
 *    federally-taxed portion of QUALIFIED RETIREMENT INCOME — so it does NOT tax:
 *      • 401(k)/403(b)/Traditional IRA distributions, including RMDs
 *      • Roth CONVERSIONS of a Traditional IRA  ← the big one for this app
 *      • pensions and government/military retirement
 *      • Social Security benefits
 *    => At the STATE level, conversions and RMDs are tax-free. Only the
 *       non-retirement investment income is taxed: taxable interest, dividends
 *       (qualified + ordinary), and capital gains.
 *  - No standard deduction. A personal exemption of $2,850/person (2025) is
 *    subtracted, and is disallowed entirely once AGI exceeds $500,000 (MFJ).
 *    An extra $1,000 exemption applies per person age 65+.
 *
 * ⚠️ Educational estimates only — not tax advice.
 * Sources: tax.illinois.gov Pub-120, IL-1040 instructions, IDOR Q&A 99 & 851.
 */

import type { FilingStatus } from "./constants";

export type StateCode = "IL" | "none";

export interface StateTaxInput {
  /** Federal AGI — used only for the exemption phaseout. */
  agi: number;
  /** Illinois-taxable (non-retirement) income components: */
  taxableInterest: number;
  ordinaryDividends: number;
  qualifiedDividends: number;
  longTermGains: number; // IL has no preferential cap-gains rate
  /** Spouses age 65+ (0–2) — each adds a $1,000 IL exemption. */
  num65Plus: number;
  /** Inflation index for the year (scales the IL exemption; default 1). */
  inflationFactor?: number;
  /** Filing status — drives the IL exemption count and phaseout. Default "mfj". */
  filingStatus?: FilingStatus;
}

export interface StateTaxResult {
  state: StateCode;
  stateName: string;
  /** Total state income tax. */
  tax: number;
  /** State taxable income after the state's exemptions. */
  taxableIncome: number;
  /** Flat state rate (0 for "none"). */
  rate: number;
  /** State exemption/deduction applied. */
  exemption: number;
  /** Short note on what the state exempts (for UI). */
  note: string;
}

interface StateConfig {
  name: string;
  rate: number;
  /** Compute the state's taxable base from the non-retirement income items. */
  taxableBase: (i: StateTaxInput) => number;
  /** Exemption/deduction given AGI + age, before the rate is applied. */
  exemption: (i: StateTaxInput) => number;
  note: string;
}

const IL_PERSONAL_EXEMPTION = 2_925; // per person, 2026 (cost-of-living indexed by IL DoR)
const IL_SENIOR_EXEMPTION = 1_000; // extra, per person age 65+ — a FIXED $1,000 (not indexed)
const IL_EXEMPTION_PHASEOUT_AGI_MFJ = 500_000; // exemption -> $0 above this AGI (MFJ)
const IL_EXEMPTION_PHASEOUT_AGI_SINGLE = 250_000; // exemption -> $0 above this AGI (Single)

export const STATE_TAX: Record<StateCode, StateConfig> = {
  IL: {
    name: "Illinois",
    rate: 0.0495,
    // Retirement income (SS, pensions, IRA/401k distributions, Roth conversions)
    // is subtracted in Illinois, so only investment income is taxed.
    taxableBase: (i) => i.taxableInterest + i.ordinaryDividends + i.qualifiedDividends + i.longTermGains,
    exemption: (i) => {
      const single = i.filingStatus === "single";
      // $250k(single)/$500k(MFJ) phaseout is statutory; the exemption amounts are indexed.
      const phaseout = single ? IL_EXEMPTION_PHASEOUT_AGI_SINGLE : IL_EXEMPTION_PHASEOUT_AGI_MFJ;
      if (i.agi > phaseout) return 0;
      const f = i.inflationFactor ?? 1;
      const personalCount = single ? 1 : 2;
      // Only the personal exemption is cost-of-living indexed; the $1,000 senior
      // exemption is a fixed statutory amount.
      return personalCount * IL_PERSONAL_EXEMPTION * f + IL_SENIOR_EXEMPTION * i.num65Plus;
    },
    note: "Illinois doesn't tax retirement income — IRA/401(k) withdrawals, RMDs, Roth conversions, pensions, and Social Security are all exempt. Only investment income (interest, dividends, capital gains) is taxed at the flat 4.95%.",
  },
  none: {
    name: "No state tax",
    rate: 0,
    taxableBase: () => 0,
    exemption: () => 0,
    note: "No state income tax modeled.",
  },
};

export function computeStateTax(input: StateTaxInput, state: StateCode = "IL"): StateTaxResult {
  const cfg = STATE_TAX[state] ?? STATE_TAX.none;
  const exemption = cfg.exemption(input);
  const taxableIncome = Math.max(0, cfg.taxableBase(input) - exemption);
  return {
    state,
    stateName: cfg.name,
    tax: taxableIncome * cfg.rate,
    taxableIncome,
    rate: cfg.rate,
    exemption,
    note: cfg.note,
  };
}
