"use client";

/**
 * "Since your last visit" — a calm, dismissible card on the Plan tab that says
 * what changed since the plan was last opened. On-device only (localStorage).
 *
 * Snapshot rules: the baseline is saved the first time (once the numbers are
 * ready). It is only replaced when the card is dismissed, so a refresh still
 * shows the same comparison and slow drift adds up until it matters.
 */
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";

type Mode = "demo" | "own";
interface Snap {
  date: string; // ISO
  balance: number;
  withdrawal: number;
  tax: number;
  successPct: number; // 0..1
  spending: number;
}

const KEY = (mode: Mode) => `rto-last-visit-${mode}`;
const MIN_DAYS = 3;

function load(mode: Mode): Snap | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY(mode));
    if (!raw) return null;
    const s = JSON.parse(raw) as Snap;
    return s && typeof s.date === "string" && typeof s.balance === "number" ? s : null;
  } catch {
    return null;
  }
}
function save(mode: Mode, s: Snap) {
  try {
    window.localStorage.setItem(KEY(mode), JSON.stringify(s));
  } catch {
    /* storage unavailable — skip quietly */
  }
}

function signed(n: number) {
  return `${n >= 0 ? "up" : "down"} ${money(Math.abs(n))}`;
}

function buildLines(prev: Snap, cur: Snap): string[] {
  const lines: string[] = [];
  const dBal = cur.balance - prev.balance;
  const balPct = prev.balance > 0 ? dBal / prev.balance : 0;
  if (Math.abs(balPct) >= 0.02 || Math.abs(dBal) >= 5000) {
    lines.push(
      `Your savings are ${signed(dBal)} (${balPct >= 0 ? "+" : "−"}${Math.abs(balPct * 100).toFixed(1)}%) — from market moves and any money you took out.`,
    );
  }
  const dPts = Math.round((cur.successPct - prev.successPct) * 100);
  if (Math.abs(dPts) >= 3) {
    let line = `Your plan's odds: ${Math.round(prev.successPct * 1000).toLocaleString("en-US")} → ${Math.round(cur.successPct * 1000).toLocaleString("en-US")} of 1,000 simulated markets (${prev.successPct >= 0.9995 ? 100 : Math.min(99, Math.round(prev.successPct * 100))}% → ${cur.successPct >= 0.9995 ? 100 : Math.min(99, Math.round(cur.successPct * 100))}%).`;
    if (dPts < 0) {
      if (cur.successPct >= 0.85) line += " Still on track — nothing to do today unless it drops below 85%.";
      else if (cur.successPct >= 0.7) line += " Still solid; worth keeping an eye on.";
      else line += " Worth a look in the walkthrough when you have a few minutes.";
    }
    lines.push(line);
  }
  const dW = cur.withdrawal - prev.withdrawal;
  if (Math.abs(dW) >= 500) {
    lines.push(`This year's recommended withdrawal is ${signed(dW)} — now ${money(cur.withdrawal)}.`);
  }
  const dT = cur.tax - prev.tax;
  if (Math.abs(dT) >= 500) {
    lines.push(`The amount to set aside for tax is ${signed(dT)} — now ${money(cur.tax)}.`);
  }
  const dS = cur.spending - prev.spending;
  if (Math.abs(dS) >= 500 && lines.length < 4) {
    lines.push(`Your yearly spending target is ${signed(dS)} — now ${money(cur.spending)}.`);
  }
  return lines.slice(0, 4);
}

export function SinceLastVisit({
  mode,
  ready,
  balance,
  withdrawal,
  tax,
  successPct,
  spending,
}: {
  mode: Mode;
  ready: boolean;
  balance: number;
  withdrawal: number;
  tax: number;
  /** null while the Monte Carlo is still running */
  successPct: number | null;
  spending: number;
}) {
  const [card, setCard] = useState<{ prev: Snap; cur: Snap; lines: string[] } | null>(null);
  const decided = useRef(false);

  useEffect(() => {
    if (!ready || successPct == null || decided.current) return;
    decided.current = true;
    const cur: Snap = { date: new Date().toISOString(), balance, withdrawal, tax, successPct, spending };
    const prev = load(mode);
    if (!prev) {
      save(mode, cur);
      return;
    }
    const days = (Date.now() - new Date(prev.date).getTime()) / 86_400_000;
    if (!(days >= MIN_DAYS)) return; // keep the older baseline so the clock can reach 3 days
    const lines = buildLines(prev, cur);
    if (lines.length) setCard({ prev, cur, lines });
    // No meaningful change: keep the baseline so slow drift adds up.
  }, [ready, mode, balance, withdrawal, tax, successPct, spending]);

  if (!card) return null;
  const dateLabel = new Date(card.prev.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const dismiss = () => {
    save(mode, { ...card.cur, date: new Date().toISOString() });
    setCard(null);
  };

  return (
    <section
      aria-label="What changed since your last visit"
      className="mt-3 rounded-2xl border border-primary/25 bg-primary/[0.05] px-4 py-3 text-foreground/80"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-foreground">Since your last visit on {dateLabel}</h2>
        <button
          onClick={dismiss}
          className="press -my-1 min-h-[44px] shrink-0 rounded-full px-3 text-[14px] font-semibold text-primary underline"
        >
          Got it
        </button>
      </div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug">
        {card.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}
