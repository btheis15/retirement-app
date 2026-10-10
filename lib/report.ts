/**
 * The quarterly client report — every number the advisor-style PDF shows, built
 * in one pass from the SAME engine calls the Plan tab uses (lib/planContext).
 * The document component (components/ClientReport.tsx) only formats this.
 *
 * Monte Carlo is run separately on the worker and passed in alongside.
 *
 * Pure: no React. ⚠️ Educational estimates only — not tax advice.
 */

import { Account, Household, Holding, ageInYear, bucketOf, holdingValue, sumBuckets, BucketTotals, ACCOUNT_KIND_META } from "./accounts";
import { PlannerSettings } from "./defaults";
import { buildPlanContext, conversionImpact, ConversionImpact, PlanContext } from "./planContext";
import { buildChecklist, ChecklistItem } from "./checklist";
import { buildIrmaaStatus, IrmaaStatus, irmaaRoomPhrase } from "./irmaaStatus";
import { buildYearPace, YearPace } from "./pace";
import { projectLifetime, ProjectionRow } from "./projection";
import { StrategyId, STRATEGY_META } from "./optimizer";
import { detectMilestones, Milestone } from "./milestones";
import { detectOpportunities, Opportunity } from "./opportunities";
import { runStressTests, StressResult } from "./stressTest";
import { buildActionPlan, PlanYear } from "./actionPlan";
import { returnModel, ReturnModel } from "./returns";
import { adjustedAnnualBenefit, breakevenAge, fullRetirementAge, CLAIM_MIN, CLAIM_MAX } from "./socialSecurity";
import { rmdStartAge } from "./tax/constants";
import { GOAL_META } from "./goals";
import { AgendaContext, AgendaItem, nextQuarter, Quarter, quarterAgenda, quarterOf } from "./quarterly";

export interface ReportPerson {
  who: "self" | "spouse";
  name: string;
  birthYear: number;
  age: number;
  fra: number;
  claimAge: number;
  /** Benefit at full retirement age (annual). */
  pia: number;
  /** Annual benefit at the chosen claim age. */
  chosenAnnual: number;
  claimYear: number;
  started: boolean;
  /** Annual benefit at each whole claim age 62–70. */
  byAge: { age: number; annual: number }[];
  /** Age when claiming at 70 overtakes claiming at 62 in cumulative dollars. */
  breakeven62v70: number | null;
  rmdStartAge: number;
  rmdStartYear: number;
}

export interface ReportAccount {
  account: Account;
  owner: string;
  typeLabel: string;
  bucket: "pretax" | "roth" | "taxable";
  unrealizedGain: number | null;
  holdings: (Holding & { value: number; gain: number | null })[];
}

export interface StrategyRow {
  id: StrategyId;
  label: string;
  lifetimeTax: number;
  estateAfterTax: number;
  depleted: boolean;
  active: boolean;
}

export interface ReportData {
  now: Date;
  quarter: Quarter;
  next: Quarter;
  ctx: PlanContext;
  names: string;
  hasSpouse: boolean;
  people: ReportPerson[];
  stateLabel: string;
  isIL: boolean;
  goalLabel: string;
  goalBlurb: string;
  strategyLabel: string;
  strategyBlurb: string;
  buckets: BucketTotals;
  total: number;
  mix: ReturnModel;
  accounts: ReportAccount[];
  totalUnrealizedGain: number;
  todo: ChecklistItem[];
  irmaa: IrmaaStatus | null;
  pace: YearPace;
  conv: ConversionImpact | null;
  convSchedule: { year: number; age: number; amount: number; marginalRate: number; irmaaLabel: string }[];
  strategies: StrategyRow[];
  milestones: Milestone[];
  opportunities: Opportunity[];
  stress: StressResult[];
  lookAhead: PlanYear[];
  rows: ProjectionRow[];
  agenda: AgendaItem[];
  nextAgenda: AgendaItem[];
  /** % to withhold on pre-tax withdrawals to cover the year's tax (null → estimates). */
  withholdPct: number | null;
  withdrawalRate: number;
}

