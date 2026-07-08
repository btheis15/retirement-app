"use client";

import { useMemo, useState, useEffect, ReactNode } from "react";
import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Stat, Disclaimer, Callout, Explainer, Info, StackedBar, PageSkeleton, DesktopOnly, Collapsible, AdjustLink } from "@/components/ui";
import { Donut, Legend, AnimatedNumber } from "@/components/charts";
import { planYear, STRATEGY_META, StrategyId, BracketTarget } from "@/lib/optimizer";
import { ordinaryBracketCeiling } from "@/lib/tax/engine";
import { detectOpportunities } from "@/lib/opportunities";
import { projectLifetime } from "@/lib/projection";
import { recommendPlan, describePlan, planGist, configMatches, GOAL_META } from "@/lib/goals";
import { analyzeConversions } from "@/lib/rothConversion";
import { buildActionPlan, PlanAction } from "@/lib/actionPlan";
import {
  adjustedAnnualBenefit,
  ssBenefitFactor,
  fullRetirementAge,
  breakevenAge,
  CLAIM_MIN,
  CLAIM_MAX,
} from "@/lib/socialSecurity";
import { ageInYear, Household } from "@/lib/accounts";
import { GoalId, PlannerSettings, survivorFromSettings } from "@/lib/defaults";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { computeMonteCarlo } from "@/lib/mcClient";
import { returnModel } from "@/lib/returns";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { SOURCES } from "@/lib/sources";

const GOALS: GoalId[] = ["maxCapital", "lowestTax", "lowestRate"];

const STRATEGIES: StrategyId[] = ["smart", "conventional", "proportional"];
const BRACKETS: BracketTarget[] = [0.12, 0.22, 0.24, 0.32];

const STEP_TONE: Record<"deferred" | "taxable" | "roth", string> = {
  deferred: "text-deferred",
  taxable: "text-taxable",
  roth: "text-roth",
};

const STRATEGY_SHORT: Record<StrategyId, string> = {
  smart: "Fills low brackets early to cut lifetime tax. Often best — compare on the Compare tab to be sure.",
  conventional: "The common rule of thumb. Simple, and sometimes hard to beat.",
  proportional: "A little from everything. Simplest, rarely tax-optimal.",
};

