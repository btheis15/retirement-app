import { money, moneyCompact, oddsText } from "@/lib/format";
import { SAFE_LINE, type KeepBalanceResult } from "@/components/spendingOdds";

/** The words for the "keep your balance" figure, in ONE place so the Plan tab, the walkthrough and the
 *  report never drift apart. Pure strings (no React) so the print report can style them itself.
 *  kind: "ok"     keep amount found and at/above the safe-line odds;
 *        "risky"  found, but fewer than 90% of markets last (more risk than the safe line) — shown, not advised;
 *        "below"  even the lowest level tested does not keep the balance;
 *        "none"   the search could not run (null result). */
export interface KeepCopy {
  kind: "ok" | "risky" | "below" | "none";
  /** One-sentence headline with the amounts (or the "below"/"none" message). */
  headline: string;
  monthly: number | null;
  yearly: number | null;
  /** Explanation of what "keep your balance" means in a typical market (null for below/none). */
  typical: string | null;
  /** Honesty line when the odds at this level are below the safe line. */
  risk: string | null;
}

export function keepCopy(keep: KeepBalanceResult | null, endAge: number, who: string, runs = 1000): KeepCopy {
  if (!keep) {
    return {
      kind: "none",
      headline: "We couldn't work out the spending that keeps your balance this time.",
      monthly: null,
      yearly: null,
      typical: null,
      risk: null,
    };
  }
  if (keep.keep == null) {
    return {
      kind: "below",
      headline: `Keeping your full balance would mean spending less than ${money(keep.lowestTested)} a year (${money(keep.lowestTested / 12)} a month), ${who}.`,
      monthly: null,
      yearly: null,
      typical: null,
      risk: null,
    };
  }
  const risky = keep.successPct != null && keep.successPct < SAFE_LINE;
  const atLeast = keep.atLeast ? "at least " : "";
  return {
    kind: risky ? "risky" : "ok",
    headline: `To keep your savings at about ${moneyCompact(keep.start)} (today's dollars) through age ${endAge}: spend ${atLeast}about ${money(keep.keep / 12)} a month (${money(keep.keep)} a year), ${who}.`,
    monthly: keep.keep / 12,
    yearly: keep.keep,
    typical: `In a typical market (the middle of the ${runs.toLocaleString("en-US")}), your balance at ${endAge} would still be about what you have today. Half the simulated markets end higher, half lower.`,
    risk:
      risky && keep.successPct != null
        ? `But at that level only ${oddsText(keep.successPct, runs)} last to age ${endAge} — more risk than our safe line, so we don't suggest spending this much.`
        : null,
  };
}

/** Compact two-row "Spend it down safely" vs "Keep your balance" pair, then the keep explanation. */
export function KeepBalanceBlock({
  safe,
  safeAtLeast,
  keep,
  endAge,
  who,
  showPair = true,
}: {
  /** Hide the two-row pair when the safe headline is already shown right above (walkthrough). */
  showPair?: boolean;
  safe: number | null;
  safeAtLeast?: boolean;
  keep: KeepBalanceResult | null;
  endAge: number;
  who: string;
}) {
  const c = keepCopy(keep, endAge, who);
  const row = (label: string, y: number | null, prefix = "", muted = false) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-primary/15 py-1.5 first:border-t-0">
      <span className="text-[15px] font-semibold">{label}</span>
      <span className={`text-[15px] ${muted ? "text-foreground/70" : ""}`}>
        {y != null ? (
          <>
            <strong>
              {prefix}
              {money(y / 12)}/mo
            </strong>{" "}
            <span className="text-foreground/70">· {money(y)}/yr</span>
          </>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
  return (
    <div className="mt-3" data-testid="keep-balance">
      {showPair && c.yearly != null && (
        <div className="rounded-xl border border-primary/20 bg-card/60 px-3 py-1">
          {safe != null && row("Spend it down safely", safe, safeAtLeast ? "at least " : "")}
          {row("Keep your balance", c.yearly, keep?.atLeast ? "at least " : "", c.kind === "risky")}
        </div>
      )}
      <p className="mt-2 text-[15px] leading-snug">{c.headline}</p>
      {c.typical && <p className="mt-1 text-[15px] leading-snug">{c.typical}</p>}
      {c.risk && <p className="mt-1.5 text-[15px] font-semibold leading-snug">{c.risk}</p>}
    </div>
  );
}
