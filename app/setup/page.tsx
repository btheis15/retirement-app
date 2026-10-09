"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/components/HouseholdProvider";
import { PageTitle, PageSkeleton, Disclaimer } from "@/components/ui";
import { YourAnswers, buildAnswers } from "@/components/PlanHome";

/** Setup, for someone who has finished the walkthrough: every answer the plan
 *  is built on, each one tap from the step where it's decided — instead of
 *  re-walking the whole flow to change one thing. Before the walkthrough is
 *  done there's nothing to summarize, so this sends you to it. */
export default function SetupPage() {
  const { ready, mode, settings, household } = useStore();
  const router = useRouter();
  const done = !!settings.walkthroughDone?.[mode];
  const year = useMemo(() => new Date().getFullYear(), []);
  useEffect(() => {
    if (ready && !done) router.replace("/");
  }, [ready, done, router]);
  if (!ready || !done) return <PageSkeleton />;

  return (
    <div>
      <PageTitle title="Your setup" subtitle="Everything your plan is built on. Tap any answer to change it — the plan updates instantly." />
      {mode === "demo" && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-ss/25 bg-ss/[0.06] px-3.5 py-2.5 text-[13px] text-foreground/75">
          <span>📊 These are the <strong>example household&apos;s</strong> answers.</span>
          <Link href="/?step=start" className="press shrink-0 rounded-full bg-card px-3 py-1 text-[12px] font-semibold text-primary ring-1 ring-primary/25">
            Use my numbers →
          </Link>
        </div>
      )}
      <div className="mt-4">
        <YourAnswers rows={buildAnswers(household, settings, year)} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link href="/plan" className="press block rounded-2xl bg-primary py-3 text-center text-[15px] font-semibold text-white">
          Back to my plan →
        </Link>
        <Link href="/?step=start" className="press block rounded-2xl border border-border bg-card py-3 text-center text-[14px] font-semibold text-foreground/70">
          ↺ Walk through every question again
        </Link>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-foreground/50">
        Want to list specific funds, tickers, or cost basis? Itemize any account on the{" "}
        <Link href="/accounts" className="font-semibold text-primary underline decoration-primary/30">Accounts</Link> tab.
      </p>
      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}
