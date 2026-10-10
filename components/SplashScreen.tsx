"use client";

/**
 * Launch splash — the first thing anyone sees when the app opens.
 *
 * It animates the app's own mark (the gold growth line on the teal tile from
 * public/icon.svg): the tile springs in, the line draws itself upward, the dot
 * lands at the peak and pulses, then the name and tagline rise in. Meanwhile
 * the app hydrates underneath; once it's ready (saved data loaded) and the
 * animation has had its moment, the splash fades away.
 *
 * Rendered on the server as part of the layout, so it's on screen from the very
 * first paint — before any JavaScript runs. Shown in full on the first open of
 * a session; a reload later in the same session gets a shorter version. Reduced-
 * motion users get a static mark and a quick fade. Never prints.
 */

import { useEffect, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";

// The name and tagline finish rising at ~1s; these leave them on screen long
// enough to actually read before the fade.
const FULL_MS = 3200; // first open of a session: the full animation, then ~2s to read
const REPEAT_MS = 2000; // a reload later in the same session — still readable
const REDUCED_MS = 1500; // static mark (no animation), readable at once
const EXIT_MS = 600;
const SEEN_KEY = "rto-splash-seen";

export function SplashScreen() {
  const { ready } = useStore();
  const [phase, setPhase] = useState<"show" | "exit" | "gone">("show");
  const [minMs, setMinMs] = useState<number | null>(null);
  const [start] = useState(() => (typeof performance !== "undefined" ? performance.now() : 0));

  // Decide how long to linger: full animation once per session, brief after.
  useEffect(() => {
    let ms = FULL_MS;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) ms = REPEAT_MS;
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* storage blocked — just show the full splash */
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) ms = REDUCED_MS;
    setMinMs(ms);
  }, []);

  // Leave once the app is ready AND the minimum time has passed.
  useEffect(() => {
    if (!ready || minMs == null || phase !== "show") return;
    const wait = Math.max(0, minMs - (performance.now() - start));
    const t = setTimeout(() => setPhase("exit"), wait);
    return () => clearTimeout(t);
  }, [ready, minMs, phase, start]);

  useEffect(() => {
    if (phase !== "exit") return;
    const t = setTimeout(() => setPhase("gone"), EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      role="status"
      aria-label="Loading Retirement Tax Optimizer"
      className={`splash fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden ${phase === "exit" ? "splash-exit" : ""}`}
      style={{ background: "linear-gradient(160deg, #072e2b 0%, #0b3f3b 45%, #0f5c55 100%)" }}
    >
      {/* soft ambient light: gold from above-right, teal from below */}
      <div aria-hidden className="splash-glow pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full" style={{ background: "radial-gradient(circle, rgba(177,121,31,0.30), transparent 65%)" }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-[30rem] w-[30rem] rounded-full" style={{ background: "radial-gradient(circle, rgba(19,117,108,0.45), transparent 65%)" }} />

      <div className="relative flex flex-col items-center px-8 text-center">
        {/* The mark */}
        <div className="splash-tile relative">
          <div aria-hidden className="splash-halo absolute inset-0 rounded-[30px]" />
          <svg viewBox="0 0 512 512" className="relative h-28 w-28 drop-shadow-[0_18px_40px_rgba(0,0,0,0.35)]" aria-hidden>
            <rect width="512" height="512" rx="112" fill="#0d4f4a" />
            <rect width="512" height="512" rx="112" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
            <path
              className="splash-line"
              d="M112 360 L208 264 L288 320 L400 176"
              pathLength={1}
              fill="none"
              stroke="#c88a26"
              strokeWidth="28"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle className="splash-pulse" cx="400" cy="176" r="26" fill="none" stroke="#e0a43c" strokeWidth="6" />
            <circle className="splash-dot" cx="400" cy="176" r="26" fill="#e0a43c" />
            <rect className="splash-base" x="104" y="392" width="304" height="22" rx="11" fill="#ffffff" opacity="0.85" />
          </svg>
        </div>

        <div className="splash-rise mt-7 text-[26px] font-bold leading-tight tracking-tight text-white" style={{ animationDelay: "0.75s" }}>
          Retirement Tax Optimizer
        </div>
        <p className="splash-rise mt-2 max-w-xs text-[15px] leading-snug text-white/70" style={{ animationDelay: "0.95s" }}>
          Keep more of what you&apos;ve saved.
        </p>
      </div>

      {/* indeterminate progress — the app is loading underneath */}
      <div className="splash-rise absolute inset-x-0 bottom-0 flex justify-center pb-[calc(3.5rem+env(safe-area-inset-bottom))]" style={{ animationDelay: "1.1s" }}>
        <div className="relative h-[3px] w-28 overflow-hidden rounded-full bg-white/15">
          <div className="splash-bar absolute inset-y-0 w-1/2 rounded-full bg-[#e0a43c]" />
        </div>
      </div>
    </div>
  );
}
