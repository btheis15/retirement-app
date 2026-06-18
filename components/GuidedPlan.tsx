"use client";

/**
 * Guided, step-by-step walkthrough of THIS YEAR's plan — one decision/insight at
 * a time, in plain English, with a gentle animation between steps. It narrates:
 * goal → how much to spend → what already covers it → where to pull the rest →
 * the Roth rollover → the tax bill and exactly why → the next few years →
 * how solid the plan is. The dense dashboard still lives below ("show all the
 * numbers"); this is the calm front door so nobody has to study the page.
 */

import { useMemo, useState, useEffect, useDeferredValue, useTransition, ReactNode } from "react";
import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";
import { Card, Pill, Info, Callout } from "@/components/ui";
import { StackedBar } from "@/components/ui";
import { spendingSweep, SpendingSweep } from "@/lib/spendingSweep";
import { AnimatedNumber } from "@/components/charts";
import { planYear } from "@/lib/optimizer";
import { ltcgZeroCeiling } from "@/lib/tax/engine";
import { FILING_CONSTANTS, FilingStatus } from "@/lib/tax/constants";
import { projectLifetime, ProjectionAssumptions } from "@/lib/projection";
import { recommendPlan, planGist, configMatches, GOAL_META } from "@/lib/goals";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { computeMonteCarlo } from "@/lib/mcClient";
import { returnModel } from "@/lib/returns";
import { buildActionPlan, PlanYear, PlanAction } from "@/lib/actionPlan";
import { GoalId, survivorFromSettings } from "@/lib/defaults";
import { adjustedAnnualBenefit } from "@/lib/socialSecurity";
import { bucketOf, ACCOUNT_KIND_META, TaxBucket, Household } from "@/lib/accounts";
import { money, moneyCompact, percent } from "@/lib/format";

const GOALS: GoalId[] = ["maxCapital", "lowestTax", "lowestRate"];
const SPEND_MAX = 400_000;

