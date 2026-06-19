"use client";

import { useMemo, useState } from "react";
import type { Household } from "@/lib/accounts";
import type { ReturnModel } from "@/lib/returns";
import {
  Scenario,
  LabAssumptions,
  PlanConfig,
  findPretaxCrossover,
  summaryCSV,
  perYearCSV,
} from "@/lib/scenarioLab";
import { computePaired } from "@/lib/mcClient";
import type { PairedResult } from "@/lib/compareMonteCarlo";
import { planAssumptions } from "@/lib/scenarioLab";
import { Card, Collapsible, Info, Callout, SectionTitle, Explainer } from "@/components/ui";
import { money, moneyCompact, percent } from "@/lib/format";
import { SOURCES } from "@/lib/sources";

function downloadCSV(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const pctWhole = (r: number) => `${Math.round(r * 100)}%`;

export function ScenarioLab({
  household,
  base,
  model,
  scenarios,
  endAge,
}: {
  household: Household;
  base: LabAssumptions;
  model: ReturnModel;
  scenarios: Scenario[];
  endAge: number;
}) {
  // Head-to-head: default A = the recommended plan, B = the advisor's baseline.
  const recIdx = Math.max(0, scenarios.findIndex((s) => s.id === "recommended"));
  const advIdx = Math.max(0, scenarios.findIndex((s) => s.id === "advisor"));
  const [aId, setAId] = useState(scenarios[recIdx]?.id ?? scenarios[0]?.id);
  const [bId, setBId] = useState(scenarios[advIdx]?.id ?? scenarios[Math.min(1, scenarios.length - 1)]?.id);
  const [paired, setPaired] = useState<PairedResult | null>(null);
  const [running, setRunning] = useState(false);

  const A = scenarios.find((s) => s.id === aId) ?? scenarios[0];
  const B = scenarios.find((s) => s.id === bId) ?? scenarios[1] ?? scenarios[0];
  const sameAB = A?.id === B?.id;

  // Deterministic account-mix crossover for the chosen pair (fast; no MC needed).
  const crossover = useMemo(
    () => (sameAB ? null : findPretaxCrossover(household, base, A.config, B.config)),
    [household, base, A?.config, B?.config, sameAB],
  );

  const runOdds = async () => {
    if (sameAB) return;
    setRunning(true);
    setPaired(null);
    try {
      const res = await computePaired({
        kind: "paired",
        household,
        assumptionsA: planAssumptions(base, A.config),
        assumptionsB: planAssumptions(base, B.config),
        model,
        runs: 1000,
        seed: 12345,
      });
      setPaired(res);
    } finally {
      setRunning(false);
    }
  };

  // Detailed per-year table: which scenario to show.
  const [detailId, setDetailId] = useState(scenarios[recIdx]?.id ?? scenarios[0]?.id);
  const detail = scenarios.find((s) => s.id === detailId) ?? scenarios[0];

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* ───────────── Head-to-head odds ───────────── */}
      <SectionTitle hint="same market histories, both plans">Head-to-head: the odds, not a claim</SectionTitle>
      <Explainer>
        Pick any two plans. We replay the <strong>same</strong> 1,000 simulated market histories through{" "}
        <em>both</em> — so the win rate reflects the plans, not luck — and report how often each ends with more
        money, the risk, and when the other plan would actually be the better call for you.
      </Explainer>
      <Card>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-foreground/45">Option A</span>
            <select
              value={aId}
              onChange={(e) => { setAId(e.target.value); setPaired(null); }}
              className="mt-1 w-full rounded-xl border border-border bg-card px-2 py-2 text-[13px]"
            >
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-foreground/45">Option B</span>
            <select
              value={bId}
              onChange={(e) => { setBId(e.target.value); setPaired(null); }}
              className="mt-1 w-full rounded-xl border border-border bg-card px-2 py-2 text-[13px]"
            >
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>

        {sameAB ? (
          <p className="mt-3 text-[12px] text-foreground/55">Pick two different plans to compare.</p>
        ) : (
          <>
            <button
              onClick={runOdds}
              disabled={running}
              className="press mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {running ? "Running 1,000 paired simulations…" : paired ? "Re-run the odds" : "Run the odds →"}
            </button>

            {paired && (
              <div className="mt-4">
                {/* Win bar */}
                <div className="flex overflow-hidden rounded-full text-[11px] font-semibold text-white">
                  <div className="flex items-center justify-center bg-gain py-1.5" style={{ width: `${Math.max(8, paired.aWins * 100)}%` }}>
                    {pctWhole(paired.aWins)}
                  </div>
                  {paired.ties > 0.005 && (
                    <div className="flex items-center justify-center bg-foreground/30 py-1.5" style={{ width: `${paired.ties * 100}%` }} />
                  )}
                  <div className="flex items-center justify-center bg-taxable py-1.5" style={{ width: `${Math.max(8, paired.bWins * 100)}%` }}>
                    {pctWhole(paired.bWins)}
                  </div>
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-foreground/55">
                  <span><span className="font-semibold text-gain">A</span> ends richer</span>
                  {paired.ties > 0.005 && <span>tie</span>}
                  <span><span className="font-semibold text-taxable">B</span> ends richer</span>
                </div>

                <p className="mt-3 text-[13px] leading-relaxed text-foreground/80">
                  Across <strong>{paired.runs.toLocaleString()}</strong> identical market histories,{" "}
                  <strong>{A.label}</strong> ends with more after-tax money than <strong>{B.label}</strong> in{" "}
                  <strong className="text-gain">{pctWhole(paired.aWins)}</strong> of them; <strong>{B.label}</strong>{" "}
                  wins the other <strong className="text-taxable">{pctWhole(paired.bWins + paired.ties)}</strong>.
                  Typical gap (A − B): <strong>{money(paired.margin.p50)}</strong>{" "}in today&apos;s dollars
                  {paired.margin.p10 < -2000 ? (
                    <> — but in A&apos;s worst 10% it instead <strong className="text-tax">trails by {money(Math.abs(paired.margin.p10))}</strong>.</>
                  ) : paired.margin.p10 > 2000 ? (
                    <> — and even at the 10th percentile A stays ahead by {money(paired.margin.p10)}.</>
                  ) : (
                    <> — and at the 10th percentile the two are roughly a wash.</>
                  )}
                </p>

                {/* Risk + success grid */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-xl border border-border bg-background/60 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-foreground/45">Funds spending to {endAge}</div>
                    <div className="tabular mt-0.5">A {percent(paired.successA, 0)} · B {percent(paired.successB, 0)}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background/60 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-foreground/45">Worst 10% of markets (left)</div>
                    <div className="tabular mt-0.5">A {moneyCompact(paired.endA.cvar10)} · B {moneyCompact(paired.endB.cvar10)}</div>
                  </div>
                </div>
                {paired.endB.cvar10 > paired.endA.cvar10 * 1.02 && (
                  <p className="mt-2 text-[12px] leading-relaxed text-foreground/65">
                    🛡️ Note the risk trade-off: in the <strong>worst 10%</strong> of markets, <strong>{B.label}</strong>{" "}
                    actually leaves more ({moneyCompact(paired.endB.cvar10)} vs {moneyCompact(paired.endA.cvar10)}) — it
                    wins {percent(paired.bWinsInWorstDecile, 0)} of A&apos;s worst outcomes. So A is the higher-average bet;
                    B is a touch safer if markets disappoint.
                  </p>
                )}
              </div>
            )}

            {/* The "when would the other win for YOU" callout — deterministic, on your mix */}
            {crossover && (
              <Callout tone="neutral" icon="🎯" title="Why this is the answer for you (and when it would flip)" className="mt-3">
                {crossover.crossoverShare == null ? (
                  <>
                    {crossover.edgeNow >= 0 ? <strong>{A.label}</strong> : <strong>{B.label}</strong>}{" "}
                    comes out ahead across <em>every</em> account mix we tested for you — at your{" "}
                    <strong>{pctWhole(crossover.currentShare)}</strong> pre-tax share it wins by about{" "}
                    <strong>{money(Math.abs(crossover.edgeNow))}</strong>, so this one isn&apos;t close.
                  </>
                ) : (
                  <>
                    Right now <strong>{pctWhole(crossover.currentShare)}</strong> of your savings (
                    {money(crossover.currentPretax)}) sits in pre-tax accounts, so the forced RMDs later are large —
                    that&apos;s why <strong>{crossover.edgeNow >= 0 ? A.label : B.label}</strong> wins for you by about{" "}
                    <strong>{money(Math.abs(crossover.edgeNow))}</strong>. The verdict would{" "}
                    <strong>flip near a {pctWhole(crossover.crossoverShare)} pre-tax share</strong> (about{" "}
                    {money(crossover.crossoverShare * crossover.total)} in pre-tax): below that, the RMDs stay small
                    enough that <strong>{crossover.favorsWhenLower === "A" ? A.label : B.label}</strong> is the better
                    call. So the right answer depends on <em>your</em> account breakdown — not a blanket rule.
                  </>
                )}
              </Callout>
            )}
          </>
        )}
        <Info q="How are these odds computed — is it the same simulations for both?" sources={[SOURCES.monteCarlo]}>
          Yes — this is the key to a fair comparison. We generate 1,000 random market-and-inflation futures{" "}
          <em>once</em>, then run <em>both</em> plans through the <strong>exact same</strong> 1,000 futures (called
          &ldquo;common random numbers&rdquo;). In each future we compare the after-tax money each plan leaves and tally
          the winner. Because both plans face an identical market every time, the win rate reflects the <em>plans</em>,
          not which one happened to get luckier draws. We compare after-tax estate in today&apos;s dollars, and report
          the worst-10% outcome for each so you see downside risk, not just the average.
        </Info>
      </Card>

      {/* ───────────── Raw data ───────────── */}
      <Collapsible
        eyebrow="for the skeptics"
        title="Dig into the data"
        summary="Every scenario's numbers in plain columns — on screen and downloadable as CSV"
        className="mt-4"
      >
        {/* Scenario summary table */}
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Scenario summary</div>
        <Card className="mt-1 overflow-x-auto p-0">
          <table className="w-full text-right text-[12px]">
            <thead className="text-foreground/50">
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left">Scenario</th>
                <th className="px-2 py-2">After-tax left</th>
                <th className="px-2 py-2">Lifetime tax</th>
                <th className="px-2 py-2">Lifetime IRMAA</th>
                <th className="px-2 py-2">Peak RMD</th>
                <th className="px-2 py-2">Top rate</th>
                <th className="px-2 py-2">→Roth</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {scenarios.map((s) => {
                const p = s.projection;
                return (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="px-2 py-1.5 text-left text-foreground/70">{s.label}</td>
                    <td className="px-2 py-1.5 font-semibold text-gain">{moneyCompact(p.endingEstateAfterTax)}</td>
                    <td className="px-2 py-1.5 text-tax">{moneyCompact(p.lifetimeTax)}</td>
                    <td className="px-2 py-1.5 text-foreground/70">{p.lifetimeIrmaa > 0 ? moneyCompact(p.lifetimeIrmaa) : "—"}</td>
                    <td className="px-2 py-1.5 text-foreground/70">{p.peakRmd > 0 ? moneyCompact(p.peakRmd) : "$0"}</td>
                    <td className="px-2 py-1.5 text-foreground/70">{pctWhole(p.peakMarginalRate)}</td>
                    <td className="px-2 py-1.5 text-roth">{p.totalConverted > 0 ? moneyCompact(p.totalConverted) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Per-year detail for one scenario */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Year-by-year</div>
          <select
            value={detailId}
            onChange={(e) => setDetailId(e.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1 text-[12px]"
          >
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <Card className="mt-1 overflow-x-auto p-0">
          <table className="w-full text-right text-[11.5px]">
            <thead className="text-foreground/50">
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left">Yr / age</th>
                <th className="px-2 py-2">RMD</th>
                <th className="px-2 py-2">Pre-tax</th>
                <th className="px-2 py-2">Broker/cash</th>
                <th className="px-2 py-2">Roth</th>
                <th className="px-2 py-2">→Roth</th>
                <th className="px-2 py-2">MAGI</th>
                <th className="px-2 py-2">Rate</th>
                <th className="px-2 py-2">Tax</th>
                <th className="px-2 py-2">IRMAA</th>
                <th className="px-2 py-2">End total</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {detail.projection.rows.map((r) => (
                <tr key={r.year} className={`border-b border-border/40 ${r.shortfall ? "bg-tax/[0.06]" : ""}`}>
                  <td className="px-2 py-1 text-left text-foreground/60">{r.year} · {r.selfAge}</td>
                  <td className={`px-2 py-1 ${r.rmd > 0 ? "font-semibold text-deferred" : "text-foreground/30"}`}>{r.rmd > 0 ? moneyCompact(r.rmd) : "—"}</td>
                  <td className="px-2 py-1 text-deferred">{r.fromPretax > 0 ? moneyCompact(r.fromPretax) : "—"}</td>
                  <td className="px-2 py-1 text-taxable">{r.fromTaxable > 0 ? moneyCompact(r.fromTaxable) : "—"}</td>
                  <td className="px-2 py-1 text-roth">{r.fromRoth > 0 ? moneyCompact(r.fromRoth) : "—"}</td>
                  <td className="px-2 py-1 text-roth">{r.conversion > 0 ? moneyCompact(r.conversion) : "—"}</td>
                  <td className="px-2 py-1 text-foreground/65">{moneyCompact(r.magi)}</td>
                  <td className="px-2 py-1 text-foreground/65">{pctWhole(r.marginalRate)}</td>
                  <td className="px-2 py-1 text-tax">{moneyCompact(r.tax)}</td>
                  <td className="px-2 py-1 text-foreground/65">{r.irmaa > 0 ? moneyCompact(r.irmaa) : "—"}</td>
                  <td className="px-2 py-1 font-medium">{moneyCompact(r.endTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-1 text-[10px] text-foreground/45">
          Nominal (future) dollars. Pink rows are years the plan fell short of full spending.
        </p>

        {/* Downloads */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => downloadCSV(`scenarios-summary-${stamp}.csv`, summaryCSV(scenarios, endAge))}
            className="press rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] font-semibold text-primary"
          >
            ⤓ Summary (.csv)
          </button>
          <button
            onClick={() => downloadCSV(`scenarios-by-year-${stamp}.csv`, perYearCSV(scenarios))}
            className="press rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] font-semibold text-primary"
          >
            ⤓ Year-by-year, all scenarios (.csv)
          </button>
          <button
            onClick={() => downloadCSV(`${detail.id}-by-year-${stamp}.csv`, perYearCSV([detail]))}
            className="press rounded-xl border border-border px-3 py-2 text-[12px] font-semibold text-foreground/70"
          >
            ⤓ This scenario only (.csv)
          </button>
        </div>

        <Info q="What do these columns mean?">
          <ul className="space-y-1">
            <li><strong>RMD</strong> — the IRS-forced minimum withdrawal from pre-tax accounts (starts at 73–75). The bigger your pre-tax balance, the bigger this gets.</li>
            <li><strong>Pre-tax / Broker-cash / Roth</strong> — where that year&apos;s spending was pulled from.</li>
            <li><strong>→Roth</strong> — pre-tax dollars converted to Roth that year (not spent).</li>
            <li><strong>MAGI</strong> — modified adjusted gross income; it sets your Medicare (IRMAA) tier two years later.</li>
            <li><strong>Rate</strong> — the top federal bracket your ordinary income reached. <strong>Tax</strong> is federal + Illinois that year.</li>
            <li><strong>End total</strong> — all accounts combined at year-end (nominal).</li>
          </ul>
        </Info>
      </Collapsible>
    </div>
  );
}
