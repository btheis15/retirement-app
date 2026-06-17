/**
 * Opportunity detector — the "you should probably move money here for an
 * instant/long-run tax benefit" callouts. Each one is explained in plain English
 * and carries a source so the reasoning is verifiable.
 *
 * These are general, rule-based observations from your numbers — NOT personal
 * advice. Confirm with a tax professional before acting.
 */

import { Household, sumBuckets, bucketOf } from "./accounts";
import { YearPlan, BracketTarget } from "./optimizer";
import { ordinaryBracketCeiling, ltcgZeroCeiling } from "./tax/engine";
import { FILING_CONSTANTS, rmdStartAge } from "./tax/constants";
import { SOURCES, Source } from "./sources";
import { money } from "./format";

export interface Opportunity {
  id: string;
  icon: string;
  title: string;
  detail: string;
  impact?: string; // a rough dollar/qualitative impact
  tone: "good" | "warn" | "info";
  sources: Source[];
}

export function detectOpportunities(
  household: Household,
  plan: YearPlan,
  bracketTarget: BracketTarget,
): Opportunity[] {
  const out: Opportunity[] = [];
  const buckets = sumBuckets(household.accounts);
  const tax = plan.tax;
  const selfAge = plan.selfAge;
  const status = plan.filingStatus;

  // 1) Roth conversion / bracket-fill headroom in a low-tax year.
  // Brackets are inflation-indexed in the engine, so scale the nominal ceiling
  // by the plan's year factor to compare against the (already-indexed) income.
  const ceiling = ordinaryBracketCeiling(bracketTarget, status) * plan.inflationFactor;
  const headroom = ceiling - tax.ordinaryTaxableIncome;
  if (headroom > 5_000 && buckets.pretax > 10_000) {
    const fillable = Math.min(headroom, buckets.pretax);
    out.push({
      id: "roth-conversion",
      icon: "🔄",
      title: "Room to convert pre-tax → Roth cheaply",
      detail: `Your income only fills part of the ${Math.round(
        bracketTarget * 100,
      )}% bracket. You could convert roughly ${money(
        fillable,
      )} from a Traditional IRA/401(k) to Roth this year, paying tax now at ${Math.round(
        bracketTarget * 100,
      )}% instead of letting it grow and come out later as RMDs — likely taxed at a higher rate once both Social Security and RMDs are flowing. Roth then grows tax-free with no future RMDs.`,
      impact: `Converts up to ${money(fillable)} at today's ${Math.round(bracketTarget * 100)}% rate`,
      tone: "good",
      sources: [SOURCES.rothConversion, SOURCES.rmd, SOURCES.brackets2026],
    });
  }

  // 2) 0% long-term capital gains harvesting.
  const zeroCeiling = ltcgZeroCeiling(status) * plan.inflationFactor;
  const zeroRoom = zeroCeiling - tax.taxableIncome;
  if (zeroRoom > 2_000 && buckets.taxableGain > 1_000) {
    const harvest = Math.min(zeroRoom, buckets.taxableGain);
    out.push({
      id: "cap-gains-harvest",
      icon: "🎁",
      title: "Harvest capital gains at 0%",
      detail: `${status === "single" ? "Filing single" : "Married filing jointly"}, long-term gains are taxed at 0% until taxable income reaches ${money(
        zeroCeiling,
      )}. You have about ${money(
        zeroRoom,
      )} of room left this year. Selling appreciated brokerage holdings to realize up to ${money(
        harvest,
      )} of gains — then optionally rebuying — resets your cost basis higher at no federal tax, shrinking future taxable gains.`,
      impact: `Up to ${money(harvest)} of gains realized tax-free`,
      tone: "good",
      sources: [SOURCES.capGains, SOURCES.brackets2026],
    });
  }

  // 3) IRMAA cliff proximity (status-aware tiers; surcharge × people on the return).
  const magi = tax.magi;
  const irmaaTiers = FILING_CONSTANTS[status].irmaaTiers;
  const people = FILING_CONSTANTS[status].people;
  const whoseWord = people === 1 ? "your" : "both spouses'";
  for (let i = 0; i < irmaaTiers.length - 1; i++) {
    const boundary = irmaaTiers[i].upTo * plan.inflationFactor;
    const nextSurcharge = irmaaTiers[i + 1].monthlyPerPerson;
    const here = irmaaTiers[i].monthlyPerPerson;
    if (magi > boundary - 15_000 && magi <= boundary && nextSurcharge > here && selfAge >= 62) {
      const annualHit = (nextSurcharge - here) * 12 * people;
      out.push({
        id: `irmaa-${i}`,
        icon: "🚧",
        title: "Watch the Medicare IRMAA cliff",
        detail: `Your income (${money(
          magi,
        )}) is within ${money(boundary - magi)} of the next IRMAA bracket at ${money(
          boundary,
        )}. Crossing it would raise ${whoseWord} Medicare premiums about ${money(
          annualHit,
        )}/yr (two years later). Covering the last bit of spending from Roth or cash instead of pre-tax keeps you under the line.`,
        impact: `Avoids ~${money(annualHit)}/yr in extra premiums`,
        tone: "warn",
        sources: [SOURCES.irmaa],
      });
      break;
    }
  }

  // 4) QCD from age 70½ — available BEFORE RMDs begin (a pure AGI-management tool),
  //    and once RMDs start it also counts toward satisfying them.
  if (selfAge >= 70 || plan.spouseAge >= 70) {
    out.push({
      id: "qcd",
      icon: "❤️",
      title: "Give to charity straight from the IRA (QCD)",
      detail: `From age 70½ you can send up to about $108,000 per person (2025, indexed) directly from a Traditional IRA to charity. It never hits your taxable income — lowering AGI, reducing how much Social Security is taxed, and helping keep you under an IRMAA tier${plan.rmd > 0 ? ", and it counts toward your required minimum distribution" : " (you don't have to wait for RMDs to start)"}.`,
      impact: "RMD dollars given this way are 100% tax-free",
      tone: "info",
      sources: [SOURCES.qcd, SOURCES.rmd],
    });
  }

  // 5) Pre-tax "tax bomb" — heavy pre-tax balance means big future RMDs.
  if (buckets.total > 0 && buckets.pretax / buckets.total > 0.6 && selfAge < rmdStartAge(household.self.birthYear)) {
    out.push({
      id: "pretax-heavy",
      icon: "💣",
      title: "RMD tax bomb — roll pre-tax → Roth now",
      detail: `About ${Math.round(
        (buckets.pretax / buckets.total) * 100,
      )}% of your assets are pre-tax. Left alone, these grow until RMDs force large taxable withdrawals in your 70s–80s, often pushing you into higher brackets and IRMAA. The years before RMDs/Social Security are the ideal time to roll some to Roth — see the quantified "rollover plan" above, which shows exactly how much to convert and how far it cuts your worst-year RMD.`,
      impact: "Shrinks future RMD-driven tax spikes",
      tone: "warn",
      sources: [SOURCES.rmd, SOURCES.rothConversion, SOURCES.rothNoRmd],
    });
  }

  // 6) Asset location — interest-bearing cash/bonds in taxable is inefficient.
  const cash = household.accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);
  if (cash > 100_000) {
    out.push({
      id: "asset-location",
      icon: "🧭",
      title: "Consider where you hold bonds & cash",
      detail: `You hold ${money(
        cash,
      )} in cash/savings. Interest is taxed as ordinary income every year and counts toward the 3.8% Net Investment Income Tax. Holding bonds/cash inside pre-tax or Roth accounts — and keeping stocks (which get preferential long-term rates and a step-up at death) in the taxable brokerage — is usually more tax-efficient.`,
      impact: "Reduces annual ordinary-income drag",
      tone: "info",
      sources: [SOURCES.niit, SOURCES.stepUp, SOURCES.capGains],
    });
  }

  // 7) Don't drain the Roth — reaffirm it's last.
  if (buckets.roth > 0 && plan.withdrawals.roth > 1) {
    out.push({
      id: "roth-last",
      icon: "🌱",
      title: "Roth is your tax-free reserve",
      detail: `The plan only taps Roth after cheaper sources, and never for forced reasons — Roth IRAs have no lifetime RMDs. Keeping Roth invested as long as possible maximizes tax-free growth and gives heirs a tax-free inheritance.`,
      impact: "Preserves tax-free growth",
      tone: "good",
      sources: [SOURCES.rothNoRmd, SOURCES.rothConversion],
    });
  }

  return out;
}
