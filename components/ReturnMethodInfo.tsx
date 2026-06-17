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
        We don&apos;t pick arbitrary numbers — we read your actual holdings and blend forward-looking 2026 capital-market
        assumptions (J.P. Morgan; nominal, before inflation):
      </p>
      <ul className="space-y-1">
        <li>
          <strong>Stocks, ETFs & stock funds: ~7.9%/yr</strong>{" "}(average), volatility ~16.5%.
        </li>
        <li>
          <strong>Bond funds: ~4.9%/yr.</strong>
        </li>
        <li>
          <strong>Cash, CDs & savings: ~3.1%/yr.</strong>
        </li>
      </ul>
      <p className="mt-1.5">
        Your mix is {percent(rm.equityPct, 0)} stocks · {percent(rm.bondPct, 0)} bonds · {percent(rm.cashPct, 0)} cash.
        Its <em>average</em>{" "}year is about <strong>{percent(rm.expected, 1)}</strong>, but money actually grows at the{" "}
        <strong>compound</strong>{" "}rate — about <strong>{percent(rm.expectedGeometric, 1)}/yr</strong>{" "}after the drag of
        volatility — so that&apos;s what the <strong>Moderate</strong>{" "}card uses (compounding the higher average would
        overstate your balance). <strong>Conservative</strong>{" "}({percent(rm.conservative, 1)}) stands in for a weak decade;{" "}
        <strong>Optimistic</strong>{" "}({percent(rm.optimistic, 1)}) for a strong one.
        {rm.basis !== "holdings" &&
          " Accounts with only a balance (no itemized holdings) are assumed to be a 70/25/5 stock/bond/cash mix — add holdings on the Accounts tab to sharpen this."}
      </p>
      <p className="mt-1.5">
        These are forward estimates (lower than the ~10% historical stock average at today&apos;s valuations); real years
        swing far above and below, and the <em>order</em>{" "}of returns matters in retirement — so leave a cushion.
      </p>
    </Info>
  );
}