export default function PlanPage() {
  const { ready, household, settings, updateSettings } = useStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const year = useMemo(() => new Date().getFullYear(), []);

  // A genuinely single household (sentinel spouse, birthYear ≤ 1900) must be taxed
  // on the SINGLE curve — defaulting to mfj would count the sentinel as a 65+
  // spouse and grant double deductions/brackets and 2 IRMAA enrollees.
  const filingStatus = household.spouse && household.spouse.birthYear > 1900 ? ("mfj" as const) : ("single" as const);
  const plan = useMemo(
    () =>
      planYear(household, {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        year,
        filingStatus,
        dividendMode: settings.dividendMode,
      }),
    [household, settings, year, filingStatus],
  );
  const opportunities = useMemo(
    () => detectOpportunities(household, plan, settings.bracketTarget),
    [household, plan, settings.bracketTarget],
  );
  // Active lifetime plan (respects the conversion mode) — its first row is this year.
  const activeProj = useMemo(
    () =>
      projectLifetime(household, {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        returnRate: settings.returnRate,
        inflationRate: settings.inflationRate,
        endAge: settings.endAge,
        convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
        survivor: survivorFromSettings(settings),
        heirTaxRate: settings.heirTaxRate,
        spendingStrategy: settings.spendingStrategy,
        dividendMode: settings.dividendMode,
      }),
    [household, settings],
  );
  const thisYearConversion = activeProj.rows[0]?.conversion ?? 0;

  if (!ready) return <PageSkeleton />;

  const w = plan.withdrawals;
  const totalDraw = w.pretax + w.taxable + w.roth;
  const voluntaryPretax = Math.max(0, w.pretax - plan.rmd);
  const coveredByIncome = totalDraw < 0.5;

  // What funds this year's spending (Social Security shown explicitly). In the
  // default "reinvest" mode, dividends & interest are NOT taken as cash — they
  // compound in the account and don't cover spending (the engine withdraws a little
  // more to cover their yearly tax), so they aren't a funding source here. They only
  // count as income to spend when the user has opted into that.
  const ssNow = plan.fixed.socialSecurity;
  const spendInvestmentIncome = settings.dividendMode === "spend";
  const interestIncome = spendInvestmentIncome ? plan.fixed.taxableInterest + plan.fixed.taxExemptInterest : 0;
  const allDividends = spendInvestmentIncome ? plan.fixed.dividends + plan.fixed.ordinaryDividends : 0;
  const guaranteed = ssNow + plan.fixed.pension + allDividends + interestIncome;
  const fundingSegs = [
    { value: ssNow, className: "bg-ss", label: "Social Security" },
    { value: plan.fixed.pension, className: "bg-primary", label: "Pension" },
    { value: allDividends, className: "bg-gain", label: "Dividends" },
    { value: interestIncome, className: "bg-roth", label: "Interest" },
    { value: totalDraw, className: "bg-taxable", label: "Withdrawals" },
  ].filter((s) => s.value > 0.5);
  const ssPending = (["self", "spouse"] as const)
    .map((who) => {
      const p = household[who];
      if (p.socialSecurityAnnual > 0 && ageInYear(p.birthYear, year) < p.ssClaimAge) {
        return `${p.label}'s Social Security (${money(adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, p.ssClaimAge))}/yr) starts at age ${p.ssClaimAge}`;
      }
      return null;
    })
    .filter(Boolean) as string[];

  const sourceSegments = [
    { label: "Pre-tax (IRA/401k)", value: w.pretax, color: HEX.deferred },
    { label: "Brokerage", value: w.taxable, color: HEX.taxable },
    { label: "Roth (tax-free)", value: w.roth, color: HEX.roth },
  ].filter((s) => s.value > 0.5);

  const incomeSegments = [
    { label: "Social Security", value: plan.fixed.socialSecurity, color: HEX.ss },
    { label: "Pension", value: plan.fixed.pension, color: HEX.primary },
    { label: "Dividends", value: allDividends, color: HEX.gain },
    { label: "Interest", value: interestIncome, color: HEX.roth },
    { label: "Pre-tax withdrawals", value: w.pretax, color: HEX.deferred },
    { label: "Brokerage", value: w.taxable, color: HEX.taxable },
    { label: "Roth (tax-free)", value: w.roth, color: HEX.roth },
  ].filter((s) => s.value > 0.5);

  // ---- Plain-English step list: exactly what to do, in order. ----
  const steps: { label: string; amount: number; detail: string; tone: "deferred" | "taxable" | "roth" }[] = [];
  if (plan.rmd > 0.5) {
    steps.push({
      label: "Take your required withdrawal (RMD)",
      amount: plan.rmd,
      detail:
        "The IRS forces this much out of your pre-tax accounts this year. It's taxed as ordinary income, so it always comes out first.",
      tone: "deferred",
    });
  }
  if (voluntaryPretax > 0.5) {
    steps.push({
      label: plan.rmd > 0.5 ? "Withdraw a little more from pre-tax" : "Withdraw from pre-tax (IRA / 401k)",
      amount: voluntaryPretax,
      detail: `Pull pre-tax dollars up to the ${percent(settings.bracketTarget, 0)} tax bracket. Taking these "cheap" dollars now means smaller forced withdrawals — and a smaller tax bill — later.`,
      tone: "deferred",
    });
  }
  if (w.taxable > 0.5) {
    steps.push({
      label: "Sell from your brokerage",
      amount: w.taxable,
      detail: "Only the gain portion is taxed, usually at the lower long-term capital-gains rate (often 0–15%).",
      tone: "taxable",
    });
  }
  if (w.roth > 0.5) {
    steps.push({
      label: "Tap your Roth (tax-free)",
      amount: w.roth,
      detail: "Used last on purpose: Roth comes out tax-free and is never forced out, so every year it stays invested is tax-free growth.",
      tone: "roth",
    });
  }
  if (settings.useConversions && thisYearConversion > 0.5) {
    steps.push({
      label: "Roll pre-tax → Roth (the tax-bomb fix)",
      amount: thisYearConversion,
      detail: `Not spending — this rolls ${money(thisYearConversion)} from your pre-tax IRA/401(k) into Roth${
        settings.convertMode === "recommended"
          ? ", sized to your projected future RMD-era tax rate"
          : `, filling the ${percent(settings.bracketTarget, 0)} bracket`
      }. Pay the tax from cash${(household.state ?? "IL") === "IL" ? " — Illinois doesn't tax the conversion" : ""} — and it shrinks every future RMD, then grows tax-free with no RMDs of its own.`,
      tone: "roth",
    });
  }

  return (
    <div>
      <PageTitle title={`Your ${year} plan`} subtitle="What to do this year, and the tax math behind it. (New to this? The Start tab walks you through it.)" />

      <div className="mt-1">
      {/* ---------- The spending target (decided once in the walkthrough; every
           card below quotes it). Shown here, changed there — one source of truth. ---------- */}
      <SectionTitle>How much you&apos;re spending each year</SectionTitle>
      <Explainer>Your after-tax target — the money you actually want in your pocket. You set it in the walkthrough; tap Adjust to change it and the whole plan updates.</Explainer>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground/60">Yearly spending (after tax)</div>
            <div className="tabular text-2xl font-bold text-primary">{money(plan.spendingTarget)}</div>
            <div className="tabular text-[12px] text-foreground/50">{money(Math.round(plan.spendingTarget / 12))}/mo</div>
          </div>
          <AdjustLink step="spend" />
        </div>
      </Card>

      {/* ---------- THE HEADLINE: what to do ---------- */}
      <Callout tone="good" icon="🧭" title="Your move this year">
        {coveredByIncome ? (
          <>
            Good news — your guaranteed income{spendInvestmentIncome ? " (Social Security, pension and the dividends you take as cash)" : " (Social Security and pension)"} already covers your{" "}
            <strong>{money(plan.spendingTarget)}</strong>{" "}of spending this year. You don&apos;t need to
            pull from any account{plan.rmd > 0.5 ? " beyond the required minimum withdrawal (RMD) below" : ""}.
          </>
        ) : (
          <>
            To spend <strong>{money(plan.spendingTarget)}</strong>{" "}after tax this year, withdraw about{" "}
            <strong>{money(totalDraw)}</strong>{" "}total from your accounts (the steps below), and set aside
            roughly <strong>{money(plan.tax.totalTax)}</strong>{" "}for tax (federal + Illinois).
          </>
        )}
      </Callout>

      {/* ---------- What funds the spending (SS shown) ---------- */}
      <SectionTitle>What pays for it</SectionTitle>
      <Explainer>Your guaranteed income — Social Security first — covers what it can; withdrawals fill the rest. Tax comes out of the total.</Explainer>
      <Card>
        {fundingSegs.length > 0 ? (
          <>
            <StackedBar segments={fundingSegs} />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {fundingSegs.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1 text-foreground/65">
                  <span className={`h-2 w-2 rounded-full ${s.className}`} />
                  {s.label} {money(s.value)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-foreground/70">No income or withdrawals yet — add accounts and benefits to see the breakdown.</p>
        )}
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-foreground/65">Guaranteed income (SS, pension, dividends, interest)</span>
            <span className="tabular font-medium text-ss">{money(guaranteed)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground/65">Withdrawals from accounts</span>
            <span className="tabular font-medium text-taxable">{money(totalDraw)}</span>
          </div>
          <div className="flex justify-between border-t border-border/60 pt-1">
            <span className="text-foreground/65">Total income</span>
            <span className="tabular">{money(plan.grossInflow)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground/65">− Tax (federal + {plan.tax.state.state === "IL" ? "Illinois" : "state"})</span>
            <span className="tabular text-tax">− {money(plan.tax.totalTax)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>= Yours to spend</span>
            <span className="tabular">{money(plan.spendingTarget)}</span>
          </div>
        </div>
        {ssPending.length > 0 && (
          <p className="mt-3 rounded-xl bg-ss/5 px-3 py-2 text-[12px] text-foreground/65">
            ⏳ {ssPending.join("; ")} — until then, withdrawals cover more (see &quot;when to claim&quot; below).
          </p>
        )}
      </Card>

      {/* ---------- The step-by-step ---------- */}
      <SectionTitle>Do this, in order</SectionTitle>
      <Explainer>We always satisfy required withdrawals first, then pull from the most tax-friendly source next, saving tax-free Roth for last.</Explainer>
      <Card>
        {steps.length === 0 ? (
          <p className="text-sm text-foreground/75">
            Nothing to withdraw — your guaranteed income covers your spending. Any surplus can be reinvested
            in your brokerage.
          </p>
        ) : (
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{s.label}</span>
                    <span className={`tabular shrink-0 font-bold ${STEP_TONE[s.tone]}`}>{money(s.amount)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/65">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {w.roth < 0.5 && steps.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-roth/5 px-3 py-2 text-[12px] text-roth">
            🌱 Leave your Roth untouched this year — it keeps growing tax-free.
          </p>
        )}

        <div className="mt-4 border-t border-border pt-3 text-[13px] text-foreground/80">
          <strong>Bottom line:</strong>{" "}you keep <strong>{money(plan.spendingTarget)}</strong>{" "}to spend
          after paying about <strong className="text-tax">{money(plan.tax.totalTax)}</strong>{" "}in tax
          (federal + Illinois) — that&apos;s {percent(plan.tax.effectiveRate)} of your total income for the year.
        </div>
      </Card>

      {/* Why this order — defined right where the steps just used it. */}
      <Info q="Why this order? (pre-tax → brokerage → Roth)" sources={[SOURCES.rmd, SOURCES.rothNoRmd, SOURCES.capGains]}>
        <p className="mb-1.5">Your accounts fall into three tax &quot;buckets,&quot; and the bucket — not the brand — sets the order:</p>
        <ul className="space-y-1">
          <li><strong className="text-deferred">Pre-tax</strong>{" "}(Traditional IRA / 401k): never taxed yet, so every dollar out is ordinary income. The IRS forces minimum withdrawals (RMDs) starting at 73–75.</li>
          <li><strong className="text-taxable">Brokerage</strong>{" "}(taxable): only the <em>gain</em>{" "}is taxed, usually at the lower capital-gains rate. No forced withdrawals.</li>
          <li><strong className="text-roth">Roth</strong>: already taxed, so it comes out tax-free and is <em>never</em>{" "}forced out — which is why it&apos;s spent last.</li>
        </ul>
      </Info>

      {/* ---------- LOOKING AHEAD: the next several years ---------- */}
      <LookingAhead />

      {/* ---------- ROLLOVER / ROTH-CONVERSION PLAN (the canonical, editable control) ---------- */}
      <RolloverPlanCard />

      {/* ---------- SOCIAL SECURITY timing — the one place to act on claim age ---------- */}
      <SsTiming household={household} year={year} />

      {/* ---------- The strategy we picked (demoted below the action; collapsed) ---------- */}
      <Collapsible
        eyebrow="under the hood"
        title="See the strategy we picked for you"
        summary="Your goal, the recommended plan, and how confident we are"
        className="mt-2"
      >
        <GoalAndRecommendation />
      </Collapsible>

      {/* ---------- Why this plan (collapsed detail) ---------- */}
      <Collapsible title="Why this plan" summary="The reasoning behind the steps, in your own numbers" className="mt-2">
        <ul className="space-y-2 text-[13px] text-foreground/75">
          {plan.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Collapsible>

      {/* ---------- Opportunities (collapsed detail) ---------- */}
      {opportunities.length > 0 && (
        <Collapsible
          title="More ways to save"
          summary={`${opportunities.length} optional move${opportunities.length > 1 ? "s" : ""} that could lower your tax`}
          className="mt-2"
        >
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
            {opportunities.map((o) => (
              <Card as="div" key={o.id} className={`border-l-4 ${oppBorder(o.tone)}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg">{o.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{o.title}</div>
                    {o.impact && (
                      <div className="mt-0.5">
                        <Pill tone={o.tone === "warn" ? "tax" : "gain"}>{o.impact}</Pill>
                      </div>
                    )}
                    <p className="mt-1.5 text-[13px] text-foreground/70">{o.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {o.sources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-primary underline decoration-primary/30 underline-offset-2"
                        >
                          {s.label} ↗
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Collapsible>
      )}

      {/* ---------- Deep detail — desktop-only. The phone keeps the Plan tab to the
           action (your move, the order, what's coming); the source/income donuts and
           the full tax breakdown are richest on a larger screen. ---------- */}
      <DesktopOnly
        mobileNote={
          <Card className="mt-2">
            <p className="text-[13px] leading-relaxed text-foreground/65">
              📊 The detailed breakdowns — where each dollar comes from, your full income picture, and the line-by-line
              tax math — are on the <strong>desktop version</strong>. Open this on a laptop to see them.
            </p>
          </Card>
        }
      >
      <SectionTitle>The full tax math</SectionTitle>
      <Explainer>Where each dollar comes from, your full income picture, and the line-by-line tax bill — the complete detail behind the numbers above.</Explainer>
      {/* ---------- Source donut ---------- */}
      <p className="mb-2 mt-4 text-[13px] font-semibold text-foreground/70">Where the money comes from</p>
      <Explainer>Each slice is an account we&apos;d draw on to fund your spending this year.</Explainer>
      <Card>
        {totalDraw > 0.5 ? (
          <>
            <Donut
              segments={sourceSegments}
              centerTop="Withdrawn"
              centerMain={moneyCompact(totalDraw)}
              centerSub="this year"
            />
            <Legend segments={sourceSegments} total={totalDraw} />
          </>
        ) : (
          <p className="text-sm text-foreground/70">
            Your Social Security, pension, dividends{plan.rmd > 0 ? " and required RMD" : ""} already cover
            this year&apos;s spending — no extra withdrawals needed.
          </p>
        )}
      </Card>

      {/* ---------- Tax bill ---------- */}
      <SectionTitle>What you&apos;ll owe in tax</SectionTitle>
      <Explainer>
        Your <em>effective</em>{" "}rate is your average across all income. Your <em>marginal</em>{" "}rate is what
        the very next dollar would be taxed at.
      </Explainer>
      <Card>
        <div className="grid grid-cols-2 gap-y-4">
          <Stat label="After-tax spending" value={money(plan.spendingTarget)} />
          <Stat label="Est. tax (fed + IL)" tone="tax" value={<AnimatedNumber value={plan.tax.totalTax} />} />
          <Stat label="Effective rate" value={percent(plan.tax.effectiveRate)} />
          <Stat label="Marginal rate" value={percent(plan.tax.marginalOrdinaryRate, 0)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {plan.rmd > 0 && <Pill tone="deferred">RMD {money(plan.rmd)}</Pill>}
          <Pill tone="ss">
            SS taxable {plan.fixed.socialSecurity > 0 ? percent(plan.tax.taxableSocialSecurity / plan.fixed.socialSecurity, 0) : "0%"}
          </Pill>
          <Pill tone="taxable">Investment-gains tax {percent(plan.tax.capitalGainsRate, 0)}</Pill>
          {plan.tax.niit > 0 && <Pill tone="tax">Extra 3.8% tax {money(plan.tax.niit)}</Pill>}
          <Pill tone={plan.tax.irmaa.perPerson > 0 ? "tax" : "gain"}>{plan.tax.irmaa.label}</Pill>
        </div>
        <Info q="Effective vs. marginal rate — what's the difference?" sources={[SOURCES.brackets2026]}>
          Tax brackets are tiers, so not every dollar is taxed the same. Your <strong>effective rate</strong>{" "}is
          the average across <em>all</em>{" "}your income ({percent(plan.tax.effectiveRate)} here) — the most honest
          measure of your tax burden. Your <strong>marginal rate</strong>{" "}({percent(plan.tax.marginalOrdinaryRate, 0)})
          is what only the <em>next</em>{" "}dollar of ordinary income would be taxed at. Aiming for a low effective
          rate over your lifetime is the real goal.
        </Info>
        <Info q="What do these colored tags mean?" sources={[SOURCES.ssTax, SOURCES.capGains, SOURCES.niit, SOURCES.irmaa]}>
          <ul className="space-y-1">
            <li><strong>SS taxable</strong>: the share of your Social Security that counts as taxable income (0–85%).</li>
            <li><strong>Investment-gains tax</strong>: the rate on your long-term investment gains (0%, 15%, or 20%).</li>
            <li><strong>Extra 3.8% tax</strong> (NIIT): an extra 3.8% on investment income once income tops $250k (joint).</li>
            <li><strong>IRMAA</strong>: which Medicare premium tier this income lands in — higher income = higher Part B/D premiums two years later.</li>
          </ul>
        </Info>
        {plan.tax.irmaa.perPerson > 0 && (
          <Info q="Should I be afraid of this IRMAA surcharge?" sources={[SOURCES.irmaa]}>
            You&apos;re in an IRMAA tier — about <strong>{money(plan.tax.irmaa.householdAnnual)}/yr</strong>{" "}in extra
            Medicare premiums for the couple, two years out. It feels scary because it&apos;s a cliff, but it&apos;s a
            relatively small, fixed cost. Avoiding it is only worth it if dodging income now doesn&apos;t cost you more
            in growth or bigger forced taxes later. If your goal is the biggest nest egg, check the{" "}
            <strong>Compare</strong>{" "}tab — if the higher-income plan still ends with more after-tax money, the surcharge
            is worth paying and you shouldn&apos;t contort your plan to avoid it.
          </Info>
        )}
      </Card>

      {/* ---------- Full income picture ---------- */}
      <SectionTitle>Full income picture</SectionTitle>
      <Explainer>Everything the IRS counts as income this year, and how it turns into your tax bill, line by line.</Explainer>
      <Card>
        <Donut
          segments={incomeSegments}
          size={168}
          thickness={20}
          centerTop="Gross income"
          centerMain={moneyCompact(plan.grossInflow)}
        />
        <Legend segments={incomeSegments} total={plan.grossInflow} />
        <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13px]">
          <Row label="Adjusted gross income (AGI)" value={money(plan.tax.agi)} />
          <Row label="Taxable Social Security" value={money(plan.tax.taxableSocialSecurity)} />
          <Row label="Deductions" value={`− ${money(plan.tax.deductions)}`} />
          <Row label="Taxable income" value={money(plan.tax.taxableIncome)} bold />
          <Row label="Ordinary income tax" value={money(plan.tax.ordinaryTax)} />
          <Row label="Capital gains tax" value={money(plan.tax.capitalGainsTax)} />
          {plan.tax.niit > 0 && <Row label="Net investment income tax" value={money(plan.tax.niit)} />}
          <Row label="Federal tax" value={money(plan.tax.federalTax)} />
          <Row label={`${plan.tax.state.stateName} state tax (${percent(plan.tax.state.rate, 2)})`} value={money(plan.tax.stateTax)} />
          <Row label="Total tax (federal + state)" value={money(plan.tax.totalTax)} bold tone="tax" />
        </div>
        {plan.tax.state.state === "IL" && (
          <p className="mt-3 rounded-xl bg-gain/5 px-3 py-2 text-[12px] text-foreground/65">
            🟢 Illinois taxes only your investment income (interest, dividends, capital gains) at a flat 4.95% — your
            IRA/401(k) withdrawals, RMDs, Roth conversions, pension, and Social Security are all <strong>state-tax-free</strong>.
          </p>
        )}
      </Card>
      </DesktopOnly>

      {/* ---------- Advanced: tune the strategy yourself (collapsed by default) ---------- */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
        className="press mt-6 flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground/70"
      >
        <span>⚙️ Advanced: how the withdrawal method works</span>
        <span className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {showAdvanced && (
      <div className="rise mt-2">
      <Explainer>
        A &quot;strategy&quot; is just the <em>order</em>{" "}we pull money from your accounts — it&apos;s a method, not a
        dollar amount or a tax rate. The robo-advisor already picks this for your goal; you can override it on the
        walkthrough&apos;s goal step.
      </Explainer>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {STRATEGIES.map((s) => (
              <span
                key={s}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium ${
                  settings.strategy === s ? "bg-primary text-white" : "border border-border bg-card text-foreground/40"
                }`}
              >
                {settings.strategy === s ? "✓ " : ""}
                {STRATEGY_META[s].label}
              </span>
            ))}
          </div>
          <AdjustLink step="goal" />
        </div>
        <p className="mt-2 text-[13px] font-medium text-foreground/70">{STRATEGY_SHORT[settings.strategy]}</p>
        <p className="mt-1 text-[12px] text-foreground/55">{STRATEGY_META[settings.strategy].blurb}</p>

        <Info q="What does &quot;Smart (bracket-fill)&quot; actually mean?" sources={[SOURCES.brackets2026, SOURCES.rmd, SOURCES.rothConversion]}>
          <p className="mb-1.5">
            It&apos;s a <strong>method for choosing which accounts to draw from</strong>{" "}— not a number, a total,
            or a tax rate. Each year it:
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Takes any <strong>required</strong>{" "}withdrawal (RMD) first.</li>
            <li>Then <strong>tops up</strong>{" "}with pre-tax dollars only until you reach the top of a low tax bracket you choose (e.g. 22%).</li>
            <li>Covers the rest from your brokerage.</li>
            <li>Leaves tax-free Roth for last.</li>
          </ol>
          <p className="mt-1.5">
            The point: deliberately pay a little tax now at a <em>low</em>{" "}rate so you don&apos;t get hit with
            large, highly-taxed forced withdrawals later. It usually produces the lowest <em>lifetime</em>{" "}tax —
            which the Scenarios page lets you verify against the alternatives.
          </p>
        </Info>

        {settings.strategy === "smart" && (
          <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
            <div className="text-[13px] font-semibold">Fill pre-tax up to this tax bracket</div>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/60">
              Your income is taxed in tiers called brackets. This control sets the <strong>highest rate
              you&apos;re willing to pay</strong>{" "}to voluntarily pull extra pre-tax money now. We add pre-tax
              withdrawals until your taxable income reaches the top of the bracket you pick, then stop and use
              other accounts. Pick a higher bracket to move more out now (more tax today, smaller forced
              withdrawals later). <strong>This is not your overall tax rate.</strong>
            </p>
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {BRACKETS.map((b) => (
                <span
                  key={b}
                  className={`rounded-xl border py-2 text-center ${
                    settings.bracketTarget === b
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground/40"
                  }`}
                >
                  <div className="text-sm font-bold">{settings.bracketTarget === b ? "✓ " : ""}{Math.round(b * 100)}%</div>
                  <div className="text-[9px] leading-tight text-foreground/45">
                    to {moneyCompact(ordinaryBracketCeiling(b))}
                  </div>
                </span>
              ))}
            </div>
            <div className="mt-2 text-right">
              <AdjustLink step="goal" label="Change bracket" />
            </div>
            <p className="mt-2 text-[11px] text-foreground/55">
              Filling to <strong>{percent(settings.bracketTarget, 0)}</strong>{" "}means we keep pulling pre-tax
              dollars until your taxable income reaches about{" "}
              <strong>{money(ordinaryBracketCeiling(settings.bracketTarget))}</strong>, then switch to other
              accounts.
            </p>
            <Info q="Show me an example of what this does" sources={[SOURCES.brackets2026, SOURCES.rothConversion]}>
              <p className="mb-1.5">
                Say your other income leaves room in the 12% bracket. Picking <strong>12%</strong>{" "}tells the
                planner: &quot;pull pre-tax money until I&apos;ve used up the 12% bracket, then stop.&quot; Those
                dollars are taxed at just 12%.
              </p>
              <p>
                Pick <strong>24%</strong>{" "}instead and it pulls more pre-tax now — taxed up to 24% today, but it
                shrinks the pre-tax balance that would later be force-withdrawn (RMDs) and possibly taxed even
                higher. So the cards aren&apos;t your tax rate — they&apos;re the <em>ceiling</em>{" "}you let
                voluntary pre-tax withdrawals reach. Higher = more out now, less forced out later.
              </p>
            </Info>
          </div>
        )}

        <Link
          href="/scenarios"
          className="press mt-4 block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary"
        >
          Compare strategies over your whole life →
        </Link>
      </Card>
      </div>
      )}
      </div>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function oppBorder(tone: "good" | "warn" | "info"): string {
  return tone === "warn" ? "border-l-tax" : tone === "good" ? "border-l-gain" : "border-l-ss";
}

function Row({ label, value, bold, tone }: { label: string; value: ReactNode; bold?: boolean; tone?: "tax" }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? "font-semibold" : "text-foreground/65"}`}>{label}</span>
      <span className={`tabular ${bold ? "font-semibold" : ""} ${tone === "tax" ? "text-tax" : ""}`}>{value}</span>
    </div>
  );
}

/** Friendly age label, e.g. 67 → "67", 66.833 → "66 yr 10 mo". */
function fmtAgePlan(years: number): string {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  return months === 0 ? `${whole}` : `${whole} yr ${months} mo`;
}

const clampClaim = (a: number) => Math.min(CLAIM_MAX, Math.max(CLAIM_MIN, Math.round(a)));

/** Social Security claim-timing: per-spouse benefit by claim age, the early-death
 *  breakeven, and the couple's survivor-benefit angle. */
function SsTiming({
  household,
  year,
}: {
  household: Household;
  year: number;
}) {
  const { settings } = useStore();
  const anyBenefit = household.self.socialSecurityAnnual > 0 || household.spouse.socialSecurityAnnual > 0;
  const higher =
    household.self.socialSecurityAnnual >= household.spouse.socialSecurityAnnual ? household.self : household.spouse;

  return (
    <>
      <SectionTitle>Social Security: when to claim</SectionTitle>
      <Explainer>
        Claiming later means a bigger check for life (about +8%/yr after full retirement, up to age 70) — but you
        collect nothing while you wait. Here&apos;s the trade-off for each of you. You pick the claim ages in the walkthrough.
      </Explainer>
      <div className="mb-2 flex justify-end">
        <AdjustLink step="ssclaim" label="Adjust claim ages" />
      </div>

      {(["self", "spouse"] as const).map((who) => {
        const p = household[who];
        const fra = fullRetirementAge(p.birthYear);
        const claim = clampClaim(p.ssClaimAge);

        if (p.socialSecurityAnnual <= 0) {
          return (
            <Card key={who} className="mb-2">
              <div className="font-semibold">{p.label}</div>
              <p className="mt-1 text-[12px] text-foreground/60">
                Add {p.label}&apos;s full-retirement benefit on the Accounts tab to compare claim ages.
              </p>
            </Card>
          );
        }

        const benefit = adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, claim);
        const pct = ssBenefitFactor(p.birthYear, claim);
        const fraInt = Math.round(fra);
        const opts = Array.from(new Set([62, fraInt, 70])).sort((a, b) => a - b);

        return (
          <Card key={who} className="mb-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.label}</span>
              <span className="text-[11px] text-foreground/55">full retirement age {fmtAgePlan(fra)}</span>
            </div>

            <div className="mt-2 flex items-baseline justify-between rounded-xl border border-border bg-background/60 px-3 py-2">
              <span className="text-[12px] font-medium text-foreground/60">
                Claiming at age <strong className="text-foreground">{claim}</strong>
              </span>
              <span className="tabular text-xl font-bold text-ss">{money(Math.round(benefit / 12))}/mo</span>
            </div>
            <div className="mt-1 text-right text-[12px] text-foreground/60">
              {money(benefit)}/yr · {percent(pct, 0)} of full
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {opts.map((a) => {
                const b = adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, a);
                const active = a === claim;
                return (
                  <div
                    key={a}
                    className={`rounded-xl border py-2 text-center ${
                      active ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/55"
                    }`}
                  >
                    <div className="text-[12px] font-semibold">Age {a}{a === fraInt ? "*" : ""}</div>
                    <div className="tabular text-[13px] font-bold">{money(Math.round(b / 12))}</div>
                    <div className="text-[9px] text-foreground/45">/mo</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-foreground/45">* full retirement age</p>
          </Card>
        );
      })}

      {anyBenefit && (
        <Callout tone="info" icon="⏳" title="Is waiting worth it? (the 'die early' risk)">
          {(() => {
            const be = breakevenAge(higher.socialSecurityAnnual, higher.birthYear, 62, 70);
            return (
              <>
                Waiting trades smaller checks now for bigger checks later. For {higher.label}, claiming at 70 instead of
                62{" "}
                {be ? (
                  <>
                    breaks even around <strong>age {Math.round(be)}</strong>
                  </>
                ) : (
                  <>doesn&apos;t change the benefit</>
                )}
                . Live past that and waiting wins; pass away earlier and claiming early collected more total cash. (Nominal
                dollars, no COLA or investment growth modeled — so treat it as a rule of thumb.)
              </>
            );
          })()}
        </Callout>
      )}

      {anyBenefit && (
        <Callout tone="good" icon="❤️" title="The couple angle: survivor benefit">
          When one of you passes, the survivor keeps only the <strong>larger</strong>{" "}of your two Social Security checks —
          the smaller one stops. So delaying the higher earner&apos;s claim ({higher.label}) permanently raises the
          benefit that lasts as long as <em>either</em>{" "}of you lives. With both of you near the same age, that survivor
          protection is often the strongest reason for the higher earner to wait.
          {settings.survivorModel && (
            <span className="mt-2 block rounded-lg bg-tax/5 px-2.5 py-1.5 text-[12px] text-foreground/75">
              🕊️ The tax side bites too: the survivor files <strong>single</strong> — brackets and the standard deduction
              roughly halve — so the same RMDs are taxed harder. Your forecast models this from age {settings.firstDeathAge},
              which is a big reason converting to Roth while you&apos;re both alive (wide joint brackets) pays off.
            </span>
          )}
          <div className="mt-2">
            <a
              href={SOURCES.ssSurvivor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-primary underline decoration-primary/30 underline-offset-2"
            >
              {SOURCES.ssSurvivor.label} ↗
            </a>
          </div>
        </Callout>
      )}

      <Info q="How claim age changes your check (the SSA rules)" sources={[SOURCES.ssClaimEarly, SOURCES.ssDelayed]}>
        Your full benefit is set at your Full Retirement Age (~67, a bit earlier if born before 1960). Claim as early as
        62 and it&apos;s permanently reduced — roughly 25–30% less. Wait past full retirement and you earn delayed-retirement
        credits of about 8% per year up to age 70 (no benefit to waiting beyond 70). The amount you enter on the Accounts
        tab is your full-retirement benefit; this control adjusts it.
      </Info>
    </>
  );
}

/** Small metric tile used inside the robo-advisor callouts. */
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "tax" | "deferred" }) {
  const color =
    tone === "gain" ? "text-gain" : tone === "tax" ? "text-tax" : tone === "deferred" ? "text-deferred" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card/60 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-foreground/50">{label}</div>
      <div className={`tabular text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

/** Goal picker (robo-advisor) + the plan it recommends for that goal. */
function GoalAndRecommendation() {
  const { household, settings, updateSettings } = useStore();
  const inputs = {
    returnRate: settings.returnRate,
    inflationRate: settings.inflationRate,
    endAge: settings.endAge,
    convertUntilAge: settings.convertUntilAge,
    survivor: survivorFromSettings(settings),
    heirTaxRate: settings.heirTaxRate,
  };
  const rec = useMemo(
    () => recommendPlan(household, inputs, settings.goal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household, settings],
  );
  // Monte-Carlo "plan confidence" for the recommended plan. Run ASYNCHRONOUSLY
  // (off the render path) so the ~1s, 600-run simulation never freezes the UI;
  // keyed on only the inputs that change the math, so display-only toggles (e.g.
  // today's-dollars) don't retrigger it.
  const confKey = JSON.stringify({
    st: rec.best.config.strategy,
    bt: rec.best.config.bracketTarget,
    uc: rec.best.config.useConversions,
    cm: rec.best.config.convertMode,
    rr: settings.returnRate,
    ir: settings.inflationRate,
    ea: settings.endAge,
    cua: settings.convertUntilAge,
    sm: settings.survivorModel,
    fda: settings.firstDeathAge,
    htr: settings.heirTaxRate,
    sp: settings.spendingStrategy,
  });
  const [confidence, setConfidence] = useState<MonteCarloResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    computeMonteCarlo({
      kind: "mc",
      household,
      assumptions: {
        strategy: rec.best.config.strategy,
        bracketTarget: rec.best.config.bracketTarget,
        returnRate: settings.returnRate,
        inflationRate: settings.inflationRate,
        endAge: settings.endAge,
        convert: rec.best.config.useConversions
          ? { untilAge: settings.convertUntilAge, mode: rec.best.config.convertMode }
          : null,
        survivor: survivorFromSettings(settings),
        heirTaxRate: settings.heirTaxRate,
        spendingStrategy: settings.spendingStrategy,
        dividendMode: settings.dividendMode,
      },
      model: returnModel(household.accounts),
      // 1,000 runs + fixed seed → matches the Forecast tab's confidence number
      // exactly for the same plan (no visually-disagreeing percentages).
      runs: 1000,
    }).then((res) => {
      if (!cancelled) setConfidence(res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household, confKey]);
  const matches =
    configMatches(
      {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        useConversions: settings.useConversions,
        convertMode: settings.convertMode,
      },
      rec.best.config,
    ) &&
    // The conversion WINDOW isn't part of PlanConfig, so compare it here: a rollover
    // through 75 is a different plan than through 80. Only then is "✓ active
    // everywhere" truthful. rec.best.metrics are computed at chosenConvertUntilAge.
    (!settings.useConversions || settings.convertUntilAge === rec.chosenConvertUntilAge);

  const applyGoal = (goal: GoalId) => {
    const r = recommendPlan(household, inputs, goal);
    updateSettings({
      goal,
      planCustomized: false,
      strategy: r.best.config.strategy,
      bracketTarget: r.best.config.bracketTarget,
      useConversions: r.best.config.useConversions,
      convertMode: r.best.config.convertMode,
      convertUntilAge: r.chosenConvertUntilAge,
    });
  };

  return (
    <>
      <SectionTitle>Your goal</SectionTitle>
      <Explainer>
        Tell the planner what matters most. It simulates your options across your whole life and picks the plan that
        wins for that goal — then lays out exactly what to do.
      </Explainer>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="text-2xl leading-none">{GOAL_META[settings.goal].icon}</span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-primary">{GOAL_META[settings.goal].short}</div>
              <div className="text-[12px] leading-snug text-foreground/60">{GOAL_META[settings.goal].blurb}</div>
            </div>
          </div>
          <AdjustLink step="goal" />
        </div>
      </Card>

      <Callout tone="good" icon="🤖" title="Your recommended plan" className="mt-2">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground/85">{planGist(rec.best.config)}</span>
          {confidence ? (
            <Pill tone={confidence.successPct >= 0.8 ? "gain" : confidence.successPct >= 0.6 ? "ss" : "tax"}>
              {Math.round(confidence.successPct * 100)}% confidence ({Math.round(confidence.successCI[0] * 100)}–{Math.round(confidence.successCI[1] * 100)}%)
            </Pill>
          ) : (
            <Pill tone="ss">calculating confidence…</Pill>
          )}
        </div>
        <p className="-mt-0.5 mb-1 text-[11px] text-foreground/45">
          Technical version: {describePlan(rec.best.config, rec.chosenConvertUntilAge)}.
        </p>
        <p className="mt-1">{rec.rationale}</p>
        {rec.claimAdvice && (
          <p className="mt-2 rounded-xl bg-gain/10 px-3 py-2 text-[12px] leading-relaxed text-gain">
            📈 Bigger lever: claiming Social Security at{" "}
            <strong>
              {rec.claimAdvice.self}
              {rec.claimAdvice.delayWho === "both" ? ` / ${rec.claimAdvice.spouse}` : ""}
            </strong>{" "}
            (vs {rec.claimAdvice.currentSelf}
            {rec.claimAdvice.delayWho === "both" ? ` / ${rec.claimAdvice.currentSpouse}` : ""}) is projected to leave about{" "}
            <strong>{moneyCompact(rec.claimAdvice.lift)}</strong>{" "}more over your lifetime — set claim ages in the &ldquo;Social Security: when to claim&rdquo; section above.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniStat label="After-tax wealth" value={moneyCompact(rec.best.metrics.netWealth)} tone="gain" />
          <MiniStat label="Lifetime tax" value={moneyCompact(rec.best.metrics.lifetimeTax)} tone="tax" />
          <MiniStat label="Lifetime Medicare (IRMAA)" value={moneyCompact(rec.best.metrics.lifetimeIrmaa)} tone="tax" />
          <MiniStat label="Peak RMD" value={moneyCompact(rec.best.metrics.peakRmd)} tone="deferred" />
        </div>
        <Info q="What does “confidence” mean?">
          {confidence ? (
            <>
              In {confidence.runs.toLocaleString()} simulations of randomized market returns (about {percent(returnModel(household.accounts).volatility, 0)} volatility for your
              mix), this plan funded your full spending to age {settings.endAge} in <strong>{Math.round(confidence.successPct * 100)}%</strong> of
              them. Median money left: {moneyCompact(confidence.endingWealth.p50)}; an unlucky run (10th percentile) leaves{" "}
              {moneyCompact(confidence.endingWealth.p10)}. Returns are modeled as independent draws — directional, not a guarantee.
            </>
          ) : (
            <>Running the market-risk simulation…</>
          )}
        </Info>
        {matches ? (
          <p className="mt-3 text-[12px] font-medium text-gain">✓ This is your plan — active everywhere, automatically.</p>
        ) : (
          <p className="mt-3 text-[12px] leading-relaxed text-foreground/60">
            Your active plan differs because you adjusted the rollover yourself.{" "}
            <button
              onClick={() => applyGoal(settings.goal)}
              className="press font-semibold text-primary underline underline-offset-2"
            >
              Switch back to the recommended plan
            </button>
          </p>
        )}
      </Callout>
    </>
  );
}

function actionColor(kind: PlanAction["kind"]): string {
  switch (kind) {
    case "rmd":
    case "pretax":
      return HEX.deferred;
    case "convert":
    case "roth":
      return HEX.roth;
    case "taxable":
      return HEX.taxable;
    default:
      return HEX.gain;
  }
}

/** "Looking ahead" — the next several years of concrete actions. */
function LookingAhead() {
  const { household, settings } = useStore();
  const proj = useMemo(
    () =>
      projectLifetime(household, {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        returnRate: settings.returnRate,
        inflationRate: settings.inflationRate,
        endAge: settings.endAge,
        convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
        survivor: survivorFromSettings(settings),
        spendingStrategy: settings.spendingStrategy,
        dividendMode: settings.dividendMode,
        heirTaxRate: settings.heirTaxRate,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      household,
      settings.strategy,
      settings.bracketTarget,
      settings.returnRate,
      settings.inflationRate,
      settings.endAge,
      settings.spendingStrategy,
      settings.heirTaxRate,
      settings.useConversions,
      settings.convertMode,
      settings.convertUntilAge,
    ],
  );
  const years = useMemo(() => buildActionPlan(household, proj, 6), [household, proj]);
  if (years.length === 0) return null;

  return (
    <>
      <SectionTitle hint={`next ${years.length} years`}>The next few years</SectionTitle>
      <Explainer>
        What to actually do each year, so you can plan around it{settings.useConversions ? ", including the Roth rollovers" : ""}.
        It re-runs whenever you change your goal, spending, or assumptions.
      </Explainer>
      <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {years.map((y, i) => (
          <Card as="div" key={y.year} className={i === 0 ? "border-primary/40" : ""}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {y.year} <span className="text-foreground/50">· age {y.selfAge}/{y.spouseAge}</span>
              </span>
              <span className="tabular text-[12px] text-foreground/55">est. tax {moneyCompact(y.tax)}</span>
            </div>
            {y.events.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {y.events.map((e, j) => (
                  <Pill key={j} tone="ss">
                    🔔 {e}
                  </Pill>
                ))}
              </div>
            )}
            <ul className="mt-2 space-y-1">
              {y.actions.map((a, j) => (
                <li key={j} className="flex items-start gap-2 text-[13px]">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: actionColor(a.kind) }}
                  />
                  <span className="text-foreground/75">{a.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <Link
        href="/projection"
        className="press mt-3 block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary"
      >
        See the full year-by-year detail in the Forecast tab →
      </Link>
    </>
  );
}

/** Through-age control for the rollover window. */
function ConvertUntilControl({
  settings,
  updateSettings,
}: {
  settings: PlannerSettings;
  updateSettings: (p: Partial<PlannerSettings>) => void;
}) {
  const opts = [70, 73, 75, 80];
  return (
    <div>
      <div className="text-[11px] font-medium text-foreground/55">Keep rolling through age</div>
      <div className="mt-1 grid grid-cols-4 gap-2">
        {opts.map((a) => (
          <button
            key={a}
            onClick={() => updateSettings({ convertUntilAge: a })}
            className={`press rounded-lg border py-1.5 text-center text-[13px] font-semibold ${
              settings.convertUntilAge === a ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"
            }`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The RMD tax-bomb explainer + the Roth-conversion plan that defuses it. */
function RolloverPlanCard() {
  const { household, settings } = useStore();
  const conv = useMemo(
    () =>
      analyzeConversions(household, {
        strategy: "smart",
        bracketTarget: settings.bracketTarget,
        returnRate: settings.returnRate,
        inflationRate: settings.inflationRate,
        endAge: settings.endAge,
        convertUntilAge: settings.convertUntilAge,
        mode: settings.convertMode,
        survivor: survivorFromSettings(settings),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household, settings],
  );

  // Only worth showing if there's a real pre-tax balance and a conversion to make.
  if (conv.pretaxShare < 0.25 || conv.totalConverted < 5_000) return null;

  const helps = conv.estateGain > 0;

  return (
    <>
      <SectionTitle>Roth conversions: pay a little tax now to cut future RMDs</SectionTitle>
      <Explainer>
        {Math.round(conv.pretaxShare * 100)}% of your money is pre-tax, so big required withdrawals later can push you into a
        higher bracket. The fix: move a little to Roth now, while you&apos;re in a low bracket — that smooths your income and
        lowers your <em>lifetime</em> tax.
      </Explainer>
      <Callout
        tone={conv.recommended ? "good" : "info"}
        icon="🧭"
        title={conv.recommended ? "Recommended: smooth some into Roth each year" : "Consider smoothing some into Roth"}
      >
        <p>
          Rolling about <strong>{money(conv.avgAnnualConversion)}/yr</strong> through <strong>{conv.windowEndYear}</strong>{" "}
          (≈{money(conv.totalConverted)} in total) cuts your worst-year RMD from{" "}
          <strong className="text-tax">{money(conv.peakRmdBaseline)}</strong> down to{" "}
          <strong className="text-gain">{money(conv.peakRmdWithConversions)}</strong>.
        </p>
        {(household.state ?? "IL") === "IL" && (
          <p className="mt-2 rounded-lg bg-gain/10 px-2.5 py-1.5 text-[12px] text-gain">
            🟢 In Illinois the rollover itself is <strong>state-tax-free</strong> — you only owe federal tax to convert,
            which makes converting more attractive here than in most states.
          </p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="Peak RMD cut" value={moneyCompact(conv.peakRmdReduction)} tone="gain" />
          <MiniStat
            label={helps ? "After-tax gain" : "After-tax change"}
            value={(helps ? "+" : "") + moneyCompact(conv.estateGain)}
            tone={helps ? "gain" : "tax"}
          />
          <MiniStat
            label="Lifetime tax"
            value={(conv.lifetimeTaxDelta >= 0 ? "+" : "−") + moneyCompact(Math.abs(conv.lifetimeTaxDelta))}
            tone={conv.lifetimeTaxDelta <= 0 ? "gain" : "tax"}
          />
        </div>
        <p className="mt-3 text-[12px] text-foreground/65">
          {helps
            ? "Even after paying some tax now, you end up with more after-tax money AND a much smaller forced-RMD tax bomb later."
            : "This trades a little lifetime tax for a much smaller forced-RMD spike and more tax-free Roth — useful if you value flexibility and lower late-life taxable income."}
        </p>
        <div className="mt-3 rounded-xl border border-border bg-background/60 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">
                {settings.useConversions ? (
                  <span className="text-gain">✓ Rollover plan is on</span>
                ) : (
                  <span className="text-foreground/60">Rollover plan is off</span>
                )}
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-foreground/55">
                {settings.useConversions
                  ? `${settings.convertMode === "recommended" ? "Recommended sizing" : `Fill the ${percent(settings.bracketTarget, 0)} bracket`} · through age ${settings.convertUntilAge}`
                  : "You decide whether to roll pre-tax money to Roth in the walkthrough."}
              </div>
            </div>
            <AdjustLink step="rollconfirm" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {[SOURCES.rothConversion, SOURCES.rmd, SOURCES.rothNoRmd].map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-primary underline decoration-primary/30 underline-offset-2"
            >
              {s.label} ↗
            </a>
          ))}
        </div>
      </Callout>
      <Info q="Why pay tax now to save later? (the tax-bomb logic)" sources={[SOURCES.rothConversion, SOURCES.rmd, SOURCES.rothNoRmd]}>
        <p className="mb-1.5">
          A big pre-tax balance isn&apos;t really &quot;yours&quot; — a chunk is a deferred IRS bill. Starting at age
          73–75 the IRS forces you to withdraw a rising percentage every year (RMDs), all taxed as ordinary income,
          whether you need the cash or not. Stacked on Social Security, those forced withdrawals can push you into higher
          brackets and trigger Medicare (IRMAA) surcharges.
        </p>
        <p>
          Rolling money to Roth in your low-bracket years pays tax now at a <em>known, low</em> rate, permanently shrinks
          those future forced withdrawals, and the Roth then grows tax-free with <strong>no RMDs ever</strong>. The
          numbers above are run on your actual accounts — if rolling didn&apos;t help, this card would say so.
        </p>
      </Info>
    </>
  );
}
