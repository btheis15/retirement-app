"use client";

/**
 * Guided, step-by-step walkthrough of THIS YEAR's plan — one decision/insight at
 * a time, in plain English, with a gentle animation between steps. It narrates:
 * goal → how much to spend → what already covers it → where to pull the rest →
 * the Roth rollover → the tax bill and exactly why → the next few years →
 * how solid the plan is. The dense dashboard still lives below ("show all the
 * numbers"); this is the calm front door so nobody has to study the page.
 */

import { useMemo, useState, useEffect, useRef, useDeferredValue, useTransition, ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/components/HouseholdProvider";
import { Card, Pill, Info, Callout, DesktopOnly, Collapsible } from "@/components/ui";
import { SOURCES } from "@/lib/sources";
import { StackedBar } from "@/components/ui";
import { spendingSweep } from "@/lib/spendingSweep";
import { spendImpact } from "@/lib/spendImpact";
import { dividendBreakdown, dividendIncomeTrajectory } from "@/lib/dividends";
import { AnimatedNumber, FanChart } from "@/components/charts";
import { planYear, STRATEGY_META } from "@/lib/optimizer";
import { ltcgZeroCeiling } from "@/lib/tax/engine";
import { FILING_CONSTANTS, FilingStatus } from "@/lib/tax/constants";
import { projectLifetime, ProjectionAssumptions } from "@/lib/projection";
import { recommendPlan, planGist, configMatches, GOAL_META } from "@/lib/goals";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { computeMonteCarlo, computeMostMoney } from "@/lib/mcClient";
import { MostMoneyStat, MostMoneyMetric, argmaxByMetric } from "@/lib/recommendMonteCarlo";
import { planAssumptions } from "@/lib/scenarioLab";
import { returnModel } from "@/lib/returns";
import { buildActionPlan, PlanYear, PlanAction } from "@/lib/actionPlan";
import { GoalId, survivorFromSettings } from "@/lib/defaults";
import { adjustedAnnualBenefit, fullRetirementAge } from "@/lib/socialSecurity";
import { rmdStartAge } from "@/lib/tax/constants";
import { bucketOf, ACCOUNT_KIND_META, TaxBucket, Household, Account, AccountKind, defaultRetirementYear } from "@/lib/accounts";
import { money, moneyCompact, percent } from "@/lib/format";

const GOALS: GoalId[] = ["maxCapital", "lowestTax", "lowestRate"];
const SPEND_MAX = 400_000;

// The walkthrough is organized into ordered "chapters" so a longer, fully-guided
// flow still reads as a coherent journey and the client always knows where they
// are. Steps are tagged with a chapter and stable-sorted into this order; the
// visible chapter list is derived from whichever steps are actually present
// (conditional steps never make the "of N" count lie).
type ChapterId = "opening" | "you" | "money" | "income" | "goal" | "spending" | "markets" | "review";
const CHAPTER_ORDER: ChapterId[] = ["opening", "you", "money", "income", "goal", "spending", "markets", "review"];
const CHAPTERS: { id: ChapterId; label: string; icon: string; blurb: string }[] = [
  { id: "you", label: "You", icon: "👤", blurb: "A couple of quick things about you, so the plan fits your life." },
  { id: "money", label: "Your money", icon: "💼", blurb: "Now your savings — just the totals, grouped by type of account." },
  { id: "income", label: "Income", icon: "🏦", blurb: "Money coming in — Social Security, and any pension." },
  { id: "goal", label: "Your goal", icon: "🎯", blurb: "What you want this money to do. We build the whole plan around it." },
  { id: "spending", label: "Spending", icon: "💵", blurb: "How much you want to spend, and how it changes over the years." },
  { id: "markets", label: "Markets & taxes", icon: "📈", blurb: "The assumptions behind the forecast, and your Roth rollover." },
  { id: "review", label: "Review", icon: "✅", blurb: "Your plan at a glance — and how solid it looks." },
];

// Deep-link target → chapter, so an "Adjust →" that points at a step which is
// conditioned out of the current flow can still land on that step's chapter.
const STEP_CHAPTER: Record<string, ChapterId> = {
  longevity: "you",
  survivor: "you",
  accounts: "money",
  ssclaim: "income",
  otherincome: "income",
  goal: "goal",
  spend: "spending",
  "spend-growth": "spending",
  markets: "markets",
  rollconfirm: "markets",
  roll: "markets",
};

/** Build an href that opens the walkthrough at a specific step (its single home).
 *  Pairs with the `?step=` seeding in GuidedPlan and the `<AdjustLink>` pill. */
export function adjustHref(stepKey: string): string {
  return `/?step=${stepKey}`;
}

// "Simple balances first": four buckets are all the engine needs to run the
// projection. Each maps to ONE synthesized account with a FIXED id, so editing a
// balance is idempotent (upsert replaces by id — no duplicates if you re-walk),
// and a $0 bucket is removed. The rich holdings/ticker editor on /accounts stays
// available as opt-in detail; once a bucket is itemized there, this step shows it
// read-only so that data is never overwritten.
const GUIDED_BUCKETS: {
  key: string;
  id: string;
  kind: AccountKind;
  label: string;
  q: string;
  help: string;
  gains?: boolean;
}[] = [
  {
    key: "bucket-pretax",
    id: "guided-pretax",
    kind: "traditional_ira",
    label: "Pre-tax retirement",
    q: "How much is in pre-tax retirement accounts?",
    help: "Traditional IRA, 401(k), 403(b), or a rollover IRA — money you haven’t paid income tax on yet. Add them all into one total.",
  },
  {
    key: "bucket-roth",
    id: "guided-roth",
    kind: "roth_ira",
    label: "Roth",
    q: "How much is in Roth accounts?",
    help: "Roth IRA and Roth 401(k) — already taxed, so it grows and comes out completely tax-free.",
  },
  {
    key: "bucket-brokerage",
    id: "guided-brokerage",
    kind: "brokerage",
    label: "Brokerage",
    gains: true,
    q: "How much is in a regular brokerage account?",
    help: "An ordinary taxable investment account — not a retirement account. You owe tax on its dividends, and on the gain when you sell.",
  },
  {
    key: "bucket-cash",
    id: "guided-cash",
    kind: "cash",
    label: "Cash & savings",
    q: "How much is in cash, savings, or CDs?",
    help: "Bank savings, money-market, and CDs — money you could spend tomorrow.",
  },
];

/** Debounced dollar entry for a bucket step. Commits ~300ms after typing stops so
 *  the engine doesn't recompute on every keystroke. While the field is focused, an
 *  external value change won't yank what you're typing. */
function BucketInput({ value, onCommit, ariaLabel }: { value: number; onCommit: (n: number) => void; ariaLabel?: string }) {
  const [local, setLocal] = useState(value ? String(value) : "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value ? String(value) : "");
  }, [value]);
  const n = Math.max(0, Number(local.replace(/[^0-9]/g, "")) || 0);
  useEffect(() => {
    if (n === value) return;
    const t = setTimeout(() => onCommit(n), 300);
    return () => clearTimeout(t);
  }, [n, value, onCommit]);
  return (
    <div>
      <label className="flex items-center gap-2 rounded-2xl border border-border bg-background/50 px-4 py-3 focus-within:border-primary">
        <span className="text-2xl font-semibold text-foreground/40">$</span>
        <input
          inputMode="numeric"
          value={local}
          placeholder="0"
          aria-label={ariaLabel ?? "Balance"}
          onFocus={() => (focused.current = true)}
          onBlur={() => (focused.current = false)}
          onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ""))}
          className="tabular w-full bg-transparent text-2xl font-bold outline-none"
        />
      </label>
      <div className="mt-1 h-4 text-right text-[12px] text-foreground/45">{n > 0 ? moneyCompact(n) : ""}</div>
    </div>
  );
}

/** Compact labeled dollar field for the income questions — debounced like
 *  BucketInput but small enough to sit several to a step. */
function IncomeField({
  label,
  hint,
  value,
  onCommit,
  readOnly,
}: {
  label: string;
  hint?: string;
  value: number;
  onCommit: (n: number) => void;
  readOnly?: boolean;
}) {
  const [local, setLocal] = useState(value ? String(value) : "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value ? String(value) : "");
  }, [value]);
  const n = Math.max(0, Number(local.replace(/[^0-9]/g, "")) || 0);
  useEffect(() => {
    if (readOnly || n === value) return;
    const t = setTimeout(() => onCommit(n), 300);
    return () => clearTimeout(t);
  }, [n, value, onCommit, readOnly]);
  return (
    <div>
      <div className="text-[12px] font-medium text-foreground/70">{label}</div>
      <label
        className={`mt-1 flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 ${readOnly ? "bg-foreground/[0.04]" : "bg-background/50 focus-within:border-primary"}`}
      >
        <span className="text-foreground/40">$</span>
        {readOnly ? (
          <span className="tabular w-full text-[14px] font-semibold text-foreground/70">{value ? value.toLocaleString("en-US") : "0"}</span>
        ) : (
          <input
            inputMode="numeric"
            value={local}
            placeholder="0"
            aria-label={label}
            onFocus={() => (focused.current = true)}
            onBlur={() => (focused.current = false)}
            onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ""))}
            className="tabular w-full bg-transparent text-[14px] font-semibold outline-none"
          />
        )}
        <span className="shrink-0 text-[11px] text-foreground/45">/yr</span>
      </label>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-foreground/45">{hint}</p>}
    </div>
  );
}

