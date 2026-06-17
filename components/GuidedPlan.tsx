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
import { Card, Pill } from "@/components/ui";
import { StackedBar } from "@/components/ui";
import { spendingSweep, SpendingSweep } from "@/lib/spendingSweep";
import { AnimatedNumber } from "@/components/charts";
import { planYear } from "@/lib/optimizer";
import { ltcgZeroCeiling } from "@/lib/tax/engine";
import { projectLifetime, ProjectionAssumptions } from "@/lib/projection";
import { recommendPlan, GOAL_META } from "@/lib/goals";
import { runMonteCarlo } from "@/lib/monteCarlo";
import { returnModel } from "@/lib/returns";
import { buildActionPlan } from "@/lib/actionPlan";
import { GoalId, survivorFromSettings } from "@/lib/defaults";
import { bucketOf } from "@/lib/accounts";
import { money, moneyCompact, percent } from "@/lib/format";

const GOALS: GoalId[] = ["maxCapital", "lowestTax", "lowestRate"];
const SPEND_MAX = 400_000;

export function GuidedPlan({ onSeeDetails }: { onSeeDetails: () => void }) {
  const { household, settings, updateSettings, updateHousehold, mode } = useStore();
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
  const confidence = useMemo(() => {
    const rm = returnModel(dHousehold.accounts);
    return runMonteCarlo(dHousehold, dAssumptions, { expected: rm.expected, volatility: rm.volatility, runs: 150 });
  }, [dHousehold, dAssumptions]);
  const rec = useMemo(() => recommendPlan(dHousehold, inputs, settings.goal), [dHousehold, settings]); // eslint-disable-line react-hooks/exhaustive-deps

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
      aggressive: mk({ convert: { untilAge: settings.convertUntilAge, mode: "fillBracket" }, bracketTarget: 0.24 }),
    };
  }, [dHousehold, dAssumptions, settings.convertUntilAge]);

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

  const applyGoal = (goal: GoalId) => {
    startTransition(() => {
      const r = recommendPlan(household, inputs, goal);
      updateSettings({
        goal,
        strategy: r.best.config.strategy,
        bracketTarget: r.best.config.bracketTarget,
        useConversions: r.best.config.useConversions,
        convertMode: r.best.config.convertMode,
      });
    });
  };

  // ---- Steps ----
  type Step = { key: string; eyebrow: string; render: () => ReactNode };
  const steps: Step[] = [];
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  const needsSetup = mode === "demo" || household.accounts.length === 0;

  steps.push({
    key: "accounts",
    eyebrow: "start with your money",
    render: () => {
      if (needsSetup) {
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">First, let&apos;s use your real numbers</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              {mode === "demo"
                ? "Right now you're looking at a $5M example."
                : "You haven't added any accounts yet."}{" "}
              Add your accounts — balances, which funds, your IRAs/401(k)s/Roth — and this whole plan recalculates around
              what you actually have.
            </p>
            <Link
              href="/accounts"
              className="press mt-4 block rounded-2xl bg-primary px-4 py-3 text-center text-sm font-semibold text-white"
            >
              Add my accounts →
            </Link>
            {mode === "demo" && (
              <button
                onClick={() => go(1)}
                className="press mt-2 block w-full rounded-2xl border border-border py-3 text-center text-sm font-semibold text-foreground/70"
              >
                Or keep exploring the example
              </button>
            )}
          </div>
        );
      }
      const pre = household.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0);
      const roth = household.accounts.filter((a) => bucketOf(a.kind) === "roth").reduce((s, a) => s + a.balance, 0);
      const taxable = household.accounts.filter((a) => bucketOf(a.kind) === "taxable").reduce((s, a) => s + a.balance, 0);
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">Here&apos;s what you have</h2>
          <p className="mt-1 text-[13px] text-foreground/60">Everything below is built from these accounts. Looks right?</p>
          <div className="mt-5 text-center">
            <div className="tabular text-4xl font-bold text-primary">
              <AnimatedNumber value={total} format={(n) => money(n)} />
            </div>
            <div className="text-[12px] text-foreground/50">across {household.accounts.length} accounts</div>
          </div>
          <div className="mt-4">
            <StackedBar
              segments={[
                { value: pre, className: "bg-deferred", label: "Pre-tax" },
                { value: taxable, className: "bg-taxable", label: "Taxable" },
                { value: roth, className: "bg-roth", label: "Roth" },
              ].filter((s) => s.value > 0.5)}
            />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/60">
              {pre > 0.5 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-deferred align-middle" />Pre-tax {moneyCompact(pre)}</span>}
              {taxable > 0.5 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-taxable align-middle" />Taxable {moneyCompact(taxable)}</span>}
              {roth > 0.5 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-roth align-middle" />Roth {moneyCompact(roth)}</span>}
            </div>
          </div>
          <Link href="/accounts" className="press mt-4 block rounded-xl border border-border py-2.5 text-center text-[13px] font-semibold text-primary">
            Edit my accounts
          </Link>
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
                className={`press flex items-center gap-3 rounded-2xl border p-3 text-left ${
                  active ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="text-2xl">{GOAL_META[g].icon}</span>
                <span className="min-w-0">
                  <span className={`block font-semibold ${active ? "text-primary" : ""}`}>{GOAL_META[g].short}</span>
                  <span className="block text-[12px] leading-snug text-foreground/60">{GOAL_META[g].blurb}</span>
                </span>
                {active && <span className="ml-auto text-primary">✓</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 rounded-xl bg-gain/5 px-3 py-2 text-[12px] text-foreground/70">
          🤖 For this goal, the planner recommends <strong>{rec.best.config.useConversions ? "rolling some pre-tax to Roth" : "your current withdrawal order"}</strong>
          {" "}— we&apos;ll walk through exactly what that means next.
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
              💡 Most careful savers <em>under</em>-spend. Based on your accounts, you can comfortably spend up to about{" "}
              <strong>{money(sweep.comfortableMax)}/yr</strong> — and up to <strong>{money(sweep.sustainableMax)}/yr</strong>{" "}
              before you&apos;d risk running short.
              {localSpend < sweep.comfortableMax - 10_000 && (
                <>
                  {" "}
                  <button onClick={() => setLocalSpend(Math.round(sweep.comfortableMax / 5_000) * 5_000)} className="press font-semibold text-primary underline">
                    Try {moneyCompact(sweep.comfortableMax)} →
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      );
    },
  });

  steps.push({
    key: "cover",
    eyebrow: "what pays for it",
    render: () => (
      <div>
        <h2 className="text-xl font-bold leading-snug">Good news — most of it is already covered</h2>
        <p className="mt-1 text-[13px] text-foreground/60">Your guaranteed income comes in first; you only pull from savings to fill the gap.</p>
        <div className="mt-4">
          <StackedBar
            segments={[
              { value: guaranteed, className: "bg-ss", label: "Guaranteed income" },
              { value: totalDraw, className: "bg-taxable", label: "From savings" },
            ].filter((s) => s.value > 0.5)}
          />
          <div className="mt-3 space-y-1 text-[13px]">
            <Row label="Guaranteed income (Social Security, pension, dividends)" value={money(guaranteed)} tone="ss" />
            <Row label="You pull this from savings" value={money(totalDraw)} tone="taxable" />
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-ss/5 px-3 py-2 text-[13px] text-foreground/75">
          {coveredByIncome ? (
            <>Your guaranteed income alone covers your spending this year — you don&apos;t need to pull from savings{rmd > 0.5 ? " beyond the required RMD" : ""}.</>
          ) : (
            <>Social Security and other income cover <strong>{money(guaranteed)}</strong>. You&apos;ll pull the remaining <strong>{money(totalDraw)}</strong> from your accounts — next we&apos;ll show exactly where.</>
          )}
        </p>
      </div>
    ),
  });

  steps.push({
    key: "pull",
    eyebrow: "where to pull it",
    render: () => {
      const items: { label: string; amount: number; why: string; dot: string }[] = [];
      if (rmd > 0.5) items.push({ label: "Take your required withdrawal (RMD)", amount: rmd, why: "The IRS forces this out of pre-tax accounts first; it's taxed as ordinary income.", dot: "bg-deferred" });
      if (voluntaryPretax > 0.5) items.push({ label: "Withdraw from pre-tax (IRA/401k)", amount: voluntaryPretax, why: "Cheap dollars now, filling a low bracket, so less is forced out later.", dot: "bg-deferred" });
      if (w.taxable > 0.5) items.push({ label: "Sell from your brokerage", amount: w.taxable, why: "Only the gain is taxed, usually at the lower capital-gains rate.", dot: "bg-taxable" });
      if (w.roth > 0.5) items.push({ label: "Tap your Roth (tax-free)", amount: w.roth, why: "Used last — it's tax-free and never forced out, so it keeps growing.", dot: "bg-roth" });
      return (
        <div>
          <h2 className="text-xl font-bold leading-snug">{coveredByIncome ? "Nothing to withdraw this year" : "Pull the rest from here — in this order"}</h2>
          <p className="mt-1 text-[13px] text-foreground/60">We always take what&apos;s required first, then the most tax-friendly source, saving tax-free Roth for last.</p>
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
        </div>
      );
    },
  });

  if (pretaxShare > 0.2) {
    steps.push({
      key: "roll",
      eyebrow: "smoothing your future taxes",
      render: () => {
        const lt = (p: { lifetimeTax: number }) => p.lifetimeTax;
        const rows = [
          { name: "Do nothing extra", p: compare.none, hint: "RMDs come out in big chunks later" },
          { name: "Smooth (recommended)", p: compare.smooth, hint: "small rollovers, stay in low brackets", best: true },
          { name: "Convert aggressively", p: compare.aggressive, hint: "fill the 24% bracket every year" },
        ];
        const lowestLifetime = Math.min(...rows.map((r) => lt(r.p)));
        return (
          <div>
            <h2 className="text-xl font-bold leading-snug">Smooth your future tax bill</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              RMDs aren&apos;t the enemy — a steady withdrawal is fine. The trap is a <strong>big</strong> one that jumps
              you into a higher bracket. The fix isn&apos;t to wipe out RMDs; it&apos;s to move a little to Roth now —
              only up to the top of a low bracket — so every year stays low and your <strong>lifetime</strong> tax is the
              smallest. We never convert a dollar at a higher rate than you&apos;d pay later.
            </p>

            {/* Proof: three approaches on YOUR numbers */}
            <div className="mt-4 overflow-hidden rounded-2xl border border-border">
              <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-foreground/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
                <span>Approach</span>
                <span className="text-right">Lifetime tax</span>
                <span className="text-right">Worst RMD</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.name}
                  className={`grid grid-cols-[1.4fr_1fr_1fr] items-center px-3 py-2 text-[12px] ${r.best ? "bg-gain/[0.06]" : "border-t border-border/50"}`}
                >
                  <span>
                    <span className={`font-semibold ${r.best ? "text-gain" : ""}`}>{r.name}</span>
                    <span className="block text-[10px] leading-tight text-foreground/50">{r.hint}</span>
                  </span>
                  <span className={`tabular text-right font-semibold ${lt(r.p) === lowestLifetime ? "text-gain" : "text-foreground/80"}`}>
                    {moneyCompact(r.p.lifetimeTax)}
                  </span>
                  <span className="tabular text-right text-foreground/70">{moneyCompact(r.p.peakRmd)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-foreground/65">
              See it? <strong>Smoothing</strong> pays the least lifetime tax — small rollovers keep every year in a low
              bracket. Doing nothing lets RMDs balloon; converting aggressively just pre-pays tax you didn&apos;t need to.
            </p>

            {/* The decision, right here */}
            <div className="mt-4 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">Use the smoothing rollover plan?</span>
                <button
                  onClick={() => updateSettings({ useConversions: !settings.useConversions })}
                  className={`press rounded-full px-4 py-1.5 text-[13px] font-semibold ${settings.useConversions ? "bg-gain/15 text-gain" : "bg-primary text-white"}`}
                >
                  {settings.useConversions ? "✓ On" : "Turn on"}
                </button>
              </div>
              {settings.useConversions && (
                <>
                  <p className="mt-2 text-[12px] text-foreground/65">
                    This year that&apos;s about <strong>{money(conversion)}</strong> moved pre-tax → Roth — sized to fill
                    your low bracket, no more.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateSettings({ convertMode: "recommended" })}
                      className={`press rounded-xl border px-2 py-1.5 text-center text-[12px] ${settings.convertMode === "recommended" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/70"}`}
                    >
                      Smooth (recommended)
                    </button>
                    <button
                      onClick={() => updateSettings({ convertMode: "fillBracket" })}
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
          Here&apos;s exactly why it&apos;s that much — federal + {isIL ? "Illinois" : "state"}, at a{" "}
          {percent(plan.tax.effectiveRate)} average rate.
        </p>
        <div className="mt-4 space-y-1 rounded-2xl border border-border p-3 text-[13px]">
          <Row label="Taxable income this year" value={money(plan.tax.taxableIncome)} bold />
          <Row label={`Top bracket it reaches`} value={percent(plan.tax.marginalOrdinaryRate, 0)} />
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
        <div className="mt-4 space-y-2">
          {lookAhead.map((y, i) => (
            <div key={y.year} className="rise rounded-2xl border border-border p-3" style={{ ["--i" as string]: i } as React.CSSProperties}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {y.year} <span className="text-foreground/50">· age {y.selfAge}</span>
                </span>
                <span className="tabular text-[12px] text-foreground/55">tax {moneyCompact(y.tax)}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-foreground/70">{y.actions[0]?.text}{y.actions.length > 1 ? `, +${y.actions.length - 1} more` : ""}</p>
            </div>
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
        <div className="emoji-bounce text-4xl">{confidence.successPct >= 0.8 ? "🎉" : confidence.successPct >= 0.6 ? "👍" : "⚠️"}</div>
        <h2 className="mt-2 text-xl font-bold leading-snug">How solid is this plan?</h2>
        <div className="pop mt-3 tabular text-5xl font-bold" style={{ color: confidence.successPct >= 0.8 ? "var(--color-gain)" : confidence.successPct >= 0.6 ? "var(--color-accent)" : "var(--color-tax)" }}>
          <AnimatedNumber value={confidence.successPct * 100} format={(n) => `${Math.round(n)}%`} />
        </div>
        <p className="mt-1 text-[13px] text-foreground/65">
          In {confidence.runs} simulations of random market returns, your money lasted to age {settings.endAge} this often.
        </p>
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

/** Tiny line showing account value left at the end vs. yearly spending, with a
 *  dot at the current choice — makes the spend↔legacy tradeoff visceral. */
function SpendSparkline({ sweep, current, endAge }: { sweep: SpendingSweep; current: number; endAge: number }) {
  const w = 320;
  const h = 64;
  const padX = 4;
  const padTop = 6;
  const padBot = 4;
  const pts = sweep.points;
  if (pts.length < 2) return null;
  const maxEst = Math.max(1, ...pts.map((p) => p.endingEstate));
  const xAt = (spend: number) => padX + (spend / sweep.max) * (w - 2 * padX);
  const yAt = (est: number) => padTop + (1 - est / maxEst) * (h - padTop - padBot);
  const line = pts.map((p) => `${xAt(p.spend)},${yAt(p.endingEstate)}`).join(" L ");
  const cur = sweep.at(current);
  const cx = xAt(current);
  const cy = yAt(cur.endingEstate);
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground/45">Money left at {endAge} vs. yearly spending</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <path d={`M ${line}`} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={cx} y1={padTop} x2={cx} y2={h - padBot} stroke="var(--color-foreground)" strokeOpacity="0.2" strokeDasharray="3 3" />
        <circle cx={cx} cy={cy} r="3.5" fill="var(--color-primary)" />
      </svg>
      <div className="flex justify-between text-[10px] text-foreground/45">
        <span>spend $0</span>
        <span>{moneyCompact(sweep.max)}+</span>
      </div>
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
