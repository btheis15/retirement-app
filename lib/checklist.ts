/**
 * "Do this in January" — the year's plan as custodian-ready instructions.
 *
 * The walkthrough ends knowing WHAT to do (withdraw $X, convert $Y, set aside
 * $Z); this turns it into the artifact a professional would hand over: which
 * named account each dollar comes from, the words to use on the phone, the
 * deadline, and how the tax actually gets paid. Per-account splits mirror the
 * engine's draw order exactly (cash first within taxable, otherwise pro-rata
 * by balance; each person's RMD from their OWN accounts) so the checklist and
 * the projection are the same plan, not two approximations.
 *
 * ⚠️ Educational estimates only — not tax advice.
 */

import { Account, Household, bucketOf } from "./accounts";
import { YearPlan } from "./optimizer";
import { money } from "./format";

export interface ChecklistItem {
  /** Emoji-ish grouping for tone/icon. */
  kind: "rmd" | "withdraw" | "sell" | "roth" | "convert" | "tax" | "irmaa";
  /** The instruction, custodian-ready. */
  title: string;
  /** One supporting line (why / mechanics). */
  detail?: string;
  amount?: number;
  deadline?: string;
}

const acctName = (household: Household, a: Account) => {
  const owner = a.owner === "spouse" ? household.spouse.label || "Spouse" : household.self.label || "You";
  return `${a.label || a.kind} (${owner})`;
};

/** Split `amount` across `accounts` pro-rata by balance, dropping dust. */
function proRata(accounts: Account[], amount: number): { account: Account; take: number }[] {
  const total = accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);
  if (total <= 0 || amount <= 0) return [];
  return accounts
    .map((account) => ({ account, take: (Math.max(0, account.balance) / total) * amount }))
    .filter((x) => x.take > 100);
}

const list = (parts: string[]) => parts.join(" · ");