export function GuidedPlan({ onSeeDetails }: { onSeeDetails: () => void }) {
  const { household, settings, updateSettings, updateHousehold, upsertAccount, removeAccount, mode, setMode, newExample } = useStore();
  const year = useMemo(() => new Date().getFullYear(), []);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();
  const seededRef = useRef(false);

  // Step navigation: remember direction so the slide goes the way you're moving.
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(next, 99));
    setDir(clamped >= step ? "fwd" : "back");
    setStep(clamped);
  };
  // Always land at the TOP of each new step (desktop AND mobile) — run it AFTER the
  // new step renders, instantly, and cover whichever element is the scroller. Doing
  // it in the click handler (pre-render) or with smooth behavior let the slide
  // animation/layout shift cancel it, so on desktop you'd stay scrolled down.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [step]);

  // Spending slider tracks at 60fps on LOCAL state; the (heavy) recompute is
  // committed to the store only ~250ms after you stop dragging — so a drag does
  // zero lifetime-projection work per frame.
  const [localSpend, setLocalSpend] = useState(household.annualSpending);
  useEffect(() => setLocalSpend(household.annualSpending), [household.annualSpending]);
  useEffect(() => {
    if (localSpend === household.annualSpending) return;
    const t = setTimeout(() => updateHousehold({ annualSpending: localSpend }), 250);
    return () => clearTimeout(t);
  }, [localSpend, household.annualSpending, updateHousehold]);

  const inputs = {
    returnRate: settings.returnRate,
    inflationRate: settings.inflationRate,
    endAge: settings.endAge,
    convertUntilAge: settings.convertUntilAge,
    survivor: survivorFromSettings(settings),
    heirTaxRate: settings.heirTaxRate,
    dividendMode: settings.dividendMode,
  };
  const activeAssumptions = useMemo(
    () => ({
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
    [settings],
  );
  const proj = useMemo(() => projectLifetime(household, activeAssumptions), [household, activeAssumptions]);
  // Filing status for THIS year's single-year planner. The app's "no spouse"
  // sentinel is spouse.birthYear <= 1900 (matches lib/goals + lib/projection); a
  // real spouse → married-filing-jointly, otherwise single. This drives the right
  // tax brackets AND the right IRMAA tiers (the joint thresholds are double the
  // single ones), so a couple is read against the MFJ tables and a single person
  // against the single tables.
  const filingStatus: FilingStatus = household.spouse && household.spouse.birthYear > 1900 ? "mfj" : "single";
  const plan = useMemo(
    () =>
      planYear(household, {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        year,
        filingStatus,
        dividendMode: settings.dividendMode,
        conversion: settings.useConversions
          ? settings.convertMode === "recommended"
            ? { mode: "recommended", futureRate: proj.futureRate }
            : { mode: "fillBracket", toBracket: settings.bracketTarget }
          : null,
      }),
    [household, settings, proj.futureRate, year, filingStatus],
  );
  // Same year WITHOUT the rollover — its ordinary taxable income is the spending-
  // and-other-income "base" that fills the low brackets before any conversion. The
  // bracket ladder uses it to split each bracket into the part your spending fills
  // vs. the part the rollover tops off. (Gross conversion can't be subtracted from
  // taxable income directly — the standard deduction sits between them.)
  const planNoConv = useMemo(
    () => planYear(household, { strategy: settings.strategy, bracketTarget: settings.bracketTarget, year, filingStatus, dividendMode: settings.dividendMode, conversion: null }),
    [household, settings.strategy, settings.bracketTarget, year, filingStatus, settings.dividendMode],
  );
  // The worst future RMD-era marginal rate, computed independently of whether the
  // rollover is currently ON — proj.futureRate is only populated when conversions
  // are active, so the rollover-confirmation step needs a toggle-independent value
  // to size the recommended rollover it previews. Reuses proj's value when it's
  // available; otherwise derives it from a no-conversion baseline (same formula).
  const futureRateStable = useMemo(() => {
    if (proj.futureRate > 0) return proj.futureRate;
    const baseline = projectLifetime(household, { ...activeAssumptions, strategy: "conventional", convert: null, returnFor: null });
    return baseline.rows.reduce((m, r) => (r.rmd > 0 ? Math.max(m, r.effMarginalRate) : m), 0);
  }, [proj.futureRate, household, activeAssumptions]);
  // Same year WITH the recommended rollover — used by the rollover-confirmation step
  // to show the build-up (spending → + rollover → total) and the IRMAA before/after,
  // regardless of whether the rollover is currently toggled on. When it IS on this
  // equals the active `plan`.
  const planWithRoll = useMemo(
    () =>
      settings.useConversions
        ? plan
        : planYear(household, {
            strategy: settings.strategy,
            bracketTarget: settings.bracketTarget,
            year,
            filingStatus,
            dividendMode: settings.dividendMode,
            conversion:
              settings.convertMode === "fillBracket"
                ? { mode: "fillBracket", toBracket: settings.bracketTarget }
                : { mode: "recommended", futureRate: futureRateStable },
          }),
    [settings.useConversions, plan, household, settings.strategy, settings.bracketTarget, settings.convertMode, futureRateStable, year, filingStatus],
  );
  const lookAhead = useMemo(() => buildActionPlan(household, proj, 5), [household, proj]);
  // The two heaviest computations (a 150-sim Monte Carlo and the 7-config plan
  // grid) run off DEFERRED inputs at low priority, so they catch up a beat after
  // a drag/goal change without ever blocking the slider, buttons, or animations.
  const dHousehold = useDeferredValue(household);
  const dAssumptions = useDeferredValue(activeAssumptions);
  // Run the 300-sim confidence on the Web Worker so it never blocks the walkthrough
  // (this is the primary phone surface). Keyed on the deferred values so it lags
  // smoothly behind a drag/goal change rather than firing on every keystroke.
  const [confidence, setConfidence] = useState<MonteCarloResult | null>(null);
  // The spending level the current `confidence` was computed at — so the spend
  // step can tell whether the (lagging) Monte-Carlo band still matches the slider,
  // and show "updating…" rather than a stale number that contradicts the live
  // sweep verdict right above it.
  const [confidenceSpend, setConfidenceSpend] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    computeMonteCarlo({
      kind: "mc",
      household: dHousehold,
      assumptions: dAssumptions,
      model: returnModel(dHousehold.accounts),
      runs: 300,
    }).then((res) => {
      if (!cancelled) {
        setConfidence(res);
        setConfidenceSpend(dHousehold.annualSpending);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dHousehold, dAssumptions]);
  // The plan-type recommendation (withdrawal order, bracket target, whether/how to
  // roll over) is chosen at a STABLE reference spending — the ~4% pace, NOT the live
  // slider value. Otherwise dragging the spend slider silently re-optimizes the
  // WHOLE plan: at low spend it aggressively fills the 24% bracket (huge conversion →
  // big tax + a high IRMAA tier), and at high spend it turns rollovers off entirely.
  // That made this year's tax/Medicare read-outs lurch and run BACKWARDS as you
  // spent more, and the quick-amount chips appear and vanish. The plan is a property
  // of the household, not of the spend you're trying on; the user explores spending
  // against a FIXED plan, and tunes the rollover on its own step.
  const recRefSpend = useMemo(() => {
    const total = household.accounts.reduce((s, a) => s + a.balance, 0);
    return total > 0 ? Math.min(SPEND_MAX, Math.round(0.04 * total)) : household.annualSpending;
  }, [household.accounts, household.annualSpending]);
  // Pinned-spending households for the recommender, keyed on the household's
  // STRUCTURAL facts (accounts, people, fixed income) so a spend change neither
  // changes the recommendation nor re-runs the search.
  const recHousehold = useMemo(
    () => ({ ...household, annualSpending: recRefSpend }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household.accounts, household.self, household.spouse, household.pensionAnnual, household.brokerageDividendsAnnual, household.ordinaryDividendsAnnual, household.taxableInterestAnnual, household.taxExemptInterestAnnual, household.state, recRefSpend],
  );
  const dRecHousehold = useMemo(
    () => ({ ...dHousehold, annualSpending: recRefSpend }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dHousehold.accounts, dHousehold.self, dHousehold.spouse, dHousehold.pensionAnnual, dHousehold.brokerageDividendsAnnual, dHousehold.ordinaryDividendsAnnual, dHousehold.taxableInterestAnnual, dHousehold.taxExemptInterestAnnual, dHousehold.state, recRefSpend],
  );
  const rec = useMemo(() => recommendPlan(recHousehold, inputs, settings.goal), [recHousehold, settings.goal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── "Most money" by PROBABILITY across simulated markets ──────────────────
  // For the maxCapital goal, "best" isn't the single-path winner — it's the plan
  // most likely to leave you the most. We curate a few DISTINCT candidate plans
  // (so the odds aren't diluted across near-duplicates), then run them all through
  // the SAME simulated markets on the worker and rank by the user's chosen metric
  // (win-rate / median / mean). The winner becomes the recommended plan.
  const finalists = useMemo(() => {
    if (settings.goal !== "maxCapital") return [];
    const seen = new Set<string>();
    const out: typeof rec.ranked = [];
    for (const c of rec.ranked) {
      if (c.metrics.depleted) continue;
      const sig = `${c.config.strategy}|${c.config.bracketTarget}|${c.config.useConversions ? c.config.convertMode : "none"}`;
      if (seen.has(sig)) continue;
      // Also drop plans that land on effectively the SAME outcome as one already
      // kept (e.g. rate-smart vs bracket-fill to the same bracket converge when the
      // future rate sits at that bracket) — otherwise two identical-looking cards.
      if (out.some((k) => Math.abs(k.metrics.netWealth - c.metrics.netWealth) < 2000)) continue;
      seen.add(sig);
      out.push(c);
      if (out.length >= 4) break;
    }
    return out;
  }, [rec, settings.goal]);
  const finalistSig = finalists.map((f) => f.label).join("|");
  const labBase = useMemo(
    () => ({ ...inputs, convertUntilAge: rec.chosenConvertUntilAge, spendingStrategy: settings.spendingStrategy }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs.returnRate, inputs.inflationRate, inputs.endAge, rec.chosenConvertUntilAge, settings.spendingStrategy, settings.survivorModel, settings.firstDeathAge, settings.heirTaxRate],
  );
  const [mostMoney, setMostMoney] = useState<MostMoneyStat[] | null>(null);
  const [mostMoneyFor, setMostMoneyFor] = useState<string | null>(null);
  useEffect(() => {
    if (settings.goal !== "maxCapital" || finalists.length < 2) {
      setMostMoney(null);
      setMostMoneyFor(null);
      return;
    }
    let cancelled = false;
    const candidates = finalists.map((f) => planAssumptions(labBase, f.config));
    computeMostMoney({
      kind: "mostMoney",
      household: dHousehold,
      candidates,
      model: returnModel(dHousehold.accounts),
      runs: 400,
      seed: 424242,
    })
      .then((stats) => {
        if (!cancelled) {
          setMostMoney(stats);
          setMostMoneyFor(finalistSig);
        }
      })
      .catch(() => {
        if (!cancelled) setMostMoney(null);
      });
    return () => {
      cancelled = true;
    };
  }, [finalistSig, dHousehold, labBase, settings.goal]); // eslint-disable-line react-hooks/exhaustive-deps
  // The probability winner under the user's chosen metric (only when fresh stats
  // match the current finalist set — otherwise we're mid-recompute).
  const mmFresh = mostMoney && mostMoneyFor === finalistSig && mostMoney.length === finalists.length;
  const winnerIdx = mmFresh ? argmaxByMetric(mostMoney!, settings.mostMoneyMetric) : -1;
  const probWinner = winnerIdx >= 0 ? finalists[winnerIdx] : null;

  // What plan EACH goal would pick — so the goal step can show the tradeoff (or
  // reassure when all three agree). Deferred + display-only, and run in LIGHT mode
  // (no claim-age / window search — those are only needed for the active plan), so
  // three goals never trigger three heavy searches.
  const LIGHT = { searchWindow: false, optimizeClaimAge: false } as const;
  const recAll = useMemo(
    () => ({
      maxCapital: recommendPlan(dRecHousehold, inputs, "maxCapital", LIGHT).best.config,
      lowestTax: recommendPlan(dRecHousehold, inputs, "lowestTax", LIGHT).best.config,
      lowestRate: recommendPlan(dRecHousehold, inputs, "lowestRate", LIGHT).best.config,
    }),
    [dRecHousehold], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const goalsAgree =
    configMatches(recAll.maxCapital, recAll.lowestTax) && configMatches(recAll.maxCapital, recAll.lowestRate);

  // Pre-tax share decides whether the rollover step is even relevant.
  const pretaxShare = useMemo(() => {
    const total = household.accounts.reduce((s, a) => s + a.balance, 0);
    const pre = household.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0);
    return total > 0 ? pre / total : 0;
  }, [household]);
  // "How much CAN I spend?" — project across spending levels once (cached) to
  // color the slider and show the impact on the account value live.
  const sweep = useMemo(() => spendingSweep(dHousehold, dAssumptions), [dHousehold, dAssumptions]);
  // Prove the point: same household, three rollover approaches, side by side.
  const compare = useMemo(() => {
    const mk = (over: Partial<ProjectionAssumptions>) => projectLifetime(dHousehold, { ...dAssumptions, ...over });
    return {
      none: mk({ convert: null }),
      smooth: mk({ convert: { untilAge: settings.convertUntilAge, mode: "recommended" } }),
      aggressive: mk({ convert: { untilAge: settings.convertUntilAge, mode: "fillBracket" }, bracketTarget: 0.32 }),
    };
  }, [dHousehold, dAssumptions, settings.convertUntilAge]);
  // Same household, three WITHDRAWAL ORDERS side by side — to show (and prove) why
  // the plan pulls where it does, rather than just asserting it. After-tax estate
  // is the apples-to-apples yardstick (it already accounts for the step-up and the
  // deferred tax on pre-tax left behind).
  const orderCompare = useMemo(() => {
    const mk = (strategy: "conventional" | "smart" | "proportional") =>
      projectLifetime(dHousehold, { ...dAssumptions, strategy });
    return { conventional: mk("conventional"), smart: mk("smart"), proportional: mk("proportional") };
  }, [dHousehold, dAssumptions]);

  // ---- Derived, plain-English values for this year ----
  const w = plan.withdrawals;
  const totalDraw = w.pretax + w.taxable + w.roth;
  const rmd = plan.rmd;
  const voluntaryPretax = Math.max(0, w.pretax - rmd);
  const ssNow = plan.fixed.socialSecurity;
  const allDividends = plan.fixed.dividends + plan.fixed.ordinaryDividends;
  const interestIncome = plan.fixed.taxableInterest + plan.fixed.taxExemptInterest;
  // GUARANTEED income = Social Security + pension only — the money that arrives no
  // matter what the markets do. Dividends & interest are NOT "guaranteed income":
  // they're the yield your savings throw off (and are usually reinvested), so they
  // belong on the "from your savings" side, not as a separate paycheck.
  const divIntIncome = allDividends + interestIncome;
  const guaranteed = ssNow + plan.fixed.pension;
  const spending = plan.spendingTarget;
  const conversion = plan.conversion;
  const totalTax = plan.tax.totalTax;
  // What your savings provide this year = the yield they paid out (no selling) + what
  // you actually sold/withdrew to fill the gap.
  const fromSavings = divIntIncome + totalDraw;
  const coveredByIncome = totalDraw < 0.5; // no selling/withdrawal needed this year
  const isIL = (household.state ?? "IL") === "IL";

  // ---- "What pays for it" context ----
  // Share of this year's spending covered by guaranteed income (SS + pension) vs.
  // what has to come out of savings.
  const coverageRatio = guaranteed + fromSavings > 0 ? guaranteed / (guaranteed + fromSavings) : 1;
  // Withdrawal rate = what you pull from savings this year ÷ total savings. The
  // classic sustainability yardstick (the "4% rule" lives here).
  const portfolioTotal = household.accounts.reduce((s, a) => s + a.balance, 0);
  const withdrawalRate = portfolioTotal > 0 ? totalDraw / portfolioTotal : 0;
  // Social Security not started yet? Show what becomes guaranteed once each spouse
  // claims, so a low-coverage year reads as "not yet" rather than "you're exposed".
  const ssSelfClaimed = plan.selfAge >= household.self.ssClaimAge;
  const ssSpouseClaimed = plan.spouseAge >= household.spouse.ssClaimAge;
  const futureSelfSS = adjustedAnnualBenefit(household.self.socialSecurityAnnual, household.self.birthYear, household.self.ssClaimAge);
  const futureSpouseSS = adjustedAnnualBenefit(household.spouse.socialSecurityAnnual, household.spouse.birthYear, household.spouse.ssClaimAge);
  const pendingSS = (ssSelfClaimed ? 0 : futureSelfSS) + (ssSpouseClaimed ? 0 : futureSpouseSS);
  const nextClaimAge = Math.min(
    ssSelfClaimed ? Infinity : household.self.ssClaimAge,
    ssSpouseClaimed ? Infinity : household.spouse.ssClaimAge,
  );

  // ---- IRMAA cliff awareness (a hard step: cross a MAGI line by $1 → the full
  // surcharge for BOTH enrollees, two years later). Surfaced right where spending
  // is chosen, since spending drives the withdrawals that drive MAGI. ----
  const medicareEnrollees = (plan.selfAge >= 65 ? 1 : 0) + (plan.spouseAge >= 65 ? 1 : 0);

  // The Roth rollover this plan does, sized at a SPEND-INDEPENDENT reference (the
  // ~4% recommended spend). The spend-impact sweep holds the rollover at THIS fixed
  // dollar amount across every spending level — so the slider isolates the SPENDING
  // decision. If the sweep instead let the rollover re-solve per spend level (a
  // bracket-fill rule), it would SHRINK as spending rose and drag MAGI down with it,
  // making the tax/Medicare read-outs move BACKWARDS as you spend more (and the
  // cliff markers jump around / vanish as you drag).
  //
  // The spend step shows the tax & Medicare impact of SPENDING ALONE (conversion:
  // null) — the Roth rollover is confirmed on its OWN step right after this, where
  // we add the rollover's taxable income on top and re-show IRMAA. Keeping spending
  // and the rollover as separate, sequential steps lets the user watch the picture
  // build up in order, and keeps this sweep cleanly monotonic in spending.
  const impact = useMemo(
    () =>
      spendImpact(
        dHousehold,
        {
          strategy: settings.strategy,
          bracketTarget: settings.bracketTarget,
          year,
          filingStatus: plan.filingStatus,
          conversion: null, // spending only — the rollover is its own step
          inflationFactor: plan.inflationFactor,
        },
        FILING_CONSTANTS[plan.filingStatus].irmaaTiers,
        medicareEnrollees,
        SPEND_MAX,
      ),
    [dHousehold, settings.strategy, settings.bracketTarget, year, plan.inflationFactor, plan.filingStatus, medicareEnrollees],
  );
  // The picture at the CURRENT slider position — interpolated, so it updates every
  // frame of a drag without re-running the planner.
  const liveImpact = impact.at(localSpend);
  // IRMAA cliff fed by the LIVE (slider) MAGI, not the committed plan — so the
  // callout actually moves as you drag, instead of sitting on a stale value.
  const irmaaCliff = irmaaCliffInfo(
    liveImpact.magi,
    plan.inflationFactor,
    FILING_CONSTANTS[plan.filingStatus].irmaaTiers,
    medicareEnrollees,
  );

  const applyGoal = (goal: GoalId) => {
    startTransition(() => {
      // Recommend at the stable reference spending (see recHousehold) so picking a
      // goal never bakes in the spend the slider happens to sit at.
      const r = recommendPlan(recHousehold, inputs, goal);
      updateSettings({
        goal,
        planCustomized: false, // picking a goal = use its recommended plan
        strategy: r.best.config.strategy,
        bracketTarget: r.best.config.bracketTarget,
        useConversions: r.best.config.useConversions,
        convertMode: r.best.config.convertMode,
        convertUntilAge: r.chosenConvertUntilAge,
      });
    });
  };

  // Auto-apply the recommended plan for the chosen goal so the user never has to
  // confirm or "apply" anything after answering the goal question. This covers
  // the default goal (never tapped) and keeps every surface (this flow + the full
  // dashboard) showing the SAME plan. It backs off the moment the user manually
  // adjusts the rollover (planCustomized), and converges in one pass (it only
  // writes when the active config actually differs from the recommendation).
  // For maxCapital, the target is the PROBABILITY winner (once the worker MC lands);
  // until then — and for the tax/rate goals — it's the deterministic best. One target,
  // one effect, so the two never fight.
  const rc = probWinner ? probWinner.config : rec.best.config;
  const recWindow = rec.chosenConvertUntilAge;
  useEffect(() => {
    if (settings.planCustomized) return;
    if (
      settings.strategy !== rc.strategy ||
      settings.bracketTarget !== rc.bracketTarget ||
      settings.useConversions !== rc.useConversions ||
      settings.convertMode !== rc.convertMode ||
      (rc.useConversions && settings.convertUntilAge !== recWindow)
    ) {
      updateSettings({
        strategy: rc.strategy,
        bracketTarget: rc.bracketTarget,
        useConversions: rc.useConversions,
        convertMode: rc.convertMode,
        ...(rc.useConversions ? { convertUntilAge: recWindow } : {}),
      });
    }
  }, [
    rc.strategy,
    rc.bracketTarget,
    rc.useConversions,
    rc.convertMode,
    recWindow,
    settings.planCustomized,
    settings.strategy,
    settings.bracketTarget,
    settings.useConversions,
    settings.convertMode,
    settings.convertUntilAge,
    updateSettings,
  ]);

  // ---- Steps ----
  type Step = { key: string; chapter: ChapterId; eyebrow: string; render: () => ReactNode };
  const steps: Step[] = [];
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  // Truly empty only when the user is on their OWN data with nothing entered yet.
  // In demo mode we SHOW the example (that's the whole point of an example).
  const needsOwnSetup = mode === "own" && household.accounts.length === 0;
  // Taxable dividends & interest the household's accounts throw off. Only when this is
  // meaningful do we ask the reinvest-vs-spend question (retirement-only households see
  // nothing — dividends inside IRAs/401ks/Roths aren't taxed yearly and get no special
  // treatment, so there's nothing to decide).
  const taxableInvestmentIncome =
    (household.brokerageDividendsAnnual ?? 0) +
    (household.ordinaryDividendsAnnual ?? 0) +
    (household.taxableInterestAnnual ?? 0) +
    (household.taxExemptInterestAnnual ?? 0);
  const hasInvestmentIncome = taxableInvestmentIncome > 200;

  // STEP 0 — the one-time fork: you go through the WHOLE walkthrough either on the
  // $5M example or on your own numbers. No mid-flow toggle; to switch, you come back
  // here (Back from step 1, or "Start over" at the end) and re-pick.
  steps.push({
    key: "start",
    chapter: "opening",
    eyebrow: "let's begin",
    render: () => (
      <div>
        <h2 className="text-xl font-bold leading-snug">How do you want to start?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
          Pick one — the whole walkthrough runs on that choice. You can start over anytime to switch.
        </p>
        <div className="mt-4 rounded-2xl border border-border bg-background/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Here&apos;s what we&apos;ll cover</div>
          <ol className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {CHAPTERS.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 text-[12px] text-foreground/70">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-bold text-foreground/45">{i + 1}</span>
                <span aria-hidden>{c.icon}</span>
                <span className="truncate">{c.label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] leading-snug text-foreground/50">
            About 5–10 minutes · your answers save automatically, so you can stop and pick up where you left off anytime.
          </p>
        </div>
        <div className="mt-5 grid gap-3">
          <button
            onClick={() => { setMode("own"); go(safeStep + 1); }}
            className={`press flex items-start gap-3 rounded-2xl border p-4 text-left ${mode === "own" ? "border-primary bg-primary/10" : "border-border"}`}
          >
            <span className="text-2xl leading-none">✏️</span>
            <span className="min-w-0">
              <span className="block font-semibold">Use my own numbers</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-foreground/55">
                Enter your accounts and get a plan built around what you actually have. Your numbers stay on your device.
              </span>
            </span>
            {mode === "own" && <span className="ml-auto shrink-0 self-center text-primary">→</span>}
          </button>
          <button
            onClick={() => { setMode("demo"); go(safeStep + 1); }}
            className={`press flex items-start gap-3 rounded-2xl border p-4 text-left ${mode === "demo" ? "border-primary bg-primary/10" : "border-border"}`}
          >
            <span className="text-2xl leading-none">📊</span>
            <span className="min-w-0">
              <span className="block font-semibold">Explore the $5M example</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-foreground/55">
                See exactly how it all works on a realistic sample household first — nothing here is your real money.
              </span>
            </span>
            {mode === "demo" && <span className="ml-auto shrink-0 self-center text-primary">→</span>}
          </button>
        </div>
      </div>
    ),
  });

  // STEPS — "simple balances first". Shown only on the simple-balance path: own
  // mode, with no custom or itemized accounts of the user's own (every account is
  // a guided-* bucket, or there are none yet). Adding a custom/itemized account on
  // /accounts switches this off and the flow falls back to the read-only overview.
  const usingSimpleBuckets = mode === "own" && household.accounts.every((a) => a.id.startsWith("guided-"));
  if (usingSimpleBuckets) {
    GUIDED_BUCKETS.forEach((b, bi) => {
      steps.push({
        key: b.key,
        chapter: "money",
        eyebrow: bi === 0 ? "your savings — just the totals" : "your savings",
        render: () => {
          const acct = household.accounts.find((a) => a.id === b.id);
          const itemized = !!acct?.holdings && acct.holdings.length > 0;
          return (
            <div>
              <h2 className="text-xl font-bold leading-snug">{b.q}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">{b.help}</p>
              {itemized ? (
                <div className="mt-4 rounded-2xl border border-border bg-background/50 p-4">
                  <div className="text-[12px] text-foreground/55">Itemized into {acct!.holdings!.length} holdings</div>
                  <div className="tabular mt-1 text-2xl font-bold text-primary">{money(acct!.balance)}</div>
                  <Link
                    href="/accounts"
                    className="press mt-3 inline-block rounded-xl border border-border px-3 py-1.5 text-[13px] font-semibold text-primary"
                  >
                    Edit holdings on the Accounts page →
                  </Link>
                </div>
              ) : (
                <div className="mt-4">
                  <BucketInput
                    ariaLabel={b.q}
                    value={acct?.balance ?? 0}
                    onCommit={(n) => {
                      if (n <= 0) {
                        if (acct) removeAccount(b.id);
                        return;
                      }
                      upsertAccount({
                        id: b.id,
                        label: b.label,
                        kind: b.kind,
                        owner: "self",
                        balance: n,
                        ...(b.kind === "brokerage" || b.kind === "cash" ? { costBasis: acct?.costBasis ?? n } : {}),
                      });
                    }}
                  />
                  {b.gains && acct && acct.balance > 0 && (
                    <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
                      <div className="text-[12px] font-medium text-foreground/70">Roughly how much of that is profit (gains)?</div>
                      <p className="mt-0.5 text-[11px] leading-snug text-foreground/55">
                        Only the gain is taxed when you sell, so this sharpens the tax math. Not sure? Leave it — we’ll
                        assume no gain for now, and you can refine it on the Accounts page.
                      </p>
                      <div className="mt-2">
                        <BucketInput
                          ariaLabel="Approximate investment gains in the brokerage account"
                          value={Math.max(0, acct.balance - (acct.costBasis ?? acct.balance))}
                          onCommit={(g) => upsertAccount({ ...acct, costBasis: Math.max(0, acct.balance - g) })}
                        />
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-[12px] text-foreground/50">Don’t have this kind of account? Leave it at $0.</p>
                </div>
              )}
            </div>
          );
        },
      });
    });
  }

  steps.push({
    key: "accounts",
    chapter: "money",
    eyebrow: "start with your money",
    render: () => {
      if (needsOwnSetup) {
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">Add your savings to continue</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              Go back a step and enter at least one balance — pre-tax, Roth, brokerage, or cash — and the whole plan
              builds around it. Want to list specific funds (tickers, cost basis, dividends)? You can itemize any
              account on the Accounts page.
            </p>
            <Link
              href="/accounts"
              className="press mt-4 block rounded-2xl border border-border px-4 py-3 text-center text-sm font-semibold text-primary"
            >
              Add detailed accounts on the Accounts page →
            </Link>
          </div>
        );
      }
      return (
        <div>
          {mode === "demo" && (
            <div className="mb-3 rounded-xl border border-ss/25 bg-ss/[0.06] px-3 py-2 text-[12px] text-foreground/70">
              <p>
                📊 You&apos;re exploring a <strong>sample {moneyCompact(total)} household</strong> — nothing here is
                your real money.
              </p>
              <button
                onClick={newExample}
                className="press mt-2 rounded-lg border border-ss/40 bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground/80"
              >
                🎲 New example
              </button>
            </div>
          )}
          <h2 className="text-xl font-bold leading-snug">{mode === "demo" ? "The example portfolio" : "Here’s what you have"}</h2>
          <p className="mt-1 text-[13px] text-foreground/60">
            {mode === "demo"
              ? "Here's exactly what we'll assess — every account, by tax treatment."
              : "Everything below is built from these accounts. Looks right?"}
          </p>
          <div className="mt-4 text-center">
            <div className="tabular text-4xl font-bold text-primary">
              <AnimatedNumber value={total} format={(n) => money(n)} />
            </div>
            <div className="text-[12px] text-foreground/50">total across {household.accounts.length} accounts</div>
          </div>
          <AccountOverview household={household} total={total} />
          {mode === "own" && (
            <Link href="/accounts" className="press mt-4 block rounded-xl border border-border py-2.5 text-center text-[13px] font-semibold text-primary">
              Edit my accounts
            </Link>
          )}
        </div>
      );
    },
  });

  // STEP — about you: birth year(s) and the year you plan to start retirement. The
  // birth years already drive ages, RMD timing, and Social Security; the retirement
  // year is captured here up front so the plan is framed around it. Editable on the
  // example too (these are exploratory levers — see HouseholdProvider), so it never
  // silently turns the example into "your own numbers".
  {
    const aboutHasSpouse = !!household.spouse && household.spouse.birthYear > 1900;
    const retYear = household.retirementYear ?? defaultRetirementYear(household.self.birthYear);
    steps.push({
      key: "aboutyou",
      chapter: "you",
      eyebrow: "a little about you",
      render: () => {
        const YearInput = ({
          value,
          onChange,
          ariaLabel,
          min,
          max,
        }: {
          value: number;
          onChange: (v: number) => void;
          ariaLabel: string;
          min: number;
          max: number;
        }) => (
          <input
            inputMode="numeric"
            aria-label={ariaLabel}
            defaultValue={String(value)}
            key={value}
            onBlur={(e) => {
              const n = Number(e.target.value.replace(/[^0-9]/g, "")) || 0;
              if (n >= min && n <= max) onChange(n);
              else e.target.value = String(value); // out of range → snap back
            }}
            className="tabular w-20 rounded-xl border border-border bg-background/50 px-2.5 py-1.5 text-center text-[16px] font-semibold outline-none focus:border-primary"
          />
        );
        const BirthRow = ({ who }: { who: "self" | "spouse" }) => {
          const p = household[who];
          return (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">{p.label || (who === "self" ? "You" : "Spouse")}</div>
                <div className="mt-0.5 text-[11px] text-foreground/55">Born {p.birthYear} · age {year - p.birthYear} this year</div>
              </div>
              <label className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-foreground/50">Birth year</span>
                <YearInput
                  value={p.birthYear}
                  ariaLabel={`${p.label || who} birth year`}
                  min={1920}
                  max={year}
                  onChange={(v) => updateHousehold({ [who]: { ...p, birthYear: v } } as never)}
                />
              </label>
            </div>
          );
        };
        const yearsAway = retYear - year;
        const selfAgeAtRet = retYear - household.self.birthYear;
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">A little about you</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              The year you were born sets your ages, when RMDs begin, and how Social Security grows. Tell us when you plan
              to start retirement, too — you can change any of this anytime.
            </p>

            <div className="mt-4 space-y-2">
              <BirthRow who="self" />
              {aboutHasSpouse && <BirthRow who="spouse" />}
            </div>

            {/* Optional spouse/partner */}
            <button
              onClick={() =>
                updateHousehold({
                  spouse: aboutHasSpouse
                    ? { ...household.spouse, birthYear: 1900 } // sentinel → filed single everywhere
                    : { ...household.spouse, birthYear: household.spouse.birthYear > 1900 ? household.spouse.birthYear : year - 61 },
                } as never)
              }
              className="press mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left"
            >
              <span className="text-[13px] text-foreground/70">
                {aboutHasSpouse ? "Planning as a couple" : "Planning just for myself"}
              </span>
              <span className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold ${aboutHasSpouse ? "border-primary bg-primary text-white" : "border-border text-foreground/60"}`}>
                {aboutHasSpouse ? "I have a spouse/partner" : "Add a spouse/partner"}
              </span>
            </button>

            {/* Planned retirement year */}
            <div className="mt-5 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">Year you plan to start retirement</div>
                  <div className="mt-0.5 text-[11px] text-foreground/55">
                    {yearsAway <= 0 ? "This is now or in the past" : `${yearsAway} ${yearsAway === 1 ? "year" : "years"} from now`} ·
                    you&apos;d be {selfAgeAtRet} that year
                  </div>
                </div>
                <YearInput
                  value={retYear}
                  ariaLabel="Year you plan to start retirement"
                  min={year - 5}
                  max={year + 40}
                  onChange={(v) => updateHousehold({ retirementYear: v })}
                />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[year, household.self.birthYear + 65, household.self.birthYear + 67, household.self.birthYear + 70]
                  .map((y) => Math.max(year - 5, Math.min(year + 40, y)))
                  .filter((y, i, arr) => arr.indexOf(y) === i)
                  .map((y) => (
                    <button
                      key={y}
                      onClick={() => updateHousehold({ retirementYear: y })}
                      className={`press rounded-xl border py-2 text-center ${retYear === y ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-foreground/65"}`}
                    >
                      <div className="text-[14px] font-bold leading-none">{y}</div>
                      <div className="mt-0.5 text-[10px]">{y === year ? "now" : `age ${y - household.self.birthYear}`}</div>
                    </button>
                  ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-foreground/45">
                We use this to frame your plan. The year-by-year projection currently begins this year; tying it fully to
                your retirement year is coming next.
              </p>
            </div>
          </div>
        );
      },
    });
  }

  // STEP — plan-to age + survivor (longevity). The horizon drives every number; the
  // survivor model captures the widow's-penalty single-filer years. Always shown
  // (it needs no account data) — so entering a balance in own-setup never inserts
  // an earlier step and shifts the index out from under the user mid-flow.
  {
    const hasSpouse = !!household.spouse && household.spouse.birthYear > 1900;
    steps.push({
      key: "longevity",
      chapter: "you",
      eyebrow: "how long should the plan cover?",
      render: () => {
        const btn = (on: boolean) =>
          `press rounded-xl border py-2 text-center ${on ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-foreground/70"}`;
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">How long should your plan cover?</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              We run every number out to this age. Planning to a longer age is the safe choice — you won&apos;t outlive the
              plan. Most advisors use about 95.
            </p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {[90, 95, 100, 105].map((a) => (
                <button key={a} onClick={() => updateSettings({ endAge: a })} className={btn(settings.endAge === a)}>
                  <div className="text-lg font-bold leading-none">{a}</div>
                  <div className="mt-0.5 text-[10px]">{a === 95 ? "typical ★" : a >= 100 ? "cautious" : "shorter"}</div>
                </button>
              ))}
            </div>
            {/* Optional: sex, for the life-expectancy context shown on Forecast.
                Lives here so every input has a home in the questionnaire. */}
            <div className="mt-4 rounded-2xl border border-border p-3">
              <div className="text-[13px] font-semibold">Optional: for life-expectancy context</div>
              <p className="mt-0.5 text-[11px] leading-snug text-foreground/50">
                Used only to show realistic longevity odds alongside the forecast — it doesn&apos;t change the plan math.
              </p>
              {(["self", ...(hasSpouse ? (["spouse"] as const) : [])] as const).map((who) => {
                const cur = who === "self" ? settings.selfSex : settings.spouseSex;
                return (
                  <div key={who} className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-foreground/65">{household[who].label || (who === "self" ? "You" : "Spouse")}</span>
                    <div className="flex gap-1.5">
                      {(["female", "male", "blended"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => updateSettings(who === "self" ? { selfSex: s } : { spouseSex: s })}
                          className={`press rounded-lg border px-2.5 py-1 text-[11px] ${cur === s ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/60"}`}
                        >
                          {s === "blended" ? "Skip" : s === "female" ? "Female" : "Male"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {hasSpouse && (
              <div className="mt-5 rounded-2xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">Model the surviving spouse</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-foreground/55">
                      When one of you passes, the survivor files taxes as single (narrower brackets) and keeps the larger
                      Social Security — the &ldquo;widow&apos;s penalty.&rdquo; On by default so the plan is realistic.
                    </div>
                  </div>
                  <button
                    onClick={() => updateSettings({ survivorModel: !settings.survivorModel })}
                    className={`press shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${settings.survivorModel ? "border-primary bg-primary text-white" : "border-border text-foreground/60"}`}
                  >
                    {settings.survivorModel ? "On" : "Off"}
                  </button>
                </div>
                {settings.survivorModel && (
                  <div className="mt-3">
                    <div className="mb-1 text-[12px] text-foreground/60">First passing around age</div>
                    <div className="grid grid-cols-5 gap-2 text-[13px]">
                      {[80, 85, 88, 90, 92].map((a) => (
                        <button key={a} onClick={() => updateSettings({ firstDeathAge: a })} className={btn(settings.firstDeathAge === a)}>
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      },
    });

    // STEP — Social Security claim age (the highest-value lever). Only when there's a
    // benefit to time; surfaces the optimizer's suggestion.
    const hasSS = household.self.socialSecurityAnnual > 0 || (hasSpouse && household.spouse.socialSecurityAnnual > 0);
    if (hasSS) {
      steps.push({
        key: "ssclaim",
        chapter: "income",
        eyebrow: "when to claim Social Security",
        render: () => {
          const adv = rec.claimAdvice;
          const ClaimPicker = ({ who }: { who: "self" | "spouse" }) => {
            const p = household[who];
            const fra = Math.round(fullRetirementAge(p.birthYear));
            const ages = Array.from(new Set([62, fra, 70]));
            return (
              <div className="rounded-2xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[14px] font-semibold">{p.label || (who === "self" ? "You" : "Spouse")}</div>
                    <div className="text-[11px] text-foreground/50">Full retirement age {fra}</div>
                  </div>
                  {/* The user's OWN benefit — we can't know it, so let them enter it. This
                      is the full (FRA) monthly amount from their SSA statement; the buttons
                      below adjust it for the claim age. */}
                  <label className="flex items-center gap-1 rounded-xl border border-border bg-background/50 px-2.5 py-1.5">
                    <span className="text-foreground/50">$</span>
                    <input
                      inputMode="numeric"
                      aria-label={`${p.label || who} full monthly Social Security benefit at age ${fra}`}
                      value={p.socialSecurityAnnual ? String(Math.round(p.socialSecurityAnnual / 12)) : ""}
                      placeholder="0"
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value.replace(/[^0-9]/g, "")) || 0);
                        updateHousehold({ [who]: { ...p, socialSecurityAnnual: v * 12 } } as never);
                      }}
                      className="tabular w-16 bg-transparent text-right text-[14px] font-semibold outline-none"
                    />
                    <span className="text-[11px] text-foreground/45">/mo</span>
                  </label>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-foreground/45">
                  Your <strong>full benefit at {fra}</strong> (from your SSA statement). The buttons below adjust it for when you claim.
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {ages.map((a) => {
                    const on = p.ssClaimAge === a;
                    return (
                      <button
                        key={a}
                        onClick={() => updateHousehold({ [who]: { ...p, ssClaimAge: a } } as never)}
                        className={`press rounded-xl border py-1.5 ${on ? "border-primary bg-primary/10" : "border-border"}`}
                      >
                        <div className={`text-[13px] font-bold ${on ? "text-primary" : ""}`}>Age {a}</div>
                        <div className="text-[10px] text-foreground/55">{moneyCompact(adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, a))}/yr</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          };
          return (
            <div>
              <h2 className="text-xl font-bold leading-snug">When should you claim Social Security?</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
                This is often the single highest-value lever. Claiming later means a bigger, inflation-protected check for
                life — but you lean on savings more in the meantime.
              </p>
              {adv && adv.delayWho && (
                <Callout tone="info" icon="🎯" title={`Our math suggests ${adv.self}${hasSpouse ? ` / ${adv.spouse}` : ""}`}>
                  {settings.goal === "maxCapital" && adv.lift > 1000 ? (
                    <>For your numbers and a plan to {settings.endAge}, this is projected to leave about <strong>{moneyCompact(adv.lift)}</strong> more over your lifetime than your current ages. It&apos;s a suggestion — set what you prefer below.</>
                  ) : (
                    <>For your numbers and a plan to {settings.endAge}, this is the best pair for your goal. It&apos;s a suggestion — set what you prefer below.</>
                  )}
                </Callout>
              )}
              <div className="mt-4 space-y-2">
                <ClaimPicker who="self" />
                {hasSpouse && <ClaimPicker who="spouse" />}
              </div>
            </div>
          );
        },
      });
    }
  }

  // STEP — other income: the pension/annuity plus the dividends & interest the
  // taxable accounts pay out each year. This is the guided HOME for every income
  // input (the questionnaire is complete — nothing consequential hides on a
  // detail page). When holdings carry real dividend data the dividend figures
  // are computed from them and shown read-only, pointing at Accounts to edit.
  {
    const taxableHoldingsForIncome = household.accounts
      .filter((a) => bucketOf(a.kind) === "taxable")
      .flatMap((a) => a.holdings ?? []);
    const divModel = dividendBreakdown(taxableHoldingsForIncome);
    const hasTaxableAccounts = household.accounts.some((a) => bucketOf(a.kind) === "taxable" && a.balance > 0);
    const showInvestFields = hasTaxableAccounts || taxableInvestmentIncome > 0;
    const isDemoIncome = mode === "demo";
    steps.push({
      key: "otherincome",
      chapter: "income",
      eyebrow: "any other income",
      render: () => (
        <div>
          <h2 className="text-xl font-bold leading-snug">Any other income coming in?</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
            Money that shows up every year without selling anything — a pension, and whatever your taxable investments
            pay out. It covers spending first, so you draw less from savings; it also shapes your tax picture.
          </p>
          {isDemoIncome && (
            <div className="mt-3">
              <Callout tone="info" icon="🔒" title="Part of the example">
                These are the example household&apos;s numbers, shown so you can see how they&apos;re used. Choose
                &ldquo;Use my own numbers&rdquo; at the start to enter yours.
              </Callout>
            </div>
          )}
          <div className="mt-4 space-y-3">
            <IncomeField
              label="Pension or annuity (per year, before tax)"
              hint="A company pension or annuity payout. Leave 0 if you don't have one."
              value={Math.round(household.pensionAnnual || 0)}
              onCommit={(v) => updateHousehold({ pensionAnnual: v })}
              readOnly={isDemoIncome}
            />
            {showInvestFields && (
              <div className="rounded-2xl border border-border p-3">
                <div className="text-[13px] font-semibold">Dividends &amp; interest from your taxable accounts</div>
                {divModel.hasData ? (
                  <>
                    <p className="mt-1 text-[11px] leading-snug text-foreground/55">
                      Computed from your holdings — shares × dividend per share. Edit the holdings on the{" "}
                      <Link href="/accounts" className="font-medium text-primary underline">
                        Accounts page
                      </Link>{" "}
                      to change these.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <IncomeField label="Qualified dividends" value={Math.round(household.brokerageDividendsAnnual || 0)} onCommit={() => {}} readOnly />
                      <IncomeField label="Ordinary dividends" value={Math.round(household.ordinaryDividendsAnnual || 0)} onCommit={() => {}} readOnly />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[11px] leading-snug text-foreground/55">
                      Rough numbers are fine — last year&apos;s 1099 forms have the exact ones. Skip anything that
                      doesn&apos;t apply.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <IncomeField
                        label="Qualified dividends"
                        hint="Most stock & index-fund dividends (1099-DIV box 1b)."
                        value={Math.round(household.brokerageDividendsAnnual || 0)}
                        onCommit={(v) => updateHousehold({ brokerageDividendsAnnual: v })}
                        readOnly={isDemoIncome}
                      />
                      <IncomeField
                        label="Ordinary dividends"
                        hint="REITs & bond funds — taxed as regular income."
                        value={Math.round(household.ordinaryDividendsAnnual || 0)}
                        onCommit={(v) => updateHousehold({ ordinaryDividendsAnnual: v })}
                        readOnly={isDemoIncome}
                      />
                    </div>
                  </>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <IncomeField
                    label="Taxable interest"
                    hint="Savings, CDs, Treasuries, money market (1099-INT)."
                    value={Math.round(household.taxableInterestAnnual || 0)}
                    onCommit={(v) => updateHousehold({ taxableInterestAnnual: v })}
                    readOnly={isDemoIncome}
                  />
                  <IncomeField
                    label="Muni-bond interest"
                    hint="Tax-exempt — but still counts for Medicare & SS tax."
                    value={Math.round(household.taxExemptInterestAnnual || 0)}
                    onCommit={(v) => updateHousehold({ taxExemptInterestAnnual: v })}
                    readOnly={isDemoIncome}
                  />
                </div>
              </div>
            )}
          </div>
          <DesktopOnly>
            <div className="mt-4 rounded-2xl border border-border bg-background/50 p-3 text-[12px] leading-relaxed text-foreground/60">
              <div className="mb-1 font-semibold text-foreground/75">Why the plan asks for each type separately</div>
              Each type is taxed differently, and the difference compounds over a long retirement:{" "}
              <strong>qualified dividends</strong> get the preferential 0/15/20% capital-gains rates;{" "}
              <strong>ordinary dividends and interest</strong> are taxed like wages; <strong>municipal-bond
              interest</strong> is federally tax-free but still raises the income that sets your Medicare (IRMAA)
              premium and how much of your Social Security is taxed. A pension is fully taxable federally — though
              Illinois exempts it, along with all retirement income.
            </div>
          </DesktopOnly>
        </div>
      ),
    });
  }

  // STEP — dividends & interest: reinvest (default) or spend. Only shown when the
  // taxable accounts actually pay something out, so the user is consciously told
  // reinvest is the default and that spending it is a deliberate choice.
  if (hasInvestmentIncome) {
    steps.push({
      key: "dividends",
      chapter: "income",
      eyebrow: "your investment income",
      render: () => {
        const spend = settings.dividendMode === "spend";
        const opt = (on: boolean) =>
          `press flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left ${on ? "border-primary bg-primary/10" : "border-border"}`;
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">What happens to your dividends &amp; interest?</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              Your taxable investments pay out about <strong>{money(Math.round(taxableInvestmentIncome))}/yr</strong> in
              dividends and interest. Most people leave it invested so it keeps compounding — or you can take it as cash
              to help fund your spending. Either way, it&apos;s taxed each year.
            </p>
            <div className="mt-4 grid gap-2">
              <button onClick={() => updateSettings({ dividendMode: "reinvest" })} className={opt(!spend)}>
                <span className="text-2xl leading-none">🔁</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`font-semibold ${!spend ? "text-primary" : ""}`}>Reinvest it</span>
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">Most common</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-foreground/60">
                    It stays invested and keeps growing. You withdraw from your accounts to cover spending (we still set
                    aside the tax it owes).
                  </span>
                </span>
                {!spend && <span className="ml-auto shrink-0 self-start text-primary">✓</span>}
              </button>
              <button onClick={() => updateSettings({ dividendMode: "spend" })} className={opt(spend)}>
                <span className="text-2xl leading-none">💵</span>
                <span className="min-w-0 flex-1">
                  <span className={`font-semibold ${spend ? "text-primary" : ""}`}>Take it as cash to spend</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-foreground/60">
                    You live partly off the payout, so you withdraw a bit less from your accounts. (Often a touch more
                    tax-efficient — the plan updates so you can compare.)
                  </span>
                </span>
                {spend && <span className="ml-auto shrink-0 self-start text-primary">✓</span>}
              </button>
            </div>
          </div>
        );
      },
    });
  }

  steps.push({
    key: "goal",
    chapter: "goal",
    eyebrow: "what matters most",
    render: () => (
      <div>
        <h2 className="text-xl font-bold leading-snug">What&apos;s your #1 goal for this money?</h2>
        <p className="mt-1 text-[13px] text-foreground/60">We&apos;ll build the whole plan around this — you can change it anytime.</p>
        <div className="mt-4 grid gap-2">
          {GOALS.map((g) => {
            const active = settings.goal === g;
            return (
              <button
                key={g}
                onClick={() => applyGoal(g)}
                className={`press flex items-start gap-3 rounded-2xl border p-3 text-left ${
                  active ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="text-2xl leading-none">{GOAL_META[g].icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`font-semibold ${active ? "text-primary" : ""}`}>{GOAL_META[g].short}</span>
                    {g === "maxCapital" && (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">Most common</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-foreground/60">{GOAL_META[g].blurb}</span>
                  <span className={`mt-1 block text-[12px] font-medium leading-snug ${active ? "text-foreground/70" : "text-foreground/45"}`}>
                    → {planGist(recAll[g])}
                  </span>
                </span>
                {active && <span className="ml-auto shrink-0 self-start text-primary">✓</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 rounded-xl bg-gain/5 px-3 py-2 text-[12px] leading-relaxed text-foreground/70">
          {goalsAgree ? (
            <>
              🤖 Good news — for your numbers, all three goals lead to the <strong>same plan</strong> (the line under each
              is identical){recAll.maxCapital.useConversions ? <>, and it does include some Roth conversions</> : <>, and it does <strong>not</strong> call for Roth conversions</>} — so
              you can&apos;t go wrong. Next we&apos;ll show exactly what it means.
            </>
          ) : (
            <>
              🤖 Your goals would lead to <strong>different plans</strong> — the one-line summary under each button shows
              how. You picked <strong>{GOAL_META[settings.goal].short}</strong>; next we&apos;ll walk through what to do.
            </>
          )}
        </p>
        {/* Advanced: the withdrawal-order machinery, for people who want to steer it
            directly. Lives HERE (the goal decision's step) so no consequential
            control exists only on a detail page. Overriding marks the plan custom. */}
        <Info q="Advanced: pick the withdrawal method yourself" className="mt-3">
          <p className="mb-2">
            A &quot;method&quot; is the <em>order</em> we pull money from your accounts. Your goal already picks the
            best one for your numbers — change it only to experiment. Your choice is kept until you re-pick a goal.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["smart", "conventional", "proportional"] as const).map((s) => (
              <button
                key={s}
                onClick={() => updateSettings({ strategy: s, planCustomized: true })}
                className={`press whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium ${
                  settings.strategy === s ? "bg-primary text-white" : "border border-border bg-card text-foreground/70"
                }`}
              >
                {STRATEGY_META[s].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-foreground/55">{STRATEGY_META[settings.strategy].blurb}</p>
          {settings.strategy === "smart" && (
            <div className="mt-2">
              <div className="text-[12px] font-semibold text-foreground/70">Fill pre-tax up to this bracket</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {([0.12, 0.22, 0.24, 0.32] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => updateSettings({ bracketTarget: b, planCustomized: true })}
                    className={`press rounded-lg border py-1.5 text-center text-[12px] font-bold ${
                      settings.bracketTarget === b ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60"
                    }`}
                  >
                    {Math.round(b * 100)}%
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-foreground/50">
                The highest rate you&apos;ll accept to voluntarily pull extra pre-tax dollars now — not your overall
                tax rate.
              </p>
            </div>
          )}
        </Info>
      </div>
    ),
  });

  // STEP — "most money" method (only for maxCapital, when there are distinct plans to
  // weigh). Ranks the finalists by how they do across the SAME simulated markets, by
  // the metric the user picks. The winner is auto-applied as the active plan.
  if (settings.goal === "maxCapital" && finalists.length >= 2) {
    steps.push({
      key: "mostmoney",
      chapter: "goal",
      eyebrow: "the most-money method",
      render: () => {
        const metric = settings.mostMoneyMetric;
        const METRIC_BTN: Record<MostMoneyMetric, string> = {
          winRate: "Wins most often",
          median: "Highest typical",
          mean: "Highest average",
        };
        const valueOf = (s: MostMoneyStat) => (metric === "winRate" ? s.winRate : metric === "median" ? s.median : s.mean);
        const ranked = mmFresh
          ? finalists.map((f, i) => ({ f, s: mostMoney![i] })).sort((a, b) => valueOf(b.s) - valueOf(a.s))
          : finalists.map((f) => ({ f, s: null as MostMoneyStat | null }));
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">Which plan most likely leaves you the most?</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              &ldquo;Most money&rdquo; depends on the markets you get. So we run your top {finalists.length} plans through the{" "}
              <strong>same</strong>{" "}hundreds of simulated markets and rank them. How do you want &ldquo;most&rdquo; measured?
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["winRate", "median", "mean"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => updateSettings({ mostMoneyMetric: k, planCustomized: false })}
                  className={`press rounded-xl border px-2 py-2 text-[12px] font-semibold ${metric === k ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/65"}`}
                >
                  {METRIC_BTN[k]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-foreground/45">
              {metric === "winRate"
                ? "Ends up with the most in the largest share of markets (it can lose some — it wins most)."
                : metric === "median"
                  ? "Highest typical (middle) ending estate — the steadiest, most-likely outcome."
                  : "Highest average ending estate — rewards upside, can favor a riskier plan."}
            </p>

            {!mmFresh ? (
              <div className="mt-4 rounded-2xl border border-border p-5 text-center text-[13px] text-foreground/55">
                <span className="inline-block animate-pulse">↻ Running your plans through the markets…</span>
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  {ranked.map(({ f, s }, i) => {
                    if (!s) return null;
                    const winner = i === 0; // best under the current measure
                    const active = configMatches(
                      { strategy: settings.strategy, bracketTarget: settings.bracketTarget, useConversions: settings.useConversions, convertMode: settings.convertMode },
                      f.config,
                    );
                    return (
                      <button
                        key={f.label}
                        onClick={() =>
                          updateSettings({
                            strategy: f.config.strategy,
                            bracketTarget: f.config.bracketTarget,
                            useConversions: f.config.useConversions,
                            convertMode: f.config.convertMode,
                            convertUntilAge: rec.chosenConvertUntilAge,
                            planCustomized: true,
                          })
                        }
                        className={`press block w-full rounded-2xl border p-3 text-left ${active ? "border-primary bg-primary/[0.06]" : "border-border"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[13px] font-semibold ${active ? "text-primary" : ""}`}>{f.label}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {winner && <Pill tone="roth">Recommended</Pill>}
                            {active && <Pill tone="gain">✓ Active</Pill>}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                          <Stat label="Wins" value={`${(s.winRate * 100).toFixed(1)}%`} hot={metric === "winRate"} />
                          <Stat label="Typical" value={money(Math.round(s.median))} hot={metric === "median"} />
                          <Stat label="Average" value={money(Math.round(s.mean))} hot={metric === "mean"} />
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-center text-[11px] text-foreground/45">Tap any plan to make it your active plan.</p>
              </>
            )}
            <p className="mt-3 rounded-xl bg-gain/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/70">
              💡 The <strong>Recommended</strong> plan (best under the measure you picked) is applied as your{" "}
              <strong>active plan</strong> — but you can tap any plan above to use it instead. Switch the measure and it
              re-picks the recommendation. Win-rate is the default a planner would call &ldquo;most likely to leave you the
              most&rdquo;; median is the steadier choice; average chases upside.
            </p>
          </div>
        );
      },
    });
  }

  steps.push({
    key: "spend",
    chapter: "spending",
    eyebrow: "how much you can spend",
    render: () => {
      const cur = sweep.at(localSpend);
      const compPct = Math.max(0, Math.min(100, (sweep.comfortableMax / sweep.max) * 100));
      const sustPct = Math.max(compPct, Math.min(100, (sweep.sustainableMax / sweep.max) * 100));
      const zone = localSpend <= sweep.comfortableMax ? "comfortable" : localSpend <= sweep.sustainableMax ? "tight" : "short";
      const hasRoom = sweep.sustainableMax > 0;
      const pos = (v: number) => Math.max(0, Math.min(100, (v / SPEND_MAX) * 100));
      const round5 = (n: number) => Math.round(n / 5_000) * 5_000;
      const floor5 = (n: number) => Math.floor(n / 5_000) * 5_000;
      const shortTier = (label: string) => label.replace(" surcharge", "").replace("Standard premium", "standard premium");

      // Ticks under the slider: the safe ceilings (green/amber) and every IRMAA
      // cliff the chosen plan would hit (red), each placed at the spending level
      // where it bites.
      const markers: { key: string; value: number; cls: string; title: string; dotted?: boolean }[] = [];
      if (hasRoom && sweep.comfortableMax > 0 && sweep.comfortableMax < SPEND_MAX)
        markers.push({ key: "comf", value: sweep.comfortableMax, cls: "bg-gain", title: "Comfortable ceiling" });
      if (hasRoom && sweep.sustainableMax > sweep.comfortableMax + 5_000 && sweep.sustainableMax < SPEND_MAX)
        markers.push({ key: "sust", value: sweep.sustainableMax, cls: "bg-accent", title: "Most you can safely spend" });
      // The IRMAA lines are drawn DOTTED — they mark where this year's income would
      // cross a Medicare surcharge. Because spending is funded partly from cash/Roth/
      // basis (not taxable income), this line sits far to the right of your spending:
      // it's the "typical" cliff that doesn't bind you yet.
      impact.irmaaCliffs
        .filter((c) => c.spend > 0 && c.spend < SPEND_MAX)
        .forEach((c, i) => markers.push({ key: `irmaa${i}`, value: c.spend, cls: "bg-tax", title: `Medicare (IRMAA) line → ${c.toLabel}`, dotted: true }));

      // The RECOMMENDED amount: the spend whose savings draw lands at the classic
      // ~4% safe-withdrawal pace (capped so it's never above what the downside
      // sweep says is sustainable). This is the headline "quick amount" — a
      // recognizable, advisor-grade anchor — so the user has a default to start from.
      let recSpend: number | null = null;
      if (portfolioTotal > 0) {
        const target = 0.04 * portfolioTotal;
        const pts = impact.points;
        for (let i = 1; i < pts.length; i++) {
          if (pts[i - 1].draw < target && pts[i].draw >= target) {
            const t = pts[i].draw === pts[i - 1].draw ? 0 : (target - pts[i - 1].draw) / (pts[i].draw - pts[i - 1].draw);
            recSpend = round5(pts[i - 1].spend + (pts[i].spend - pts[i - 1].spend) * t);
            break;
          }
        }
        // Fallback for large portfolios: a 4% DRAW can land beyond the slider's max
        // spending (you'd never spend that much), so the crossing above isn't found.
        // Anchor the recommended on ~4% of savings as a spend instead, so there's
        // always a sensible default chip. Either way, cap at the sustainable ceiling.
        if (recSpend == null) recSpend = floor5(Math.min(SPEND_MAX, target));
        if (recSpend != null && hasRoom && sweep.sustainableMax > 5_000) recSpend = Math.min(recSpend, floor5(sweep.sustainableMax));
        if (recSpend != null && recSpend < 5_000) recSpend = null;
      }

      // Secondary "quick amounts": just under each IRMAA cliff, and the most you
      // could safely spend. Deduped (within $5k) and sorted.
      const rawChips: { label: string; value: number; cls: string }[] = [];
      impact.irmaaCliffs.forEach((c) => {
        const v = floor5(c.spend - 2_500); // land just UNDER the cliff
        if (v >= 5_000 && v < SPEND_MAX) rawChips.push({ label: `Under ${shortTier(c.toLabel)}`, value: v, cls: "border-tax/40 text-tax" });
      });
      if (hasRoom && sweep.sustainableMax > 5_000 && sweep.sustainableMax <= SPEND_MAX)
        rawChips.push({ label: "Most you can afford", value: floor5(sweep.sustainableMax), cls: "border-accent/50 text-accent" });
      const otherChips: typeof rawChips = [];
      rawChips
        .sort((a, b) => a.value - b.value)
        .forEach((c) => {
          if (recSpend != null && Math.abs(c.value - recSpend) < 5_000) return; // don't duplicate the recommended
          if (!otherChips.some((x) => Math.abs(x.value - c.value) < 5_000)) otherChips.push(c);
        });
      const chips = otherChips.slice(0, 3);

      // Confidence band (today's dollars) for the "what's it worth at the end"
      // readout — a real range, not a single number. Settles a beat behind a drag.
      const cw = confidence?.endingWealthReal;
      const band = confidence?.bandReal;
      // Does spending actually move the IRMAA tier, or is it pinned by other income
      // (SS, dividends, forced RMDs)? If your MAGI at this spend is already at the
      // floor it'd be with ZERO spending, then spending isn't adding to it — so you
      // can't trim your way under the cliff. Say that honestly instead of implying
      // a smaller spend would help.
      const baseMagi = impact.points[0]?.magi ?? 0;
      const irmaaPinned = medicareEnrollees > 0 && !!irmaaCliff?.inSurcharge && liveImpact.magi <= baseMagi + 5_000;

      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">How much do you want to spend each year?</h2>
          <p className="mt-1 text-[13px] text-foreground/60">
            Your <strong>take-home</strong> target — money in your pocket after all taxes. As you move it, watch your tax
            rate, your Medicare (IRMAA) tier, and what your savings are worth at the end all update below.
          </p>
          <div className="mt-4 text-center">
            <div className="tabular text-4xl font-bold text-primary">
              <AnimatedNumber value={localSpend} format={(n) => money(n)} />
            </div>
            <div className="text-[12px] text-foreground/50">
              per year, after tax{" "}
              <span className="text-foreground/40">(≈ {money(Math.round(localSpend / 12))}/mo)</span>
              {plan.filingStatus === "mfj" ? <span className="text-foreground/40"> · total for both of you</span> : ""}
            </div>
          </div>

          {/* Colored "how much you can spend" zones + slider */}
          <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/5">
            <div className="bg-gain/70" style={{ width: `${compPct}%` }} title="Comfortable" />
            <div className="bg-accent/60" style={{ width: `${sustPct - compPct}%` }} title="Doable but tight" />
            <div className="bg-tax/50" style={{ width: `${100 - sustPct}%` }} title="Runs short" />
          </div>
          <input
            type="range"
            min={0}
            max={SPEND_MAX}
            step={5_000}
            value={Math.min(SPEND_MAX, localSpend)}
            onChange={(e) => setLocalSpend(Number(e.target.value))}
            className="mt-1.5 w-full accent-primary"
            aria-label="Yearly spending"
          />

          {/* Marker rail: where the safe ceilings and the IRMAA cliffs fall, in
              spending terms — so the cliffs aren't a surprise you only meet later. */}
          {markers.length > 0 && (
            <>
              <div className="relative mt-1 h-4">
                {markers.map((m) =>
                  m.dotted ? (
                    <div
                      key={m.key}
                      className="absolute top-0 h-4 w-0 -translate-x-1/2 border-l-2 border-dotted border-tax"
                      style={{ left: `${pos(m.value)}%` }}
                      title={`${m.title} — kicks in around ${money(m.value)}/yr of spending`}
                    />
                  ) : (
                    <div
                      key={m.key}
                      className={`absolute top-0 h-3 w-[2px] -translate-x-1/2 rounded-full ${m.cls}`}
                      style={{ left: `${pos(m.value)}%` }}
                      title={`${m.title} — ${money(m.value)}/yr`}
                    />
                  ),
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-foreground/45">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-[2px] rounded-full bg-gain" /> comfortable</span>
                {markers.some((m) => m.key === "sust") && (
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-[2px] rounded-full bg-accent" /> max safe</span>
                )}
                {markers.some((m) => m.dotted) && (
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-0 border-l-2 border-dotted border-tax" /> 🏥 where IRMAA would start (you&apos;re under it now)</span>
                )}
              </div>
            </>
          )}

          {/* Each year after this: grow with inflation (sensible default) or stay flat.
              Costs rise, so flat spending for decades quietly erodes your lifestyle — we
              default to keeping it steady in real terms, but let you choose flat. */}
          {(() => {
            const yearsToEnd = Math.max(0, settings.endAge - plan.selfAge);
            const grownAtEnd = localSpend * Math.pow(1 + settings.inflationRate, yearsToEnd);
            return (
              <div className="mt-4 rounded-2xl border border-border p-3">
                <div className="text-[12px] font-semibold">Each year after this…</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/60">
                  Prices rise over time, so by default we grow your spending with inflation (about{" "}
                  {percent(settings.inflationRate, 1)}/yr) to keep your lifestyle the same — {money(localSpend)} today
                  would be about <strong>{money(Math.round(grownAtEnd))}</strong>/yr at age {settings.endAge}. The
                  forecasts below already do this.
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    onClick={() => updateSettings({ spendingStrategy: "constant" })}
                    className={`press rounded-xl border p-2 text-left ${settings.spendingStrategy === "constant" ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <div className="text-[12px] font-semibold">Grow with inflation</div>
                    <div className="text-[10px] text-foreground/55">keeps your lifestyle · recommended</div>
                  </button>
                  <button
                    onClick={() => updateSettings({ spendingStrategy: "flatNominal" })}
                    className={`press rounded-xl border p-2 text-left ${settings.spendingStrategy === "flatNominal" ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <div className="text-[12px] font-semibold">Keep it flat</div>
                    <div className="text-[10px] text-foreground/55">same dollars · buys less each year</div>
                  </button>
                  <button
                    onClick={() => updateSettings({ spendingStrategy: "guardrails" })}
                    className={`press rounded-xl border p-2 text-left ${settings.spendingStrategy === "guardrails" ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <div className="text-[12px] font-semibold">Guardrails</div>
                    <div className="text-[10px] text-foreground/55">trim in bad years, raise in good · most resilient</div>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Quick amounts — anchor the choice to a meaningful number in one tap.
              The recommended ~4% safe-pace amount leads, styled as the default. */}
          {(recSpend != null || chips.length > 0) && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">Quick amounts</div>
              <div className="flex flex-wrap gap-2">
                {recSpend != null && (() => {
                  const active = Math.abs(localSpend - recSpend) < 2_500;
                  return (
                    <button
                      onClick={() => setLocalSpend(recSpend!)}
                      className={`press rounded-full border px-3 py-1 text-[12px] font-semibold ${active ? "border-primary bg-primary text-white" : "border-primary bg-primary/10 text-primary"}`}
                    >
                      ✓ Recommended · {moneyCompact(recSpend)}
                    </button>
                  );
                })()}
                {chips.map((c) => {
                  const active = Math.abs(localSpend - c.value) < 2_500;
                  return (
                    <button
                      key={c.label}
                      onClick={() => setLocalSpend(c.value)}
                      className={`press rounded-full border px-3 py-1 text-[12px] font-medium ${active ? "border-primary bg-primary/10 text-primary" : `${c.cls} bg-transparent`}`}
                    >
                      {c.label} · {moneyCompact(c.value)}
                    </button>
                  );
                })}
              </div>
              {recSpend != null && (
                <p className="mt-1 text-[10px] leading-snug text-foreground/45">
                  Recommended ≈ a <strong>4% withdrawal pace</strong>, the rate planners treat as safe for a long retirement.
                </p>
              )}
            </div>
          )}

          {/* Live "what this number means right now" — tax rate + Medicare tier,
              both reading off the chosen spending so they move with the slider. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-foreground/50">Tax this year</div>
              <div className="tabular text-lg font-bold text-foreground/85">{moneyCompact(liveImpact.totalTax)}</div>
              <div className="text-[10px] leading-snug text-foreground/45">
                federal + state · from your spending
                {liveImpact.marginalRate > 0.12 ? ` · top bracket ${percent(liveImpact.marginalRate, 0)}` : ""}
              </div>
            </div>
            <div className={`rounded-xl border p-2.5 ${irmaaCliff?.inSurcharge ? "border-tax/30 bg-tax/[0.05]" : "border-border bg-card/60"}`}>
              <div className="text-[10px] uppercase tracking-wide text-foreground/50">Medicare (IRMAA)</div>
              {medicareEnrollees === 0 ? (
                <>
                  <div className="text-[13px] font-bold text-foreground/70">Not yet</div>
                  <div className="text-[10px] leading-snug text-foreground/45">starts at 65</div>
                </>
              ) : irmaaCliff?.inSurcharge ? (
                <>
                  <div className="tabular text-lg font-bold text-tax">+{moneyCompact(irmaaCliff.curSurcharge)}/yr</div>
                  <div className="text-[10px] leading-snug text-foreground/45">
                    {shortTier(irmaaCliff.curLabel)} · {money(Math.round(irmaaCliff.curPerPersonMo))}/mo per person
                    {irmaaCliff.enrollees > 1 ? ` × ${irmaaCliff.enrollees} on Medicare` : ""}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-snug text-foreground/40">
                    = {money(Math.round(irmaaCliff.curPartB))} Part B + {money(Math.round(irmaaCliff.curPartD))} Part D
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[13px] font-bold text-gain">No surcharge</div>
                  <div className="text-[10px] leading-snug text-foreground/45">
                    {irmaaCliff && Number.isFinite(irmaaCliff.distance) ? `${moneyCompact(irmaaCliff.distance)} of room` : "well clear"}
                  </div>
                </>
              )}
            </div>
          </div>
          {pretaxShare > 0.2 && (
            <p className="mt-1.5 text-[11px] leading-snug text-foreground/45">
              This is from your <strong>spending alone</strong>. Your Roth rollover is the <strong>next step</strong> — it adds
              taxable income on top of this, which is what can push your Medicare (IRMAA) tier up.
            </p>
          )}

          {/* Why no IRMAA today can be temporary: a take-home spend funded largely from
              already-taxed/non-taxable money (cash & CD principal, brokerage cost basis,
              Roth) keeps MAGI low NOW — but as those drain and RMDs ramp, MAGI climbs and
              a surcharge can arrive. Only shown when the gap is real AND the no-conversion
              projection actually crosses into IRMAA in a future year. */}
          {(() => {
            if (irmaaCliff?.inSurcharge) return null; // already in surcharge — covered above
            const magiNow = Math.round(liveImpact.magi);
            const spendNow = Math.round(localSpend);
            const gap = spendNow - magiNow;
            const firstIrmaa = compare.none.rows.find((r) => r.irmaa > 0 && r.year > year);
            if (!firstIrmaa || gap < 50_000) return null;
            return (
              <p className="mt-2 rounded-xl border border-ss/25 bg-ss/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-foreground/70">
                ⏳ <strong>Don&apos;t count on $0 IRMAA forever — this is mostly a &ldquo;right now&rdquo; thing.</strong> A big
                slice of your {money(spendNow)}{" "}comes from money that isn&apos;t taxable income — cash &amp; CD principal, the
                original cost of your brokerage holdings (you already paid tax on it), and any Roth — so your taxable income
                (MAGI) is only about {money(magiNow)} this year, well under the surcharge line. As those draw down and required
                withdrawals (RMDs) ramp up, more of your spending comes from pre-tax accounts and your MAGI climbs: even funding
                it the way you do now, your Forecast crosses into an IRMAA surcharge around <strong>{firstIrmaa.year}</strong>{" "}
                (age {firstIrmaa.selfAge}). No surprise later — it&apos;s already in the projections.
              </p>
            );
          })()}

          {/* Deep IRMAA policy — desktop only; mobile keeps the live tier readout above. */}
          <DesktopOnly>
          {medicareEnrollees > 0 && (
            <Info q="How is this Medicare (IRMAA) number figured — and why doesn't it match Medicare's premium table?" sources={[SOURCES.irmaa]}>
              <p>
                <strong>IRMAA</strong> is an income-related surcharge that gets <strong>added on top of</strong> the standard
                Medicare premium everyone pays (in 2026 that base is about <strong>$203/mo</strong> for Part B, plus your Part D
                plan). Once your income crosses a threshold, you pay the standard premium <em>plus</em> this extra.
              </p>
              <p className="mt-2">
                Medicare quotes it <strong>per person, per month</strong>, and splits it into Part&nbsp;B and Part&nbsp;D. The figure
                here is the <strong>surcharge only</strong> (not the total premium), with Part&nbsp;B and Part&nbsp;D{" "}
                <strong>combined</strong>, then shown <strong>per year</strong> for the{" "}
                {medicareEnrollees > 1 ? `${medicareEnrollees} of you` : "one of you"}{" "}on Medicare. So Medicare&apos;s own
                table looks bigger because it shows the <em>whole</em> monthly premium (standard + surcharge), each part on its own
                line — this shows just the added yearly cost.
              </p>
              {irmaaCliff?.inSurcharge && (
                <p className="mt-2 rounded-lg bg-tax/[0.06] px-2 py-1.5">
                  In your tier ({shortTier(irmaaCliff.curLabel)}) that&apos;s about{" "}
                  <strong>{money(Math.round(irmaaCliff.curPartB))}/mo Part&nbsp;B</strong> +{" "}
                  <strong>{money(Math.round(irmaaCliff.curPartD))}/mo Part&nbsp;D</strong> ≈{" "}
                  <strong>{money(Math.round(irmaaCliff.curPerPersonMo))}/mo per person</strong>. Part&nbsp;D alone tops out near{" "}
                  <strong>$91/mo</strong>{" "}even at the highest income — so the big piece is always Part&nbsp;B (that&apos;s why
                  this is far more than the ~$91 max on the Part&nbsp;D table).{" "}
                  {irmaaCliff.enrollees > 1 ? (
                    <>With <strong>{irmaaCliff.enrollees} of you</strong> on Medicare, the household pays{" "}
                    {money(Math.round(irmaaCliff.curPerPersonMo))} × 12 × {irmaaCliff.enrollees} ={" "}
                    <strong>{money(irmaaCliff.curSurcharge)}/yr</strong>.</>
                  ) : (
                    <>For the one of you on Medicare so far, that&apos;s {money(Math.round(irmaaCliff.curPerPersonMo))} × 12 ={" "}
                    <strong>{money(irmaaCliff.curSurcharge)}/yr</strong> (it doubles once both of you are enrolled).</>
                  )}
                </p>
              )}
              <p className="mt-2">
                The spending number above is your <strong>whole household&apos;s</strong>{" "}take-home — not per person. The
                IRMAA surcharge is the opposite: it&apos;s billed to <strong>each person</strong> on Medicare, so the yearly
                household cost is the per-person amount × the number of you enrolled.
              </p>
              <p className="mt-2">
                Your tier is set by your{" "}
                <strong>{plan.filingStatus === "single" ? "single-filer" : "married-filing-jointly"} MAGI from two years earlier</strong>{" "}
                — your 2026 premium uses your 2024 income. The brackets are the{" "}
                {plan.filingStatus === "single" ? "single" : "joint"} ones (for 2026, the surcharge starts at{" "}
                <strong>{plan.filingStatus === "single" ? "$109,000" : "$218,000"}</strong>{" "}of MAGI
                {plan.filingStatus === "single" ? "" : " — double the single-filer threshold"}).
              </p>
            </Info>
          )}
          </DesktopOnly>

          {/* Zone verdict — does it last, and what's left (live, downside path). */}
          {hasRoom && (
            <p
              className={`mt-3 rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                zone === "comfortable" ? "bg-gain/5 text-foreground/80" : zone === "tight" ? "bg-accent/10 text-foreground/80" : "bg-tax/5 text-foreground/80"
              }`}
            >
              {zone === "comfortable" && (
                <>✅ <strong>Comfortable.</strong> Even on a single cautious (below-average) market path your money lasts to{" "}
                  {settings.endAge}, leaving about <strong>{money(cur.endingEstateReal)}</strong>{" "}in today&apos;s dollars. The
                  range below stress-tests that across hundreds of markets.</>
              )}
              {zone === "tight" && (
                <>🟡 <strong>Doable, but tight.</strong> On a cautious market path it lasts to {settings.endAge}, ending with
                  only about <strong>{money(cur.endingEstateReal)}</strong>{" "}in today&apos;s dollars. The range below shows
                  how much the markets could swing that.</>
              )}
              {zone === "short" && (
                <>🔴 <strong>Too high.</strong> At this level your savings would run short around <strong>age {Number.isFinite(cur.depletionAge) ? cur.depletionAge : settings.endAge}</strong>.</>
              )}
            </p>
          )}

          {/* Withdrawal-rate guide — the classic "4% rule" yardstick. Desktop-only:
              the zone verdict above already gives mobile the sustainability read. */}
          <DesktopOnly>
          {portfolioTotal > 0 && (() => {
            const liveWR = liveImpact.draw / portfolioTotal;
            const drawing = liveImpact.draw > 0.5;
            const wrTone = !drawing || liveWR <= 0.045 ? "gain" : liveWR <= 0.06 ? "accent" : "tax";
            return (
              <p className={`mt-2 rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-${wrTone}/[0.07] text-foreground/80`}>
                💡{" "}
                {!drawing ? (
                  <>Your guaranteed income covers this spending — you&apos;re not drawing from savings yet, so you&apos;re well within a sustainable pace.</>
                ) : (
                  <>
                    At this spending you&apos;d pull about <strong className={`text-${wrTone}`}>{(liveWR * 100).toFixed(1)}%</strong> of your{" "}
                    <strong>{money(portfolioTotal)}</strong> in savings this year.{" "}
                    {liveWR <= 0.045
                      ? "That's at or below the ~4–4.5% pace planners treat as sustainable for a long retirement — a comfortable draw."
                      : liveWR <= 0.06
                        ? "That's a bit above the classic ~4% pace — workable, but worth watching, especially before Social Security starts."
                        : "That's a steep pace versus the ~4% rule of thumb — the market-risk range below shows whether it holds up."}
                  </>
                )}
              </p>
            );
          })()}
          </DesktopOnly>

          {/* Portfolio value over time, as a confidence interval — the standard
              high-end "fan", not a single line. Reads off the off-thread Monte
              Carlo, which lags a drag; while it catches up we show "updating…"
              rather than a stale band that would contradict the verdict above. */}
          {/* The full market-risk range is detail — on mobile it lives on the final
              "how solid is this plan?" step; here we keep it only where there's room. */}
          <DesktopOnly>
          {(() => {
            const fanFresh = confidenceSpend != null && Math.abs(confidenceSpend - localSpend) < 2_500;
            const haveFan = band && band.length > 1 && cw;
            return (
              <div className="mt-3 rounded-2xl border border-border p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                  What your savings could be worth — range across {(confidence?.runs ?? 300).toLocaleString()} markets
                </div>
                {haveFan && fanFresh ? (
                  <>
                    <FanChart band={band!} height={180} yLabel={(n) => moneyCompact(n)} startAge={plan.selfAge} />
                    <p className="mt-1 text-[12px] leading-relaxed text-foreground/70">
                      At age {settings.endAge}, in today&apos;s dollars, your savings are likely worth between{" "}
                      <strong>{moneyCompact(cw!.p10)}</strong> and <strong>{moneyCompact(cw!.p90)}</strong> — typically around{" "}
                      <strong>{moneyCompact(cw!.p50)}</strong>. The shaded band is the middle range of outcomes; the line is the median.
                    </p>
                    <p className="mt-1 text-[10px] text-foreground/45">
                      Spans good and bad market sequences, not a single average path.
                    </p>
                    <Info q="How is this range figured?" sources={[SOURCES.monteCarlo, SOURCES.cma]}>
                      We replay your whole plan across {(confidence?.runs ?? 300).toLocaleString()} different market histories
                      (a &ldquo;Monte Carlo&rdquo; simulation). In each one, every year we roll the dice on stocks, bonds, cash,
                      and inflation <em>together</em> — the way they actually move, so a 2022-style year where stocks and bonds
                      fall while inflation spikes can happen — and we allow more big crashes and booms than a plain bell curve
                      would (&ldquo;fat tails&rdquo;). Each year&apos;s spending is withdrawn <em>before</em> the market grows, so
                      a bad early stretch hurts the way it really would (sequence-of-returns risk). The shaded band is the
                      middle range (10th–90th percentile) of where you land; the dark line is the median. Returns use
                      forward-looking 2026 capital-market assumptions (≈7.9% stocks / 4.9% bonds, cross-checked across J.P.
                      Morgan, Vanguard &amp; Morningstar), not a backward-looking ~10% average.
                    </Info>
                  </>
                ) : (
                  <div className="flex items-center gap-2 py-6 text-[12px] text-foreground/55">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
                    Updating the range for {money(localSpend)}/yr across hundreds of market simulations…
                  </div>
                )}
              </div>
            );
          })()}
          </DesktopOnly>

          {/* Medicare IRMAA cliff awareness — live, fed by the slider's MAGI. The
              spending you pick drives the withdrawals that drive MAGI, and IRMAA
              is a hard step, not a slope. */}
          {irmaaCliff && (irmaaCliff.inSurcharge || (!irmaaCliff.atTop && irmaaCliff.distance < 30_000)) && (
            <div className="mt-3 rounded-xl border border-tax/30 bg-tax/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
              <div className="font-semibold text-tax">🏥 Watch the Medicare (IRMAA) cliff</div>
              {irmaaCliff.inSurcharge ? (
                <p className="mt-1">
                  At this spending level your income lands in <strong>{irmaaCliff.curLabel}</strong> — about{" "}
                  <strong>{money(irmaaCliff.curSurcharge)}/yr</strong> in extra Medicare premiums for{" "}
                  {irmaaCliff.enrollees > 1 ? "both of you" : "you"}, billed two years later.
                  {irmaaPinned ? (
                    <>
                      {" "}
                      Dialing spending up or down won&apos;t clear this — your tier is set by your Roth rollover and fixed
                      income (dividends, RMDs), not your spending. Adjust the rollover (next step) to change it.
                    </>
                  ) : (
                    irmaaCliff.overBy > 0 && irmaaCliff.overBy < 15_000 && irmaaCliff.dropSaving > 0 && (
                      <>
                        {" "}
                        You&apos;re only <strong>{money(irmaaCliff.overBy)}</strong> over the line — trimming spending (the{" "}
                        <em>Under {shortTier(irmaaCliff.curLabel)}</em> quick amount above does it) could drop{" "}
                        {money(irmaaCliff.dropSaving)}/yr of that surcharge entirely.
                      </>
                    )
                  )}
                </p>
              ) : (
                <p className="mt-1">
                  You&apos;re within <strong>{money(irmaaCliff.distance)}</strong> of the next IRMAA cliff (MAGI{" "}
                  {money(irmaaCliff.nextThreshold)}). Crossing it would add about <strong>{money(irmaaCliff.nextJump)}/yr</strong>{" "}
                  in Medicare premiums for {irmaaCliff.enrollees > 1 ? "both of you" : "you"} — and it&apos;s a cliff: one
                  dollar over triggers the whole surcharge.
                </p>
              )}
              {portfolioTotal > 0 && (() => {
                const amt = irmaaCliff.inSurcharge ? irmaaCliff.curSurcharge : irmaaCliff.nextJump;
                if (amt <= 0) return null;
                const pct = amt / portfolioTotal;
                const pctStr = pct < 0.001 ? "under 0.1%" : `${(pct * 100).toFixed(pct < 0.01 ? 2 : 1)}%`;
                const tiny = pct < 0.005;
                return (
                  <p className="mt-1.5 rounded-lg bg-gain/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-foreground/75">
                    💡 But keep it in scale: {money(amt)}/yr is only about <strong>{pctStr}</strong> of your{" "}
                    {money(portfolioTotal)} in savings{tiny ? <> — a tiny slice. It&apos;s rarely a good reason to spend less than you comfortably can; you saved this money to use it.</> : "."}
                  </p>
                );
              })()}
              <p className="mt-1 text-[11px] text-foreground/55">
                IRMAA is based on your income from two years prior, so today&apos;s choices set your premiums then.
              </p>
            </div>
          )}
        </div>
      );
    },
  });

  // STEP — market assumptions (return + inflation). These set the MIDDLE of every
  // projection; the forecast still stress-tests across hundreds of paths around them.
  steps.push({
    key: "markets",
    chapter: "markets",
    eyebrow: "market assumptions",
    render: () => {
      const btn = (on: boolean) =>
        `press rounded-xl border py-2 text-center ${on ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-foreground/70"}`;
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">What should we assume about markets?</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
            These set the middle of every projection. We default to cautious, professional long-run numbers — nudge them
            if you like. (The forecast then stress-tests hundreds of market paths around this.)
          </p>
          <div className="mt-4">
            <div className="mb-1 text-[12px] font-medium text-foreground/60">Average yearly return, after fees</div>
            <div className="grid grid-cols-3 gap-2">
              {[{ r: 0.04, l: "Cautious" }, { r: 0.05, l: "Moderate" }, { r: 0.06, l: "Optimistic" }].map((o) => (
                <button key={o.r} onClick={() => updateSettings({ returnRate: o.r })} className={btn(near(settings.returnRate, o.r))}>
                  <div className="text-lg font-bold leading-none">{percent(o.r, 0)}</div>
                  <div className="mt-0.5 text-[10px]">{o.l}{o.r === 0.05 ? " ★" : ""}</div>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-foreground/55">
              {near(settings.returnRate, 0.04)
                ? "Cautious — a conservative long-run estimate; your plan looks safer if markets disappoint."
                : near(settings.returnRate, 0.06)
                  ? "Optimistic — closer to the historical stock average; assumes a strong, stock-heavy run."
                  : "Moderate — a professional middle estimate for a balanced mix. ★ Suggested unless you have a reason to differ."}
            </p>
          </div>
          <div className="mt-4">
            <div className="mb-1 text-[12px] font-medium text-foreground/60">Inflation</div>
            <div className="grid grid-cols-4 gap-2 text-[13px]">
              {[0.02, 0.025, 0.03, 0.035].map((r) => (
                <button key={r} onClick={() => updateSettings({ inflationRate: r })} className={btn(near(settings.inflationRate, r))}>
                  {percent(r, 1)}{r === 0.025 ? " ★" : ""}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-foreground/55">
              How fast prices rise each year. <strong>2.5%</strong> (★) is about the long-run average and the Fed&apos;s
              target — a sensible default.
            </p>
          </div>
        </div>
      );
    },
  });

  // ── Confirm the Roth rollover — its own step right after spending, so the picture
  // builds up in order: spending first (previous step), then we add the rollover's
  // taxable income on top and re-show the Medicare (IRMAA) tier. ──
  if (pretaxShare > 0.2) {
    steps.push({
      key: "rollconfirm",
      chapter: "markets",
      eyebrow: "confirm your rollover",
      render: () => {
        const on = settings.useConversions;
        const tiers = FILING_CONSTANTS[plan.filingStatus].irmaaTiers;
        const fct = plan.inflationFactor;
        const before = irmaaCliffInfo(planNoConv.tax.magi, fct, tiers, medicareEnrollees);
        const after = irmaaCliffInfo(planWithRoll.tax.magi, fct, tiers, medicareEnrollees);
        const rollAmt = planWithRoll.conversion;
        const rollTax = planWithRoll.conversionTax;
        const addlMagi = Math.max(0, planWithRoll.tax.magi - planNoConv.tax.magi);
        const irmaaJump = (after?.curSurcharge ?? 0) - (before?.curSurcharge ?? 0);
        const tierName = (l: string) => l.replace(" surcharge", "").replace("Standard premium", "no surcharge");
        const irmaaCell = (c: ReturnType<typeof irmaaCliffInfo>) =>
          medicareEnrollees === 0 ? "—" : c?.inSurcharge ? `+${moneyCompact(c.curSurcharge)}/yr` : "none";
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">Confirm your Roth rollover</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              Separate from your spending, your plan can move some pre-tax money into a Roth this year — taxed at a low,
              controlled rate now — to shrink the big forced withdrawals (RMDs) that would be taxed harder later. Here&apos;s
              exactly what it adds on top of the spending you just chose.
            </p>

            {rollAmt < 1 ? (
              (() => {
                // Nothing to convert THIS year — so answer the real question: WHEN does
                // it start to pay off? Read it straight from the projection. compare.smooth
                // is the rate-arbitrage path; its first FUTURE conversion year is the answer.
                const noneThis = compare.none.rows[0];
                const convRows = compare.smooth.rows.filter((r) => r.conversion > 1);
                const fc = convRows.find((r) => r.year > year);
                const gainReal = compare.smooth.endingEstateAfterTaxReal - compare.none.endingEstateAfterTaxReal;
                const peakRate = compare.none.peakMarginalRate;
                const peakRmd = compare.none.peakRmd;
                const thisRate = noneThis?.marginalRate ?? planNoConv.tax.marginalOrdinaryRate;
                const thisMagi = Math.round(noneThis?.magi ?? planNoConv.tax.magi);

                if (fc && gainReal > 1_000) {
                  const total = compare.smooth.totalConverted;
                  const yearsAway = fc.year - year;
                  const avgPerYear = Math.round(total / Math.max(1, convRows.length));
                  return (
                    <>
                      <Callout tone="info" icon="📅" title={`Start rolling over in ${fc.year} — at age ${fc.selfAge}`}>
                        Not this year. Your plan converts only in years when moving the money costs less than letting it
                        come out later as a forced withdrawal (RMD) — and <strong>{fc.year}</strong>
                        {yearsAway > 0 ? <>, about {yearsAway} {yearsAway === 1 ? "year" : "years"} out,</> : null}{" "}is the
                        first year that&apos;s true for you. Converting sooner would push your next dollars into a higher
                        rate (counting how a rollover adds to your taxable Social Security and Medicare premiums), so the
                        plan waits for the room to open.
                      </Callout>

                      <div className="mt-3 rounded-2xl border border-border p-3 text-[12.5px] leading-relaxed">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                          The math, straight from your projection
                        </div>
                        <ul className="mt-2 space-y-1.5 text-foreground/75">
                          <li>
                            📅 First rollover in <strong>{fc.year}</strong> (age {fc.selfAge}), then about{" "}
                            <strong>{convRows.length} {convRows.length === 1 ? "year" : "years"}</strong> of conversions —
                            roughly <strong>{moneyCompact(avgPerYear)}/yr</strong>, <strong>{moneyCompact(total)}</strong>{" "}
                            moved into tax-free Roth in all.
                          </li>
                          <li>
                            🪜 Each move is taxed around <strong>{percent(fc.marginalRate, 0)}</strong> — versus up to{" "}
                            <strong>{percent(peakRate, 0)}</strong> on the RMDs it heads off (which would otherwise force
                            out as much as <strong>{moneyCompact(peakRmd)}</strong> in a single year).
                          </li>
                          <li>
                            💰 Net projected payoff: about <strong>{moneyCompact(gainReal)}</strong>{" "}more for your
                            family after every tax is paid (in today&apos;s dollars).
                          </li>
                        </ul>
                        <p className="mt-2 text-[11px] text-foreground/55">
                          The plan does this for you automatically — there&apos;s nothing to act on this year.
                        </p>
                      </div>
                    </>
                  );
                }

                return (
                  <Callout tone="info" icon="✓" title="No rollover pays off — this year or later">
                    The plan checked every year through age <strong>{settings.convertUntilAge}</strong> and found none where
                    converting clearly wins: your taxable income never drops far enough below the{" "}
                    <strong>{percent(peakRate, 0)}</strong> your future RMDs are taxed at to make paying the tax early worth
                    it. That&apos;s the right answer for your numbers — and the plan re-checks it automatically each year, so
                    if a lower-income or down-market year opens up, it&apos;ll flag the conversion then.
                  </Callout>
                );
              })()
            ) : (
              <>
                <div className="mt-4 rounded-2xl border border-border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-foreground/45">Recommended this year</div>
                  <div className="tabular text-2xl font-bold text-primary">{money(rollAmt)}</div>
                  <div className="text-[12px] text-foreground/55">
                    moved from pre-tax → Roth. It isn&apos;t spent — it stays invested and grows tax-free, with no future RMDs.
                  </div>
                </div>

                {/* Build-up: spending → + rollover → total, with the Medicare tier at each line. */}
                <div className="mt-3 overflow-hidden rounded-2xl border border-border text-[12px]">
                  <div className="grid grid-cols-[1fr_6.5rem_5.5rem] gap-x-3 border-b border-border/60 px-3 py-1.5 text-[9px] uppercase tracking-wide text-foreground/40">
                    <span />
                    <span className="text-right">Income (MAGI)</span>
                    <span className="text-right">Medicare</span>
                  </div>
                  <div className="grid grid-cols-[1fr_6.5rem_5.5rem] items-center gap-x-3 px-3 py-2">
                    <span className="text-foreground/75">
                      From your spending
                      <div className="text-[10px] text-foreground/45">{money(household.annualSpending)}/yr take-home</div>
                    </span>
                    <span className="tabular text-right text-foreground/80">{money(Math.round(planNoConv.tax.magi))}</span>
                    <span className="tabular text-right text-foreground/70">{irmaaCell(before)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_6.5rem_5.5rem] items-center gap-x-3 bg-gain/[0.05] px-3 py-2">
                    <span className="font-medium text-gain">+ Roth rollover</span>
                    <span className="tabular text-right text-gain">
                      +{money(Math.round(addlMagi))}
                      <span className="block text-[10px] font-normal text-foreground/45">≈{moneyCompact(rollTax)} income tax</span>
                    </span>
                    <span className="tabular text-right text-foreground/70">
                      {medicareEnrollees === 0 ? "—" : irmaaJump > 1 ? `+${moneyCompact(irmaaJump)}/yr` : "none"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_6.5rem_5.5rem] items-center gap-x-3 border-t border-border/60 px-3 py-2 font-semibold">
                    <span>{on ? "= Your full plan" : "= If you do it"}</span>
                    <span className="tabular text-right">{money(Math.round(planWithRoll.tax.magi))}</span>
                    <span className={`tabular text-right ${after?.inSurcharge ? "text-tax" : "text-gain"}`}>{irmaaCell(after)}</span>
                  </div>
                </div>

                {medicareEnrollees > 0 && (before?.inSurcharge || after?.inSurcharge) && (() => {
                  const t = after?.inSurcharge ? after : before;
                  const perMo = Math.round(t?.curPerPersonMo ?? 0);
                  return (
                    <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-foreground/45">
                      The Medicare figures are the <strong>yearly total for everyone on Medicare</strong>, not per person.{" "}
                      {medicareEnrollees > 1
                        ? `Both of you are enrolled — about ${money(perMo)}/mo each (${money(perMo)} × 12 × 2).`
                        : `Only one of you is 65+ so far, so it covers one person (${money(perMo)}/mo × 12); your spouse adds the same once they reach 65.`}
                    </p>
                  );
                })()}

                {medicareEnrollees > 0 && irmaaJump > 1 && (
                  <p className="mt-2 rounded-xl border border-tax/30 bg-tax/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
                    🏥 <strong>Only in the years you convert.</strong> Adding this {money(rollAmt)} rollover on top of your
                    income lifts your taxable income (MAGI) this year from{" "}
                    <strong>{money(Math.round(planNoConv.tax.magi))}</strong>{" "}to{" "}
                    <strong>{money(Math.round(planWithRoll.tax.magi))}</strong> — high enough to reach Medicare&apos;s{" "}
                    <strong>{tierName(after?.curLabel ?? "")}</strong> surcharge band, about <strong>+{money(irmaaJump)}/yr</strong>{" "}
                    {medicareEnrollees > 1 ? "for both of you combined" : "for the one of you on Medicare"} (billed two years
                    out). You&apos;re <strong>not</strong> in that tier today — without the rollover you&apos;d owe no surcharge
                    (the top row) — and you&apos;d pay it only in years you actually convert. The next step shows the full
                    bracket math.
                  </p>
                )}
                {(() => {
                  const gainReal = compare.smooth.endingEstateAfterTaxReal - compare.none.endingEstateAfterTaxReal;
                  const peakBomb = compare.none.peakRmd;
                  const bombRate = compare.none.peakMarginalRate;
                  const noneIrmaa = compare.none.lifetimeIrmaa;
                  const smoothIrmaa = compare.smooth.lifetimeIrmaa;
                  const worthIt = gainReal > 1_000;
                  const surPct = irmaaJump > 1 && portfolioTotal > 0 ? irmaaJump / portfolioTotal : 0;
                  const surStr = surPct < 0.001 ? "under 0.1%" : `${(surPct * 100).toFixed(surPct < 0.01 ? 2 : 1)}%`;
                  return (
                    <DesktopOnly>
                    <p className="mt-2 rounded-xl bg-gain/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/75">
                      💡 <strong>Why it&apos;s worth it.</strong> Leave this money in pre-tax and your biggest forced withdrawal
                      (RMD) climbs to about <strong>{moneyCompact(peakBomb)}</strong>{" "}in a single year, taxed up at{" "}
                      <strong>{percent(bombRate, 0)}</strong>{" "}— a tax bomb you don&apos;t get to time.
                      {worthIt ? (
                        <> Rolling over now heads that off: it&apos;s projected to leave your family about{" "}
                        <strong>{moneyCompact(gainReal)}</strong>{" "}more (in today&apos;s dollars) after every tax is paid</>
                      ) : (
                        <> Rolling over now shrinks that forced withdrawal and the tax on it</>
                      )}
                      {medicareEnrollees > 0 && noneIrmaa > smoothIrmaa + 100 ? (
                        <>, and holds your lifetime Medicare surcharges near <strong>{moneyCompact(smoothIrmaa)}</strong>{" "}instead
                        of about <strong>{moneyCompact(noneIrmaa)}</strong> if you wait</>
                      ) : null}
                      .{irmaaJump > 1 ? (
                        <> The <strong>+{money(irmaaJump)}/yr</strong> surcharge during conversion years — about {surStr} of your
                        savings — is small next to that.</>
                      ) : null}
                    </p>
                    </DesktopOnly>
                  );
                })()}

                <div className="mt-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                    Follow this recommendation?
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateSettings({ useConversions: true, planCustomized: true })}
                      className={`press flex-1 rounded-xl border px-3 py-2 text-[13px] font-semibold ${on ? "border-primary bg-primary text-white" : "border-border text-foreground/70"}`}
                    >
                      ✓ Yes, do the rollover
                    </button>
                    <button
                      onClick={() => updateSettings({ useConversions: false, planCustomized: true })}
                      className={`press flex-1 rounded-xl border px-3 py-2 text-[13px] font-semibold ${!on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"}`}
                    >
                      Skip it this year
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-foreground/45">
                    {on ? (
                      <>Applied. Everything after this — your tax, your future RMDs, and what your family keeps — reflects this rollover.</>
                    ) : (
                      <>
                        Skipped. Your taxable income stays at {money(Math.round(planNoConv.tax.magi))} and your Medicare stays{" "}
                        {tierName(before?.curLabel ?? "no surcharge")} — but your pre-tax balance keeps growing, so your future
                        RMDs (and the tax on them) will be larger.
                      </>
                    )}
                  </p>
                </div>
              </>
            )}

            {/* The two remaining levers, tucked in an expander so they don't crowd the
                decision: how many years to keep converting, and the heir's tax rate. */}
            <Info q="Advanced — conversion window & your heirs' tax rate">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[12px] font-medium text-foreground/70">Keep converting through age</div>
                  <div className="grid grid-cols-4 gap-2 text-[13px]">
                    {[70, 73, 75, 80].map((a) => (
                      <button
                        key={a}
                        onClick={() => updateSettings({ convertUntilAge: a, planCustomized: true })}
                        className={`press rounded-xl border py-1.5 ${settings.convertUntilAge === a ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70"}`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-foreground/50">
                    How long the plan keeps moving pre-tax → Roth. Longer can shift more before RMDs start, but spreads the
                    tax over more years.
                  </p>
                </div>
                <div>
                  <div className="mb-1 text-[12px] font-medium text-foreground/70">If a non-spouse heir inherits your pre-tax, assume they pay</div>
                  <div className="grid grid-cols-4 gap-2 text-[13px]">
                    {[0.12, 0.22, 0.24, 0.32].map((r) => (
                      <button
                        key={r}
                        onClick={() => updateSettings({ heirTaxRate: r })}
                        className={`press rounded-xl border py-1.5 ${Math.abs(settings.heirTaxRate - r) < 1e-9 ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70"}`}
                      >
                        {percent(r, 0)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-foreground/50">
                    Inherited pre-tax money is taxed as the heir&apos;s income (SECURE Act 10-year rule). This sets how the
                    &ldquo;money your family keeps&rdquo; figures discount it — Roth is inherited tax-free.
                  </p>
                </div>
              </div>
            </Info>
          </div>
        );
      },
    });
  }

  steps.push({
    key: "fund",
    chapter: "markets",
    eyebrow: "what pays for it — and from where",
    render: () => {
      const pct = Math.round(coverageRatio * 100);
      const heading = coveredByIncome
        ? "Your income already covers it"
        : coverageRatio >= 0.5
          ? "Good news — most of it is already covered"
          : coverageRatio >= 0.25
            ? "A good chunk is already covered"
            : pendingSS > 0.5
              ? "This year, most comes from your accounts"
              : "Here's what funds your spending";
      // Itemize guaranteed income (SS + pension) so it isn't a black box.
      const gItems = [
        { label: "Social Security", value: ssNow },
        { label: "Pension", value: plan.fixed.pension },
      ].filter((g) => g.value > 0.5);
      // Withdrawal-rate read: is the savings draw a sustainable pace?
      const wrPct = (withdrawalRate * 100).toFixed(1);
      const wrTone = withdrawalRate <= 0.045 ? "gain" : withdrawalRate <= 0.06 ? "accent" : "tax";

      // Where that savings draw comes from: required first, then the order that keeps
      // the most after lifetime tax. (Same money as "From savings" above — this is its breakdown.)
      const items: { label: string; amount: number; why: string }[] = [];
      if (rmd > 0.5) items.push({ label: "Take your required withdrawal (RMD)", amount: rmd, why: "The IRS forces this out of pre-tax accounts first; it's taxed as ordinary income." });
      if (voluntaryPretax > 0.5) items.push({ label: "Withdraw from pre-tax (IRA/401k)", amount: voluntaryPretax, why: "Taxed as ordinary income — but done now, in a low bracket, so less is forced out at higher rates later." });
      if (w.taxable > 0.5) items.push({ label: "Spend from taxable accounts (cash first, then brokerage)", amount: w.taxable, why: "Cash is spent first (no tax); then brokerage, where only the gain is taxed at the lower capital-gains rate." });
      if (w.roth > 0.5) items.push({ label: "Tap your Roth (tax-free)", amount: w.roth, why: "Used last — tax-free and never forced out, so it keeps compounding the longest." });
      const keep = (p: typeof orderCompare.conventional) =>
        Math.max(0, p.endingEstateAfterTax - p.endingBuckets.taxableGain * 0.15);
      const orders = [
        { key: "conventional", name: "Brokerage & cash first", v: keep(orderCompare.conventional) },
        { key: "smart", name: "Pre-tax first (fill low brackets)", v: keep(orderCompare.smart) },
        { key: "proportional", name: "A little from everything", v: keep(orderCompare.proportional) },
      ];
      const ranked = [...orders].sort((a, b) => b.v - a.v);
      const chosen = orders.find((o) => o.key === settings.strategy) ?? ranked[0];
      const runnerUp = ranked.find((o) => o.key !== chosen.key) ?? ranked[1];
      const edge = chosen.v - (runnerUp?.v ?? chosen.v);
      const usesBrokerageFirst = settings.strategy === "conventional";
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">{heading}</h2>
          <p className="mt-1 text-[13px] text-foreground/60">
            Two sources fund your spending: <strong>guaranteed income</strong> (Social Security &amp; pension — arrives no
            matter what) and <strong>your savings</strong>. Here&apos;s the split for {year}, and exactly which accounts the
            savings draw comes from.
          </p>
          <div className="mt-4">
            <StackedBar
              segments={[
                { value: guaranteed, className: "bg-ss", label: "Guaranteed income" },
                { value: fromSavings, className: "bg-taxable", label: "From your savings" },
              ].filter((s) => s.value > 0.5)}
            />
            <div className="mt-1 flex justify-between text-[11px] text-foreground/45">
              <span>{pct}% guaranteed income</span>
              <span>{100 - pct}% from your savings</span>
            </div>
            <div className="mt-3 space-y-1 text-[13px]">
              <Row label="Guaranteed income — Social Security &amp; pension" value={money(guaranteed)} tone="ss" bold />
              {guaranteed > 0.5 ? (
                gItems.map((g) => <Row key={g.label} label={`…${g.label}`} value={money(g.value)} sub />)
              ) : (
                <Row label="…not yet — Social Security hasn't started" value="$0" sub />
              )}
              <div className="my-1 border-t border-border/60" />
              <Row label="From your savings" value={money(fromSavings)} tone="taxable" bold />
              {divIntIncome > 0.5 && (
                <>
                  <Row label="…Dividends &amp; interest your accounts paid out (no selling)" value={money(divIntIncome)} sub />
                  <div className="pl-2">
                    <DividendInterestDetail
                      household={household}
                      qualified={plan.fixed.dividends}
                      ordinary={plan.fixed.ordinaryDividends}
                      taxableInt={plan.fixed.taxableInterest}
                      taxExemptInt={plan.fixed.taxExemptInterest}
                    />
                  </div>
                </>
              )}
              <Row label={divIntIncome > 0.5 ? "…Sold or withdrawn from your accounts" : "…Sold or withdrawn from your accounts"} value={money(totalDraw)} sub />
            </div>
            <p className="mt-1 text-[10px] leading-snug text-foreground/45">
              &ldquo;Your savings&rdquo; means everything you&apos;ve saved — pre-tax (IRA/401k), taxable (cash &amp;
              brokerage), and Roth combined. Dividends &amp; interest are the yield those accounts pay out (often reinvested);
              the steps below show which accounts this year&apos;s <em>sold/withdrawn</em> draw comes from.
            </p>
          </div>

          {/* What this means — the real value: is the draw sustainable, and what changes when SS starts. */}
          {coveredByIncome ? (
            <p className="mt-3 rounded-xl bg-ss/5 px-3 py-2 text-[13px] text-foreground/75">
              Your guaranteed income alone covers your spending this year — you don&apos;t need to pull from your accounts
              {rmd > 0.5 ? " beyond the required RMD" : ""}. Anything left over can stay invested.
            </p>
          ) : (
            <>
              {portfolioTotal > 0 && (
                <p className={`mt-3 rounded-xl px-3 py-2 text-[13px] leading-relaxed bg-${wrTone}/[0.07] text-foreground/80`}>
                  💡 The <strong>{money(totalDraw)}</strong> you pull is about{" "}
                  <strong className={`text-${wrTone}`}>{wrPct}%</strong> of your <strong>{money(portfolioTotal)}</strong> in savings.{" "}
                  {withdrawalRate <= 0.045
                    ? "That's at or below the ~4–4.5% pace planners treat as sustainable for a long retirement — a comfortable draw."
                    : withdrawalRate <= 0.06
                      ? "That's a bit above the classic ~4% pace — workable for now, but worth watching, especially before Social Security starts."
                      : "That's a steep pace versus the ~4% rule of thumb — the longevity check later will show whether it lasts."}
                </p>
              )}
              {pendingSS > 0.5 && Number.isFinite(nextClaimAge) && (
                <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground/75">
                  📅 This is the heavy-lifting phase: <strong>Social Security hasn&apos;t started yet</strong>. Once you claim
                  at {nextClaimAge}, about <strong>{money(pendingSS)}/yr</strong>{" "}more becomes guaranteed income — so
                  you&apos;ll pull noticeably less from your accounts, and these early years are the most you&apos;ll lean on them.
                </p>
              )}
            </>
          )}

          {/* Social Security claim-age guidance — the single highest-value lever, so
              we surface it (not silently apply it: when to claim is a personal call). */}
          {rec.claimAdvice && (
            <Callout tone="good" icon="📈" title="A bigger lever: when to claim Social Security" className="mt-3">
              {(() => {
                const ca = rec.claimAdvice;
                const who =
                  ca.delayWho === "self"
                    ? household.self.label
                    : ca.delayWho === "spouse"
                      ? household.spouse.label
                      : ca.delayWho === "both"
                        ? "both of you"
                        : "you";
                return (
                  <>
                    On your numbers, having <strong>{who}</strong> claim Social Security at{" "}
                    <strong>{ca.delayWho === "spouse" ? ca.spouse : ca.self}</strong>
                    {ca.delayWho === "both" ? ` / ${ca.spouse}` : ""} instead of {ca.currentSelf}
                    {ca.delayWho === "both" ? ` / ${ca.currentSpouse}` : ""} is projected to leave about{" "}
                    <strong>{money(ca.lift)}</strong>{" "}more over your lifetime — partly because delaying the higher earner
                    also locks in a larger benefit for whoever lives longer. It&apos;s a personal decision (health, cash
                    needs) — claim ages live on the Social Security step, so there&apos;s one place to set them.
                    <div className="mt-2">
                      <button
                        onClick={() => {
                          const i = steps.findIndex((s) => s.key === "ssclaim");
                          if (i >= 0) go(i);
                        }}
                        className="press rounded-lg border border-gain/40 bg-card/60 px-2.5 py-1 text-[11px] font-semibold text-primary"
                      >
                        ← Adjust claim ages (Social Security step)
                      </button>
                    </div>
                  </>
                );
              })()}
            </Callout>
          )}

          {/* Where that savings draw comes from — the withdrawal order, on the same money. */}
          {!coveredByIncome && items.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-base font-bold leading-snug">Where that {money(totalDraw)} comes from — in this order</h3>
              <p className="mt-1 text-[13px] text-foreground/60">
                Take what&apos;s required first, then the source your numbers show keeps the most money after every tax —
                saving tax-free Roth for last.
              </p>
              <ol className="mt-4 space-y-2">
                {items.map((it, i) => (
                  <li key={i} className="rise flex gap-3 rounded-2xl border border-border p-3" style={{ ["--i" as string]: i } as React.CSSProperties}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{it.label}</span>
                        <span className="tabular shrink-0 font-bold">{money(it.amount)}</span>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-foreground/60">{it.why}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {items.length === 1 && (
                <p className="mt-2 text-[12px] leading-snug text-foreground/55">
                  That one source covers this whole year&apos;s gap, so it&apos;s all you need now. In later years the mix can
                  shift as balances and tax brackets change.
                </p>
              )}

              {/* The rollover is SEPARATE money movement, not spending — connect the two. */}
              {conversion > 0.5 && (
                <p className="mt-2 rounded-xl bg-roth/[0.08] px-3 py-2 text-[12px] leading-relaxed text-foreground/75">
                  🔄 Separately, you&apos;ll move about <strong>{money(conversion)}</strong>{" "}from pre-tax into your Roth
                  (the next step). That&apos;s <em>not</em> spending — it lands in your Roth and grows tax-free; its tax is best paid
                  from cash.
                </p>
              )}

              {/* Why THIS order — proven on the user's own numbers, and honest about the
                  "spend taxable first" rule of thumb. Desktop-only: it's the evidence; the
                  order itself is already shown in the breakdown above. */}
              <DesktopOnly>
              <div className="mt-3 rounded-2xl border border-border p-3">
                {chosen.key === ranked[0].key ? (
                  <>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      Why this order? We tested all three on your numbers
                    </div>
                    <div className="space-y-1">
                      {ranked.map((o) => (
                        <div key={o.key} className="flex items-baseline justify-between gap-2 text-[12px]">
                          <span className={o.key === chosen.key ? "font-semibold text-gain" : "text-foreground/60"}>
                            {o.key === chosen.key ? "✓ " : ""}
                            {o.name}
                          </span>
                          <span className={`tabular ${o.key === chosen.key ? "font-bold text-gain" : "text-foreground/55"}`}>
                            {moneyCompact(o.v)} left
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="-mt-0.5 mb-1 text-[10px] leading-snug text-foreground/40">
                      &ldquo;Left&rdquo; = after-tax estate counted conservatively (assuming heirs may sell the brokerage rather
                      than always getting a full step-up), so the winner isn&apos;t resting on a single tax bet.
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-foreground/70">
                      {usesBrokerageFirst ? (
                        <>
                          Many advisors say &ldquo;spend your brokerage first&rdquo; — and for you that&apos;s exactly right
                          {edge > 1000 ? <>, by about <strong>{moneyCompact(edge)}</strong></> : null}. Spending the brokerage
                          keeps your taxable income low, which opens up cheap room to roll pre-tax → Roth; and anything you
                          leave in the brokerage gets a <strong>step-up at death</strong> that erases the gain for your heirs.
                        </>
                      ) : settings.strategy === "smart" ? (
                        <>
                          Here it pays to pull <strong>pre-tax first</strong>
                          {edge > 1000 ? <>, by about <strong>{moneyCompact(edge)}</strong></> : null}. Filling your low
                          brackets with pre-tax dollars now shrinks the balance that would otherwise be forced out later as
                          RMDs at higher rates — worth more than the capital-gains savings of selling the brokerage first.
                        </>
                      ) : (
                        <>
                          For you a <strong>balanced draw</strong> from every account wins
                          {edge > 1000 ? <>, by about <strong>{moneyCompact(edge)}</strong></> : null} — it keeps taxable
                          income low enough to convert pre-tax → Roth cheaply while still preserving brokerage gains for the
                          step-up.
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-[12px] leading-relaxed text-foreground/70">
                    Because your goal is <strong>{GOAL_META[settings.goal].short.toLowerCase()}</strong>, the plan pulls in the
                    order that best serves it. The order below explains the general trade-off.
                  </p>
                )}
                <Info q="Wait — why not just spend the brokerage first like advisors say?">
                  <p>
                    It&apos;s a great rule of thumb, and often right — but not always. The catch is that the money in your
                    pre-tax IRA/401(k) will be taxed as ordinary income <em>eventually</em>, either when you take it or when
                    your heirs do. If you only ever touch the brokerage, that pre-tax balance keeps growing and gets forced
                    out in your 70s–80s as RMDs — often at a <em>higher</em>{" "}rate than you&apos;d pay today, and it can push
                    up your Medicare (IRMAA) premiums too.
                  </p>
                  <p className="mt-2">
                    So the real comparison isn&apos;t &ldquo;15% on a brokerage gain vs 22% on a pre-tax dollar this
                    year.&rdquo; It&apos;s &ldquo;a known low rate now vs a likely higher rate later&rdquo; on the pre-tax
                    money, plus the fact that brokerage gains can escape tax entirely via the step-up at death. The table
                    above is that full lifetime comparison run on your actual accounts — whichever order keeps the most after
                    every tax is the one we use.
                  </p>
                </Info>
              </div>
              </DesktopOnly>
            </div>
          )}

          {/* The tax on this year's SPENDING — folded in here so there's no separate
              tax page. Uses the spending-only plan (the conversion's tax is its own step). */}
          {(() => {
            const t = planNoConv.tax;
            const fedZero = t.federalTax < 100 && t.taxableIncome > 1000;
            const lowTax = t.taxableIncome < 2000;
            return (
              <div className="mt-5 border-t border-border pt-4">
                <h3 className="text-base font-bold leading-snug">Set aside about {money(t.totalTax)} for tax</h3>
                <DesktopOnly>{lowTax ? (
                  <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
                    Almost none of this year&apos;s <strong>{money(spending)}</strong> is taxable income — you funded it
                    mostly from cash and dividends (money you&apos;ve already paid tax on, or that&apos;s taxed at the 0%
                    rate), and your {money(t.deductions)} standard deduction covers the rest. So the bill is only about{" "}
                    <strong>{money(t.totalTax)}</strong>.
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
                    Spending isn&apos;t the same as taxable income. Of your <strong>{money(spending)}</strong>, only{" "}
                    <strong>{money(t.taxableIncome)}</strong> is taxed: the cash you spend is money you already paid tax on
                    (and a brokerage sale is taxed only on its <em>gain</em>), and your {money(t.deductions)} standard
                    deduction shields the first slice of the rest. Your top rate is{" "}
                    <strong>{percent(t.marginalOrdinaryRate, 0)}</strong>, so the bill is about{" "}
                    <strong>{money(t.totalTax)}</strong> — roughly {percent(t.effectiveRate)} of your income.
                  </p>
                )}</DesktopOnly>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-xl border border-border bg-background/60 p-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-foreground/45">Federal</div>
                    <div className="tabular text-sm font-bold text-tax">{moneyCompact(t.federalTax)}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background/60 p-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-foreground/45">{isIL ? "Illinois" : "State"} (4.95%)</div>
                    <div className="tabular text-sm font-bold text-tax">{moneyCompact(t.stateTax)}</div>
                  </div>
                </div>
                <DesktopOnly>{fedZero ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-foreground/65">
                    Federal is about $0 because most of your income is qualified dividends &amp; long-term gains, which
                    get a <strong>0% federal rate</strong> while your taxable income stays under about{" "}
                    {money(ltcgZeroCeiling(planNoConv.filingStatus))}
                    {isIL ? <> — Illinois still taxes that investment income at 4.95% (the {moneyCompact(t.stateTax)}).</> : "."}
                  </p>
                ) : isIL ? (
                  <p className="mt-2 text-[12px] text-foreground/55">
                    🟢 Illinois taxes only your investment income — withdrawals, RMDs, pension, and Social Security are state-tax-free.
                  </p>
                ) : null}</DesktopOnly>
              </div>
            );
          })()}
        </div>
      );
    },
  });

  if (pretaxShare > 0.2) {
    steps.push({
      key: "roll",
      chapter: "review",
      eyebrow: "the rollover, in detail",
      render: () => {
        const rows = [
          { name: "Do nothing extra", p: compare.none, hint: "RMDs arrive in big, high-bracket chunks" },
          { name: "Smooth (recommended)", p: compare.smooth, hint: "small rollovers, stay in low brackets", best: true },
          { name: "Convert aggressively", p: compare.aggressive, hint: "fill the 32% bracket every year" },
        ];
        const mostKept = Math.max(...rows.map((r) => r.p.endingEstateAfterTax));
        const biggestRmd = Math.max(...rows.map((r) => r.p.peakRmd));
        const smoothKeep = compare.smooth.endingEstateAfterTax;
        const aggrKeep = compare.aggressive.endingEstateAfterTax;
        const noneKeep = compare.none.endingEstateAfterTax;
        const gainVsNothing = smoothKeep - noneKeep;
        // How much of the best-case gain smoothing captures, vs. doing nothing.
        const captured =
          aggrKeep > noneKeep + 1 ? Math.round(((smoothKeep - noneKeep) / (aggrKeep - noneKeep)) * 100) : 100;
        const aggrEdge = aggrKeep - smoothKeep;

        // ---- Detailed, plain-English scenario explanations -------------------
        // Drafted through 3 lenses and adversarially verified for accuracy across
        // household types (wealthy / moderate / low-pre-tax). Every numeric claim
        // is dynamic; phrasing flips so it stays TRUE whether aggressive helps,
        // ties, or loses money. moneyCompact() keeps the sign of negatives, so all
        // magnitude comparisons use Math.abs() + an explicit more/less/same word.
        const pctBT = percent(settings.bracketTarget, 0);
        const pctAggr = percent(compare.aggressive.peakMarginalRate, 0);
        const pctFuture = percent(proj.futureRate, 0);
        const pctNonePeak = percent(compare.none.peakMarginalRate, 0);
        const moveThisYear = conversion < 1000 ? "little or no conversion" : `about ${money(conversion)}`;
        const aggrVsSmooth =
          aggrEdge > 1
            ? `about ${moneyCompact(aggrEdge)} more than smoothing — a small edge in return for a much bigger tax bill now`
            : aggrEdge < -1
              ? `about ${moneyCompact(Math.abs(aggrEdge))} less than smoothing — because paying a higher rate now just to dodge a lower one later actually leaves you worse off`
              : "about the same as smoothing — so there's no reason to take on the bigger, lumpier tax bill";
        const RMD_DEF =
          "RMD stands for Required Minimum Distribution. Starting at age 73 the IRS makes you take a minimum amount out of your pre-tax retirement accounts (a traditional IRA or a workplace 401(k) — money you set aside before paying tax, so the tax has never been paid on it) every year, whether you need it or not, and you pay income tax on it — the same way a paycheck or pension is taxed. The bigger that account grows, the bigger this forced withdrawal gets.";
        const BRACKET_DEF =
          "Income tax comes in steps. The first slice of your income is taxed at a low rate, the next slice a bit higher, and so on. A tax bracket is just the rate the next dollar you earn gets taxed at. Filling a low step up to its top means paying that gentle rate; any income above it is taxed at the next, higher rate.";
        const ROTH_DEF =
          "A Roth is a retirement account you've already paid the tax on. It grows tax-free, you owe nothing when you take money out, and you are never forced to withdraw from your own Roth — there are no RMDs on it during your life.";
        const explain = [
          {
            q: "⬜ Do nothing — and let big forced withdrawals push you into higher taxes later",
            body: `In this path you never move a dollar on purpose. Your pre-tax retirement accounts — a traditional IRA or workplace 401(k), money you set aside before paying tax — just keep growing. The catch is that starting at age 73 the IRS makes you take a minimum amount out every year (that's an RMD, a required minimum distribution) and taxes it the same way a paycheck is taxed. Because the forced withdrawal is a share of an account that keeps growing, the dollar amount you're made to take out gets bigger over time — in your case the largest one reaches about ${moneyCompact(compare.none.peakRmd)}, and the top of your income in those years lands in the ${pctNonePeak} bracket. Nothing is wrong with the money — it's all still yours — but you don't get to pick the years you pay the tax; the IRS decides for you. And whatever pre-tax money is left when you pass still owes income tax: whoever inherits it pays it. That's why your family keeps about ${moneyCompact(compare.none.endingEstateAfterTax)} after every tax is paid — about ${moneyCompact(gainVsNothing)} less than the smoothing plan would leave.`,
            upside: "Nothing to do and no tax you chose to trigger — your money keeps growing untouched until it's withdrawn or inherited.",
            downside: `You don't control when the tax hits, the leftover pre-tax money still owes income tax for your heirs, and your family keeps about ${moneyCompact(gainVsNothing)} less than with smoothing.`,
            catchFirst: false,
          },
          {
            q: "🟩 Smooth (recommended) — move a little to your Roth each year, at a gentle rate",
            body: `Here you take the IRS's required minimum withdrawal as usual, and then quietly move a modest extra amount from your pre-tax account into a Roth — an account where the money then grows tax-free and is never forced out again. The key is the size: each year you move only enough to fill your low ${pctBT} bracket up to its top and not a dollar more, so the tax stays small and predictable. It works best if you pay that tax from your regular savings or checking rather than from the retirement account, so the full amount keeps growing — and Illinois doesn't tax the move at all. This year's suggested move is ${moveThisYear}. The rule behind it is simple: never move a dollar at a higher tax rate than you'd pay on it later, so you're only ever paying tax you'd owe anyway, just sooner and at a known low rate. Doing this gently shrinks the pre-tax balance that drives those forced withdrawals, so your biggest RMD ever stays down around ${moneyCompact(compare.smooth.peakRmd)} instead of ${moneyCompact(compare.none.peakRmd)}. After every tax is paid your family keeps about ${moneyCompact(compare.smooth.endingEstateAfterTax)} — roughly ${moneyCompact(gainVsNothing)} more than leaving it alone.`,
            upside: `A small, known tax now buys tax-free growth and far smaller forced withdrawals later — about ${moneyCompact(gainVsNothing)} more for your family than doing nothing, all inside your gentle ${pctBT} rate.`,
            downside: "You do pay a little tax in each year you move money, and it takes a small, steady bit of attention rather than being fully hands-off.",
            catchFirst: false,
          },
          {
            q: "🟧 Convert aggressively — empty the pre-tax account fast",
            body: `This is the same idea as smoothing, but with much bigger amounts each year: instead of filling only your gentle ${pctBT} bracket, you move so much that the last of it is taxed up at the ${pctAggr} rate. Over the conversion years you'd move a large total out of the pre-tax account. Because you clear it out fastest, your forced withdrawals later nearly disappear — your biggest RMD ever drops to about ${moneyCompact(compare.aggressive.peakRmd)}. Whether this is wise comes down to one comparison: the tax rate you'd likely pay later, once those forced withdrawals are large, is about ${pctFuture}, and you'd be paying ${pctAggr} now to avoid it. On your numbers this path leaves your family ${aggrVsSmooth}.`,
            upside: `Your forced withdrawals later nearly disappear — your biggest RMD ever falls to about ${moneyCompact(compare.aggressive.peakRmd)}.`,
            downside: `You pay a big tax bill now, up at the ${pctAggr} rate — and whenever the rate you'd have paid later would be lower, that's paying a high rate now just to dodge a lower one.`,
            catchFirst: aggrEdge <= 0,
          },
        ];

        // ---- Single, first-match recommendation -----------------------------
        // Ordered so it NEVER praises aggressive when it loses/ties, and only says
        // "little to do" when the whole decision barely moves the outcome (not just
        // when this one year's conversion is $0 — the moderate household converts
        // $0 THIS year yet the lifetime choice still swings ~$200k).
        const worstKeep = Math.min(noneKeep, smoothKeep, aggrKeep);
        const barelyMatters = mostKept - worstKeep < Math.max(40_000, mostKept * 0.02);
        const aggrThreshold = Math.max(50_000, noneKeep * 0.005);
        let takeaway: string;
        if (barelyMatters) {
          takeaway = `For your situation there's very little to do here, and that's good news. You don't have much pre-tax money driving future forced withdrawals, so your outcome stays about the same no matter which path you pick — all three land within a hair of each other (around ${moneyCompact(smoothKeep)} for your family). This year the plan suggests ${moveThisYear}. Converting harder wouldn't meaningfully change your outcome, so don't feel you need to act.`;
        } else if (aggrEdge < 0) {
          takeaway = `Smoothing is the clear winner for you, and converting aggressively would be a mistake. The tax rate you'd likely pay later on your forced withdrawals is only about ${pctFuture}, so paying up in the ${pctAggr} bracket now to clear the account faster actually leaves your family about ${moneyCompact(Math.abs(aggrEdge))} worse off than smoothing. Stick with the small, steady moves inside your ${pctBT} bracket — ${moveThisYear} this year — and keep the roughly ${moneyCompact(gainVsNothing)} you gain over doing nothing.`;
        } else if (aggrEdge <= aggrThreshold) {
          takeaway = `Go with smoothing. It captures about ${captured}% of the entire benefit — roughly ${moneyCompact(gainVsNothing)} more for your family than doing nothing — in small, low-rate steps that never leave your gentle ${pctBT} bracket. Converting aggressively would add only about ${moneyCompact(aggrEdge)} on top, and only by paying tax up in the higher ${pctAggr} bracket — not worth the bigger, lumpier tax bill. This year, move ${moveThisYear}.`;
        } else {
          takeaway = `Both active paths beat doing nothing handily. Smoothing alone already gets your family about ${moneyCompact(gainVsNothing)} more, gently and predictably. Because the rate you'd face later is genuinely high (about ${pctFuture}), converting aggressively could add a further ${moneyCompact(aggrEdge)} on top — but only by paying a much bigger tax bill now, up in the ${pctAggr} bracket. If you have the cash to cover that bill and want to wring out every dollar, aggressive edges ahead; if you'd rather keep it calm, smoothing is still an excellent choice. Either way, start with ${moveThisYear} this year.`;
        }

        return (
          <DesktopOnly
            mobileNote={
              <div>
                <h2 className="text-xl font-bold leading-snug">Your rollover, in detail</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-foreground/65">
                  Your plan moves small amounts to Roth across your low-tax years instead of facing one big forced
                  withdrawal (RMD) later — projected to keep about <strong>{moneyCompact(gainVsNothing)}</strong>{" "}more
                  after every tax. Open this on a larger screen for the full year-by-year comparison and bracket math.
                </p>
              </div>
            }
          >
          <div>
            <h2 className="text-xl font-bold leading-snug">Your rollover, in detail</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              RMDs aren&apos;t the enemy — a steady withdrawal is fine. The trap is one <strong>big</strong>{" "}forced
              withdrawal that lands in a high bracket. The fix: move a little to Roth each year, only up to the top of a
              low bracket, so the balance that drives future RMDs shrinks gently. We never convert a dollar at a higher
              rate than you&apos;d pay later.
            </p>

            {/* Bracket reference: what "a low bracket" actually means, in dollars */}
            <BracketLadder
              status={plan.filingStatus}
              fillRate={settings.bracketTarget}
              futureRate={compare.none.peakMarginalRate}
              year={year}
              ordinaryIncome={plan.tax.ordinaryTaxableIncome}
              baseOrdinary={planNoConv.tax.ordinaryTaxableIncome}
              conversion={plan.conversion}
            />

            {/* Proof: three approaches on YOUR numbers */}
            <div className="mt-4 overflow-hidden rounded-2xl border border-border">
              <div className="grid grid-cols-[1.5fr_1fr_1fr] bg-foreground/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
                <span>Approach</span>
                <span className="text-right">Money you keep</span>
                <span className="text-right">Biggest RMD</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.name}
                  className={`grid grid-cols-[1.5fr_1fr_1fr] items-center px-3 py-2 text-[12px] ${r.best ? "bg-gain/[0.06]" : "border-t border-border/50"}`}
                >
                  <span>
                    <span className={`font-semibold ${r.best ? "text-gain" : ""}`}>{r.name}</span>
                    <span className="block text-[10px] leading-tight text-foreground/50">{r.hint}</span>
                  </span>
                  <span className={`tabular text-right font-semibold ${r.p.endingEstateAfterTax >= mostKept - 1 ? "text-gain" : "text-foreground/70"}`}>
                    {moneyCompact(r.p.endingEstateAfterTax)}
                  </span>
                  <span className={`tabular text-right font-semibold ${r.p.peakRmd >= biggestRmd - 1 ? "text-tax/80" : "text-foreground/70"}`}>
                    {moneyCompact(r.p.peakRmd)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-foreground/45">
              &ldquo;Money you keep&rdquo; is your estate after all taxes — the tax still owed on any pre-tax left behind
              (at your projected future rate) <em>and</em> the lifetime Medicare (IRMAA) premium surcharges your income
              triggers. A taxable brokerage left to heirs gets a step-up in basis, so its gains pass tax-free.
              &ldquo;Biggest RMD&rdquo; is the largest single forced withdrawal you&apos;d ever face.
            </p>
            {compare.aggressive.lifetimeIrmaa > compare.smooth.lifetimeIrmaa + 5_000 && (
              <p className="mt-1.5 rounded-xl bg-ss/[0.06] px-3 py-2 text-[11px] leading-relaxed text-foreground/65">
                🩺 Converting aggressively pushes your income into higher Medicare (IRMAA) tiers — about{" "}
                <strong>{moneyCompact(compare.aggressive.lifetimeIrmaa)}</strong> in lifetime Part B/D surcharges vs.{" "}
                <strong>{moneyCompact(compare.smooth.lifetimeIrmaa)}</strong>{" "}with smoothing. That extra premium cost
                is already counted in &ldquo;money you keep&rdquo; above — it&apos;s part of why bigger isn&apos;t always
                better.
              </p>
            )}

            {/* Detailed, plain-English explanation of each choice — collapsed by
                default so the page stays calm; tap any row to understand it fully. */}
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                What each choice means — tap to read
              </div>
              {explain.map((e) => (
                <Info key={e.q} q={e.q}>
                  <p>{e.body}</p>
                  {e.catchFirst ? (
                    <>
                      <p className="mt-2 text-tax">
                        <strong>The catch:</strong> {e.downside}
                      </p>
                      <p className="mt-1 text-gain">
                        <strong>Good thing:</strong> {e.upside}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-gain">
                        <strong>Good thing:</strong> {e.upside}
                      </p>
                      <p className="mt-1 text-tax">
                        <strong>The catch:</strong> {e.downside}
                      </p>
                    </>
                  )}
                </Info>
              ))}
              <div className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                New to these words? Tap any
              </div>
              <Info q="What's an RMD?">{RMD_DEF}</Info>
              <Info q="What's a tax bracket?">{BRACKET_DEF}</Info>
              <Info q="What's a Roth?">{ROTH_DEF}</Info>
            </div>

            {/* The single, honest recommendation for THIS household. */}
            <Callout tone="good" icon="💡" title="Bottom line for you" className="mt-3">
              {takeaway}
            </Callout>

            {/* No decision here — the rollover is chosen ONCE, on the "Confirm your
                rollover" step. This step is just the detailed comparison behind it. */}
            <p className="mt-4 rounded-xl border border-border bg-background/40 px-3 py-2 text-[12px] text-foreground/60">
              You decide whether to do this back on the <strong>&ldquo;Confirm your rollover&rdquo;</strong> step — this is
              just the detailed comparison behind that choice.
            </p>
            {isIL && (
              <p className="mt-2 rounded-xl bg-gain/10 px-3 py-2 text-[12px] text-gain">
                🟢 In Illinois the rollover itself is <strong>state-tax-free</strong> — you only owe federal tax to do it.
              </p>
            )}
          </div>
          </DesktopOnly>
        );
      },
    });
  }

  steps.push({
    key: "ahead",
    chapter: "review",
    eyebrow: "looking ahead",
    render: () => (
      <div>
        <h2 className="text-xl font-bold leading-snug">Your next few years, at a glance</h2>
        <p className="mt-1 text-[13px] text-foreground/60">So you know what&apos;s coming and can plan around it.</p>
        <p className="-mt-0.5 text-[11px] text-foreground/45">Tap any year to see everything it involves.</p>
        <div className="mt-3 space-y-2">
          {lookAhead.map((y, i) => (
            <AheadYearRow key={y.year} y={y} i={i} />
          ))}
        </div>
      </div>
    ),
  });

  // STEP — the full breakdown: all the supporting detail consolidated at the END of
  // the flow, so the question steps stay simple. This is also where MOBILE users find
  // the deeper detail that's desktop-only on the steps. Collapsed sections keep it calm.
  steps.push({
    key: "breakdown",
    chapter: "review",
    eyebrow: "all the detail, in one place",
    render: () => {
      const t = plan.tax;
      const incomeTax = t.totalTax;
      const fed = t.federalTax ?? 0;
      const stateTax = Math.max(0, incomeTax - fed);
      const medicare = t.irmaa?.householdAnnual ?? 0;
      const orderWhy =
        settings.strategy === "smart"
          ? "We fill your low tax brackets with pre-tax dollars first, so less is forced out later as high-taxed RMDs — then cover the rest from your brokerage, and leave tax-free Roth for last."
          : settings.strategy === "conventional"
            ? "We spend your brokerage and cash first (keeping taxable income low), then pre-tax, and leave tax-free Roth for last."
            : "We draw a little from every account each year — balancing today's tax against the forced withdrawals (RMDs) building up in your pre-tax accounts.";
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">Your plan, in full</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
            Everything you chose — tap any line to change it — plus the detail behind it, tucked into sections.
          </p>
          {(() => {
            const hasSpouse = !!household.spouse && household.spouse.birthYear > 1900;
            const hasSSben = household.self.socialSecurityAnnual > 0 || (hasSpouse && household.spouse.socialSecurityAnnual > 0);
            const jumpTo = (key: string) => {
              const i = steps.findIndex((s) => s.key === key);
              if (i >= 0) go(i);
            };
            const growth =
              settings.spendingStrategy === "flatNominal" ? "flat" : settings.spendingStrategy === "guardrails" ? "guardrails" : "rises with inflation";
            const recap: { label: string; value: string; key: string }[] = [
              { label: "Goal", value: GOAL_META[settings.goal].short, key: "goal" },
              { label: "Spending", value: `${money(household.annualSpending)}/yr · ${growth}`, key: "spend" },
              {
                label: "Plan to age",
                value: `${settings.endAge}${settings.survivorModel && hasSpouse ? ` · survivor from ${settings.firstDeathAge}` : ""}`,
                key: "longevity",
              },
            ];
            if (hasSSben)
              recap.push({
                label: "Social Security",
                value: `claim at ${household.self.ssClaimAge}${hasSpouse && household.spouse.socialSecurityAnnual > 0 ? ` / ${household.spouse.ssClaimAge}` : ""}`,
                key: "ssclaim",
              });
            if ((household.pensionAnnual ?? 0) > 0 || taxableInvestmentIncome > 0)
              recap.push({
                label: "Other income",
                value: [
                  (household.pensionAnnual ?? 0) > 0 ? `pension ${moneyCompact(household.pensionAnnual)}/yr` : "",
                  taxableInvestmentIncome > 0 ? `investments ${moneyCompact(taxableInvestmentIncome)}/yr` : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
                key: "otherincome",
              });
            if (hasInvestmentIncome)
              recap.push({ label: "Dividends", value: settings.dividendMode === "spend" ? "spent as income" : "reinvested", key: "dividends" });
            if (pretaxShare > 0.2)
              recap.push({ label: "Roth rollover", value: settings.useConversions ? "on" : "skipped", key: "rollconfirm" });
            return (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                <div className="bg-foreground/[0.03] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                  Your choices — tap to change any
                </div>
                {recap.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => jumpTo(r.key)}
                    className="press flex w-full items-center justify-between gap-3 border-t border-border/50 px-3 py-2.5 text-left"
                  >
                    <span className="text-[12px] text-foreground/55">{r.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{r.value}</span>
                      <span aria-hidden className="text-[12px] text-primary">✎</span>
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">The detail</div>
          <div className="mt-2 space-y-2">
            <Collapsible eyebrow="this year" title="Your tax this year" summary={`About ${money(incomeTax + medicare)} total`}>
              <div className="mt-1">
                <Row label="Federal income tax" value={money(fed)} />
                <Row label="State income tax" value={money(stateTax)} />
                {medicare > 0 && <Row label="Medicare (IRMAA) surcharge" value={money(medicare)} />}
                <Row label="Total set-aside" value={money(incomeTax + medicare)} bold />
              </div>
              <p className="mt-2 text-[12px] leading-snug text-foreground/55">
                The <strong>Plan</strong> tab shows the line-by-line math; <strong>Forecast</strong> shows how it changes year by year.
              </p>
            </Collapsible>

            <Collapsible title="Why your money comes out in this order">
              <p className="text-[13px] leading-relaxed text-foreground/70">{orderWhy}</p>
            </Collapsible>

            {pretaxShare > 0.2 && (
              <Collapsible title="Your Roth rollover, compared">
                <p className="text-[13px] leading-relaxed text-foreground/70">
                  Smoothing small amounts to Roth each year is projected to leave your family about{" "}
                  <strong>{moneyCompact(Math.max(0, compare.smooth.endingEstateAfterTax - compare.none.endingEstateAfterTax))}</strong>{" "}
                  more than doing nothing, and keeps your biggest forced withdrawal (RMD) down near{" "}
                  <strong>{moneyCompact(compare.smooth.peakRmd)}</strong> instead of{" "}
                  <strong>{moneyCompact(compare.none.peakRmd)}</strong>. The full three-way comparison is on the
                  &ldquo;Your rollover, in detail&rdquo; step.
                </p>
              </Collapsible>
            )}

            <Collapsible title="Medicare (IRMAA), in plain English">
              <p className="text-[13px] leading-relaxed text-foreground/70">
                Once your income crosses certain lines, Medicare adds a surcharge on top of the standard premium — billed
                per person, and set by your income from two years earlier. It&apos;s a step, not a slope: cross a line and the
                whole next surcharge kicks in. That&apos;s why the plan watches those lines when sizing your withdrawals and rollover.
              </p>
            </Collapsible>

            <Collapsible title="Key terms">
              <div className="space-y-2 text-[13px] leading-relaxed text-foreground/70">
                <p><strong>RMD</strong> — a Required Minimum Distribution: starting at 73, the IRS makes you withdraw a minimum from your pre-tax accounts each year and taxes it as ordinary income.</p>
                <p><strong>Tax bracket</strong> — income is taxed in steps; your &ldquo;bracket&rdquo; is the rate the next dollar is taxed at.</p>
                <p><strong>Roth</strong> — an account you&apos;ve already paid tax on; it grows tax-free, comes out tax-free, and is never force-withdrawn during your life.</p>
              </div>
            </Collapsible>
          </div>

          <Callout tone="info" icon="📊" className="mt-3">
            Want the live numbers and charts? The <strong>Plan</strong> and <strong>Forecast</strong> tabs have the full
            year-by-year detail — in the menu any time, or via &ldquo;See all the numbers&rdquo; on the next step.
          </Callout>
        </div>
      );
    },
  });

  steps.push({
    key: "done",
    chapter: "review",
    eyebrow: confidence
      ? confidence.successPct >= 0.8
        ? "you're set"
        : confidence.successPct >= 0.6
          ? "looking good"
          : "worth a closer look"
      : "the verdict",
    render: () => (
      <div className="text-center">
        {confidence ? (
          <>
            <div className="emoji-bounce text-4xl">{confidence.successPct >= 0.8 ? "🎉" : confidence.successPct >= 0.6 ? "👍" : "⚠️"}</div>
            <h2 className="mt-2 text-xl font-bold leading-snug">How solid is this plan?</h2>
            <div className="pop mt-3 tabular text-5xl font-bold" style={{ color: confidence.successPct >= 0.8 ? "var(--color-gain)" : confidence.successPct >= 0.6 ? "var(--color-accent)" : "var(--color-tax)" }}>
              <AnimatedNumber value={confidence.successPct * 100} format={(n) => `${Math.round(n)}%`} />
            </div>
            <p className="mt-1 text-[13px] text-foreground/65">
              Across {confidence.runs.toLocaleString()} simulated market futures — including crashes and long slumps — your
              money lasted to age {settings.endAge} this often. Give or take a couple of points ({Math.round(confidence.successCI[0] * 100)}–
              {Math.round(confidence.successCI[1] * 100)}%), since it&apos;s based on {confidence.runs.toLocaleString()} sample runs.
            </p>
          </>
        ) : (
          <div className="py-8">
            <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
            <h2 className="mt-3 text-xl font-bold leading-snug">How solid is this plan?</h2>
            <p className="mt-1 text-[13px] text-foreground/55">Running the market-risk simulation…</p>
          </div>
        )}
        <p className="mt-4 text-[13px] text-foreground/70">
          That&apos;s your plan. Come back and adjust your spending or income anytime — every step updates automatically.
        </p>
        <div className="mt-4 space-y-2">
          <button onClick={() => setStep(0)} className="press w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground/70">
            ↺ Walk through it again
          </button>
          <button onClick={onSeeDetails} className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white">
            See all the numbers & charts →
          </button>
        </div>
      </div>
    ),
  });

  // Order the (conditionally-built) steps into chapter order; stable sort keeps
  // insertion order within a chapter.
  steps.sort((a, b) => CHAPTER_ORDER.indexOf(a.chapter) - CHAPTER_ORDER.indexOf(b.chapter));

  const safeStep = Math.min(step, steps.length - 1);
  const current = steps[safeStep];
  const isLast = safeStep >= steps.length - 1;
  // Derive the visible chapter list from the steps actually present so the
  // orientation chrome ("3 of 6", the rail) never counts a chapter with no steps.
  const visibleChapters = CHAPTERS.filter((c) => steps.some((s) => s.chapter === c.id));
  const curChapter = CHAPTERS.find((c) => c.id === current.chapter) ?? null;
  const curChapterIdx = curChapter ? visibleChapters.findIndex((c) => c.id === curChapter.id) : -1;
  const firstIndexOfChapter = (id: ChapterId) => steps.findIndex((s) => s.chapter === id);

  // Deep-link entry: another page (Plan/Forecast "Adjust →") can open the
  // walkthrough at a specific step via `/?step=<key>`. Seed once on mount, by KEY
  // (robust to conditional steps); if that exact step isn't in the current flow,
  // fall back to its chapter's first visible step. Clear the param so a refresh or
  // Back doesn't strand the user on a re-seed. Runs after `ready` (the page gates
  // GuidedPlan on it, so the right mode/steps are already built).
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const target = searchParams.get("step");
    if (!target) return;
    let i = steps.findIndex((s) => s.key === target);
    if (i < 0 && STEP_CHAPTER[target]) i = firstIndexOfChapter(STEP_CHAPTER[target]);
    if (i >= 0) {
      setDir("fwd");
      setStep(i);
    }
    router.replace("/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistent cash-flow reference: once the user has set their spending, keep the
  // key line items visible on every later step so they never lose track of the
  // number they picked (or where the rest of the cash is going). Off on the
  // setup/intro steps and when there's nothing to fund.
  const spendStepIdx = steps.findIndex((s) => s.key === "spend");
  const irmaa = plan.tax.irmaa?.householdAnnual ?? 0;
  const showCashFlow = !needsOwnSetup && spendStepIdx >= 0 && safeStep > spendStepIdx;

  return (
    <Card className="overflow-hidden">
      <div className="lg:flex lg:items-start lg:gap-5">
        {/* Desktop chapter rail — the client always sees where they are & what's left */}
        {visibleChapters.length > 0 && (
          <nav
            className="mb-4 hidden shrink-0 self-start rounded-xl border border-border bg-background/50 p-3 lg:mb-0 lg:block lg:w-52"
            aria-label="Plan steps"
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">Your plan</div>
            <ol className="space-y-0.5">
              {visibleChapters.map((c, i) => {
                const state = i < curChapterIdx ? "done" : i === curChapterIdx ? "current" : "todo";
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => go(firstIndexOfChapter(c.id))}
                      aria-current={state === "current" ? "step" : undefined}
                      className={`press flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                        state === "current" ? "bg-primary/10 font-semibold text-primary" : "text-foreground/55 hover:bg-foreground/5"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          state === "done"
                            ? "bg-primary text-white"
                            : state === "current"
                              ? "border-2 border-primary text-primary"
                              : "border border-border text-foreground/40"
                        }`}
                      >
                        {state === "done" ? "✓" : i + 1}
                      </span>
                      <span className="min-w-0 truncate">{c.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {/* Step content column */}
        <div className="min-w-0 lg:flex-1">
          {/* Mobile chapter header — compact "where am I" cue */}
          {curChapter && (
            <div className="mb-2 lg:hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/70">
                  <span aria-hidden>{curChapter.icon}</span>
                  {curChapter.label}
                </span>
                <span className="text-[11px] text-foreground/45">
                  {curChapterIdx + 1} of {visibleChapters.length}
                </span>
              </div>
              <div className="mt-1.5 flex gap-1">
                {visibleChapters.map((c, i) => (
                  <span key={c.id} className={`h-1 flex-1 rounded-full ${i <= curChapterIdx ? "bg-primary" : "bg-foreground/10"}`} />
                ))}
              </div>
            </div>
          )}

          {/* fine progress dots (within the whole flow) */}
          <div className="mb-3 flex items-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => go(i)}
                aria-label={`Step ${i + 1}`}
                className={`press h-1.5 flex-1 rounded-full transition-colors ${i <= safeStep ? "bg-primary" : "bg-foreground/10"}`}
              />
            ))}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">{current.eyebrow}</div>

          {/* Chapter intro — a one-line "now we'll look at X" framing on the first
              step of each chapter, the way an advisor frames the next topic. */}
          {curChapter && firstIndexOfChapter(curChapter.id) === safeStep && (
            <div className="mt-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-primary">
                <span aria-hidden className="text-base">{curChapter.icon}</span>
                {curChapter.label}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground/60">{curChapter.blurb}</p>
            </div>
          )}

          {showCashFlow && (
            <CashFlowBar
              spending={spending}
              conversion={conversion}
              tax={totalTax}
              irmaa={irmaa}
              guaranteed={guaranteed}
              fromSavings={totalDraw}
            />
          )}

          {/* animated step body — re-keyed so the directional slide replays each step */}
          <div key={current.key} className={`mt-1 min-h-[360px] ${dir === "back" ? "step-back" : "step-fwd"}`}>
            {current.render()}
          </div>

          {/* nav */}
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-3">
            <button
              onClick={() => go(safeStep - 1)}
              disabled={safeStep === 0}
              className="press rounded-xl px-4 py-2 text-sm font-medium text-foreground/60 disabled:opacity-30"
            >
              ← Back
            </button>
            <span className="text-[12px] text-foreground/45">
              {safeStep + 1} / {steps.length}
            </span>
            {isLast ? (
              <button onClick={onSeeDetails} className="press rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white">
                Finish
              </button>
            ) : (
              <button onClick={() => go(safeStep + 1)} className="press rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white">
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Persistent at-a-glance cash-flow reference shown across the later walkthrough
 * steps, so the user never loses sight of the spending number they picked or how
 * the rest of this year's cash splits up. Uses (where the money goes) as chips,
 * with a muted funding line (where it comes from).
 */
function CashFlowBar({
  spending,
  conversion,
  tax,
  irmaa,
  guaranteed,
  fromSavings,
}: {
  spending: number;
  conversion: number;
  tax: number;
  irmaa: number;
  guaranteed: number;
  fromSavings: number;
}) {
  return (
    <div className="mt-2 rounded-xl border border-border bg-background/50 px-3 py-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
        This year’s cash flow — for reference
      </div>
      {/* Just the number you picked (and the rollover, if any) — tax & Medicare are
          shown in full on the steps that explain them, so they're not repeated here. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        <CFItem icon="💵" label="Personal spending" value={spending} tone="text-foreground" />
        {conversion > 0.5 && <CFItem icon="🔄" label="Roth rollover" value={conversion} tone="text-roth" />}
      </div>
      <div className="mt-1.5 border-t border-border/50 pt-1 text-[10.5px] leading-snug text-foreground/45">
        Funded by {money(guaranteed)} of guaranteed income
        {fromSavings > 0.5 ? <> + {money(fromSavings)} pulled from your accounts</> : <> — no withdrawals needed</>}.
        {conversion > 0.5 && " The rollover moves to Roth (not spent); its tax is best paid from cash."}
      </div>
    </div>
  );
}

/**
 * Where this year's MAGI sits relative to the Medicare IRMAA cliffs. IRMAA is a
 * step function: crossing a tier's MAGI ceiling adds the FULL next-tier surcharge
 * (per enrollee, ×12 months), two years later. Returns the current surcharge, the
 * distance to the next cliff, and the jump if you cross it — so the UI can warn
 * before spending/withdrawals push the household over a line.
 */
type IrmaaTier = { upTo: number; monthlyPerPerson: number; partB?: number; partD?: number; label: string };
function irmaaCliffInfo(magi: number, factor: number, tiers: IrmaaTier[], enrollees: number) {
  if (enrollees <= 0) return null; // nobody on Medicare yet → IRMAA doesn't apply
  let idx = tiers.findIndex((t) => magi <= t.upTo * factor);
  if (idx < 0) idx = tiers.length - 1;
  const cur = tiers[idx];
  const atTop = idx >= tiers.length - 1;
  const next = atTop ? null : tiers[idx + 1];
  const nextThreshold = atTop ? Infinity : cur.upTo * factor; // top of current tier = the next cliff
  const prevThreshold = idx > 0 ? tiers[idx - 1].upTo * factor : 0; // the cliff just below you
  const prev = idx > 0 ? tiers[idx - 1] : null;
  return {
    inSurcharge: cur.monthlyPerPerson > 0,
    curLabel: cur.label,
    curSurcharge: cur.monthlyPerPerson * 12 * enrollees,
    curPerPersonMo: cur.monthlyPerPerson,
    curPartB: cur.partB ?? 0,
    curPartD: cur.partD ?? 0,
    atTop,
    nextThreshold,
    distance: nextThreshold - magi,
    nextJump: next ? (next.monthlyPerPerson - cur.monthlyPerPerson) * 12 * enrollees : 0,
    // How far you've crossed the line BELOW you, and what dropping back under it saves.
    overBy: magi - prevThreshold,
    dropSaving: prev ? (cur.monthlyPerPerson - prev.monthlyPerPerson) * 12 * enrollees : 0,
    enrollees,
  };
}

function CFItem({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span aria-hidden className="text-[12px]">{icon}</span>
      <span className="text-[11px] text-foreground/55">{label}</span>
      <span className={`tabular text-[13px] font-bold ${tone}`}>{money(value)}</span>
    </div>
  );
}

/** Professional, advisor-grade snapshot of the accounts being assessed: grouped
 *  by tax treatment (Pre-tax / Roth / Taxable) with subtotals and % of total,
 *  each account showing its type, owner, balance, and (for taxable) unrealized
 *  gain. Answers "what exactly are we looking at?" at a glance. */
function AccountOverview({ household, total }: { household: Household; total: number }) {
  const nameOf = (owner: "self" | "spouse") => (owner === "self" ? household.self.label : household.spouse.label);
  const sumOf = (b: TaxBucket) =>
    household.accounts.filter((a) => bucketOf(a.kind) === b).reduce((s, a) => s + a.balance, 0);
  const groups: { bucket: TaxBucket; title: string; note: string; dot: string }[] = [
    { bucket: "pretax", title: "Pre-tax (Traditional)", note: "Taxed as income when withdrawn · the IRS forces withdrawals (RMDs) starting at 73", dot: "bg-deferred" },
    { bucket: "roth", title: "Roth", note: "Already taxed · grows tax-free · no forced withdrawals", dot: "bg-roth" },
    { bucket: "taxable", title: "Taxable (brokerage & cash)", note: "Only the gains are taxed when you sell — not the original money you put in", dot: "bg-taxable" },
  ];
  const legend: { label: string; dot: string; value: number }[] = [
    { label: "Pre-tax", dot: "bg-deferred", value: sumOf("pretax") },
    { label: "Taxable", dot: "bg-taxable", value: sumOf("taxable") },
    { label: "Roth", dot: "bg-roth", value: sumOf("roth") },
  ];
  return (
    <div className="mt-4">
      <StackedBar
        segments={[
          { value: sumOf("pretax"), className: "bg-deferred", label: "Pre-tax" },
          { value: sumOf("taxable"), className: "bg-taxable", label: "Taxable" },
          { value: sumOf("roth"), className: "bg-roth", label: "Roth" },
        ].filter((s) => s.value > 0.5)}
      />
      <div className="mt-1.5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-foreground/55">
        {legend.filter((l) => l.value > 0.5).map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${l.dot}`} />
            {l.label} <span className="text-foreground/40">{Math.round((l.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
      <div className="mt-3 space-y-2.5">
        {groups
          .map((g) => ({ ...g, accts: household.accounts.filter((a) => bucketOf(a.kind) === g.bucket), subtotal: sumOf(g.bucket) }))
          .filter((g) => g.subtotal > 0.5)
          .map((g) => (
            <div key={g.bucket} className="rounded-xl border border-border/70 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <span className={`inline-block h-2 w-2 rounded-full ${g.dot}`} />
                  {g.title}
                  <span className="font-normal text-foreground/40">· {Math.round((g.subtotal / total) * 100)}%</span>
                </span>
                <span className="tabular text-[13px] font-semibold">{money(g.subtotal)}</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-foreground/45">{g.note}</p>
              <div className="mt-1.5 space-y-1 border-t border-border/40 pt-1.5">
                {g.accts.map((a) => {
                  const meta = ACCOUNT_KIND_META[a.kind];
                  const gain = g.bucket === "taxable" && a.costBasis != null ? Math.max(0, a.balance - a.costBasis) : 0;
                  return (
                    <div key={a.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0">
                        <span className="text-[12px] text-foreground/85">{a.label}</span>
                        <span className="block text-[10px] leading-snug text-foreground/45">
                          {meta.label} · {nameOf(a.owner)}
                          {gain > 0 ? ` · ${moneyCompact(gain)} unrealized gain` : ""}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[12px] font-medium text-foreground/80">{money(a.balance)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/** One year in the "Looking ahead" list. Collapsed it shows a one-line summary;
 *  tapped, it reveals EVERY action for that year (RMD, conversion, brokerage
 *  sale, Roth tap…), any life events that begin that year, and the spending it
 *  funds — so "+1 more" is never a dead end. Self-contained open state. */
const ACTION_DOT: Record<PlanAction["kind"], string> = {
  rmd: "bg-deferred",
  pretax: "bg-deferred",
  convert: "bg-roth",
  taxable: "bg-taxable",
  roth: "bg-roth",
  none: "bg-foreground/30",
};
function AheadYearRow({ y, i }: { y: PlanYear; i: number }) {
  const [open, setOpen] = useState(false);
  const summary = `${y.actions[0]?.text ?? ""}${y.actions.length > 1 ? `, +${y.actions.length - 1} more` : ""}`;
  return (
    <div className="rise rounded-2xl border border-border" style={{ ["--i" as string]: i } as React.CSSProperties}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press flex w-full items-center justify-between gap-2 px-3 pt-3 text-left"
      >
        <span className="font-semibold">
          {y.year} <span className="text-foreground/50">· age {y.selfAge}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tabular text-[12px] text-foreground/55">est. tax {moneyCompact(y.tax)}</span>
          <span className={`text-foreground/40 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </span>
      </button>
      {!open ? (
        <button onClick={() => setOpen(true)} className="block w-full px-3 pb-3 pt-1 text-left">
          <span className="text-[12px] leading-snug text-foreground/70">{summary}</span>
        </button>
      ) : (
        <div className="rise px-3 pb-3 pt-2">
          {y.events.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {y.events.map((e) => (
                <span key={e} className="rounded-full bg-ss/10 px-2 py-0.5 text-[11px] font-medium text-ss">
                  📌 {e}
                </span>
              ))}
            </div>
          )}
          <ul className="space-y-1.5">
            {y.actions.map((a, idx) => (
              <li key={idx} className="flex gap-2 text-[12px] leading-snug">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ACTION_DOT[a.kind]}`} />
                <span className="text-foreground/80">{a.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-foreground/55">
            {y.coveredByIncome
              ? `Your guaranteed income covers your ${money(y.spendingTarget)} of spending this year — nothing forced from savings.`
              : `This funds your ${money(y.spendingTarget)} of spending for the year, for about ${money(y.tax)} in total tax.`}
          </p>
        </div>
      )}
    </div>
  );
}

/** Plain-English reference for "a low bracket": the actual federal ordinary
 *  brackets with their dollar ranges, marking where the smoothing plan FILLS to
 *  (green) and where untouched RMDs would eventually LAND (red). Turns the
 *  abstract "fill the low bracket" into something the user can sanity-check. */
function BracketLadder({
  status,
  fillRate,
  futureRate,
  year,
  ordinaryIncome,
  baseOrdinary: baseOrdinaryProp = 0,
  conversion = 0,
}: {
  status: FilingStatus;
  fillRate: number;
  futureRate: number;
  year: number;
  /** This year's ordinary taxable income (after deductions, excludes preferential
   *  gains/dividends) — what actually fills these brackets. INCLUDES the rollover. */
  ordinaryIncome: number;
  /** Ordinary taxable income WITHOUT the rollover — the spending/other-income base
   *  that fills the low brackets first. The rollover taxable footprint is the rest. */
  baseOrdinary?: number;
  /** Gross pre-tax rolled over to Roth this year. 0 if no rollover. */
  conversion?: number;
}) {
  const brackets = FILING_CONSTANTS[status].ordinary;
  const fmt = (n: number) => moneyCompact(n);
  const showFuture = futureRate > fillRate + 1e-9; // only flag a future bracket that's actually higher
  const hasIncome = ordinaryIncome > 0.5;
  const clampN = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  // Split this year's ordinary income into the SPENDING/other-income base (fills the
  // low brackets first) and the ROLLOVER taxable footprint that sits on top of it.
  // baseOrdinary comes from a no-conversion plan, so it's in the same TAXABLE terms
  // as ordinaryIncome (can't just subtract gross conversion — the deduction is between).
  const baseOrdinary = clampN(baseOrdinaryProp, 0, ordinaryIncome);
  const hasRollover = conversion > 0.5;
  // How this year's ordinary income fills each bracket: the slice inside it (split
  // spending vs rollover) and the tax on just that slice. A bracket taxes only the
  // dollars that land IN it, not your whole income.
  const rows = brackets.map((b, i) => {
    const from = i === 0 ? 0 : brackets[i - 1].upTo;
    const slice = Math.max(0, Math.min(ordinaryIncome, b.upTo) - from);
    const spendSlice = Math.max(0, Math.min(baseOrdinary, b.upTo) - from);
    const rollSlice = Math.max(0, Math.min(ordinaryIncome, b.upTo) - Math.max(from, baseOrdinary));
    const width = b.upTo === Infinity ? null : b.upTo - from;
    return {
      rate: b.rate,
      from,
      upTo: b.upTo,
      slice,
      spendSlice,
      rollSlice,
      tax: slice * b.rate,
      pctFull: width ? clampN(slice / width, 0, 1) : null,
      spendPct: width ? clampN(spendSlice / width, 0, 1) : 0,
      rollPct: width ? clampN(rollSlice / width, 0, 1) : 0,
      isFill: Math.abs(b.rate - fillRate) < 1e-9,
      isFuture: showFuture && Math.abs(b.rate - futureRate) < 1e-9,
    };
  });
  const totalTax = rows.reduce((s, r) => s + r.tax, 0);
  const effective = ordinaryIncome > 0 ? totalTax / ordinaryIncome : 0;
  const topRow = [...rows].reverse().find((r) => r.slice > 0); // highest bracket actually reached
  const fillBracket = rows.find((r) => r.isFill);
  const fillTop = fillBracket && fillBracket.upTo !== Infinity ? fillBracket.upTo : ordinaryIncome;
  const cols = "grid grid-cols-[2.1rem_minmax(0,1fr)_4.75rem_3.5rem_4rem] items-center gap-x-2";
  return (
    <div className="mt-4 rounded-2xl border border-border p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
        Your federal brackets ({status === "mfj" ? "married filing jointly" : "single"}, {year})
      </div>
      {hasIncome && (
        <div className={`${cols} px-2 pb-1 text-[9px] uppercase tracking-wide text-foreground/40`}>
          <span>Rate</span>
          <span>Income range</span>
          <span>Filled</span>
          <span className="text-right">Yours</span>
          <span className="text-right">Tax</span>
        </div>
      )}
      <div className="space-y-1">
        {rows.map((r) => {
          const range = r.upTo === Infinity ? `${fmt(r.from)}+` : `${fmt(r.from)} – ${fmt(r.upTo)}`;
          const filled = r.slice > 0.5;
          return (
            <div
              key={r.rate}
              className={`${cols} rounded-lg px-2 py-1 text-[12px] ${r.isFill ? "bg-gain/10" : r.isFuture ? "bg-tax/[0.07]" : ""}`}
            >
              <span className={`font-semibold ${r.isFill ? "text-gain" : r.isFuture ? "text-tax" : "text-foreground/70"}`}>
                {Math.round(r.rate * 100)}%
              </span>
              <span className="tabular truncate text-foreground/55">{range}</span>
              {hasIncome ? (
                <>
                  {/* "How full" bar — spending fills first (blue), the rollover tops
                      it off (green). The top, open-ended bracket has no width. */}
                  <span className="flex items-center gap-1">
                    <span className="relative h-2 w-9 shrink-0 overflow-hidden rounded-full bg-foreground/10">
                      <span className="absolute inset-y-0 left-0 bg-ss/70" style={{ width: `${r.spendPct * 100}%` }} />
                      <span className="absolute inset-y-0 bg-gain" style={{ left: `${r.spendPct * 100}%`, width: `${r.rollPct * 100}%` }} />
                    </span>
                    <span className="tabular w-6 text-right text-[9px] text-foreground/45">
                      {r.pctFull == null ? "" : `${Math.round(r.pctFull * 100)}%`}
                    </span>
                  </span>
                  <span className={`tabular text-right ${filled ? "font-semibold text-foreground/85" : "text-foreground/25"}`}>
                    {filled ? fmt(r.slice) : "—"}
                  </span>
                  <span className={`tabular text-right ${filled ? "text-tax/80" : "text-foreground/25"}`}>
                    {filled ? fmt(r.tax) : "—"}
                  </span>
                </>
              ) : (
                <>
                  <span />
                  <span />
                  <span className="text-right text-[10px] font-semibold">
                    {r.isFill ? <span className="text-gain">↑ fill</span> : r.isFuture ? <span className="text-tax">↑ RMDs</span> : ""}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {hasIncome && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 text-[9px] text-foreground/45">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-ss/70" /> from spending &amp; other income</span>
          {hasRollover && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-gain" /> from the Roth rollover</span>}
        </div>
      )}
      {hasIncome && hasRollover && fillBracket && (
        <p className="mt-2 rounded-lg bg-gain/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-foreground/75">
          💡 Your spending &amp; other income add about <strong>{money(baseOrdinary)}</strong> of ordinary taxable income
          {baseOrdinary > fillBracket.from + 0.5 ? <> — partway up your <strong className="text-gain">{Math.round(fillRate * 100)}%</strong> bracket</> : <>, so your low brackets start nearly empty</>}. The rollover then moves{" "}
          <strong>{money(conversion)}</strong> to Roth; after your standard deduction that&apos;s about{" "}
          <strong>{money(Math.max(0, ordinaryIncome - baseOrdinary))}</strong> of taxable income — just enough to fill your{" "}
          <strong className="text-gain">{Math.round(fillRate * 100)}%</strong> bracket to about its <strong>{fmt(fillTop)}</strong>{" "}
          top, and it stops there
          {showFuture ? <>, staying well below the <strong className="text-tax">{Math.round(futureRate * 100)}%</strong> rate your future RMDs would otherwise hit</> : ""}. That&apos;s the whole idea.
        </p>
      )}
      {hasIncome && topRow && (
        <p className="mt-2 rounded-lg bg-foreground/[0.03] px-2 py-1.5 text-[11px] leading-relaxed text-foreground/70">
          The <strong>{money(ordinaryIncome)}</strong> of your income taxed at these rates this year owes about{" "}
          <strong>{money(totalTax)}</strong> — an effective <strong>{percent(effective, 0)}</strong>, even though your top
          bracket is <strong>{Math.round(topRow.rate * 100)}%</strong>.{" "}
          {topRow.rate > 0.10 ? (
            <>
              Only the <strong>{money(topRow.slice)}</strong> above {fmt(topRow.from)} is taxed at {Math.round(topRow.rate * 100)}%
              (about <strong>{money(topRow.tax)}</strong>) — a bracket is a slice, not a cliff, so &ldquo;being in the{" "}
              {Math.round(topRow.rate * 100)}% bracket&rdquo; costs far less than {Math.round(topRow.rate * 100)}% of everything.
            </>
          ) : (
            <>All of it sits in the lowest bracket.</>
          )}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-foreground/50">
        Each rollover fills only up to the top of your{" "}
        <span className="font-semibold text-gain">{Math.round(fillRate * 100)}%</span> bracket
        {showFuture ? (
          <>
            {" "}— we don&apos;t push you into the{" "}
            <span className="font-semibold text-tax">{Math.round(futureRate * 100)}%</span> bracket your big forced RMDs
            would otherwise reach.
          </>
        ) : (
          " — already at or below where your future RMDs land, so there's little to gain from converting more."
        )}
      </p>
    </div>
  );
}

/** "See where this comes from" for the Dividends & interest line. The category
 *  totals are exact (the user enters them per type on the Accounts page); the
 *  per-asset attribution is by holding TYPE (dividend-paying vs interest-bearing),
 *  since we don't track each fund's individual payout — so we show which assets
 *  generate each, the amount of those assets, and the implied yield, without
 *  inventing per-fund dollar figures. */
function DividendInterestDetail({
  household,
  qualified,
  ordinary,
  taxableInt,
  taxExemptInt,
}: {
  household: Household;
  qualified: number;
  ordinary: number;
  taxableInt: number;
  taxExemptInt: number;
}) {
  const totalDiv = qualified + ordinary;
  const totalInt = taxableInt + taxExemptInt;
  if (totalDiv + totalInt < 0.5) return null;

  const cats = [
    { label: "Qualified dividends", value: qualified, note: "preferential 0/15/20% rate" },
    { label: "Ordinary dividends", value: ordinary, note: "taxed as ordinary income (REITs, some funds)" },
    { label: "Taxable interest", value: taxableInt, note: "ordinary income (CDs, Treasuries, savings)" },
    { label: "Tax-exempt interest", value: taxExemptInt, note: "federal-tax-free (munis) — still counts for IRMAA" },
  ].filter((c) => c.value > 0.5);

  // Per-holding dividend model: when taxable holdings carry real dividend data
  // (auto-fetched or entered), show exactly which holdings throw off the dividends
  // — shares × dividend-per-share — plus their yield and modeled growth, and where
  // that income is projected to go (the growth model). Cash interest is separate.
  const taxableHoldings = household.accounts.filter((a) => bucketOf(a.kind) === "taxable").flatMap((a) => a.holdings ?? []);
  const bd = dividendBreakdown(taxableHoldings);
  const traj = bd.hasData ? dividendIncomeTrajectory(taxableHoldings, 20) : null;

  // Fallback (no per-holding data): attribute by holding type / account kind.
  const taxable = household.accounts.filter((a) => bucketOf(a.kind) === "taxable");
  let divAssets = 0;
  const divNames: string[] = [];
  for (const a of taxable) {
    if (a.holdings && a.holdings.length > 0) {
      for (const h of a.holdings) {
        if (h.type === "cash" || h.type === "bond_fund") continue;
        divAssets += h.shares * h.price;
        divNames.push(h.name);
      }
    } else if (a.kind !== "cash") {
      divAssets += a.balance;
      divNames.push(a.label);
    }
  }
  const namesList = (names: string[]) =>
    names.length ? `${names.slice(0, 4).join(", ")}${names.length > 4 ? `, +${names.length - 4} more` : ""}` : "";

  return (
    <Info q="See where this comes from">
      <p>Here&apos;s the makeup of this income and exactly which holdings throw it off:</p>
      <p className="mt-2 rounded-lg bg-ss/[0.06] px-2 py-1.5 text-foreground/70">
        Only your <strong>taxable (brokerage)</strong> dividends count as income here — those are the ones you actually
        receive and pay tax on each year. Dividends inside your <strong>IRA / 401(k) / Roth</strong> automatically reinvest
        and compound <em>inside</em>{" "}the account (they&apos;re part of its growth, not spendable income), so they&apos;re
        not counted in this figure.
      </p>
      <div className="mt-2 space-y-1">
        {cats.map((c) => (
          <div key={c.label} className="flex items-baseline justify-between gap-2">
            <span className="text-foreground/75">
              {c.label} <span className="text-foreground/45">· {c.note}</span>
            </span>
            <span className="tabular shrink-0 font-medium">{money(c.value)}</span>
          </div>
        ))}
      </div>

      {bd.hasData && bd.holdings.filter((h) => h.kind !== "none").length > 0 ? (
        <>
          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="mb-1 grid grid-cols-[1fr_auto_auto] gap-x-2 text-[10px] uppercase tracking-wide text-foreground/40">
              <span>Holding (shares × div/share)</span>
              <span className="text-right">Yield</span>
              <span className="text-right">Income/yr</span>
            </div>
            <div className="space-y-1">
              {bd.holdings
                .filter((h) => h.kind !== "none" && h.income > 0.5)
                .map((h) => (
                  <div key={h.ticker} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2">
                    <span className="min-w-0 truncate text-foreground/80">
                      <strong>{h.ticker}</strong>{" "}
                      <span className="text-foreground/45">
                        {h.shares.toLocaleString()} × ${h.dps.toFixed(2)} · {percent(h.growth, 0)}/yr growth
                      </span>
                    </span>
                    <span className="tabular text-right text-foreground/55">{percent(h.yieldPct, 1)}</span>
                    <span className="tabular text-right font-medium">{money(h.income)}</span>
                  </div>
                ))}
            </div>
          </div>
          {traj && (
            <p className="mt-2 rounded-lg bg-gain/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-foreground/75">
              📈 At each holding&apos;s modeled dividend-growth rate, this <strong>{money(traj[0].total)}</strong> of dividends
              is projected to grow to about <strong>{money(traj[10].total)}</strong> in 10 years and{" "}
              <strong>{money(traj[20].total)}</strong> in 20 — before you sell a single share. Individual stocks fade from
              their recent growth toward a steady long-run rate; broad funds grow at their own history (the
              dividend-discount approach advisors use).
            </p>
          )}
          <p className="mt-2 text-foreground/50">
            Dividend-per-share and growth are pulled from the market feed and refreshed daily — edit any holding on the
            Accounts page to override.
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 border-t border-border/50 pt-2">
            {totalDiv > 0.5 && (
              <p>
                <strong>{money(totalDiv)} in dividends</strong> comes from your dividend-paying holdings
                {namesList(divNames) ? <> ({namesList(divNames)})</> : null}
                {divAssets > 0 ? (
                  <> — about {money(divAssets)} of assets, an implied <strong>{percent(totalDiv / divAssets, 1)}</strong> yield</>
                ) : null}
                .
              </p>
            )}
          </div>
          <p className="mt-2 text-foreground/50">
            Add tickers &amp; shares on the Accounts page and we&apos;ll pull each holding&apos;s real dividend-per-share and
            growth automatically.
          </p>
        </>
      )}
    </Info>
  );
}

function Row({ label, value, tone, bold, sub }: { label: string; value: ReactNode; tone?: "ss" | "taxable"; bold?: boolean; sub?: boolean }) {
  const color = tone === "ss" ? "text-ss" : tone === "taxable" ? "text-taxable" : "";
  return (
    <div className={`flex items-center justify-between gap-2 ${sub ? "pl-2" : ""}`}>
      <span className={`${bold ? "font-semibold" : sub ? "text-foreground/55" : "text-foreground/70"} text-[13px]`}>{label}</span>
      <span className={`tabular shrink-0 ${bold ? "font-bold" : "font-medium"} ${color}`}>{value}</span>
    </div>
  );
}

/** A small labeled stat cell; `hot` highlights the metric the user is ranking by. */
function Stat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className={`rounded-lg px-1 py-1.5 ${hot ? "bg-primary/10" : ""}`}>
      <div className={`tabular text-[12.5px] font-bold leading-tight ${hot ? "text-primary" : "text-foreground/80"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-foreground/45">{label}</div>
    </div>
  );
}
