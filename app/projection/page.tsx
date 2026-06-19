"use client";

import { useMemo, useState, useEffect } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Stat, Pill, Disclaimer, Callout, Explainer, Info, PageSkeleton, DesktopOnly, Collapsible } from "@/components/ui";
import { StackedArea, Bars, CompareBars, AnimatedNumber, FanChart } from "@/components/charts";
import { projectLifetime } from "@/lib/projection";
import { detectMilestones } from "@/lib/milestones";
import { analyzeConversions } from "@/lib/rothConversion";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { computeMonteCarlo } from "@/lib/mcClient";
import { runStressTests } from "@/lib/stressTest";
import { solveSafeSpending } from "@/lib/spendingSolver";
import { STRATEGY_META } from "@/lib/optimizer";
import { returnModel } from "@/lib/returns";
import { survivorFromSettings, PlannerSettings } from "@/lib/defaults";
import { survivalCurve, planningHorizonAge, probReachAge, lifeExpectancy, paramsFor, MORTALITY_META, Sex } from "@/lib/mortality";
import { Household } from "@/lib/accounts";
import { ReturnMethodInfo } from "@/components/ReturnMethodInfo";
import { SpendingPowerCard } from "@/components/SpendingPowerCard";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { SOURCES } from "@/lib/sources";

/** Monte-Carlo run count for the headline confidence check. */
const MC_RUNS = 1000;

