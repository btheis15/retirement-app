"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";
import { PageSkeleton } from "@/components/ui";
import { ClientReport } from "@/components/ClientReport";
import { buildReport } from "@/lib/report";
import { activeAssumptions } from "@/lib/planContext";
import { computeMonteCarlo } from "@/lib/mcClient";
import { returnModel } from "@/lib/returns";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { compareSnapshots, ReviewSnapshot } from "@/lib/quarterly";
import { GOAL_META } from "@/lib/goals";
import { STRATEGY_META } from "@/lib/optimizer";
import { loadReviews, previousReview, saveReview } from "@/components/reviewHistory";

/** The quarterly client report: an advisor-style plan document built from the
 *  household's own numbers, previewed on screen and saved as a PDF through the
 *  browser's print dialog (letter-size pages; see the report rules in
 *  globals.css). Viewing it records this quarter's snapshot so next quarter's
 *  report can show what changed. Nothing is uploaded. */
export default function ReportPage() {
  const { ready, mode, household, settings } = useStore();
  const now = useMemo(() => new Date(), []);
  const data = useMemo(() => (ready && household.accounts.length > 0 ? buildReport(household, settings, now) : null), [ready, household, settings, now]);

  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setMc(null);
    computeMonteCarlo({
      kind: "mc",
      household,
      assumptions: activeAssumptions(settings),
      model: returnModel(household.accounts),
      runs: 1000, // same run count + seed as the Plan and Forecast tabs
    }).then((res) => {
      if (!cancelled) setMc(res);
    });
    return () => {
      cancelled = true;
    };
  }, [data, household, settings]);

  // This quarter's snapshot, and the previous quarter's for comparison.
  const snapshot: ReviewSnapshot | null = useMemo(() => {
    if (!data) return null;
    return {
      quarter: data.quarter.key,
      at: now.getTime(),
      total: data.total,
      buckets: { pretax: data.buckets.pretax, roth: data.buckets.roth, taxable: data.buckets.taxable },
      spending: data.ctx.planConv.spendingTarget,
      successPct: mc ? mc.successPct : null,
      yearTax: data.ctx.yearTaxTotal,
      conversion: settings.useConversions ? data.ctx.planConv.conversion : 0,
      estateAfterTax: data.ctx.activeProj.endingEstateAfterTax,
      returnRate: settings.returnRate,
      planLabel: `${GOAL_META[settings.goal].short} · ${STRATEGY_META[settings.strategy].label}`,
      claimAges: data.people.map((p) => `${p.name} ${p.claimAge}`).join(", "),
    };
  }, [data, mc, settings, now]);
  const [prev, setPrev] = useState<ReviewSnapshot | null>(null);
  useEffect(() => {
    if (!data || !mc || !snapshot) return;
    setPrev(previousReview(loadReviews(mode), data.quarter.key));
    saveReview(mode, snapshot);
  }, [data, mc, snapshot, mode]);
  const changes = prev && snapshot ? compareSnapshots(prev, snapshot) : [];

  // The saved PDF's file name comes from the document title; the running
  // footer (names, quarter, page x of y) comes from @page margin boxes.
  const fileTitle = data ? `Retirement Plan - ${data.names} - ${data.quarter.label}` : "Retirement Plan";
  const footerText = data ? `${data.names} · ${data.quarter.label} review${mode === "demo" ? " · EXAMPLE" : ""}`.replace(/["\\]/g, "") : "";
  const download = () => {
    const before = document.title;
    document.title = fileTitle;
    const restore = () => {
      document.title = before;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  if (!ready) return <PageSkeleton />;
  if (!data) {
    return (
      <div className="pt-6">
        <h1 className="text-[28px] font-bold leading-tight">Your quarterly report</h1>
        <p className="mt-2 text-[15px] text-foreground/65">
          Add your accounts first — the report is built from your own balances, holdings, and answers.
        </p>
        <Link href="/" className="press mt-4 inline-block rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">
          Start your setup →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <style>{`@page { size: letter; margin: 0.55in 0.6in 0.6in; @bottom-left { content: "${footerText}"; font-size: 8pt; color: #5b6b70; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #5b6b70; } }`}</style>

      {/* Toolbar — screen only */}
      <div className="no-print sticky top-0 z-30 -mx-4 mb-4 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/plan" className="text-[13px] font-semibold text-primary">
              ← Back to my plan
            </Link>
            <div className="text-[17px] font-bold leading-tight">
              {data.quarter.label} quarterly review
            </div>
            <div className="text-[12px] text-foreground/55">
              {mc ? "Ready — letter-size pages, about 15 in all." : "Running the market simulation for the report…"}
            </div>
          </div>
          <button
            onClick={download}
            disabled={!mc}
            className="press rounded-xl bg-primary px-5 py-2.5 text-[15px] font-semibold text-white disabled:opacity-40"
          >
            ⬇️ Download PDF
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-foreground/50">
          Opens your device&apos;s print dialog — choose <strong>Save as PDF</strong>{" "}(on iPhone/iPad: Share → Save to Files). Made on this device;
          nothing is uploaded.
        </p>
      </div>

      <ClientReport data={data} mc={mc} prev={prev} changes={changes} household={household} settings={settings} isDemo={mode === "demo"} />
    </div>
  );
}