export function buildReport(household: Household, settings: PlannerSettings, now: Date): ReportData {
  const year = now.getFullYear();
  const ctx = buildPlanContext(household, settings, year);
  const { plan, planConv, activeProj, filingStatus, yearTaxTotal } = ctx;
  const hasSpouse = !!household.spouse && household.spouse.birthYear > 1900;
  const nameOf = (who: "self" | "spouse") => household[who].label || (who === "self" ? "You" : "Spouse");

  // ---- People & Social Security ----
  const people: ReportPerson[] = (["self", "spouse"] as const)
    .filter((w) => w === "self" || hasSpouse)
    .map((who) => {
      const p = household[who];
      const byAge: { age: number; annual: number }[] = [];
      for (let a = CLAIM_MIN; a <= CLAIM_MAX; a++) byAge.push({ age: a, annual: adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, a) });
      return {
        who,
        name: nameOf(who),
        birthYear: p.birthYear,
        age: ageInYear(p.birthYear, year),
        fra: fullRetirementAge(p.birthYear),
        claimAge: p.ssClaimAge,
        pia: p.socialSecurityAnnual,
        chosenAnnual: adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, p.ssClaimAge),
        claimYear: p.birthYear + p.ssClaimAge,
        started: ageInYear(p.birthYear, year) >= p.ssClaimAge,
        byAge,
        breakeven62v70: p.socialSecurityAnnual > 0 ? breakevenAge(p.socialSecurityAnnual, p.birthYear, 62, 70) : null,
        rmdStartAge: rmdStartAge(p.birthYear),
        rmdStartYear: p.birthYear + rmdStartAge(p.birthYear),
      };
    });

  // ---- Portfolio ----
  const buckets = sumBuckets(household.accounts);
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  const order: Record<string, number> = { pretax: 0, roth: 1, taxable: 2 };
  const accounts: ReportAccount[] = household.accounts
    .map((a) => {
      const bucket = bucketOf(a.kind);
      const gainable = bucket === "taxable" && a.kind !== "cash";
      return {
        account: a,
        owner: nameOf(a.owner),
        typeLabel: ACCOUNT_KIND_META[a.kind]?.label ?? a.kind,
        bucket,
        unrealizedGain: gainable && a.costBasis != null ? a.balance - a.costBasis : null,
        holdings: (a.holdings ?? [])
          .map((h) => ({
            ...h,
            value: holdingValue(h),
            gain: gainable && h.costPerShare != null ? holdingValue(h) - h.shares * h.costPerShare : null,
          }))
          .sort((x, y) => y.value - x.value),
      };
    })
    .sort((x, y) => order[x.bucket] - order[y.bucket] || y.account.balance - x.account.balance);
  const totalUnrealizedGain = accounts.reduce((s, a) => s + (a.unrealizedGain ?? 0), 0);

  // ---- This year ----
  const irmaa = buildIrmaaStatus(household, activeProj.rows[0]?.magi ?? planConv.tax.magi, filingStatus, year);
  const irmaaLine = !irmaa
    ? null
    : irmaa.inSurcharge
      ? `This year's income sets your ${irmaa.billingYear} Medicare premium${irmaa.enrolleesAtBilling > 1 ? "s" : ""} at ${irmaa.label.toLowerCase()} — about $${Math.round(irmaa.perPersonMonthly)}/mo per person above the standard premium.`
      : `No Medicare surcharge at this income${irmaa.atTop ? "" : ` — ${irmaaRoomPhrase(irmaa)}`}.`;
  const todo = buildChecklist(household, planConv, { yearTaxTotal, irmaaLine });
  const medicareEligible = plan.selfAge >= 65 || (hasSpouse && plan.spouseAge >= 65);
  const pace = buildYearPace(plan, { now, medicareEligible, extraTax: yearTaxTotal - plan.tax.totalTax });
  const pretaxGross = planConv.withdrawals.pretax;
  const pct = pretaxGross > 0 ? Math.ceil((yearTaxTotal / pretaxGross) * 100) : Infinity;
  const withholdPct = pct <= 90 ? pct : null;
  const totalDraw = planConv.withdrawals.pretax + planConv.withdrawals.taxable + planConv.withdrawals.roth;

  // ---- Strategy & conversions ----
  const conv = conversionImpact(household, settings, activeProj);
  const convSchedule = activeProj.rows
    .filter((r) => r.conversion > 0.5)
    .map((r) => ({ year: r.year, age: r.selfAge, amount: r.conversion, marginalRate: r.marginalRate, irmaaLabel: r.irmaaLabel }));
  const strategies: StrategyRow[] = (["conventional", "smart", "proportional"] as StrategyId[]).map((id) => {
    const p = id === settings.strategy ? activeProj : projectLifetime(household, { ...ctx.assumptions, strategy: id });
    return {
      id,
      label: STRATEGY_META[id].label,
      lifetimeTax: p.lifetimeTax,
      estateAfterTax: p.endingEstateAfterTax,
      depleted: p.depleted,
      active: id === settings.strategy,
    };
  });

  // ---- Quarter agenda ----
  const quarter = quarterOf(now);
  const next = nextQuarter(quarter);
  const ages = people.map((p) => p.age);
  const agendaCtx: AgendaContext = {
    planYear: year,
    rmd: planConv.rmd,
    conversion: settings.useConversions ? ctx.thisYearConversion : 0,
    yearTax: yearTaxTotal,
    withholdPct,
    onMedicare: ages.some((a) => a >= 65),
    inIrmaaWindow: !!irmaa?.inWindow,
    irmaaHeadroom: irmaa && !irmaa.atTop ? irmaa.headroom : Infinity,
    qcdEligible: buckets.pretax > 0 && ages.some((a) => a >= 71), // 70½ by year-end ⇔ 71 this year (conservative)
    hasBrokerage: household.accounts.some((a) => a.kind === "brokerage" && a.balance > 0),
    hasLosses: household.accounts.some((a) =>
      bucketOf(a.kind) === "taxable" && (a.holdings ?? []).some((h) => h.costPerShare != null && holdingValue(h) < h.shares * h.costPerShare - 500),
    ),
    isIL: (household.state ?? "IL") === "IL",
  };

  return {
    now,
    quarter,
    next,
    ctx,
    names: hasSpouse ? `${nameOf("self")} & ${nameOf("spouse")}` : nameOf("self"),
    hasSpouse,
    people,
    stateLabel: (household.state ?? "IL") === "IL" ? "Illinois" : "No state income tax modeled",
    isIL: (household.state ?? "IL") === "IL",
    goalLabel: GOAL_META[settings.goal].short,
    goalBlurb: GOAL_META[settings.goal].blurb,
    strategyLabel: STRATEGY_META[settings.strategy].label,
    strategyBlurb: STRATEGY_META[settings.strategy].blurb,
    buckets,
    total,
    mix: returnModel(household.accounts),
    accounts,
    totalUnrealizedGain,
    todo,
    irmaa,
    pace,
    conv,
    convSchedule,
    strategies,
    milestones: detectMilestones(household, activeProj),
    opportunities: detectOpportunities(household, plan, settings.bracketTarget),
    stress: runStressTests(household, ctx.assumptions),
    lookAhead: buildActionPlan(household, activeProj, 5),
    rows: activeProj.rows,
    agenda: quarterAgenda(quarter, agendaCtx),
    nextAgenda: quarterAgenda(next, agendaCtx),
    withholdPct,
    withdrawalRate: total > 0 ? totalDraw / total : 0,
  };
}