export function GuidedPlan({ onSeeDetails }: { onSeeDetails: () => void }) {
  const { household, settings, updateSettings, updateHousehold, mode, setMode } = useStore();
  const year = useMemo(() => new Date().getFullYear(), []);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [, startTransition] = useTransition();

  // Step navigation: remember direction so the slide goes the way you're moving.
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(next, 99));
    setDir(clamped >= step ? "fwd" : "back");
    setStep(clamped);
  };

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
    }),
    [settings],
  );
  const proj = useMemo(() => projectLifetime(household, activeAssumptions), [household, activeAssumptions]);
  const plan = useMemo(
    () =>
      planYear(household, {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        year,
        conversion: settings.useConversions
          ? settings.convertMode === "recommended"
            ? { mode: "recommended", futureRate: proj.futureRate }
            : { mode: "fillBracket", toBracket: settings.bracketTarget }
          : null,
      }),
    [household, settings, proj.futureRate, year],
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
  useEffect(() => {
    let cancelled = false;
    computeMonteCarlo({
      kind: "mc",
      household: dHousehold,
      assumptions: dAssumptions,
      model: returnModel(dHousehold.accounts),
      runs: 300,
    }).then((res) => {
      if (!cancelled) setConfidence(res);
    });
    return () => {
      cancelled = true;
    };
  }, [dHousehold, dAssumptions]);
  // Use the FRESH household (not the deferred one) so the bracket this flow picks
  // always matches what the full dashboard picks for the same goal — otherwise the
  // two can momentarily disagree (the 22% vs 24% the user saw). The grid is light
  // and household edits are already debounced upstream.
  const rec = useMemo(() => recommendPlan(household, inputs, settings.goal), [household, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // What plan EACH goal would pick — so the goal step can show the tradeoff (or
  // reassure when all three agree). Deferred + display-only, and run in LIGHT mode
  // (no claim-age / window search — those are only needed for the active plan), so
  // three goals never trigger three heavy searches.
  const LIGHT = { searchWindow: false, optimizeClaimAge: false } as const;
  const recAll = useMemo(
    () => ({
      maxCapital: recommendPlan(dHousehold, inputs, "maxCapital", LIGHT).best.config,
      lowestTax: recommendPlan(dHousehold, inputs, "lowestTax", LIGHT).best.config,
      lowestRate: recommendPlan(dHousehold, inputs, "lowestRate", LIGHT).best.config,
    }),
    [dHousehold, settings], // eslint-disable-line react-hooks/exhaustive-deps
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
  const guaranteed = ssNow + plan.fixed.pension + allDividends + interestIncome;
  const spending = plan.spendingTarget;
  const conversion = plan.conversion;
  const conversionTax = plan.conversionTax;
  const totalTax = plan.tax.totalTax;
  const spendingTax = Math.max(0, totalTax - conversionTax);
  const coveredByIncome = totalDraw < 0.5;
  const isIL = (household.state ?? "IL") === "IL";
  // Federal can legitimately be ~$0 when income is mostly 0%-rate long-term gains/
  // qualified dividends and ordinary income is under the standard deduction.
  const federalZero = plan.tax.federalTax < 100 && plan.tax.taxableIncome > 1000;
  const zeroCeiling = ltcgZeroCeiling(plan.filingStatus);

  // ---- "What pays for it" context ----
  // Share of this year's funding that comes from guaranteed income vs. savings.
  const coverageRatio = guaranteed + totalDraw > 0 ? guaranteed / (guaranteed + totalDraw) : 1;
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
  const irmaaCliff = irmaaCliffInfo(
    plan.tax.magi,
    plan.inflationFactor,
    FILING_CONSTANTS[plan.filingStatus].irmaaTiers,
    medicareEnrollees,
  );

  const applyGoal = (goal: GoalId) => {
    startTransition(() => {
      const r = recommendPlan(household, inputs, goal);
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
  const rc = rec.best.config;
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
  type Step = { key: string; eyebrow: string; render: () => ReactNode };
  const steps: Step[] = [];
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  // Truly empty only when the user is on their OWN data with nothing entered yet.
  // In demo mode we SHOW the example (that's the whole point of an example).
  const needsOwnSetup = mode === "own" && household.accounts.length === 0;

  // STEP 0 — the one-time fork: you go through the WHOLE walkthrough either on the
  // $5M example or on your own numbers. No mid-flow toggle; to switch, you come back
  // here (Back from step 1, or "Start over" at the end) and re-pick.
  steps.push({
    key: "start",
    eyebrow: "let's begin",
    render: () => (
      <div>
        <h2 className="text-xl font-bold leading-snug">How do you want to start?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
          Pick one — the whole walkthrough runs on that choice. You can start over anytime to switch.
        </p>
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

  steps.push({
    key: "accounts",
    eyebrow: "start with your money",
    render: () => {
      if (needsOwnSetup) {
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">Let&apos;s use your real numbers</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              You haven&apos;t added any accounts yet. Add your IRAs, 401(k)s, Roth, and brokerage — balances and which
              funds — and this whole plan recalculates around what you actually have.
            </p>
            <Link
              href="/accounts"
              className="press mt-4 block rounded-2xl bg-primary px-4 py-3 text-center text-sm font-semibold text-white"
            >
              Add my accounts →
            </Link>
          </div>
        );
      }
      return (
        <div>
          {mode === "demo" && (
            <div className="mb-3 rounded-xl border border-ss/25 bg-ss/[0.06] px-3 py-2 text-[12px] text-foreground/70">
              📊 You&apos;re exploring a <strong>sample ~$5M household</strong> — nothing here is your real money.
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

  steps.push({
    key: "goal",
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
                <span className="min-w-0">
                  <span className={`block font-semibold ${active ? "text-primary" : ""}`}>{GOAL_META[g].short}</span>
                  <span className={`mt-0.5 block text-[12px] font-medium leading-snug ${active ? "text-foreground/70" : "text-foreground/45"}`}>
                    {planGist(recAll[g])}
                  </span>
                  {active && (
                    <span className="mt-1 block text-[12px] leading-snug text-foreground/55">{GOAL_META[g].blurb}</span>
                  )}
                </span>
                {active && <span className="ml-auto shrink-0 text-primary">✓</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 rounded-xl bg-gain/5 px-3 py-2 text-[12px] leading-relaxed text-foreground/70">
          {goalsAgree ? (
            <>
              🤖 Good news — for your numbers, all three goals lead to the <strong>same plan</strong> (the line under each
              is identical). Moving some money to a Roth wins on every measure here, so you can&apos;t go wrong. Next
              we&apos;ll show exactly what it means.
            </>
          ) : (
            <>
              🤖 Your goals would lead to <strong>different plans</strong> — the one-line summary under each button shows
              how. You picked <strong>{GOAL_META[settings.goal].short}</strong>; next we&apos;ll walk through what to do.
            </>
          )}
        </p>
      </div>
    ),
  });

  steps.push({
    key: "spend",
    eyebrow: "how much you can spend",
    render: () => {
      const cur = sweep.at(localSpend);
      const compPct = Math.max(0, Math.min(100, (sweep.comfortableMax / sweep.max) * 100));
      const sustPct = Math.max(compPct, Math.min(100, (sweep.sustainableMax / sweep.max) * 100));
      const zone = localSpend <= sweep.comfortableMax ? "comfortable" : localSpend <= sweep.sustainableMax ? "tight" : "short";
      const hasRoom = sweep.sustainableMax > 0;
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">How much do you want to spend each year?</h2>
          <p className="mt-1 text-[13px] text-foreground/60">
            Your <strong>take-home</strong> target — money in your pocket after all taxes. The colored bar shows how much
            your savings can actually support.
          </p>
          <div className="mt-4 text-center">
            <div className="tabular text-4xl font-bold text-primary">
              <AnimatedNumber value={localSpend} format={(n) => money(n)} />
            </div>
            <div className="text-[12px] text-foreground/50">per year, after tax</div>
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

          {/* Live impact on the account value */}
          {hasRoom && (
            <p
              className={`mt-3 rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                zone === "comfortable" ? "bg-gain/5 text-foreground/80" : zone === "tight" ? "bg-accent/10 text-foreground/80" : "bg-tax/5 text-foreground/80"
              }`}
            >
              {zone === "comfortable" && (
                <>✅ <strong>Comfortable.</strong> Your money lasts to {settings.endAge} and you&apos;d still have about{" "}
                  <strong>{money(cur.endingEstate)}</strong> left.</>
              )}
              {zone === "tight" && (
                <>🟡 <strong>Doable, but tight.</strong> It lasts to {settings.endAge}, but you&apos;d end with only about{" "}
                  <strong>{money(cur.endingEstate)}</strong>.</>
              )}
              {zone === "short" && (
                <>🔴 <strong>Too high.</strong> At this level your savings would run short around <strong>age {Number.isFinite(cur.depletionAge) ? cur.depletionAge : settings.endAge}</strong>.</>
              )}
            </p>
          )}

          {/* Sparkline: account value left vs how much you spend */}
          {hasRoom && <SpendSparkline sweep={sweep} current={localSpend} endAge={settings.endAge} />}

          {hasRoom && (
            <p className="mt-3 rounded-xl bg-primary/5 px-3 py-2 text-[12px] leading-relaxed text-foreground/70">
              💡 Most careful savers <em>under</em>-spend.{" "}
              {sweep.sustainableMax >= sweep.max ? (
                <>
                  Based on your accounts, your savings comfortably support even the most we model here —{" "}
                  <strong>{money(sweep.max)}/yr</strong>. You have plenty of room.
                </>
              ) : (
                <>
                  Based on your accounts, you can comfortably spend up to about{" "}
                  <strong>{money(sweep.comfortableMax)}/yr</strong>
                  {sweep.sustainableMax > sweep.comfortableMax + 5_000 ? (
                    <>
                      {" "}
                      — and up to <strong>{money(sweep.sustainableMax)}/yr</strong> before you&apos;d risk running short
                    </>
                  ) : null}
                  .
                </>
              )}
              {localSpend < sweep.comfortableMax - 10_000 && (
                <>
                  {" "}
                  <button onClick={() => setLocalSpend(Math.round(sweep.comfortableMax / 5_000) * 5_000)} className="press font-semibold text-primary underline">
                    Try {moneyCompact(sweep.comfortableMax)} →
                  </button>
                </>
              )}
              <span className="mt-1 block text-foreground/50">
                These ceilings already allow for a <strong>weak market</strong> (not just an average one) — the final step
                shows your exact odds across hundreds of simulations.
              </span>
            </p>
          )}

          {/* Medicare IRMAA cliff awareness — the spending you pick drives the
              withdrawals that drive MAGI, and IRMAA is a hard step, not a slope. */}
          {irmaaCliff && (irmaaCliff.inSurcharge || (!irmaaCliff.atTop && irmaaCliff.distance < 30_000)) && (
            <div className="mt-3 rounded-xl border border-tax/30 bg-tax/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
              <div className="font-semibold text-tax">🏥 Watch the Medicare (IRMAA) cliff</div>
              {irmaaCliff.inSurcharge ? (
                <p className="mt-1">
                  At this spending level your income lands in <strong>{irmaaCliff.curLabel}</strong> — about{" "}
                  <strong>{money(irmaaCliff.curSurcharge)}/yr</strong> in extra Medicare premiums for{" "}
                  {irmaaCliff.enrollees > 1 ? "both of you" : "you"}, billed two years later.
                  {irmaaCliff.overBy > 0 && irmaaCliff.overBy < 15_000 && irmaaCliff.dropSaving > 0 && (
                    <>
                      {" "}
                      You&apos;re only <strong>{money(irmaaCliff.overBy)}</strong> over the line — trimming spending (or this
                      year&apos;s rollover) a touch could drop {money(irmaaCliff.dropSaving)}/yr of that surcharge entirely.
                    </>
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
              <p className="mt-1 text-[11px] text-foreground/55">
                IRMAA is based on your income from two years prior, so today&apos;s choices set your premiums then.
              </p>
            </div>
          )}
        </div>
      );
    },
  });

  steps.push({
    key: "cover",
    eyebrow: "what pays for it",
    render: () => {
      const pct = Math.round(coverageRatio * 100);
      const heading = coveredByIncome
        ? "Your income already covers it"
        : coverageRatio >= 0.5
          ? "Good news — most of it is already covered"
          : coverageRatio >= 0.25
            ? "A good chunk is already covered"
            : pendingSS > 0.5
              ? "This year, most comes from your savings"
              : "Here's what funds your spending";
      // Itemize guaranteed income so "guaranteed" isn't a black box.
      const gItems = [
        { label: "Social Security", value: ssNow },
        { label: "Pension", value: plan.fixed.pension },
        { label: "Dividends & interest", value: allDividends + interestIncome },
      ].filter((g) => g.value > 0.5);
      // Withdrawal-rate read: is the savings draw a sustainable pace?
      const wrPct = (withdrawalRate * 100).toFixed(1);
      const wrTone = withdrawalRate <= 0.045 ? "gain" : withdrawalRate <= 0.06 ? "accent" : "tax";
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">{heading}</h2>
          <p className="mt-1 text-[13px] text-foreground/60">
            Your guaranteed income comes in first; you only pull from savings to fill the gap. Here&apos;s the split for {year}.
          </p>
          <div className="mt-4">
            <StackedBar
              segments={[
                { value: guaranteed, className: "bg-ss", label: "Guaranteed income" },
                { value: totalDraw, className: "bg-taxable", label: "From savings" },
              ].filter((s) => s.value > 0.5)}
            />
            <div className="mt-1 flex justify-between text-[11px] text-foreground/45">
              <span>{pct}% guaranteed income</span>
              <span>{100 - pct}% from savings</span>
            </div>
            <div className="mt-3 space-y-1 text-[13px]">
              <Row label="Guaranteed income (doesn't depend on markets)" value={money(guaranteed)} tone="ss" bold />
              {gItems.map((g) => (
                <Row key={g.label} label={`…${g.label}`} value={money(g.value)} sub />
              ))}
              <div className="my-1 border-t border-border/60" />
              <Row label="You pull this from savings" value={money(totalDraw)} tone="taxable" bold />
            </div>
          </div>

          {/* What this means — the real value: is the draw sustainable, and what changes when SS starts. */}
          {coveredByIncome ? (
            <p className="mt-3 rounded-xl bg-ss/5 px-3 py-2 text-[13px] text-foreground/75">
              Your guaranteed income alone covers your spending this year — you don&apos;t need to pull from savings
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
                  at {nextClaimAge}, about <strong>{money(pendingSS)}/yr</strong> more becomes guaranteed income — so you&apos;ll
                  pull noticeably less from savings, and these early years are the most you&apos;ll lean on your accounts.
                </p>
              )}
              <p className="mt-2 rounded-xl bg-foreground/[0.03] px-3 py-2 text-[13px] text-foreground/70">
                So this year you need <strong>{money(totalDraw)}</strong> from savings — next we&apos;ll show exactly which
                accounts it comes from, and why that order keeps your lifetime tax lowest.
              </p>
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
                    <strong>{money(ca.lift)}</strong> more over your lifetime — partly because delaying the higher earner
                    also locks in a larger benefit for whoever lives longer. It&apos;s a personal decision (health, cash
                    needs); you can set claim ages on the Accounts page. This estimate already reflects your plan-to age.
                  </>
                );
              })()}
            </Callout>
          )}
        </div>
      );
    },
  });

  steps.push({
    key: "pull",
    eyebrow: "where to pull it",
    render: () => {
      const items: { label: string; amount: number; why: string }[] = [];
      if (rmd > 0.5) items.push({ label: "Take your required withdrawal (RMD)", amount: rmd, why: "The IRS forces this out of pre-tax accounts first; it's taxed as ordinary income." });
      if (voluntaryPretax > 0.5) items.push({ label: "Withdraw from pre-tax (IRA/401k)", amount: voluntaryPretax, why: "Taxed as ordinary income — but done now, in a low bracket, so less is forced out at higher rates later." });
      if (w.taxable > 0.5) items.push({ label: "Spend taxable savings (cash first, then brokerage)", amount: w.taxable, why: "Cash is spent first (no tax); then brokerage, where only the gain is taxed at the lower capital-gains rate." });
      if (w.roth > 0.5) items.push({ label: "Tap your Roth (tax-free)", amount: w.roth, why: "Used last — tax-free and never forced out, so it keeps compounding the longest." });

      // Live proof: the three withdrawal orders on THIS household. We rank by money
      // you can COUNT ON — after-tax estate valued as if heirs realize the brokerage
      // gains rather than always getting a full step-up — because that's the measure
      // the advisor uses to avoid recommending a fragile, step-up-dependent plan.
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
          <h2 className="text-xl font-bold leading-snug">{coveredByIncome ? "Nothing to withdraw this year" : "Pull the rest from here — in this order"}</h2>
          <p className="mt-1 text-[13px] text-foreground/60">
            Take what&apos;s required first, then the source your numbers show keeps the most money after every tax —
            saving tax-free Roth for last.
          </p>
          {items.length === 0 ? (
            <p className="mt-4 rounded-xl bg-gain/5 px-3 py-3 text-[13px] text-foreground/75">Your income covers your spending — no withdrawals needed. Any surplus can be reinvested.</p>
          ) : (
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
          )}

          {items.length === 1 && (
            <p className="mt-2 text-[12px] leading-snug text-foreground/55">
              That one source covers this whole year&apos;s gap, so it&apos;s all you need now. In later years the mix can
              shift as balances and tax brackets change.
            </p>
          )}

          {/* The rollover is SEPARATE money movement, not spending — connect the two. */}
          {conversion > 0.5 && (
            <p className="mt-2 rounded-xl bg-roth/[0.08] px-3 py-2 text-[12px] leading-relaxed text-foreground/75">
              🔄 Separately, you&apos;ll move about <strong>{money(conversion)}</strong> from pre-tax into your Roth (the
              next step). That&apos;s <em>not</em> spending — it lands in your Roth and grows tax-free; its tax is best paid
              from cash.
            </p>
          )}

          {/* Why THIS order — proven on the user's own numbers, and honest about the
              "spend taxable first" rule of thumb. */}
          {!coveredByIncome && (
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
                  out in your 70s–80s as RMDs — often at a <em>higher</em> rate than you&apos;d pay today, and it can push
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
          )}
        </div>
      );
    },
  });

  if (pretaxShare > 0.2) {
    steps.push({
      key: "roll",
      eyebrow: "smoothing your future taxes",
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
          <div>
            <h2 className="text-xl font-bold leading-snug">Smooth your future tax bill</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              RMDs aren&apos;t the enemy — a steady withdrawal is fine. The trap is one <strong>big</strong> forced
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
                <strong>{moneyCompact(compare.smooth.lifetimeIrmaa)}</strong> with smoothing. That extra premium cost is
                already counted in &ldquo;money you keep&rdquo; above — it&apos;s part of why bigger isn&apos;t always
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

            {/* The decision, right here */}
            <div className="mt-4 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">Use the smoothing rollover plan?</span>
                <button
                  onClick={() => updateSettings({ useConversions: !settings.useConversions, planCustomized: true })}
                  className={`press rounded-full px-4 py-1.5 text-[13px] font-semibold ${settings.useConversions ? "bg-gain/15 text-gain" : "bg-primary text-white"}`}
                >
                  {settings.useConversions ? "✓ On" : "Turn on"}
                </button>
              </div>
              {settings.useConversions && (
                <>
                  <p className="mt-2 text-[12px] text-foreground/65">
                    This year that&apos;s about <strong>{money(conversion)}</strong> moved pre-tax → Roth — sized to fill
                    your {percent(settings.bracketTarget, 0)} bracket, no more.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateSettings({ convertMode: "recommended", planCustomized: true })}
                      className={`press rounded-xl border px-2 py-1.5 text-center text-[12px] ${settings.convertMode === "recommended" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70"}`}
                    >
                      Smooth (recommended)
                    </button>
                    <button
                      onClick={() => updateSettings({ convertMode: "fillBracket", planCustomized: true })}
                      className={`press rounded-xl border px-2 py-1.5 text-center text-[12px] ${settings.convertMode === "fillBracket" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70"}`}
                    >
                      Fill the {percent(settings.bracketTarget, 0)} bracket
                    </button>
                  </div>
                </>
              )}
            </div>
            {isIL && (
              <p className="mt-2 rounded-xl bg-gain/10 px-3 py-2 text-[12px] text-gain">
                🟢 In Illinois the rollover itself is <strong>state-tax-free</strong> — you only owe federal tax to do it.
              </p>
            )}
          </div>
        );
      },
    });
  }

  steps.push({
    key: "tax",
    eyebrow: "the tax, and why",
    render: () => (
      <div>
        <h2 className="text-xl font-bold leading-snug">Set aside {money(totalTax)} for tax</h2>
        <p className="mt-1 text-[13px] text-foreground/60">
          Here&apos;s exactly why it&apos;s that much — federal + {isIL ? "Illinois" : "state"}. That&apos;s about{" "}
          {percent(plan.tax.effectiveRate)} of your total income.
        </p>
        <div className="mt-4 space-y-1 rounded-2xl border border-border p-3 text-[13px]">
          <Row label="Taxable income this year" value={money(plan.tax.taxableIncome)} bold />
          <Row label={`Highest tax rate you hit`} value={percent(plan.tax.marginalOrdinaryRate, 0)} />
          <div className="my-1 border-t border-border/60" />
          {ssNow > 0 && <Row label="…from taxable Social Security" value={money(plan.tax.taxableSocialSecurity)} sub />}
          {w.pretax > 0.5 && <Row label="…from pre-tax withdrawals (incl. RMD)" value={money(w.pretax)} sub />}
          {conversion > 0.5 && <Row label="…from the Roth rollover" value={money(conversion)} sub />}
          {(allDividends > 0.5 || w.taxable > 0.5) && <Row label="…from dividends & brokerage sales" value={money(allDividends + w.taxable)} sub />}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-card/60 p-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-foreground/50">Federal</div>
            <div className="tabular text-sm font-bold text-tax">{moneyCompact(plan.tax.federalTax)}</div>
          </div>
          <div className="rounded-xl border border-border bg-card/60 p-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-foreground/50">{isIL ? "Illinois" : "State"} (4.95%)</div>
            <div className="tabular text-sm font-bold text-tax">{moneyCompact(plan.tax.stateTax)}</div>
          </div>
        </div>
        {federalZero && (
          <p className="mt-3 rounded-xl bg-ss/5 px-3 py-2 text-[12px] leading-relaxed text-foreground/75">
            <strong>Wait — why $0 federal?</strong> Most of your income this year is long-term capital gains and
            qualified dividends. {plan.filingStatus === "single" ? "Filing single" : "Filing jointly"}, those get a
            special <strong>0% federal rate</strong> as long as your taxable income stays under about{" "}
            {money(zeroCeiling)} — and your ordinary income is covered by the standard deduction, so there&apos;s
            nothing left for the IRS to tax. {isIL ? "Illinois has no 0% bracket, so it still taxes that investment income at its flat 4.95% — that's the " + money(plan.tax.stateTax) + "." : ""}
          </p>
        )}
        {conversion > 0.5 && (
          <p className="mt-3 rounded-xl bg-foreground/5 px-3 py-2 text-[12px] text-foreground/70">
            Of that, about <strong>{money(conversionTax)}</strong> is the tax on your rollover (best paid from cash, so the full{" "}
            {money(conversion)} lands in Roth){isIL ? " — Illinois adds nothing on the conversion" : ""}. The other{" "}
            {money(spendingTax)} covers your spending income.
          </p>
        )}
        {isIL && !federalZero && (
          <p className="mt-2 text-[12px] text-foreground/55">
            🟢 Illinois taxes only your investment income — your withdrawals, RMDs, rollover, pension, and Social Security are state-tax-free.
          </p>
        )}
      </div>
    ),
  });

  steps.push({
    key: "ahead",
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

  steps.push({
    key: "done",
    eyebrow: "You're set",
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
              In {confidence.runs.toLocaleString()} simulations of random market returns (correlated, fat-tailed), your money lasted to age{" "}
              {settings.endAge} this often — a likely range of {Math.round(confidence.successCI[0] * 100)}–
              {Math.round(confidence.successCI[1] * 100)}%.
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

  const safeStep = Math.min(step, steps.length - 1);
  const current = steps[safeStep];
  const isLast = safeStep >= steps.length - 1;

  // Persistent cash-flow reference: once the user has set their spending, keep the
  // key line items visible on every later step so they never lose track of the
  // number they picked (or where the rest of the cash is going). Off on the
  // setup/intro steps and when there's nothing to fund.
  const spendStepIdx = steps.findIndex((s) => s.key === "spend");
  const irmaa = plan.tax.irmaa?.householdAnnual ?? 0;
  const showCashFlow = !needsOwnSetup && spendStepIdx >= 0 && safeStep > spendStepIdx;

  return (
    <Card className="overflow-hidden">
      {/* progress dots */}
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
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        <CFItem icon="💵" label="Personal spending" value={spending} tone="text-foreground" />
        {conversion > 0.5 && <CFItem icon="🔄" label="Roth rollover" value={conversion} tone="text-roth" />}
        {tax > 0.5 && <CFItem icon="🧾" label="Tax set-aside" value={tax} tone="text-tax" />}
        {irmaa > 0.5 && <CFItem icon="🏥" label="Medicare IRMAA" value={irmaa} tone="text-tax" />}
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
type IrmaaTier = { upTo: number; monthlyPerPerson: number; label: string };
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
    { bucket: "pretax", title: "Pre-tax (Traditional)", note: "Taxed as income when withdrawn · RMDs apply", dot: "bg-deferred" },
    { bucket: "roth", title: "Roth", note: "Already taxed · grows tax-free · no RMDs", dot: "bg-roth" },
    { bucket: "taxable", title: "Taxable (brokerage & cash)", note: "Only the gains are taxed", dot: "bg-taxable" },
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
          <span className="tabular text-[12px] text-foreground/55">tax {moneyCompact(y.tax)}</span>
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
}: {
  status: FilingStatus;
  fillRate: number;
  futureRate: number;
  year: number;
}) {
  const brackets = FILING_CONSTANTS[status].ordinary;
  const fmt = (n: number) => moneyCompact(n);
  const showFuture = futureRate > fillRate + 1e-9; // only flag a future bracket that's actually higher
  return (
    <div className="mt-4 rounded-2xl border border-border p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
        Your federal brackets ({status === "mfj" ? "married filing jointly" : "single"}, {year})
      </div>
      <div className="space-y-1">
        {brackets.map((b, i) => {
          const from = i === 0 ? 0 : brackets[i - 1].upTo;
          const isFill = Math.abs(b.rate - fillRate) < 1e-9;
          const isFuture = showFuture && Math.abs(b.rate - futureRate) < 1e-9;
          const range = b.upTo === Infinity ? `${fmt(from)}+` : `${fmt(from)} – ${fmt(b.upTo)}`;
          return (
            <div
              key={b.rate}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] ${isFill ? "bg-gain/10" : isFuture ? "bg-tax/[0.07]" : ""}`}
            >
              <span className={`w-9 shrink-0 font-semibold ${isFill ? "text-gain" : isFuture ? "text-tax" : "text-foreground/70"}`}>
                {Math.round(b.rate * 100)}%
              </span>
              <span className="tabular text-foreground/55">{range}</span>
              {isFill && <span className="ml-auto text-[10px] font-semibold text-gain">↑ we fill to here</span>}
              {isFuture && (
                <span className="ml-auto text-[10px] font-semibold text-tax">↑ big RMDs would reach here</span>
              )}
            </div>
          );
        })}
      </div>
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

/** Tiny line showing account value left at the end vs. yearly spending, with a
 *  dot at the current choice — makes the spend↔legacy tradeoff visceral. */
function SpendSparkline({ sweep, current, endAge }: { sweep: SpendingSweep; current: number; endAge: number }) {
  const pts = sweep.points;
  if (pts.length < 2) return null;
  // Plot area with gutters for axis labels.
  const w = 340;
  const h = 124;
  const L = 46; // left gutter (y labels)
  const R = 10;
  const T = 10;
  const B = 26; // bottom gutter (x labels)
  const plotW = w - L - R;
  const plotH = h - T - B;
  const maxEst = Math.max(1, ...pts.map((p) => p.endingEstate));
  const xAt = (spend: number) => L + (spend / sweep.max) * plotW;
  const yAt = (est: number) => T + (1 - est / maxEst) * plotH;
  const baseY = yAt(0); // the $0 ("runs out") line
  const line = pts.map((p) => `${xAt(p.spend)},${yAt(p.endingEstate)}`).join(" L ");
  const cur = sweep.at(current);
  const cx = xAt(current);
  const cy = yAt(cur.endingEstate);
  const axis = "var(--color-foreground)";
  const xMid = sweep.max / 2;
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground/45">
        Money left at age {endAge} (up) vs. what you spend each year (right)
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Money left versus yearly spending">
        {/* axes */}
        <line x1={L} y1={T} x2={L} y2={baseY} stroke={axis} strokeOpacity="0.25" strokeWidth="1" />
        <line x1={L} y1={baseY} x2={w - R} y2={baseY} stroke={axis} strokeOpacity="0.25" strokeWidth="1" />
        {/* y-axis reference labels */}
        <text x={L - 5} y={T + 3} textAnchor="end" fontSize="9" fill={axis} fillOpacity="0.55">{moneyCompact(maxEst)}</text>
        <text x={L - 5} y={(T + baseY) / 2 + 3} textAnchor="end" fontSize="9" fill={axis} fillOpacity="0.45">{moneyCompact(maxEst / 2)}</text>
        <text x={L - 5} y={baseY + 3} textAnchor="end" fontSize="9" fill={axis} fillOpacity="0.55">$0</text>
        {/* the curve */}
        <path d={`M ${line}`} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* current choice marker + value */}
        <line x1={cx} y1={T} x2={cx} y2={baseY} stroke={axis} strokeOpacity="0.25" strokeDasharray="3 3" />
        <circle cx={cx} cy={cy} r="4" fill="var(--color-primary)" />
        <text x={Math.min(cx + 6, w - R)} y={Math.max(cy - 6, T + 8)} textAnchor={cx > w - 70 ? "end" : "start"} fontSize="10" fontWeight="600" fill="var(--color-primary)">
          {moneyCompact(cur.endingEstate)} left
        </text>
        {/* x-axis reference labels */}
        <text x={L} y={h - 8} textAnchor="start" fontSize="9" fill={axis} fillOpacity="0.55">$0</text>
        <text x={L + plotW / 2} y={h - 8} textAnchor="middle" fontSize="9" fill={axis} fillOpacity="0.45">{moneyCompact(xMid)}/yr</text>
        <text x={w - R} y={h - 8} textAnchor="end" fontSize="9" fill={axis} fillOpacity="0.55">{moneyCompact(sweep.max)}+/yr</text>
      </svg>
    </div>
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