export function buildChecklist(
  household: Household,
  plan: YearPlan,
  opts: {
    /** Total tax to reserve this year INCLUDING the conversion's (the all-in number). */
    yearTaxTotal: number;
    /** This-year IRMAA framing line (null → omit). */
    irmaaLine?: string | null;
  },
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const accounts = household.accounts;
  const pretax = accounts.filter((a) => bucketOf(a.kind) === "pretax" && a.balance > 0);
  const cash = accounts.filter((a) => bucketOf(a.kind) === "taxable" && a.kind === "cash" && a.balance > 0);
  const brokerage = accounts.filter((a) => bucketOf(a.kind) === "taxable" && a.kind !== "cash" && a.balance > 0);
  const roth = accounts.filter((a) => bucketOf(a.kind) === "roth" && a.balance > 0);

  // 1) RMDs — per person, from that person's OWN accounts (legal requirement).
  for (const d of plan.rmdDetails.filter((x) => x.amount > 0.5)) {
    const name = d.owner === "spouse" ? household.spouse.label || "Spouse" : household.self.label || "You";
    const own = pretax.filter((a) => a.owner === d.owner);
    const split = proRata(own, d.amount);
    items.push({
      kind: "rmd",
      amount: d.amount,
      deadline: "Dec 31",
      title: `Take ${name}'s required RMD: ${money(d.amount)}`,
      detail:
        (split.length > 1
          ? `From ${name === "You" ? "your" : "their"} own pre-tax accounts — any mix works, e.g. ${list(
              split.map((s) => `${money(Math.round(s.take))} from ${acctName(household, s.account)}`),
            )}. `
          : split.length === 1
            ? `From ${acctName(household, split[0].account)}. `
            : "") +
        `Ask the custodian for a "required minimum distribution." It's taxed as ordinary income.`,
    });
  }

  // 2) Voluntary pre-tax withdrawal (beyond RMDs) — pooled pro-rata, like the engine.
  const voluntaryPretax = Math.max(0, plan.withdrawals.pretax - plan.rmd);
  if (voluntaryPretax > 100) {
    const split = proRata(pretax, voluntaryPretax);
    items.push({
      kind: "withdraw",
      amount: voluntaryPretax,
      title: `Withdraw ${money(voluntaryPretax)} more from pre-tax (IRA / 401k)`,
      detail:
        (split.length
          ? `${list(split.map((s) => `${money(Math.round(s.take))} from ${acctName(household, s.account)}`))}. `
          : "") + `This fills your low tax brackets on purpose — cheap dollars now instead of forced ones later.`,
    });
  }

  // 3) Taxable: spend cash first (no tax), then sell brokerage.
  const taxableDraw = plan.withdrawals.taxable;
  if (taxableDraw > 100) {
    const cashTotal = cash.reduce((s, a) => s + a.balance, 0);
    const fromCash = Math.min(taxableDraw, cashTotal);
    const fromBrokerage = taxableDraw - fromCash;
    const parts: string[] = [];
    if (fromCash > 100) parts.push(`${money(Math.round(fromCash))} from ${cash.length === 1 ? acctName(household, cash[0]) : "cash/savings"} (no tax)`);
    if (fromBrokerage > 100) {
      const split = proRata(brokerage, fromBrokerage);
      parts.push(
        `sell ${money(Math.round(fromBrokerage))}${
          split.length === 1
            ? ` from ${acctName(household, split[0].account)}`
            : split.length > 1
              ? ` — ${list(split.map((s) => `${money(Math.round(s.take))} ${acctName(household, s.account)}`))}`
            : ""
        } (only the gain is taxed)`,
      );
    }
    items.push({
      kind: "sell",
      amount: taxableDraw,
      title: `Cover ${money(taxableDraw)} from taxable savings`,
      detail: parts.length ? `${parts.join(", then ")}.` : undefined,
    });
  }

  // 4) Roth (rare — last resort by design).
  if (plan.withdrawals.roth > 100) {
    const split = proRata(roth, plan.withdrawals.roth);
    items.push({
      kind: "roth",
      amount: plan.withdrawals.roth,
      title: `Withdraw ${money(plan.withdrawals.roth)} from Roth (tax-free)`,
      detail: split.length ? `${list(split.map((s) => `${money(Math.round(s.take))} from ${acctName(household, s.account)}`))}.` : undefined,
    });
  }

  // 5) The conversion — the one transaction where the exact word matters.
  if (plan.conversion > 100) {
    const split = proRata(pretax, plan.conversion);
    items.push({
      kind: "convert",
      amount: plan.conversion,
      deadline: "Dec 31",
      title: `Convert ${money(plan.conversion)} from pre-tax to Roth`,
      detail:
        `Ask for a "Roth conversion" (not a rollover). Any mix of pre-tax accounts works — e.g. ${
          split.length ? list(split.map((s) => `${money(Math.round(s.take))} from ${acctName(household, s.account)}`)) : "your largest IRA"
        }. Decline withholding on the conversion itself and pay its ≈${money(plan.conversionTax)} tax from cash (step below) — withholding from the conversion shrinks what lands in the Roth.`,
    });
  }

  // 6) Paying the IRS — the mechanics, not just the amount.
  if (opts.yearTaxTotal > 100) {
    const pretaxGross = plan.withdrawals.pretax;
    // Withholding is deemed paid evenly through the year — the cleanest retiree
    // mechanism. Suggest it when pre-tax distributions can carry the whole bill.
    const pct = pretaxGross > 0 ? Math.ceil((opts.yearTaxTotal / pretaxGross) * 100) : Infinity;
    const quarterly = Math.round(opts.yearTaxTotal / 4);
    items.push({
      kind: "tax",
      amount: opts.yearTaxTotal,
      deadline: pct <= 90 ? "with each withdrawal" : "Apr 15 · Jun 15 · Sep 15 · Jan 15",
      title: `Set aside ${money(opts.yearTaxTotal)} for tax — and pay it as you go`,
      detail:
        pct <= 90
          ? `Easiest: have the custodian withhold ${pct}% on your pre-tax withdrawals (the IRS treats withholding as paid on time all year). Or pay four estimates of ${money(quarterly)} (IRS 1040-ES). Safe harbor: match 100% of last year's total tax (110% if income was over $150k) and no penalty applies regardless.`
          : `Pay four estimated-tax installments of about ${money(quarterly)} (IRS Form 1040-ES). Safe harbor: match 100% of last year's total tax (110% if income was over $150k) and no penalty applies regardless.`,
    });
  }

  // 7) IRMAA — what this year's income already decided.
  if (opts.irmaaLine) {
    items.push({ kind: "irmaa", title: "Medicare check", detail: opts.irmaaLine });
  }

  return items;
}