export default function ProjectionPage() {
  const { ready, household, settings, updateSettings } = useStore();
  // The safe-spending RANGE: the most you can spend at 90% confidence if you NEVER
  // cut (flat), and if you're willing to FLEX (trim in down years, guardrails). The
  // two ends turn the old "$290k vs $451k" contradiction into one honest spectrum.
  const [safe, setSafe] = useState<{ flat: number; flex: number } | null>(null);
  const [solving, setSolving] = useState(false);
  const [solveProg, setSolveProg] = useState(0);
  const [boot, setBoot] = useState<MonteCarloResult | null>(null);
  const [bootLoading, setBootLoading] = useState(false);
  const [regime, setRegime] = useState<MonteCarloResult | null>(null);
  const [regimeLoading, setRegimeLoading] = useState(false);

  // A primitive key of ONLY the settings that change the math, so display-only
  // toggles (today's-dollars, sex for longevity, the goal flag) never retrigger
  // the heavy engines. household is referentially stable until accounts/people
  // actually change, so it's safe as an object dep.
  const computeKey = JSON.stringify({
    st: settings.strategy,
    bt: settings.bracketTarget,
    rr: settings.returnRate,
    ir: settings.inflationRate,
    ea: settings.endAge,
    uc: settings.useConversions,
    cua: settings.convertUntilAge,
    cm: settings.convertMode,
    sm: settings.survivorModel,
    fda: settings.firstDeathAge,
    htr: settings.heirTaxRate,
    sp: settings.spendingStrategy,
  });

  const result = useMemo(() => {
    const base = {
      bracketTarget: settings.bracketTarget,
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      survivor: survivorFromSettings(settings),
      heirTaxRate: settings.heirTaxRate,
      spendingStrategy: settings.spendingStrategy,
    };
    const chosen = projectLifetime(household, {
      ...base,
      strategy: settings.strategy,
      convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
    });
    const smart = projectLifetime(household, { ...base, strategy: "smart" });
    const conventional = projectLifetime(household, { ...base, strategy: "conventional" });
    const milestones = detectMilestones(household, chosen);
    const conv = analyzeConversions(household, {
      strategy: settings.strategy === "proportional" ? "smart" : settings.strategy,
      bracketTarget: settings.bracketTarget,
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      convertUntilAge: settings.convertUntilAge,
      mode: settings.convertMode,
      survivor: survivorFromSettings(settings),
      heirTaxRate: settings.heirTaxRate,
    });
    return { chosen, smart, conventional, milestones, conv };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household, computeKey]);

  // Monte-Carlo "plan confidence" for the active plan (fixed seed → stable number).
  // Run ASYNCHRONOUSLY off the render path: the 1,000-run simulation takes ~1–2s,
  // so doing it in useMemo froze the UI on every change. Instead we paint a loading
  // state first, then compute on the next tick; while recomputing we keep showing
  // the previous result (stale-while-revalidate) so nothing flickers or freezes.
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [mcLoading, setMcLoading] = useState(true);
  useEffect(() => {
    setMcLoading(true);
    // Inputs changed → any prior cross-check is now stale; reset to "Run →" so a
    // stale second opinion can never sit next to a freshly recomputed main number.
    setBoot(null);
    setRegime(null);
    let cancelled = false;
    computeMonteCarlo({
      kind: "mc",
      household,
      assumptions: {
        strategy: settings.strategy,
        bracketTarget: settings.bracketTarget,
        returnRate: settings.returnRate,
        inflationRate: settings.inflationRate,
        endAge: settings.endAge,
        convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
        survivor: survivorFromSettings(settings),
        heirTaxRate: settings.heirTaxRate,
        spendingStrategy: settings.spendingStrategy,
      },
      model: returnModel(household.accounts),
      runs: MC_RUNS,
    })
      .then((res) => {
        if (cancelled) return;
        setMc(res);
        setMcLoading(false);
      })
      .catch(() => {
        if (!cancelled) setMcLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household, computeKey]);

  // Deterministic sequence-of-returns stress tests (cheap, no randomness).
  const stress = useMemo(
    () =>
      runStressTests(household, {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household, computeKey],
  );

  // Return scenarios derived from the actual holdings (the SpendingPowerCard
  // normalizes settings.returnRate to one of these on mount).
  const rm = useMemo(() => returnModel(household.accounts), [JSON.stringify(household.accounts)]);
  const scenarios = useMemo(
    () => [
      { id: "cons", label: "Conservative", rate: rm.conservative },
      { id: "mod", label: "Moderate", rate: rm.expectedGeometric },
      { id: "opt", label: "Optimistic", rate: rm.optimistic },
    ],
    [rm],
  );

  if (!ready) return <PageSkeleton />;

  const { chosen, smart, conventional, milestones, conv } = result;
  const rows = chosen.rows;

  // Today's-dollars toggle: deflate every future figure by inflation so the user
  // sees real purchasing power instead of big nominal numbers. Point-in-time
  // values deflate by their own year; the projection already supplies real
  // versions of the lifetime aggregates.
  const real = settings.realDollars;
  const infl = settings.inflationRate;
  const startYr = rows[0]?.year ?? new Date().getFullYear();
  const defAt = (year: number) => (real ? 1 / Math.pow(1 + infl, year - startYr) : 1);
  const lifetimeTaxDisp = real ? chosen.lifetimeTaxReal : chosen.lifetimeTax;
  const endingAfterTaxDisp = real ? chosen.endingEstateAfterTaxReal : chosen.endingEstateAfterTax;
  const endingGrossDisp = real ? chosen.endingEstateReal : chosen.endingEstate;
  // Guaranteed-income floor (SS + pension): contextualizes "failure" as a spending
  // cut, not $0. Uses the full benefits as the eventual lifetime floor.
  const guaranteedAnnual = household.self.socialSecurityAnnual + household.spouse.socialSecurityAnnual + household.pensionAnnual;
  const guaranteedMonthly = guaranteedAnnual / 12;

  const findSafeSpending = async () => {
    setSolving(true);
    setSafe(null);
    setSolveProg(0);
    const baseA = {
      strategy: settings.strategy,
      bracketTarget: settings.bracketTarget,
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
      survivor: survivorFromSettings(settings),
      heirTaxRate: settings.heirTaxRate,
    } as const;
    // Both ends at the SAME 90% confidence — they differ only by whether you flex
    // spending in downturns, so the comparison is honest (apples to apples).
    const flatRes = await solveSafeSpending(household, { ...baseA, spendingStrategy: "constant" }, [0.9], {
      model: rm,
      onProgress: (d, t) => setSolveProg((d / t) * 0.5),
    });
    const flexRes = await solveSafeSpending(household, { ...baseA, spendingStrategy: "guardrails" }, [0.9], {
      model: rm,
      onProgress: (d, t) => setSolveProg(0.5 + (d / t) * 0.5),
    });
    setSafe({ flat: flatRes[0]?.spend ?? 0, flex: Math.max(flatRes[0]?.spend ?? 0, flexRes[0]?.spend ?? 0) });
    setSolving(false);
  };

  const crossCheckAssumptions = () => ({
    strategy: settings.strategy,
    bracketTarget: settings.bracketTarget,
    returnRate: settings.returnRate,
    inflationRate: settings.inflationRate,
    endAge: settings.endAge,
    convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
    survivor: survivorFromSettings(settings),
    heirTaxRate: settings.heirTaxRate,
    spendingStrategy: settings.spendingStrategy,
  });

  const runBootstrap = () => {
    setBootLoading(true);
    setBoot(null);
    computeMonteCarlo({ kind: "bootstrap", household, assumptions: crossCheckAssumptions(), model: rm, runs: 600 })
      .then((res) => {
        setBoot(res);
        setBootLoading(false);
      })
      .catch(() => setBootLoading(false));
  };

  const runRegime = () => {
    setRegimeLoading(true);
    setRegime(null);
    computeMonteCarlo({ kind: "regime", household, assumptions: crossCheckAssumptions(), model: rm, runs: 600 })
      .then((res) => {
        setRegime(res);
        setRegimeLoading(false);
      })
      .catch(() => setRegimeLoading(false));
  };

  // Stacked-area series (sample is fine — rows are annual).
  const areaRows = rows.map((r) => ({ x: r.year }));
  const series = [
    { key: "pretax", color: HEX.deferred, values: rows.map((r) => r.startBalances.pretax * defAt(r.year)) },
    { key: "taxable", color: HEX.taxable, values: rows.map((r) => r.startBalances.taxable * defAt(r.year)) },
    { key: "roth", color: HEX.roth, values: rows.map((r) => r.startBalances.roth * defAt(r.year)) },
  ];

  // RMD bars — sample down to ~10 columns.
  const step = Math.max(1, Math.round(rows.length / 10));
  const rmdBars = rows
    .filter((_, i) => i % step === 0)
    .map((r) => ({ label: `'${String(r.year).slice(2)}`, value: r.rmd * defAt(r.year) }));

  // Real-dollar MC outputs are deflated PER RUN by that run's own realized
  // inflation path (in the engine), not by a single average rate — correct in the
  // tails. So just pick the engine's real series when today's-dollars is on.

  const savings = real ? conventional.lifetimeTaxReal - smart.lifetimeTaxReal : conventional.lifetimeTax - smart.lifetimeTax;
  const estateGain = real
    ? smart.endingEstateAfterTaxReal - conventional.endingEstateAfterTaxReal
    : smart.endingEstateAfterTax - conventional.endingEstateAfterTax;

  // RMD summary: when they begin, the first amount, and the peak.
  const firstRmd = rows.find((r) => r.rmd > 0);
  const peakRmd = rows.reduce((m, r) => Math.max(m, r.rmd), 0);

  return (
    <div>
      <PageTitle title="Lifetime forecast" subtitle="Will your money last, and how much can you safely spend?" />

      {/* Headline — the ANSWER comes first, before any assumption controls. */}
      <SectionTitle hint={STRATEGY_META[settings.strategy].label}>If you follow this plan</SectionTitle>
      <Card>
        <div className="grid grid-cols-3 gap-y-4">
          <Stat label="Lifetime tax (fed + IL)" tone="tax" value={<AnimatedNumber value={lifetimeTaxDisp} format={moneyCompact} />} />
          <Stat
            label={`After-tax estate at ${settings.endAge}`}
            tone="gain"
            value={<AnimatedNumber value={endingAfterTaxDisp} format={moneyCompact} />}
            sub={`${moneyCompact(endingGrossDisp)} before deferred tax`}
          />
          <Stat
            label="Plan confidence"
            tone={!mc ? "default" : mc.successPct >= 0.8 ? "gain" : mc.successPct >= 0.6 ? "default" : "tax"}
            value={mc ? `${Math.round(mc.successPct * 100)}%` : "···"}
            sub={mc ? `${Math.round(mc.successCI[0] * 100)}–${Math.round(mc.successCI[1] * 100)}% likely range` : "calculating…"}
          />
        </div>
        {chosen.depleted && (
          <div className="mt-3">
            <Pill tone="tax">⚠️ At the flat return, assets run short before age {settings.endAge}</Pill>
          </div>
        )}
        <Info q="What does “after-tax estate” mean?" className="mt-3">
          <p>
            Your <strong>estate</strong> is what&apos;s left at your plan-to age of {settings.endAge}. The headline
            number is <strong>after-tax</strong> — what heirs actually keep after the income tax owed on inherited
            pre-tax accounts. The smaller print, <strong>&ldquo;before deferred tax,&rdquo;</strong> is the raw balance{" "}
            <em>before</em> an heir would owe that income tax on the pre-tax (traditional IRA/401k) portion.
          </p>
        </Info>
      </Card>

      {/* ---------- Monte-Carlo: probability the money lasts ---------- */}
      <SectionTitle hint={`${MC_RUNS.toLocaleString()} simulations`}>Will your money last? (market-risk check)</SectionTitle>
      <Explainer>
        The forecast above uses one steady return. Real markets bounce around — here we re-run your plan {MC_RUNS.toLocaleString()} times.
        Each year, stocks/bonds/cash are drawn <strong>together</strong> from their correlated, <strong>fat-tailed</strong>{" "}
        distributions (~{percent(rm.volatility, 0)} volatility), so crashes and down-years for both stocks and bonds can
        happen — the way professional engines model it.
      </Explainer>
      <Card>
        {mc ? (
          <MonteCarloResults
            mc={mc}
            real={real}
            endAge={settings.endAge}
            hasPension={household.pensionAnnual > 0}
            guaranteedMonthly={guaranteedMonthly}
            spendingStrategy={settings.spendingStrategy}
            selfBirthYear={household.self.birthYear}
          />
        ) : (
          <MCResultsLoading />
        )}
        {mc && mcLoading && (
          <p className="mt-2 text-center text-[11px] text-foreground/45">↻ Updating with your latest numbers…</p>
        )}
        {/* Safe-spending RANGE — the same 90% confidence, flat vs. flexible. Turns
            the old contradiction (one widget said "$X runs short," another "$Y is
            safe") into one honest spectrum. */}
        <div className="mt-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Your safe spending range</span>
            <button
              onClick={findSafeSpending}
              disabled={solving}
              className="press rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {solving ? `Solving… ${Math.round(solveProg * 100)}%` : safe ? "Recompute" : "Find my range →"}
            </button>
          </div>
          {!safe && !solving && (
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/55">
              Solves for your safe yearly spend at <strong>90% confidence</strong> two ways: spending the same amount
              every year, vs. trimming a little in down markets. This stress-tests the spending target you set on the
              Plan tab. Runs a few hundred simulations; takes a few seconds.
            </p>
          )}
          {solving && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(solveProg * 100)}%` }} />
            </div>
          )}
          {safe && !solving && (
            <div className="mt-2">
              <div className="rounded-xl border border-gain/30 bg-gain/[0.06] p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-foreground/50">Safe to spend (90% confidence)</div>
                <div className="tabular text-xl font-bold text-gain">
                  {moneyCompact(safe.flat)} – {moneyCompact(safe.flex)}/yr
                </div>
                <div className="mt-0.5 text-[10px] text-foreground/45">in today&apos;s dollars</div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-xl border border-border bg-background/60 p-2">
                  <div className="tabular font-bold text-foreground/85">{moneyCompact(safe.flat)}/yr</div>
                  <div className="text-foreground/55">if you spend the <strong>same every year</strong>, never cutting</div>
                </div>
                <div className="rounded-xl border border-border bg-background/60 p-2">
                  <div className="tabular font-bold text-foreground/85">{moneyCompact(safe.flex)}/yr</div>
                  <div className="text-foreground/55">if you&apos;ll <strong>trim a little</strong> in down markets (guardrails)</div>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/55">
                You&apos;re currently planning <strong>{moneyCompact(household.annualSpending)}/yr</strong>
                {household.annualSpending <= safe.flat
                  ? " — within even the never-cut level, so you have real room."
                  : household.annualSpending <= safe.flex
                    ? " — above the never-cut level but safe if you can flex in bad years."
                    : " — above both; consider trimming, working longer, or leaning on guardrails."}
              </p>
            </div>
          )}
        </div>

        {/* Second opinions — block-bootstrap + regime-switching + the "why
            percentiles" note. Advanced/reassurance, desktop-only so the mobile
            flow stays headline → will-it-last → safe range → longevity. */}
        <DesktopOnly>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Second opinions (optional) — when all three models agree, you can trust the number</p>
        {/* Historical block-bootstrap — a "second opinion" from real market history. */}
        <div className="mt-2 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Cross-check against real history</span>
            <button
              onClick={runBootstrap}
              disabled={bootLoading || !mc}
              className="press rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-[12px] font-semibold text-primary disabled:opacity-50"
            >
              {bootLoading ? "Running…" : boot ? "Rerun" : "Run →"}
            </button>
          </div>
          {!boot && !bootLoading && (
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/55">
              The check above draws returns from a statistical model. This re-runs your plan through random multi-year
              blocks of <strong>actual 1928–2024 market history</strong> (a &ldquo;block bootstrap,&rdquo; like cFIREsim) —
              capturing real crashes, the 1970s stagflation, and how stocks, bonds &amp; inflation truly moved together.
              Detrended to the same long-run averages, so only the <em>shape</em> differs.
            </p>
          )}
          {boot && mc && !bootLoading && (
            <p className="mt-2 text-[12px] leading-relaxed text-foreground/70">
              Historical: <strong className="text-foreground/90">{Math.round(boot.successPct * 100)}%</strong>{" "}
              ({Math.round(boot.successCI[0] * 100)}–{Math.round(boot.successCI[1] * 100)}%) vs.{" "}
              <strong>{Math.round(mc.successPct * 100)}%</strong> from the model.{" "}
              {Math.abs(boot.successPct - mc.successPct) <= 0.04
                ? "The two agree closely — a reassuring sign your result isn't an artifact of the model's shape."
                : boot.successPct < mc.successPct
                  ? "History is a bit harsher — real sequences (stagflation, clustered crashes) stress the plan more than the smooth model."
                  : "History is a touch kinder here than the fat-tailed model."}
            </p>
          )}
        </div>

        {/* Regime-switching — the actuarial-standard model with volatility clustering. */}
        <div className="mt-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Cross-check with regime-switching (actuarial standard)</span>
            <button
              onClick={runRegime}
              disabled={regimeLoading || !mc}
              className="press rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-[12px] font-semibold text-primary disabled:opacity-50"
            >
              {regimeLoading ? "Running…" : regime ? "Rerun" : "Run →"}
            </button>
          </div>
          {!regime && !regimeLoading && (
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/55">
              Re-runs your plan under a <strong>tougher test where bad years tend to clump together</strong> (the
              regime-switching model actuaries use for capital reserving). Equity flips between a calm bull market and a
              sharply negative bear market, and a down year is far more likely to be followed by another, so bad years{" "}
              <strong>cluster</strong> — the real-world pattern a smooth model understates. We hold the average return
              <em> and</em> volatility identical to the main model, so any difference is the <em>clustering</em> alone.
              Calibrated to 1928–2024 history.
            </p>
          )}
          {regime && mc && !regimeLoading && (
            <p className="mt-2 text-[12px] leading-relaxed text-foreground/70">
              Regime-switching: <strong className="text-foreground/90">{Math.round(regime.successPct * 100)}%</strong>{" "}
              ({Math.round(regime.successCI[0] * 100)}–{Math.round(regime.successCI[1] * 100)}%) vs.{" "}
              <strong>{Math.round(mc.successPct * 100)}%</strong> from the main model.{" "}
              {regime.successPct < mc.successPct - 0.02
                ? "Clustered down-years stress the plan a bit more — at the same average return and volatility — which is exactly why professionals don't rely on a single model that treats each year as independent."
                : Math.abs(regime.successPct - mc.successPct) <= 0.02
                  ? "The two land in the same place — your result is robust to how returns are modeled, not an artifact of the smooth model's shape."
                  : "Comparable to the main model."}{" "}
              {regime.regimeInfo && (
                <span className="text-foreground/45">
                  (Bull ≈ {percent(regime.regimeInfo.bullMean, 0)}/yr {percent(regime.regimeInfo.bullWeight, 0)} of the
                  time; bear ≈ {percent(regime.regimeInfo.bearMean, 0)}/yr — retargeted to your forward assumptions.)
                </span>
              )}
            </p>
          )}
        </div>

        <Info q="Why percentiles instead of “average ± standard deviation”?" sources={[]}>
          <p className="mb-1.5">
            The randomness <em>input</em> is your portfolio&apos;s volatility — a standard deviation (~{percent(rm.volatility, 0)} a
            year here) applied to a {percent(rm.expected, 1)} expected return, drawn lognormally so a year can&apos;t lose
            more than 100%.
          </p>
          <p className="mb-1.5">
            But the <em>outcome</em> — money left after decades of compounding and withdrawals — is heavily right-skewed, so a
            plain &ldquo;mean ± SD&rdquo; would misstate it (it implies a symmetric bell curve and can even suggest negative
            wealth). That&apos;s why professional planning tools report <strong>percentiles</strong>: the 50th is the median
            outcome, the 25th–75th is the likely range, and the 10th–90th brackets the unlucky-to-lucky span — the same
            cone-of-outcomes view you&apos;d see in eMoney or RightCapital.
          </p>
          <p>
            It captures sequence-of-returns risk (a bad early stretch hurts more), fat tails (crash-sized years), and
            stocks &amp; bonds falling together. The main model draws each year independently; for the two effects it
            doesn&apos;t build in — serial correlation and regime shifts — use the <strong>real-history</strong> and{" "}
            <strong>regime-switching</strong> cross-checks above, which re-run your exact plan under those dynamics. When
            all three land in the same neighborhood (they typically do), the result is robust to how returns are
            modeled — not an artifact of one model&apos;s shape. Treat the percentage as a directional confidence check,
            not a guarantee; a concentrated single-stock portfolio is riskier than the volatility shown. Lowering
            spending, delaying Social Security, or holding more bonds raises the number.
          </p>
          <p className="pt-1 text-foreground/60">
            Want the deeper &ldquo;how &amp; why&rdquo; on each model — and who in the industry uses it, with sources? See{" "}
            <a href="/learn" className="font-semibold text-primary underline decoration-primary/30 underline-offset-2">
              The models &amp; methods behind your forecast
            </a>{" "}
            on the Learn tab.
          </p>
        </Info>
        </DesktopOnly>
      </Card>

      {/* ---------- How long to plan for — an input to the answer above, so it
           follows it. ---------- */}
      <LongevityCard household={household} settings={settings} updateSettings={updateSettings} real={real} />

      {/* ---------- Adjust the assumptions — every knob behind the forecast in ONE
           collapsed panel, after the answer (not before it). ---------- */}
      <Collapsible
        eyebrow="tune it"
        title="Adjust the assumptions"
        summary="Return scenario, inflation, plan-to age, today's-dollars, survivor years, spending strategy, heir tax"
        defaultOpenDesktop={false}
        className="mt-2"
      >
        <span className="mb-1 block text-[12px] font-medium text-foreground/60">Return scenario</span>
        <div className="flex gap-2">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => updateSettings({ returnRate: s.rate })}
              className={`press flex-1 rounded-xl border py-2 text-center ${
                Math.abs(settings.returnRate - s.rate) < 0.0025
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border"
              }`}
            >
              <div className="text-[12px] font-semibold">{s.label}</div>
              <div className="text-[11px] text-foreground/55">{percent(s.rate, 1)}/yr</div>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-foreground/55">
          Based on your holdings ({percent(rm.equityPct, 0)} stocks · {percent(rm.bondPct, 0)} bonds · {percent(rm.cashPct, 0)} cash).
          Stocks have averaged ~10%/yr long-term, so a stock-heavy mix sits high; these scenarios bracket your blend.
          {rm.basis !== "holdings" && " (Accounts without itemized holdings use an assumed mix — add holdings for precision.)"}
        </p>
        <ReturnMethodInfo rm={rm} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-foreground/60">Inflation</span>
            <select
              className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm"
              value={settings.inflationRate}
              onChange={(e) => updateSettings({ inflationRate: Number(e.target.value) })}
            >
              {[0.02, 0.025, 0.03, 0.035].map((v) => (
                <option key={v} value={v}>{percent(v, 1)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-foreground/60">Plan to age</span>
            <select
              className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm"
              value={settings.endAge}
              onChange={(e) => updateSettings({ endAge: Number(e.target.value) })}
            >
              {[85, 90, 95, 100, 105].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 space-y-1 border-t border-border/50 pt-2">
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-[13px]">
              <span className="font-medium">Show in today’s dollars</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-foreground/55">
                Adjust every future figure for inflation, so amounts reflect real purchasing power instead of big
                nominal numbers.
              </span>
            </span>
            <button
              onClick={() => updateSettings({ realDollars: !settings.realDollars })}
              className={`press shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${real ? "bg-gain/15 text-gain" : "bg-foreground/10 text-foreground/60"}`}
            >
              {real ? "✓ On" : "Off"}
            </button>
          </label>

          <div className="border-t border-border/50 pt-2">
            <label className="flex items-center justify-between gap-3 py-1">
              <span className="text-[13px]">
                <span className="font-medium">Model the survivor years</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-foreground/55">
                  The &quot;widow&apos;s penalty&quot;: after the first spouse passes, the survivor files Single — harder
                  brackets and a smaller deduction.
                </span>
              </span>
              <button
                onClick={() => updateSettings({ survivorModel: !settings.survivorModel })}
                className={`press shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${settings.survivorModel ? "bg-gain/15 text-gain" : "bg-foreground/10 text-foreground/60"}`}
              >
                {settings.survivorModel ? "✓ On" : "Off"}
              </button>
            </label>
            {settings.survivorModel && (
              <label className="flex items-center justify-between gap-3 py-1">
                <span className="text-[12px] text-foreground/60">First spouse passes at age</span>
                <select
                  className="rounded-xl border border-border bg-background/60 px-3 py-1.5 text-sm"
                  value={settings.firstDeathAge}
                  onChange={(e) => updateSettings({ firstDeathAge: Number(e.target.value) })}
                >
                  {[80, 82, 85, 88, 90, 92].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="border-t border-border/50 pt-2">
            <span className="text-[13px] font-medium">Spending strategy</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-foreground/55">
              <strong>Rises with inflation</strong> keeps your lifestyle steady — the dollar amount grows ~
              {percent(settings.inflationRate, 1)}/yr (the sensible default). <strong>Flat</strong> spends the same
              dollars every year (buys less over time). <strong>Guardrails</strong> (Guyton-Klinger) trims ~10% after bad
              markets and raises it after good ones — the most survivable, the way a real retiree adjusts.
            </span>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(["constant", "flatNominal", "guardrails"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => updateSettings({ spendingStrategy: s })}
                  className={`press rounded-xl border px-2 py-1.5 text-center text-[11.5px] font-semibold ${settings.spendingStrategy === s ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"}`}
                >
                  {s === "constant" ? "Rises w/ inflation" : s === "flatNominal" ? "Flat (same $)" : "Guardrails"}
                </button>
              ))}
            </div>
          </div>

          <label className="block border-t border-border/50 pt-2">
            <span className="text-[13px] font-medium">Heir&apos;s tax rate on inherited pre-tax</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-foreground/55">
              A non-spouse heir must drain an inherited IRA within 10 years (SECURE Act), taxed at their own bracket.
              Drives the &quot;after-tax estate.&quot; Default 24%.
            </span>
            <select
              className="mt-1.5 w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm"
              value={settings.heirTaxRate}
              onChange={(e) => updateSettings({ heirTaxRate: Number(e.target.value) })}
            >
              {[0.12, 0.22, 0.24, 0.32].map((v) => (
                <option key={v} value={v}>{percent(v, 0)}</option>
              ))}
            </select>
          </label>
        </div>
      </Collapsible>

      {/* ---------- Stress tests: sequence-of-returns "what ifs" (desktop-only) ---------- */}
      <DesktopOnly>
      <SectionTitle hint="sequence-of-returns">Stress tests — what if it goes wrong early?</SectionTitle>
      <Explainer>
        Monte Carlo asks &ldquo;how often does it work?&rdquo; These ask the opposite: what if a crash or a lost decade hits
        right as you retire — the worst possible timing? Each runs your exact plan through a fixed bad sequence.
      </Explainer>
      <div className="space-y-2">
        {stress.map((s) => (
          <Card as="div" key={s.scenario.id} className={`border-l-4 ${s.depleted ? "border-l-tax" : "border-l-gain"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{s.scenario.name}</span>
              <span className={`tabular text-[12px] font-semibold ${s.depleted ? "text-tax" : "text-gain"}`}>
                {s.depleted ? `runs short at age ${s.depletionAge}` : `survives · ${moneyCompact(real ? s.endingEstateAfterTax / Math.pow(1 + infl, rows.length) : s.endingEstateAfterTax)} left`}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-foreground/65">{s.scenario.description}</p>
            <p className="mt-1 text-[11px] text-foreground/45">
              Low point: {moneyCompact(real ? s.minBalance / Math.pow(1 + infl, Math.max(0, s.minBalanceAge - rows[0].selfAge)) : s.minBalance)} around age {s.minBalanceAge}.
            </p>
          </Card>
        ))}
      </div>
      </DesktopOnly>

      {chosen.survivorYear > 0 && (
        <Callout tone="warn" icon="🕊️" title={`Survivor years modeled from ${chosen.survivorYear}`} className="mt-2">
          From {chosen.survivorYear} the forecast assumes one spouse has passed and the survivor files <strong>single</strong>{" "}
          — tax brackets and the standard deduction roughly halve, so the same RMDs are taxed harder (the &quot;widow&apos;s
          penalty&quot;). It&apos;s built into every number here, and it&apos;s a major reason converting to Roth during your
          joint years pays off.
        </Callout>
      )}

      {/* What-if spending explorer — demoted and collapsed. Your SAFE number is the
          range above; this slider is purely exploratory ("could I spend more?"). */}
      <Collapsible
        title="Explore other spending levels"
        summary="A what-if slider — not your safe number (that's the range above)"
        defaultOpenDesktop={false}
        className="mt-2"
      >
        <SpendingPowerCard />
      </Collapsible>

      {/* ---------- Deep analytics — desktop-only. On a phone the Forecast stays
           focused on "will it last / how much can I spend"; the full charts, the
           rollover comparison, milestones, and the year-by-year table live on the
           larger screen where there's room to study them. ---------- */}
      <DesktopOnly
        mobileNote={
          <Card className="mt-2">
            <p className="text-[13px] leading-relaxed text-foreground/65">
              📊 The full detail — balances over time, your RMD schedule, the rollover comparison, smart-vs-conventional,
              key milestones, and the year-by-year table — is on the <strong>desktop version</strong>, where there&apos;s room
              to lay it out. Open this on a laptop to dig in. Roth conversions are turned on and tuned on the{" "}
              <strong>Plan tab</strong>.
            </p>
          </Card>
        }
      >
      {/* Balances over time */}
      <SectionTitle>Account balances over time</SectionTitle>
      <Card>
        <StackedArea rows={areaRows} series={series} yLabel={(n) => moneyCompact(n)} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <Key color={HEX.deferred} label="Pre-tax" />
          <Key color={HEX.taxable} label="Taxable" />
          <Key color={HEX.roth} label="Roth" />
        </div>
        <p className="mt-2 text-[12px] text-foreground/55">
          Watch the pre-tax (amber) band: the smart plan shrinks it early so forced RMDs stay small,
          while Roth (violet) is preserved for last.
        </p>
      </Card>

      {/* RMD ramp */}
      <SectionTitle>Required minimum distributions</SectionTitle>
      {firstRmd ? (
        <Callout tone="info" icon="📌" title={`RMDs begin in ${firstRmd.year} (age ${firstRmd.selfAge})`}>
          Your first required withdrawal is about <strong>{money(firstRmd.rmd)}</strong>, rising to roughly{" "}
          <strong>{money(peakRmd)}</strong> at the peak as the IRS divisor shrinks. RMDs are taxed as ordinary
          income whether you need the cash or not. <strong>The plan always takes at least the RMD</strong> (it
          comes out first), so you&apos;ll never under-withdraw — the year-by-year table below shows the pre-tax
          column meeting or exceeding it.
        </Callout>
      ) : (
        <Callout tone="good" icon="🌱" title="No RMDs within this horizon">
          Required withdrawals start at age 73–75 (by birth year). The years before then are your cheapest
          window to draw down pre-tax money voluntarily, before it&apos;s forced out and taxed.
        </Callout>
      )}
      <Card>
        {rmdBars.some((b) => b.value > 0) ? (
          <Bars data={rmdBars} color={HEX.deferred} />
        ) : (
          <p className="text-sm text-foreground/70">
            No RMDs within this horizon — they start at age 73–75 depending on birth year.
          </p>
        )}
      </Card>

      <Info q="Why do RMDs keep growing? What's the &quot;IRS divisor&quot;?" sources={[SOURCES.rmd, SOURCES.rmdAge]}>
        <p className="mb-1.5">
          Each year&apos;s RMD = your <strong>prior year-end pre-tax balance ÷ an IRS divisor</strong>. The divisor
          comes from the IRS Uniform Lifetime Table and is roughly how many more years the IRS expects the money
          to last, so it doubles as a built-in spend-down schedule.
        </p>
        <p className="mb-1.5">
          As you age, that divisor <strong>shrinks</strong> — you divide by a smaller number, so you must pull a
          bigger slice each year. At age 75 the divisor is 24.6 (about <strong>4%</strong>{" "}of the balance); by 85
          it&apos;s 16.0 (<strong>~6.25%</strong>); by 90 it&apos;s 12.2 (<strong>~8.2%</strong>). And because the
          balance itself keeps growing with investment returns, the dollar amount climbs on two fronts at once —
          that&apos;s why the bars ramp up.
        </p>
        <p>
          This is the &quot;RMD tax bomb&quot;: a big pre-tax balance left untouched forces ever-larger withdrawals,
          all taxed as ordinary income, which can push you into higher brackets and IRMAA tiers. Drawing pre-tax
          down earlier (or converting to Roth) in your low-tax years shrinks it. Roth IRAs have no RMDs at all.
        </p>
      </Info>

      {/* Roth conversion / rollover plan — READ-ONLY impact view. The editable
          toggle lives on the Plan tab (one setting drives both pages). */}
      <SectionTitle>Roth conversions — the lifetime impact</SectionTitle>
      <Explainer>
        Your forecast with and without rolling pre-tax money to Roth in your low-tax years. This view is read-only —
        turn the plan on/off and tune it on the Plan tab; it flows through every chart and the table here.
      </Explainer>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Rollover plan {settings.useConversions ? "on" : "off"}</div>
            <p className="text-[12px] text-foreground/60">
              {settings.useConversions
                ? `Rolls about ${moneyCompact(conv.avgAnnualConversion)}/yr through ${conv.windowEndYear} (${moneyCompact(conv.totalConverted)} total).`
                : "No Roth conversions in the current plan."}
            </p>
          </div>
          <a
            href="/plan"
            className="press shrink-0 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary"
          >
            Adjust on Plan →
          </a>
        </div>
        <p className="mb-2 mt-4 text-[13px] text-foreground/70">Worst-year RMD — the forced &quot;tax bomb&quot;:</p>
        <CompareBars
          items={[
            { label: "No rollovers", value: conv.peakRmdBaseline, color: HEX.tax },
            { label: "With rollovers", value: conv.peakRmdWithConversions, color: HEX.gain },
          ]}
          format={(n) => money(n)}
        />
        <div className="mt-5 grid grid-cols-3 gap-2">
          <MiniBox label="Rolled to Roth" value={moneyCompact(conv.totalConverted)} tone="roth" />
          <MiniBox
            label="After-tax wealth"
            value={(conv.estateGain >= 0 ? "+" : "−") + moneyCompact(Math.abs(conv.estateGain))}
            tone={conv.estateGain >= 0 ? "gain" : "tax"}
          />
          <MiniBox
            label="Lifetime tax"
            value={(conv.lifetimeTaxDelta >= 0 ? "+" : "−") + moneyCompact(Math.abs(conv.lifetimeTaxDelta))}
            tone={conv.lifetimeTaxDelta <= 0 ? "gain" : "tax"}
          />
        </div>
        <p className="mt-3 text-[12px] text-foreground/60">
          {conv.recommended
            ? "For your numbers, rolling pre-tax → Roth leaves more after-tax money and a far smaller forced-RMD spike. Recommended."
            : "For your numbers the gain is modest — rolling mainly trades a little lifetime tax for a smaller RMD spike and more tax-free Roth."}
        </p>
      </Card>

      {/* Strategy comparison */}
      <SectionTitle>Smart vs. conventional</SectionTitle>
      <Card>
        <p className="mb-3 text-[13px] text-foreground/70">Estimated lifetime tax (federal + Illinois) — same spending & assumptions:</p>
        <CompareBars
          items={[
            { label: "Smart (bracket-fill)", value: real ? smart.lifetimeTaxReal : smart.lifetimeTax, color: HEX.gain },
            { label: "Conventional order", value: real ? conventional.lifetimeTaxReal : conventional.lifetimeTax, color: HEX.tax },
          ]}
          format={(n) => money(n)}
        />
        <p className="mb-2 mt-5 text-[13px] text-foreground/70">After-tax estate left at age {settings.endAge}:</p>
        <CompareBars
          items={[
            { label: "Smart (bracket-fill)", value: real ? smart.endingEstateAfterTaxReal : smart.endingEstateAfterTax, color: HEX.gain },
            { label: "Conventional order", value: real ? conventional.endingEstateAfterTaxReal : conventional.endingEstateAfterTax, color: HEX.taxable },
          ]}
          format={(n) => money(n)}
        />
        {(savings > 1000 || estateGain > 1000) && (
          <p className="mt-3 rounded-xl bg-gain/10 p-3 text-[13px] text-gain">
            {savings > 1000 && (
              <>
                The smart plan pays about <strong>{money(savings)}</strong>{" "}less in lifetime tax
                {estateGain > 1000 ? " " : "."}
              </>
            )}
            {estateGain > 1000 && (
              <>
                and leaves about <strong>{money(estateGain)}</strong>{" "}more after-tax wealth to your
                heirs.
              </>
            )}
          </p>
        )}
        {savings <= 1000 && estateGain <= 1000 && (
          <p className="mt-3 rounded-xl bg-foreground/5 p-3 text-[13px] text-foreground/65">
            At these assumptions the two strategies are close — the smart plan front-loads tax to shrink
            future RMDs, while the conventional order keeps more invested but faces larger taxable RMDs
            later. Try a higher spending level or return to see the gap widen.
          </p>
        )}
      </Card>

      {/* Decisions timeline */}
      <SectionTitle hint={`${milestones.length} events`}>Key decisions & milestones</SectionTitle>
      <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {milestones.map((m, i) => (
          <Card as="div" key={i} className={`border-l-4 ${toneBorder(m.tone)}`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <span>{m.icon}</span> {m.title}
              </span>
              <span className="tabular text-[12px] text-foreground/55">{m.year} · age {m.age}</span>
            </div>
            <p className="mt-1 text-[13px] text-foreground/70">{m.detail}</p>
          </Card>
        ))}
      </div>

      {/* Year table */}
      <SectionTitle>Year by year</SectionTitle>
      <Explainer>
        The <strong className="text-deferred">RMD</strong> column is the minimum the IRS forces out of pre-tax
        that year — it&apos;s already included in the Pre-tax withdrawal, shown separately so you can see the
        mandatory floor.
      </Explainer>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-right text-[12px]">
          <thead className="text-foreground/50">
            <tr className="border-b border-border">
              <th className="px-2 py-2 text-left">Yr / age</th>
              <th className="px-2 py-2">Pre-tax</th>
              <th className="px-2 py-2">RMD min</th>
              <th className="px-2 py-2">Broker</th>
              <th className="px-2 py-2">Roth</th>
              <th className="px-2 py-2">→Roth</th>
              <th className="px-2 py-2">Tax</th>
              <th className="px-2 py-2">Assets</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => {
              const d = defAt(r.year);
              return (
              <tr key={r.year} className="border-b border-border/50">
                <td className="px-2 py-1.5 text-left text-foreground/60">
                  {r.year} · {r.selfAge}
                </td>
                <td className="px-2 py-1.5 text-deferred">{r.fromPretax > 0 ? moneyCompact(r.fromPretax * d) : "—"}</td>
                <td className={`px-2 py-1.5 ${r.rmd > 0 ? "font-semibold text-deferred" : "text-foreground/30"}`}>
                  {r.rmd > 0 ? moneyCompact(r.rmd * d) : "—"}
                </td>
                <td className="px-2 py-1.5 text-taxable">{r.fromTaxable > 0 ? moneyCompact(r.fromTaxable * d) : "—"}</td>
                <td className="px-2 py-1.5 text-roth">{r.fromRoth > 0 ? moneyCompact(r.fromRoth * d) : "—"}</td>
                <td className={`px-2 py-1.5 ${r.conversion > 0 ? "font-semibold text-roth" : "text-foreground/30"}`}>
                  {r.conversion > 0 ? moneyCompact(r.conversion * d) : "—"}
                </td>
                <td className="px-2 py-1.5 text-tax">{moneyCompact(r.tax * d)}</td>
                <td className="px-2 py-1.5">{moneyCompact(r.endTotal * d)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      </DesktopOnly>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-foreground/60">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function toneBorder(tone: "info" | "warn" | "good"): string {
  return tone === "warn" ? "border-l-tax" : tone === "good" ? "border-l-gain" : "border-l-ss";
}

function MiniBox({ label, value, tone }: { label: string; value: string; tone?: "gain" | "tax" | "roth" }) {
  const color =
    tone === "gain" ? "text-gain" : tone === "tax" ? "text-tax" : tone === "roth" ? "text-roth" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/60 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-foreground/50">{label}</div>
      <div className={`tabular text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

/** The Monte-Carlo results block — rendered only once `mc` has been computed
 *  (receives a non-null result, so no null-guards needed inside). */
function MonteCarloResults({
  mc,
  real,
  endAge,
  hasPension,
  guaranteedMonthly,
  spendingStrategy,
  selfBirthYear,
}: {
  mc: MonteCarloResult;
  real: boolean;
  endAge: number;
  hasPension: boolean;
  guaranteedMonthly: number;
  spendingStrategy: "constant" | "guardrails";
  selfBirthYear: number;
}) {
  const band = real ? mc.bandReal : mc.band;
  const ending = real ? mc.endingWealthReal : mc.endingWealth;
  const cvar = real ? mc.cvarEndingWealthReal : mc.cvarEndingWealth;
  return (
    <>
      <div className="text-center">
        <div className="tabular text-3xl font-bold" style={{ color: mc.successPct >= 0.8 ? HEX.gain : mc.successPct >= 0.6 ? HEX.accent : HEX.tax }}>
          {Math.round(mc.successPct * 100)}%
        </div>
        <div className="text-[13px] text-foreground/65">of simulations funded your full spending to age {endAge}</div>
        <div className="mt-0.5 text-[11px] text-foreground/45">
          95% confidence interval: {Math.round(mc.successCI[0] * 100)}–{Math.round(mc.successCI[1] * 100)}% (±
          {(((mc.successCI[1] - mc.successCI[0]) / 2) * 100).toFixed(1)} pts across {mc.runs.toLocaleString()} runs)
        </div>
      </div>
      <div className="mt-4">
        <FanChart band={band} yLabel={(n) => moneyCompact(n)} startAge={band.length ? band[0].year - selfBirthYear : undefined} />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/55">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: HEX.gain, opacity: 0.28 }} /> 25th–75th (likely range)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: HEX.gain, opacity: 0.13 }} /> 10th–90th (full range)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: HEX.primary }} /> median (50th)
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        <MiniBox label="10th" value={moneyCompact(ending.p10)} tone="tax" />
        <MiniBox label="25th" value={moneyCompact(ending.p25)} />
        <MiniBox label="50th" value={moneyCompact(ending.p50)} />
        <MiniBox label="75th" value={moneyCompact(ending.p75)} />
        <MiniBox label="90th" value={moneyCompact(ending.p90)} tone="gain" />
      </div>
      <p className="mt-2 text-[11px] text-foreground/55">
        Ending wealth by percentile{real ? " (today’s dollars)" : ""}. Assumes a{" "}
        <strong>{percent(mc.expectedReturn, 1)}</strong> expected return with{" "}
        <strong>{percent(mc.volatility, 0)}</strong> volatility (one standard deviation) for your mix.
      </p>
      {/* Failure DEPTH — success % alone hides how bad the bad cases are. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniBox label="Worst-10% outcome (CVaR)" value={moneyCompact(cvar)} tone="tax" />
        <MiniBox
          label="If it falls short, money typically runs out at"
          value={mc.medianShortfallAge > 0 ? `age ${Math.round(mc.medianShortfallAge)}` : "—"}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/45">
        Even a &ldquo;failure&rdquo; rarely means $0 — your guaranteed income (Social Security{hasPension ? " + pension" : ""}) keeps
        paying about <strong>{moneyCompact(guaranteedMonthly)}/mo</strong> no matter what; falling short means trimming
        discretionary spending, not destitution.
      </p>
      {spendingStrategy === "guardrails" && (
        <p className="mt-2 rounded-xl bg-ss/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/65">
          🛟 With <strong>guardrails</strong> on, that high success rate comes from <em>flexing spending</em>, not magic.
          In a typical run your spending dips at most <strong>{percent(mc.spendCut.p50, 0)}</strong> below plan in a bad
          stretch; in a rough run (90th pct), up to <strong>{percent(mc.spendCut.p90, 0)}</strong>. The trade-off for a
          higher success rate is being willing to trim in down markets.
        </p>
      )}
    </>
  );
}

/** Skeleton shown while the first Monte-Carlo run computes (keeps the UI from
 *  freezing — the simulation runs off the render path). */
function MCResultsLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      <div className="mt-3 text-[13px] font-medium text-foreground/60">Running {MC_RUNS.toLocaleString()} simulations…</div>
      <div className="mt-0.5 text-[11px] text-foreground/40">Crunching market risk across your whole plan.</div>
    </div>
  );
}

/**
 * Longevity card — how long should you actually plan for? Uses the Gompertz
 * survival model (calibrated to SSA 2021, see research/mortality.py) to show the
 * couple's survival curve and recommend a "plan-to" age that covers all but the
 * longest 10% longevity tail. Affects only this display + the chosen endAge —
 * never the tax math.
 */
function LongevityCard({
  household,
  settings,
  updateSettings,
  real,
}: {
  household: Household;
  settings: PlannerSettings;
  updateSettings: (p: Partial<PlannerSettings>) => void;
  real: boolean;
}) {
  void real;
  const thisYear = new Date().getFullYear();
  const selfAge = thisYear - household.self.birthYear;
  const hasSpouse = !!household.spouse && household.spouse.birthYear > 1900;
  const spouseAge = hasSpouse ? thisYear - household.spouse.birthYear : null;

  const selfInfo = { currentAge: selfAge, sex: settings.selfSex };
  const spouseInfo = hasSpouse && spouseAge != null ? { currentAge: spouseAge, sex: settings.spouseSex } : null;

  const curve = survivalCurve(selfInfo, spouseInfo, 105);
  const planAge = planningHorizonAge(selfInfo, spouseInfo, 0.1);
  const pReach90 = probReachAge(selfInfo, spouseInfo, 90);
  const pReach95 = probReachAge(selfInfo, spouseInfo, 95);
  const pReachEnd = probReachAge(selfInfo, spouseInfo, settings.endAge);
  const leSelf = lifeExpectancy(selfAge, paramsFor(settings.selfSex));
  const leSpouse = spouseInfo ? lifeExpectancy(spouseAge!, paramsFor(settings.spouseSex)) : null;

  // Chart geometry: x = self age across the curve, y = probability 0..1.
  const W = 320, H = 120, padL = 6, padR = 6, padT = 8, padB = 16;
  const a0 = curve[0].age, a1 = curve[curve.length - 1].age;
  const xOf = (age: number) => padL + ((age - a0) / (a1 - a0)) * (W - padL - padR);
  const yOf = (p: number) => padT + (1 - p) * (H - padT - padB);
  const lineFor = (key: "self" | "spouse" | "either") =>
    curve.map((pt, i) => `${i === 0 ? "M" : "L"}${xOf(pt.age).toFixed(1)},${yOf(pt[key]).toFixed(1)}`).join(" ");
  const eitherArea =
    `M${xOf(a0).toFixed(1)},${yOf(0).toFixed(1)} ` +
    curve.map((pt) => `L${xOf(pt.age).toFixed(1)},${yOf(pt.either).toFixed(1)}`).join(" ") +
    ` L${xOf(a1).toFixed(1)},${yOf(0).toFixed(1)} Z`;
  const endX = xOf(Math.min(a1, Math.max(a0, settings.endAge)));
  const y10 = yOf(0.1);

  const endShortOfPlan = settings.endAge < planAge;
  // Snap the suggestion to a value the "Plan to age" select can actually show.
  const snapTo = [85, 90, 95, 100, 105].find((o) => o >= planAge) ?? 105;

  return (
    <Card className="mt-3">
      <SectionTitle hint="Gompertz survival model">How long should you plan for?</SectionTitle>
      <p className="mt-1 text-[13px] leading-snug text-foreground/70">
        Picking a horizon is a longevity bet. Rather than guess, this models your odds of being alive at each age
        from the official SSA life tables — and for a couple, the odds that <em>at least one</em> of you is, since the
        money has to last until then.
      </p>

      {/* Sex selectors — affect only this longevity estimate, not the tax math. */}
      <div className="mt-3 flex flex-wrap gap-4">
        <SexPick label={household.self.label || "You"} value={settings.selfSex} onChange={(v) => updateSettings({ selfSex: v })} />
        {spouseInfo && (
          <SexPick label={household.spouse.label || "Spouse"} value={settings.spouseSex} onChange={(v) => updateSettings({ spouseSex: v })} />
        )}
      </div>

      {/* Survival curve */}
      <div className="mt-3 rounded-xl border border-border bg-background/40 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Survival probability by ${household.self.label || "your"} age`}>
          {/* 10% tail reference line */}
          <line x1={padL} y1={y10} x2={W - padR} y2={y10} stroke={HEX.tax} strokeDasharray="3 3" strokeOpacity={0.5} />
          <text x={padL + 1} y={y10 - 2} fontSize="8" fill={HEX.tax} fillOpacity={0.8}>10% still alive</text>
          {/* either-alive area + lines */}
          <path d={eitherArea} fill={HEX.primary} fillOpacity={0.1} />
          {spouseInfo && <path d={lineFor("self")} fill="none" stroke={HEX.ss} strokeWidth={1.2} strokeOpacity={0.7} />}
          {spouseInfo && <path d={lineFor("spouse")} fill="none" stroke={HEX.roth} strokeWidth={1.2} strokeOpacity={0.7} />}
          <path d={lineFor("either")} fill="none" stroke={HEX.primary} strokeWidth={2} />
          {/* chosen plan-to age marker */}
          <line x1={endX} y1={padT} x2={endX} y2={H - padB} stroke={HEX.accent} strokeWidth={1.5} />
          <text x={endX} y={padT + 6} fontSize="8" fill={HEX.accent} textAnchor={endX > W / 2 ? "end" : "start"}>
            plan to {settings.endAge}
          </text>
          {/* x-axis age ticks */}
          {[a0, 80, 90, 100, a1].filter((v, i, arr) => arr.indexOf(v) === i && v >= a0 && v <= a1).map((age) => (
            <text key={age} x={xOf(age)} y={H - 4} fontSize="8" fill="currentColor" fillOpacity={0.45} textAnchor="middle">
              {age}
            </text>
          ))}
        </svg>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[10px]">
          <Key color={HEX.primary} label={spouseInfo ? "Either of you alive" : "Alive"} />
          {spouseInfo && <Key color={HEX.ss} label={`${household.self.label || "You"} alive`} />}
          {spouseInfo && <Key color={HEX.roth} label={`${household.spouse.label || "Spouse"} alive`} />}
        </div>
        <p className="mt-0.5 px-1 text-[10px] text-foreground/40">
          Horizontal axis is {household.self.label || "your"} age; all lines share the same calendar timeline
          {spouseInfo && `, so a point on ${household.spouse.label || "the spouse"}'s line is their age at that same year`}.
        </p>
      </div>

      {/* Headline stats */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniBox label={spouseInfo ? "Either reaches 90" : "Reach 90"} value={percent(pReach90, 0)} />
        <MiniBox label={spouseInfo ? "Either reaches 95" : "Reach 95"} value={percent(pReach95, 0)} />
        <MiniBox label="Suggested plan-to" value={`${planAge}`} tone="roth" />
      </div>

      <p className="mt-3 text-[12px] leading-snug text-foreground/65">
        Life expectancy is about <strong>{Math.round(leSelf)}</strong> for {household.self.label || "you"}
        {leSpouse != null && (
          <>
            {" "}and <strong>{Math.round(leSpouse)}</strong> for {household.spouse.label || "your spouse"}
          </>
        )}
        . There&apos;s a <strong>{percent(pReachEnd, 0)}</strong> chance {spouseInfo ? "at least one of you is" : "you are"}{" "}
        alive at your current plan-to age of <strong>{settings.endAge}</strong>. To cover all but the longest{" "}
        <strong>10%</strong> of the longevity range, plan to about <strong>age {planAge}</strong>.
      </p>

      {endShortOfPlan && (
        <button
          onClick={() => updateSettings({ endAge: snapTo })}
          className="press mt-3 w-full rounded-xl border border-roth/40 bg-roth/10 px-4 py-2.5 text-[13px] font-semibold text-roth"
        >
          Plan to age {snapTo} → cover the longevity tail
        </button>
      )}

      <Info q="Why this matters & how it's modeled" className="mt-3">
        <p>
          A plan that runs out of money at 92 looks fine on paper, but a 65-year-old couple has a real chance one
          spouse lives well past that. Planning only to life expectancy means roughly a coin-flip of outliving the
          plan — which is why advisors plan to a tail age, not the average.
        </p>
        <p className="mt-2">
          Survival is modeled with the <strong>Gompertz law of mortality</strong>, fit to the{" "}
          <strong>{MORTALITY_META.source}</strong>. &quot;Average&quot; uses a unisex blend; choosing a sex uses the
          sex-specific curve. This affects only the suggested horizon and the survival chart — never your taxes or
          balances.
        </p>
        {spouseInfo && (
          <p className="mt-2">
            For a couple, the &quot;either of you alive&quot; curve treats the two lives as{" "}
            <strong>independent</strong> (no &quot;broken-heart&quot; correlation, where one spouse&apos;s death raises
            the other&apos;s near-term risk). Real couples&apos; lifespans are mildly correlated, so this slightly
            overstates the odds at least one of you is alive at the oldest ages — and nudges the suggested plan-to age a
            touch older, i.e. it errs on the conservative side.
          </p>
        )}
      </Info>
    </Card>
  );
}

function SexPick({ label, value, onChange }: { label: string; value: Sex; onChange: (v: Sex) => void }) {
  const opts: { v: Sex; l: string }[] = [
    { v: "blended", l: "Average" },
    { v: "female", l: "Female" },
    { v: "male", l: "Male" },
  ];
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-foreground/55">{label}</div>
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`press px-2.5 py-1 text-[12px] ${
              value === o.v ? "bg-primary/15 font-semibold text-primary" : "text-foreground/55"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}
