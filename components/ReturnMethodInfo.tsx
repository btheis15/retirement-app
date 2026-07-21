"use client";

import { Info } from "@/components/ui";
import { ReturnModel } from "@/lib/returns";
import { historicalGeometric } from "@/lib/returnsHistorical";
import { SOURCES } from "@/lib/sources";
import { percent } from "@/lib/format";

/** A click-through explaining exactly how the Cautious / Expected / Strong /
 *  History-repeated return cards are derived from the household's holdings. */
export function ReturnMethodInfo({ rm }: { rm: ReturnModel }) {
  const hist = historicalGeometric(rm);
  return (
    <Info q="How are these return numbers figured?" sources={[SOURCES.cma, SOURCES.histReturns]}>
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
        volatility — so that&apos;s what the <strong>Expected</strong>{" "}card uses (compounding the higher average would
        overstate your balance). <strong>Cautious</strong>{" "}({percent(rm.conservative, 1)}) stands in for a weak decade;{" "}
        <strong>Strong</strong>{" "}({percent(rm.optimistic, 1)}) for a kind one.
        {rm.basis !== "holdings" &&
          " Accounts with only a balance (no itemized holdings) are assumed to be a 70/25/5 stock/bond/cash mix — add holdings on the Accounts tab to sharpen this."}
      </p>
      <p className="mt-1.5">
        <strong>History repeated</strong>{" "}({percent(hist, 1)}) is different: it&apos;s what this exact mix actually
        compounded at over 1928–2024 (S&amp;P 500, 10-year Treasuries, and T-bills, rebalanced yearly) — for an all-stock
        mix, that&apos;s the famous ~10%/yr. The forward estimates above are lower on purpose: at today&apos;s prices, most
        professional forecasters expect the coming decades to pay less than the last century did. Pick the history card if
        you&apos;d rather assume the past repeats — just know which bet you&apos;re making. Either way, real years swing far
        above and below, and the <em>order</em>{" "}of returns matters in retirement — so leave a cushion.
      </p>
    </Info>
  );
}
