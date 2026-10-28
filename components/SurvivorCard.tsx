"use client";

import { Card, SectionTitle, Info, AdjustLink } from "@/components/ui";
import { money, percent } from "@/lib/format";
import type { ProjectionRow } from "@/lib/projection";

/** Pure read-out of the survivor transition already computed by the projection:
 *  last full joint year vs. first survivor year. No engine logic here. */
export function survivorSnapshot(rows: ProjectionRow[], survivorYear: number, defAt: (year: number) => number) {
  if (survivorYear <= 0) return null;
  const after = rows.find((r) => r.year === survivorYear);
  const before = [...rows].reverse().find((r) => r.year < survivorYear);
  if (!after || !before) return null;
  const snap = (r: ProjectionRow) => {
    const d = defAt(r.year);
    return {
      year: r.year,
      ss: r.socialSecurity * d,
      spending: r.spendingTarget * d,
      tax: r.tax * d,
      rate: r.magi > 0 ? r.tax / r.magi : 0,
      irmaa: r.irmaa * d,
    };
  };
  return { before: snap(before), after: snap(after) };
}

function Row({ label, a, b, monthly, note }: { label: string; a: number; b: number; monthly?: boolean; note?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 border-t border-border py-2 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">{label}</div>
        {note && <div className="text-[13px] text-foreground/65">{note}</div>}
      </div>
      <div className="tabular text-right text-[15px]">
        {money(a)}
        {monthly && <div className="text-[13px] text-foreground/65">{money(a / 12)}/mo</div>}
      </div>
      <div className="tabular text-right text-[15px] font-semibold">
        {money(b)}
        {monthly && <div className="text-[13px] font-normal text-foreground/65">{money(b / 12)}/mo</div>}
      </div>
    </div>
  );
}

export function SurvivorCard({
  rows,
  survivorYear,
  defAt,
  real,
  isCouple,
  survivorModel,
  spendingFactor,
}: {
  rows: ProjectionRow[];
  survivorYear: number;
  defAt: (year: number) => number;
  real: boolean;
  isCouple: boolean;
  survivorModel: boolean;
  spendingFactor: number;
}) {
  if (!isCouple || !survivorModel) return null;
  const s = survivorSnapshot(rows, survivorYear, defAt);
  if (!s) return null;
  const { before, after } = s;
  const showIrmaa = before.irmaa > 0 || after.irmaa > 0;

  return (
    <div className="mt-2">
      <SectionTitle>If one of you passes first</SectionTitle>
      <Card>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 pb-1 text-[13px] font-semibold text-foreground/65">
          <div>Household, per year</div>
          <div className="text-right">Both of you<br />({before.year})</div>
          <div className="text-right">One of you<br />({after.year})</div>
        </div>
        <Row label="Social Security" a={before.ss} b={after.ss} monthly />
        <Row label="Spending" a={before.spending} b={after.spending} monthly note={`${percent(spendingFactor, 0)} of the joint amount`} />
        <Row label="Federal + state tax" a={before.tax} b={after.tax} note={`${percent(before.rate)} → ${percent(after.rate)} of income`} />
        {showIrmaa && <Row label="Medicare IRMAA surcharge" a={before.irmaa} b={after.irmaa} />}
        <p className="mt-2 text-[13px] leading-snug text-foreground/65">
          {real ? "Today's dollars." : "Future dollars."} Shown for the last year with both of you and the first year with one.
        </p>
        <Info q="Why do these numbers change?">
          <p>
            <strong>Social Security:</strong> the survivor keeps the larger of the two checks. The smaller one stops, so the
            household&apos;s Social Security drops.
          </p>
          <p className="mt-2">
            <strong>Spending:</strong> one person spends less than two. The plan assumes {percent(spendingFactor, 0)} of the joint
            amount.
          </p>
          <p className="mt-2">
            <strong>Tax (the &ldquo;widow&apos;s penalty&rdquo;):</strong> a survivor files as single. Single tax brackets are
            narrower and the Medicare IRMAA income limits are lower, so similar income is taxed at a higher rate.
          </p>
          <p className="mt-2">
            The survivor also inherits the other spouse&apos;s retirement accounts. This is a planning estimate, not a
            prediction. Roth conversions and required withdrawals can differ between the two years shown.
          </p>
        </Info>
        <div className="mt-2 flex justify-end">
          <AdjustLink step="longevity" label="Change survivor assumptions" />
        </div>
      </Card>
    </div>
  );
}
