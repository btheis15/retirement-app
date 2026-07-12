"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Disclaimer, Callout, Explainer, Info, PageSkeleton, AdjustLink, DesktopOnly } from "@/components/ui";
import { CompareBars } from "@/components/charts";
import { ScenarioLab } from "@/components/ScenarioLab";
import { recommendPlan, GOAL_META } from "@/lib/goals";
import { buildScenarios, LabAssumptions, PlanConfig } from "@/lib/scenarioLab";
import { returnModel } from "@/lib/returns";
import { survivorFromSettings, GoalId } from "@/lib/defaults";
import { ReturnMethodInfo } from "@/components/ReturnMethodInfo";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { SOURCES } from "@/lib/sources";

const SPEND_MAX = 500_000;
const sigOf = (c: PlanConfig) => `${c.strategy}|${c.bracketTarget}|${c.useConversions ? c.convertMode : "none"}`;

export default function ScenariosPage() {
  const { ready, household, settings, updateSettings } = useStore();

  const rm = useMemo(() => returnModel(household.accounts), [JSON.stringify(household.accounts)]);
  const model = rm;

  // Use the SAME app-wide return assumption the Start walkthrough used, so the plan
  // recommended here is identical to the one Start applied (no surprise mismatch).
  const inputs = useMemo(
    () => ({
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      convertUntilAge: settings.convertUntilAge,
      survivor: survivorFromSettings(settings),
      heirTaxRate: settings.heirTaxRate,
    }),
    [settings.returnRate, settings.inflationRate, settings.endAge, settings.convertUntilAge, settings.survivorModel, settings.firstDeathAge, settings.heirTaxRate],
  );

  // Recommendation is pinned to a stable 4%-of-portfolio reference spend (exactly like
  // the Start walkthrough), so the plan shown here matches the one Start applied.
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  const recRefSpend = total > 0 ? Math.min(SPEND_MAX, Math.round(0.04 * total)) : household.annualSpending;
  const recHousehold = useMemo(() => ({ ...household, annualSpending: recRefSpend }), [household, recRefSpend]);

  const rec = useMemo(
    () => recommendPlan(recHousehold, inputs, settings.goal, { optimizeClaimAge: false }),
    [recHousehold, inputs, settings.goal],
  );
  const recommended: PlanConfig = rec.best.config;

  // Base lifetime assumptions for the scenario projections — at ACTUAL spending, so
  // the numbers match the rest of the app.
  const base: LabAssumptions = useMemo(
    () => ({
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      convertUntilAge: rec.chosenConvertUntilAge,
      survivor: survivorFromSettings(settings),
      heirTaxRate: settings.heirTaxRate,
      spendingStrategy: settings.spendingStrategy,
    }),
    [settings.returnRate, settings.inflationRate, settings.endAge, rec.chosenConvertUntilAge, settings.survivorModel, settings.firstDeathAge, settings.heirTaxRate, settings.spendingStrategy],
  );

  const scenarios = useMemo(() => buildScenarios(household, base, recommended), [household, base, recommended]);

  const activeConfig: PlanConfig = {
    strategy: settings.strategy,
    bracketTarget: settings.bracketTarget,
    useConversions: settings.useConversions,
    convertMode: settings.convertMode,
  };
  const activeSig = sigOf(activeConfig);
  const recSig = sigOf(recommended);
  const activeIsRecommended = activeSig === recSig && !settings.planCustomized;

  const resetToRecommended = () =>
    updateSettings({
      strategy: recommended.strategy,
      bracketTarget: recommended.bracketTarget,
      useConversions: recommended.useConversions,
      convertMode: recommended.convertMode,
      convertUntilAge: rec.chosenConvertUntilAge,
      planCustomized: false,
    });

  // The goal's recommendation auto-applies while the plan isn't customized — the
  // same standing behavior the Start walkthrough maintains. Without this, a visitor
  // landing here BEFORE ever opening Start sits on the default config and would be
  // told they "overrode" a recommendation they never touched.
  const needsAlign = ready && !settings.planCustomized && activeSig !== recSig;
  useEffect(() => {
    if (needsAlign) resetToRecommended();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAlign, activeSig, recSig]);

  if (!ready) return <PageSkeleton />;

  const withMetrics = scenarios.map((s) => ({
    ...s,
    netWealth: s.projection.endingEstateAfterTax,
    lifetimeTax: s.projection.lifetimeTax,
  }));
  const mostWealth = withMetrics.reduce((a, b) => (b.netWealth > a.netWealth ? b : a));
  const lowestTax = withMetrics.reduce((a, b) => (b.lifetimeTax < a.lifetimeTax ? b : a));
  const ranked = [...withMetrics].sort((a, b) => b.netWealth - a.netWealth);

  const goalMeta = GOAL_META[settings.goal];

  return (
    <div>
      <PageTitle
        title="Compare your options"
        subtitle="The plan we picked for your goal — and the evidence, odds, and raw numbers behind why."
      />

      {/* ───── Your goal (from Start) + active vs recommended ───── */}
      <SectionTitle>Your goal — chosen on Start</SectionTitle>
      <Explainer>This is what you told us to optimize for. It has one home — the walkthrough&apos;s goal step — so it can&apos;t drift out of sync.</Explainer>
      <div className="flex items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-3 gap-2">
          {(Object.keys(GOAL_META) as GoalId[]).map((g) => (
            <div
              key={g}
              className={`rounded-xl border p-2.5 text-center ${
                settings.goal === g ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/40"
              }`}
            >
              <div className="text-lg leading-none">{GOAL_META[g].icon}</div>
              <div className="mt-1 text-[12px] font-semibold leading-tight">
                {settings.goal === g ? "✓ " : ""}
                {GOAL_META[g].short}
              </div>
            </div>
          ))}
        </div>
        <AdjustLink step="goal" />
      </div>

      <Callout tone={activeIsRecommended ? "good" : "warn"} icon={activeIsRecommended ? "✓" : "✏️"} title={activeIsRecommended ? "Your active plan is the one we recommend" : "You've overridden the recommendation"} className="mt-3">
        For <strong>{goalMeta.short.toLowerCase()}</strong>, we recommend <strong>{rec.best.label}</strong>.{" "}
        {activeIsRecommended ? (
          <>It&apos;s active everywhere in the app. Tapping <em>&ldquo;Use this plan&rdquo;</em> on any option below switches the whole app to that plan instead.</>
        ) : (
          <>
            Your active plan is currently different — you chose another option (&ldquo;Use this plan&rdquo; here, or an
            override in the walkthrough).{" "}
            <button onClick={resetToRecommended} className="font-semibold text-primary underline decoration-primary/30 underline-offset-2">
              Reset to my goal&apos;s recommendation
            </button>
            .
          </>
        )}
      </Callout>
      <p className="mt-2 text-[12px] leading-relaxed text-foreground/55">
        The recommendation is chosen at a standard reference spending level (about 4% of savings), so it stays stable
        as you explore; each card&apos;s numbers use your actual spending.
      </p>

      {/* ───── Assumed return ───── */}
      <SectionTitle hint={`spending ${moneyCompact(household.annualSpending)}/yr · to age ${settings.endAge}`}>Assumed yearly return</SectionTitle>
      <Explainer>Built from your holdings ({percent(rm.equityPct, 0)} stocks · {percent(rm.bondPct, 0)} bonds · {percent(rm.cashPct, 0)} cash), not arbitrary numbers. The head-to-head below stress-tests across 1,000 varied markets.</Explainer>
      <ReturnMethodInfo rm={rm} />

      {/* ───── Bottom line ───── */}
      <SectionTitle>The bottom line</SectionTitle>
      <Callout tone="good" icon="🏆" title="Most money left after tax">
        Of the options we compared, <strong>{mostWealth.label}</strong> leaves the most — about{" "}
        <strong>{money(mostWealth.netWealth)}</strong> after tax at age {settings.endAge}
        {mostWealth.id !== lowestTax.id ? <>. It isn&apos;t the lowest-tax option, but it comes out ahead.</> : <>, and it&apos;s also the lowest-tax option here.</>}
      </Callout>

      {/* ───── After-tax wealth bars ───── */}
      <SectionTitle>After-tax money left at age {settings.endAge}</SectionTitle>
      <Explainer>The true bottom line — what you&apos;d actually keep or pass on, taxes accounted for. Higher is better.</Explainer>
      <Card>
        <CompareBars
          items={ranked.map((p) => ({ label: p.label, value: p.netWealth, color: p.id === mostWealth.id ? HEX.gain : HEX.taxable }))}
          format={(n) => money(n)}
        />
        <Info q="How is &quot;after-tax money left&quot; calculated?">
          A pre-tax dollar still owes income tax when withdrawn, so to compare fairly we discount leftover pre-tax by an
          assumed 22% future rate, knock 15% off unrealized brokerage gains, and count Roth at full value (already
          tax-free). An estimate for comparison, not a prediction.
        </Info>
      </Card>

      {/* ───── Lifetime tax bars ───── */}
      <SectionTitle>Total lifetime tax (federal + Illinois)</SectionTitle>
      <Explainer>Every dollar of tax across the whole projection. Lower looks better — but it&apos;s only half the story (the lowest-tax plan can leave you poorer).</Explainer>
      <Card>
        <CompareBars
          items={ranked.map((p) => ({ label: p.label, value: p.lifetimeTax, color: p.id === lowestTax.id ? HEX.gain : HEX.tax }))}
          format={(n) => money(n)}
        />
      </Card>

      {/* ───── The options, with Use this plan ───── */}
      <SectionTitle>Your options, side by side</SectionTitle>
      <Explainer>A tight, advisor-style set — your recommended plan plus the meaningful alternatives. &quot;Use this plan&quot; makes it the active plan across the whole app (overriding your goal&apos;s pick until you reset).</Explainer>
      <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {ranked.map((p) => {
          const isActive = sigOf(p.config) === activeSig;
          const isRec = p.id === "recommended";
          return (
            <Card as="div" key={p.id} className={isActive ? "border-primary/40 bg-primary/[0.03]" : ""}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{p.label}</div>
                  <p className="mt-0.5 text-[12px] text-foreground/60">{p.how}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {isRec && <Pill tone="roth">Recommended</Pill>}
                  {p.id === mostWealth.id && <Pill tone="gain">Most wealth</Pill>}
                  {p.id === lowestTax.id && <Pill tone="ss">Lowest tax</Pill>}
                  {p.projection.depleted && <Pill tone="tax">Runs short</Pill>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border bg-background/60 p-2">
                  <div className="text-[11px] text-foreground/55">After-tax money left</div>
                  <div className="tabular text-[13px] font-semibold text-gain">{money(p.netWealth)}</div>
                  <div className="text-[10px] text-foreground/45">at age {settings.endAge}</div>
                </div>
                <div className="rounded-xl border border-border bg-background/60 p-2">
                  <div className="text-[11px] text-foreground/55">Lifetime tax</div>
                  <div className="tabular text-[13px] font-semibold text-tax">{money(p.lifetimeTax)}</div>
                  <div className="text-[10px] text-foreground/45">peak RMD {moneyCompact(p.projection.peakRmd)}</div>
                </div>
              </div>
              <button
                onClick={() =>
                  updateSettings({
                    strategy: p.config.strategy,
                    bracketTarget: p.config.bracketTarget,
                    useConversions: p.config.useConversions,
                    convertMode: p.config.convertMode,
                    planCustomized: true,
                  })
                }
                disabled={isActive}
                className={`press mt-3 w-full rounded-xl py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "bg-primary text-white"}`}
              >
                {isActive ? "✓ Currently active" : "Use this plan"}
              </button>
            </Card>
          );
        })}
      </div>

      <Info q="How can paying more tax leave me with more money?" sources={[SOURCES.rothConversion, SOURCES.rmd]} className="mt-3">
        <p className="mb-1.5">Pre-tax accounts (IRA/401k) have a catch: the IRS eventually <em>forces</em> big withdrawals (RMDs), taxed as ordinary income — often at a higher rate than today.</p>
        <p>By pulling or converting some pre-tax now at a <em>low</em> rate, you pay a little more tax today but shrink those forced withdrawals and let tax-free Roth compound. Total tax can be higher yet leave more after-tax wealth.</p>
      </Info>

      {/* ───── The evidence: head-to-head + raw data (desktop-depth only) ───── */}
      <DesktopOnly
        mobileNote={
          <p className="mt-4 rounded-xl border border-border bg-card px-3 py-2.5 text-[12px] text-foreground/55">
            🖥️ The full evidence layer — head-to-head odds across 1,000 simulated markets, the year-by-year numbers
            behind every option, and CSV export — is on the desktop view, where there&apos;s room to lay it out.
          </p>
        }
      >
        <SectionTitle>The evidence</SectionTitle>
        <ScenarioLab household={household} base={base} model={model} scenarios={scenarios} endAge={settings.endAge} />
      </DesktopOnly>

      <Link
        href="/projection"
        className="press mt-5 block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary"
      >
        See the year-by-year forecast for the active plan →
      </Link>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}
