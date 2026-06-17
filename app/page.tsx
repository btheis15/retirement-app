"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/components/HouseholdProvider";
import { GuidedPlan } from "@/components/GuidedPlan";
import { PageTitle, PageSkeleton, Disclaimer } from "@/components/ui";

/** The app's front door: the calm, step-by-step walkthrough. Answering the
 *  questions here builds the plan; "See all the numbers" hands off to the Plan
 *  dashboard. The dense numbers live there, not here, so a first-time visitor
 *  starts at the beginning instead of landing mid-app. */
export default function HomePage() {
  const { ready } = useStore();
  const router = useRouter();
  if (!ready) return <PageSkeleton />;
  return (
    <div>
      <PageTitle title={`What to do in ${new Date().getFullYear()}`} subtitle="A step-by-step walkthrough — one thing at a time, in plain English." />
      <GuidedPlan onSeeDetails={() => router.push("/plan")} />
      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}
