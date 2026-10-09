"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/components/HouseholdProvider";
import { GuidedPlan } from "@/components/GuidedPlan";
import { PageTitle, PageSkeleton, Disclaimer } from "@/components/ui";

/** The app's front door. First visit: the calm, one-question-at-a-time setup
 *  walkthrough that builds the plan. Once the walkthrough is finished (for the
 *  current data mode), the front door is the Plan tab instead — a returning
 *  customer opens the app to "here's what to do", not to "How do you want to
 *  start?". Deep links (`/?step=…`, every "Adjust →" / "Change" link) still open
 *  the walkthrough at that step. */
export default function HomePage() {
  const { ready, mode, settings } = useStore();
  const router = useRouter();
  // Decide once per visit: a later in-page router.replace("/") (GuidedPlan clears
  // its ?step= param) must never bounce someone out mid-edit.
  const [route, setRoute] = useState<"pending" | "walkthrough" | "plan">("pending");
  const done = !!settings.walkthroughDone?.[mode];
  // The heading reflects why you came (first run vs. returning to edit), fixed at
  // arrival — finishing the walkthrough mid-visit shouldn't retitle the page.
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    if (!ready || route !== "pending") return;
    const hasStep = new URLSearchParams(window.location.search).has("step");
    if (done && !hasStep) {
      setRoute("plan");
      router.replace("/plan");
    } else {
      setReturning(done);
      setRoute("walkthrough");
    }
  }, [ready, route, done, router]);

  if (!ready || route !== "walkthrough") return <PageSkeleton />;
  return (
    <div>
      <PageTitle
        title={returning ? "Update your plan" : "Let’s build your plan"}
        subtitle={returning ? "Change any answer — your plan updates instantly." : "A few questions, one at a time. Your answers save as you go."}
      />
      <Suspense fallback={<PageSkeleton />}>
        <GuidedPlan onSeeDetails={() => router.push("/plan")} />
      </Suspense>
      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}
