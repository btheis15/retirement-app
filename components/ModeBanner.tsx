"use client";

import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";

/** A thin banner telling you whether you're viewing the $5M example or your own
 *  numbers, with a one-tap switch. Hidden until the store hydrates. */
export function ModeBanner() {
  const { ready, mode, setMode } = useStore();
  if (!ready) return <div className="h-7" aria-hidden />;

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
      <span className="inline-flex items-center gap-1.5 text-foreground/60">
        <span className={`h-2 w-2 rounded-full ${mode === "demo" ? "bg-accent" : "bg-gain"}`} />
        {mode === "demo" ? "Viewing the $5M example" : "Viewing your numbers"}
      </span>
      {mode === "demo" ? (
        <Link href="/accounts" onClick={() => setMode("own")} className="press font-medium text-primary">
          Enter my own →
        </Link>
      ) : (
        <button onClick={() => setMode("demo")} className="press font-medium text-primary">
          Show the example
        </button>
      )}
    </div>
  );
}
