"use client";

/**
 * "Record what actually happened" — the keep-in-sync half of the plan. When
 * the user really withdraws / deposits / converts money, this sheet applies it
 * to their accounts (pro-rata share sales, cash-first — lib/adjustments.ts),
 * so the app keeps matching reality without any re-entry. Opened blank from
 * the Accounts page ("± Adjust") or prefilled from the Plan tab's "Mark done".
 */

import { useMemo, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { applyCashFlow, applyTransfer } from "@/lib/adjustments";
import { Account, ACCOUNT_KIND_META, bucketOf } from "@/lib/accounts";
import { money } from "@/lib/format";

export interface AdjustPrefill {
  kind?: "withdraw" | "deposit" | "transfer";
  accountId?: string;
  toAccountId?: string;
  amount?: number;
  /** One line of context shown at the top, e.g. "Marking done: Take your RMD". */
  reason?: string;
}

const INPUT =
  "field-focus w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-[14px] outline-none focus:border-primary";

export function AdjustSheet({
  prefill,
  onClose,
  onApplied,
}: {
  prefill?: AdjustPrefill;
  onClose: () => void;
  onApplied?: (info: { kind: string; applied: number }) => void;
}) {
  const { household, setAccounts } = useStore();
  const accounts = household.accounts;
  const [kind, setKind] = useState<"withdraw" | "deposit" | "transfer">(prefill?.kind ?? "withdraw");
  const [accountId, setAccountId] = useState<string>(prefill?.accountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState<string>(
    prefill?.toAccountId ?? accounts.find((a) => bucketOf(a.kind) === "roth")?.id ?? "__newroth__",
  );
  const [amountText, setAmountText] = useState(prefill?.amount ? String(Math.round(prefill.amount)) : "");
  const [result, setResult] = useState<{ applied: number; summary: string; undo: Account[] } | null>(null);
  const amount = Number(amountText.replace(/[^0-9]/g, "")) || 0;
  const from = accounts.find((a) => a.id === accountId);

  const kinds = useMemo(
    () =>
      [
        { k: "withdraw" as const, icon: "↑", label: "I took money out", sub: "spent it, or moved it to your bank" },
        { k: "deposit" as const, icon: "↓", label: "I added money", sub: "new savings landed in an account" },
        { k: "transfer" as const, icon: "⇄", label: "I moved money between accounts", sub: "a Roth conversion or a transfer" },
      ] as const,
    [],
  );

  const apply = () => {
    if (!from || amount <= 0) return;
    const snapshot = accounts.map((a) => ({ ...a, holdings: a.holdings ? a.holdings.map((h) => ({ ...h })) : undefined }));
    let next: Account[];
    let applied = 0;
    let summary = "";
    if (kind === "transfer") {
      const existingTo = accounts.find((a) => a.id === toAccountId);
      const to: Account = existingTo ?? { id: `a${Date.now()}-roth`, label: "Roth IRA", kind: "roth_ira", owner: from.owner, balance: 0 };
      const t = applyTransfer(from, to, amount);
      applied = t.applied;
      next = accounts.map((a) => (a.id === from.id ? t.from : a.id === to.id ? t.to : a));
      if (!existingTo) next.push(t.to);
      summary = `Moved ${money(applied)} from ${from.label} to ${to.label}.`;
    } else {
      const r = applyCashFlow(from, amount, kind);
      applied = r.applied;
      next = accounts.map((a) => (a.id === from.id ? r.account : a));
      summary =
        kind === "withdraw"
          ? `Took ${money(applied)} out of ${from.label} — the app now shows the lower balance.`
          : `Added ${money(applied)} to ${from.label}.`;
    }
    setAccounts(next);
    setResult({ applied, summary, undo: snapshot });
    onApplied?.({ kind, applied });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="scrim-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="sheet-panel relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/15" />

        {result ? (
          <>
            <h2 className="text-lg font-semibold">✅ Recorded</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground/75">{result.summary}</p>
            {result.applied < amount - 0.5 && (
              <p className="mt-1 text-[12px] text-foreground/55">
                (You asked for {money(amount)}; only {money(result.applied)} was there to move.)
              </p>
            )}
            <p className="mt-2 text-[12px] leading-snug text-foreground/55">
              Every number in the app — the plan, the pace, the forecast — now works from the updated balance.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setAccounts(result.undo);
                  setResult(null);
                }}
                className="press rounded-xl border border-border py-2.5 text-[13px] font-semibold text-foreground/70"
              >
                Undo
              </button>
              <button onClick={onClose} className="press rounded-xl bg-primary py-2.5 text-[13px] font-semibold text-background">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Record what actually happened</h2>
            {prefill?.reason && <p className="mt-1 text-[12px] font-medium text-primary">{prefill.reason}</p>}
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              Tell the app about real money moves and it adjusts your accounts for you — no re-typing holdings. Shares
              are sold from cash first, then evenly across the account, at today&apos;s prices.
            </p>
            <div className="mt-4 space-y-2">
              {kinds.map((o) => (
                <button
                  key={o.k}
                  onClick={() => setKind(o.k)}
                  className={`press flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${kind === o.k ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <span className="text-xl" aria-hidden>
                    {o.icon}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[14px] font-semibold ${kind === o.k ? "text-primary" : ""}`}>{o.label}</span>
                    <span className="block text-[11px] text-foreground/50">{o.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <span className="text-[12px] font-medium text-foreground/60">{kind === "deposit" ? "Into" : "From"}</span>
              <select className={`${INPUT} mt-1`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({ACCOUNT_KIND_META[a.kind].label}) — {money(Math.round(a.balance))}
                  </option>
                ))}
              </select>
            </div>
            {kind === "transfer" && (
              <div className="mt-2">
                <span className="text-[12px] font-medium text-foreground/60">Into</span>
                <select className={`${INPUT} mt-1`} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} ({ACCOUNT_KIND_META[a.kind].label})
                      </option>
                    ))}
                  <option value="__newroth__">＋ New Roth IRA</option>
                </select>
              </div>
            )}
            <div className="mt-2">
              <span className="text-[12px] font-medium text-foreground/60">Amount</span>
              <label className={`${INPUT} mt-1 flex items-center gap-1.5`}>
                <span className="text-foreground/40">$</span>
                <input
                  inputMode="numeric"
                  value={amountText ? Number(amountText.replace(/[^0-9]/g, "")).toLocaleString("en-US") : ""}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  aria-label="Amount"
                  className="tabular w-full bg-transparent font-semibold outline-none"
                />
              </label>
            </div>
            <button
              onClick={apply}
              disabled={!from || amount <= 0}
              className={`press mt-4 w-full rounded-xl py-2.5 text-[14px] font-semibold ${from && amount > 0 ? "bg-primary text-background" : "bg-foreground/10 text-foreground/40"}`}
            >
              {kind === "withdraw" ? "Record the withdrawal" : kind === "deposit" ? "Record the deposit" : "Record the move"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
