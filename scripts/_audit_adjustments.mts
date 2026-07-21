/**
 * AUDIT PROBE — real-life account adjustments (lib/adjustments.ts).
 * Run: npx tsx scripts/_audit_adjustments.mts
 *
 * Hand math:
 *  Itemized account: cash $10,000 + AAPL 100 sh @ $200 ($20,000) + VTI 50 sh
 *  @ $260 ($13,000) = $43,000.
 *   - Withdraw $4,000 → all from cash (cash-first): cash $6,000, shares
 *     untouched, balance $39,000.
 *   - Withdraw $16,000 → cash $10,000 then $6,000 pro-rata from $33,000 of
 *     shares (fraction 6/33): AAPL 100×(1−6/33) = 81.818 sh, VTI 40.909 sh;
 *     balance $27,000 exactly.
 *  Balance-only taxable: balance $100,000, basis $60,000; withdraw $25,000 →
 *  balance $75,000, basis $45,000 (scales by 75%).
 *  Transfer $30,000 IRA→Roth: conservation — combined total unchanged; Roth
 *  gains a $30,000 cash line.
 */
import { applyCashFlow, applyTransfer } from "../lib/adjustments.ts";
import type { Account } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

const itemized = (): Account =>
  ({
    id: "a1",
    label: "Brokerage",
    kind: "brokerage",
    owner: "self",
    balance: 0,
    holdings: [
      { ticker: "", name: "Cash", type: "cash", shares: 10_000, price: 1 },
      { ticker: "AAPL", name: "Apple", type: "stock", shares: 100, price: 200, costPerShare: 150 },
      { ticker: "VTI", name: "Vanguard", type: "etf", shares: 50, price: 260, costPerShare: 200 },
    ],
  }) as Account;

// ── cash-first withdrawal ────────────────────────────────────────────────────
const w1 = applyCashFlow(itemized(), 4_000, "withdraw");
check("small withdrawal comes from cash only", near(w1.account.holdings!.find((h) => h.type === "cash")!.shares, 6_000));
check("shares untouched", w1.account.holdings!.find((h) => h.ticker === "AAPL")!.shares === 100);
check("balance $39,000", near(w1.account.balance, 39_000), `${w1.account.balance}`);
check("applied = requested", w1.applied === 4_000);

// ── cash exhausted → pro-rata share sale ─────────────────────────────────────
const w2 = applyCashFlow(itemized(), 16_000, "withdraw");
check("cash line removed when spent to zero", !w2.account.holdings!.some((h) => h.type === "cash"));
check("AAPL sold pro-rata (81.818 sh)", near(w2.account.holdings!.find((h) => h.ticker === "AAPL")!.shares, 100 * (1 - 6 / 33), 0.001));
check("VTI sold pro-rata (40.909 sh)", near(w2.account.holdings!.find((h) => h.ticker === "VTI")!.shares, 50 * (1 - 6 / 33), 0.001));
check("balance $27,000 exactly (conservation)", near(w2.account.balance, 27_000), `${w2.account.balance}`);
check("prices never touched", w2.account.holdings!.every((h) => h.price === 200 || h.price === 260));

// ── clamped at the balance ───────────────────────────────────────────────────
const w3 = applyCashFlow(itemized(), 99_000, "withdraw");
check("over-withdrawal clamps at $43,000", near(w3.applied, 43_000) && near(w3.account.balance, 0), `${w3.applied}`);

// ── deposits land on the cash line ───────────────────────────────────────────
const d1 = applyCashFlow(itemized(), 5_000, "deposit");
check("deposit grows cash", near(d1.account.holdings!.find((h) => h.type === "cash")!.shares, 15_000));
const noCash: Account = { ...itemized(), holdings: itemized().holdings!.filter((h) => h.type !== "cash") };
const d2 = applyCashFlow(noCash, 5_000, "deposit");
check("deposit creates a cash line when none exists", near(d2.account.holdings!.find((h) => h.type === "cash")!.shares ?? 0, 5_000));

// ── balance-only accounts (incl. taxable basis math) ─────────────────────────
const plain: Account = { id: "p", label: "IRA", kind: "traditional_ira", owner: "self", balance: 100_000 } as Account;
const w4 = applyCashFlow(plain, 25_000, "withdraw");
check("balance-only withdraw", w4.account.balance === 75_000 && w4.applied === 25_000);
const taxablePlain: Account = { id: "t", label: "Brokerage", kind: "brokerage", owner: "self", balance: 100_000, costBasis: 60_000 } as Account;
const w5 = applyCashFlow(taxablePlain, 25_000, "withdraw");
check("taxable basis scales on withdrawal ($45,000)", near(w5.account.costBasis!, 45_000), `${w5.account.costBasis}`);
const d3 = applyCashFlow(taxablePlain, 10_000, "deposit");
check("taxable basis grows dollar-for-dollar on deposit", near(d3.account.costBasis!, 70_000));
const w6 = applyCashFlow(plain, 200_000, "withdraw");
check("balance-only clamps", w6.applied === 100_000 && w6.account.balance === 0);

// ── transfers (Roth conversion) conserve money ───────────────────────────────
const ira: Account = { id: "i", label: "Rollover IRA", kind: "rollover_401k", owner: "self", balance: 250_000 } as Account;
const roth: Account = { id: "r", label: "Roth IRA", kind: "roth_ira", owner: "self", balance: 50_000 } as Account;
const t1 = applyTransfer(ira, roth, 30_000);
check("conversion: from drops, to grows", t1.from.balance === 220_000 && t1.to.balance === 80_000);
check("conversion conserves the total", near(t1.from.balance + t1.to.balance, 300_000));
const rothItemized: Account = { ...itemized(), id: "r2", kind: "roth_ira" };
const t2 = applyTransfer(ira, rothItemized, 30_000);
check("transfer into an itemized account lands as cash", near(t2.to.holdings!.find((h) => h.type === "cash")!.shares, 40_000));
const t3 = applyTransfer({ ...ira, balance: 10_000 }, roth, 30_000);
check("transfer clamps at what's there", t3.applied === 10_000 && t3.to.balance === 60_000);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
