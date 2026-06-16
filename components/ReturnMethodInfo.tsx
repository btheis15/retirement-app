"use client";

import { Info } from "@/components/ui";
import { ReturnModel } from "@/lib/returns";
import { percent } from "@/lib/format";

/** A click-through explaining exactly how the Conservative / Moderate / Optimistic
 *  return cards are derived from the household's holdings. */
export function ReturnMethodInfo({ rm }: { rm: ReturnModel }) {
  return (
    <Info q="How are these return numbers figured?">
      <p className="mb-1.5">
        We don&apos;t pick arbitrary numbers — we read your actual holdings and blend long-run, nominal
        asset-class averages:
      </p>
      <ul className="space-y-1">
        <li>
          <strong>Stocks, ETFs & stock funds: ~10%/yr</strong> — the long-run U.S. large-cap average with
          dividends reinvested.
        </li>
        <li>
          <strong>Bond funds: ~4.5%/yr.</strong>
        </li>
        <li>
          <strong>Cash, CDs & savings: ~3%/yr.</strong>
        </li>
      </ul>
      <p className="mt-1.5">
        Your mix is {percent(rm.equityPct, 0)} stocks · {percent(rm.bondPct, 0)} bonds · {percent(rm.cashPct, 0)} cash,
        which blends to about <strong>{percent(rm.expected, 1)}/yr</strong> — that&apos;s the <strong>Moderate</strong>{" "}
        card. <strong>Conservative</strong> ({percent(rm.conservative, 1)}) is that minus ~3.5 points, to stand in for a
        weak decade or a rough run of early-retirement returns. <strong>Optimistic</strong> ({percent(rm.optimistic, 1)})
        adds ~2.5 points for a strong market.
        {rm.basis !== "holdings" &&
          " Accounts with only a balance (no itemized holdings) are assumed to be a 70/25/5 stock/bond/cash mix — add holdings on the Accounts tab to sharpen this."}
      </p>
      <p className="mt-1.5">
        These are long-run averages <em>before</em> inflation; real years swing far above and below, and the{" "}
        <em>order</em> of returns matters in retirement — so leave yourself a cushion.
      </p>
    </Info>
  );
}
