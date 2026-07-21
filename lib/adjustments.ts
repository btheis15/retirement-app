/**
 * Real-life account adjustments — the "keep the app matching my actual money"
 * layer. When the user actually withdraws, deposits, converts, or moves money,
 * these pure functions apply it to an Account so balances (and holdings, when
 * itemized) track reality without re-entering anything.
 *
 * Mechanics, stated plainly:
 *  - WITHDRAW from an itemized account: cash/fixed-dollar lines are spent
 *    first (that's how the engine models draws too), then shares are sold
 *    pro-rata across the remaining holdings at their current prices.
 *  - DEPOSIT into an itemized account: lands on the cash line (one is created
 *    if needed) — the app doesn't guess what you bought; edit the holding if
 *    you invested it.
 *  - Balance-only accounts adjust the balance; a taxable account's cost basis
 *    scales proportionally on withdrawals (selling a slice realizes its share
 *    of the gain) and grows dollar-for-dollar on deposits (new money is basis).
 *  - Amounts clamp at what's actually there; `applied` reports the real move.
 */

import { Account, Holding, bucketOf, holdingValue, syncAccountFromHoldings } from "./accounts";

export interface AdjustResult {
  account: Account;
  /** Dollars actually moved (≤ requested — clamped at the balance). */
  applied: number;
}

const isCashLine = (h: Holding) => h.type === "cash" || !h.ticker;

/** Withdraw or deposit real dollars in an account. */
export function applyCashFlow(account: Account, amount: number, kind: "withdraw" | "deposit"): AdjustResult {
  const amt = Math.max(0, amount);
  if (amt === 0) return { account, applied: 0 };
  const taxable = bucketOf(account.kind) === "taxable";

  if (!account.holdings || account.holdings.length === 0) {
    if (kind === "deposit") {
      return {
        account: {
          ...account,
          balance: account.balance + amt,
          ...(taxable && account.costBasis != null ? { costBasis: account.costBasis + amt } : {}),
        },
        applied: amt,
      };
    }
    const applied = Math.min(amt, account.balance);
    const remainFraction = account.balance > 0 ? (account.balance - applied) / account.balance : 0;
    return {
      account: {
        ...account,
        balance: account.balance - applied,
        ...(taxable && account.costBasis != null ? { costBasis: account.costBasis * remainFraction } : {}),
      },
      applied,
    };
  }

  const holdings = account.holdings.map((h) => ({ ...h }));
  if (kind === "deposit") {
    const cash = holdings.find(isCashLine);
    if (cash) cash.shares += amt / cash.price;
    else holdings.push({ ticker: "", name: "Cash", type: "cash", shares: amt, price: 1 });
    return { account: syncAccountFromHoldings({ ...account, holdings }), applied: amt };
  }

  // Withdraw: cash lines first…
  let remaining = amt;
  for (const h of holdings) {
    if (remaining <= 0) break;
    if (!isCashLine(h)) continue;
    const value = holdingValue(h);
    const take = Math.min(value, remaining);
    h.shares -= take / h.price;
    remaining -= take;
  }
  // …then pro-rata share sales across everything else, at current prices.
  const rest = holdings.filter((h) => !isCashLine(h));
  const restValue = rest.reduce((s, h) => s + holdingValue(h), 0);
  if (remaining > 0 && restValue > 0) {
    const take = Math.min(remaining, restValue);
    const fraction = take / restValue;
    for (const h of rest) h.shares -= h.shares * fraction;
    remaining -= take;
  }
  const cleaned = holdings.filter((h) => holdingValue(h) > 0.005);
  return {
    account: syncAccountFromHoldings({ ...account, holdings: cleaned }),
    applied: amt - remaining,
  };
}

export interface TransferResult {
  from: Account;
  to: Account;
  applied: number;
}

/** Move real dollars between accounts (a Roth conversion, a rollover, a
 *  transfer). Sells pro-rata on the way out; lands as cash on the way in
 *  (conservation: from + to changes net to zero). What you buy in the
 *  destination is yours to record — edit its holdings after investing. */
export function applyTransfer(from: Account, to: Account, amount: number): TransferResult {
  const out = applyCashFlow(from, amount, "withdraw");
  const inn = applyCashFlow(to, out.applied, "deposit");
  return { from: out.account, to: inn.account, applied: out.applied };
}
