"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Disclaimer, AdjustLink } from "@/components/ui";
import { money, moneyCompact } from "@/lib/format";
import {
  Account,
  AccountKind,
  ACCOUNT_KIND_META,
  HOLDING_TYPE_LABEL,
  Holding,
  HoldingType,
  bucketOf,
  sumBuckets,
  holdingValue,
  syncAccountFromHoldings,
  defaultRetirementYear,
} from "@/lib/accounts";
import { holdingDps, holdingDivGrowth, dividendKind, holdingDividendKind } from "@/lib/dividends";
import { rmdStartAge } from "@/lib/tax/constants";
import { adjustedAnnualBenefit, fullRetirementAge } from "@/lib/socialSecurity";
import { searchTickers, getSeries, latestPrices, assetTypeLabel, SearchResult } from "@/lib/prices";
import { PortfolioCard } from "@/components/PortfolioCard";
import { DataVaultCard } from "@/components/DataVaultCard";

const KIND_OPTIONS: AccountKind[] = [
  "rollover_401k",
  "traditional_401k",
  "traditional_ira",
  "traditional_403b",
  "govt_457b",
  "tsp_traditional",
  "sep_ira",
  "simple_ira",
  "solo_401k",
  "roth_ira",
  "roth_401k",
  "roth_403b",
  "tsp_roth",
  "brokerage",
  "cash",
];

/** Friendly age label, e.g. 67 → "67", 66.667 → "66 yr 8 mo". */
function fmtAge(years: number): string {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  return months === 0 ? `${whole}` : `${whole} yr ${months} mo`;
}

export default function AccountsPage() {
  const { ready, mode, household, updateHousehold, upsertAccount, removeAccount, setMode, newExample, resetOwn } = useStore();
  const [editing, setEditing] = useState<Account | null>(null);

  if (!ready) return <div className="h-screen" />;

  const buckets = sumBuckets(household.accounts);
  const thisYear = new Date().getFullYear();

  const num = (v: string) => Math.max(0, Number(v.replace(/[^0-9.]/g, "")) || 0);

  return (
    <div>
      <PageTitle title="Your accounts" subtitle="All inputs stay on your device — nothing is uploaded." />

      {mode === "demo" && (
        <Card className="border-accent/30 bg-accent/5">
          <p className="text-sm text-foreground/75">
            You&apos;re viewing a <strong>{moneyCompact(buckets.total)} sample household</strong>. Editing anything
            will start your own plan (the example stays intact).
          </p>
          <p className="mt-1 text-[12px] text-foreground/55">
            🎲 <strong>New example</strong> rolls a fresh random household ($5M–$10M) — a different account mix,
            Social Security claim ages, and spending — so you can see how the planner behaves across many situations.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={newExample}
              className="press rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary"
            >
              🎲 New example
            </button>
            <button
              onClick={() => setMode("own")}
              className="press rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Start my own (blank)
            </button>
          </div>
        </Card>
      )}

      {/* Live portfolio value (shows once you have holdings with tickers) */}
      <PortfolioCard />

      {/* People */}
      <SectionTitle>Household (filing jointly)</SectionTitle>
      {(["self", "spouse"] as const).map((who) => {
        const p = household[who];
        return (
          <Card key={who} className="mb-3">
            <Field label="Name">
              <input
                className={INPUT}
                value={p.label}
                onChange={(e) => updateHousehold({ [who]: { ...p, label: e.target.value } } as never)}
              />
            </Field>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="Birth year">
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={p.birthYear}
                  onChange={(e) => updateHousehold({ [who]: { ...p, birthYear: num(e.target.value) } } as never)}
                />
              </Field>
              <Field label="Current age">
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={thisYear - p.birthYear}
                  onChange={(e) =>
                    updateHousehold({ [who]: { ...p, birthYear: thisYear - num(e.target.value) } } as never)
                  }
                />
              </Field>
            </div>
            {/* SS claim age is a coached decision (compares breakeven, survivor angle) —
                read-only here, with a single home in the walkthrough to change it. */}
            <Field label="SS claim age" className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-medium text-foreground/80">Claims at {p.ssClaimAge}</span>
                <AdjustLink step="ssclaim" />
              </div>
            </Field>
            <p className="mt-1 text-[11px] text-foreground/55">
              RMDs begin at age {rmdStartAge(p.birthYear)} for {p.label || (who === "self" ? "you" : "your spouse")}{" "}
              (SECURE 2.0, based on birth year).
            </p>
            <Field label={`Social Security — full benefit (monthly, at age ${fmtAge(fullRetirementAge(p.birthYear))})`} className="mt-2">
              <MoneyInput
                value={Math.round(p.socialSecurityAnnual / 12)}
                onChange={(v) => updateHousehold({ [who]: { ...p, socialSecurityAnnual: v * 12 } } as never)}
              />
              <p className="mt-1 text-[11px] text-foreground/55">
                Enter the monthly amount at your <strong>full retirement age</strong>{" "}(~{fmtAge(fullRetirementAge(p.birthYear))}) — SSA lists
                this on your statement. We adjust it for the claim age above:{" "}
                <strong>{money(adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, p.ssClaimAge))}</strong>/yr at age {p.ssClaimAge}.
                Compare claim ages on the Plan tab.
              </p>
            </Field>
          </Card>
        );
      })}

      <Card className="mb-3">
        <Field label="Year you plan to start retirement">
          <input
            className={INPUT}
            inputMode="numeric"
            value={household.retirementYear ?? defaultRetirementYear(household.self.birthYear)}
            onChange={(e) => updateHousehold({ retirementYear: num(e.target.value) })}
          />
          <p className="mt-1 text-[11px] text-foreground/55">
            You&apos;d be age {(household.retirementYear ?? defaultRetirementYear(household.self.birthYear)) - household.self.birthYear} that
            year. Used to frame your plan; the year-by-year projection currently still begins this year.
          </p>
        </Field>
      </Card>

      {/* Income & spending */}
      <SectionTitle>Income & spending</SectionTitle>
      <Card>
        {/* Spending is a coached decision (weighed against comfortable/sustainable
            ceilings and IRMAA cliffs) — read-only here, with a single home to change it. */}
        <Field label="Desired annual spending (after tax)">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="tabular text-xl font-bold text-primary">{money(household.annualSpending)}</div>
              <div className="tabular text-[12px] text-foreground/50">{money(Math.round(household.annualSpending / 12))}/mo</div>
            </div>
            <AdjustLink step="spend" />
          </div>
        </Field>
        <Field label="Pension / annuity (annual, fully taxable)" className="mt-2">
          <MoneyInput value={household.pensionAnnual} onChange={(v) => updateHousehold({ pensionAnnual: v })} />
        </Field>
        <Field label="Dividends — qualified (annual)" className="mt-2">
          <MoneyInput value={household.brokerageDividendsAnnual} onChange={(v) => updateHousehold({ brokerageDividendsAnnual: v })} />
        </Field>
        <Field label="Dividends — ordinary / REIT (annual)" className="mt-2">
          <MoneyInput value={household.ordinaryDividendsAnnual ?? 0} onChange={(v) => updateHousehold({ ordinaryDividendsAnnual: v })} />
        </Field>
        <Field label="Taxable interest — CDs / bonds / savings (annual)" className="mt-2">
          <MoneyInput value={household.taxableInterestAnnual ?? 0} onChange={(v) => updateHousehold({ taxableInterestAnnual: v })} />
        </Field>
        <Field label="Tax-exempt (muni) interest (annual)" className="mt-2">
          <MoneyInput value={household.taxExemptInterestAnnual ?? 0} onChange={(v) => updateHousehold({ taxExemptInterestAnnual: v })} />
          <p className="mt-1 text-[11px] text-foreground/55">
            Not federally taxed — but it still counts toward your Medicare (IRMAA) premiums and how much of your
            Social Security is taxed.
          </p>
        </Field>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-gain/5 px-3 py-2 text-[12px] text-foreground/70">
          <span>📍</span>
          <span>
            <strong>State: Illinois.</strong> Illinois doesn&apos;t tax retirement income — your withdrawals, RMDs,
            Roth conversions, pension, and Social Security are state-tax-free; only investment income is taxed at the
            flat 4.95%. <span className="text-foreground/50">(More states coming.)</span>
          </span>
        </div>
      </Card>

      {/* Accounts */}
      <SectionTitle hint={money(buckets.total)}>Accounts</SectionTitle>
      <div className="space-y-2">
        {household.accounts.map((a) => (
          <AccountRow key={a.id} account={a} onEdit={() => setEditing(a)} onRemove={() => removeAccount(a.id)} />
        ))}
      </div>

      <button
        onClick={() =>
          setEditing({ id: `a${Date.now()}`, label: "", kind: "traditional_ira", owner: "self", balance: 0 })
        }
        className="press mt-3 w-full rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-primary"
      >
        + Add an account
      </button>

      {mode === "own" && household.accounts.length > 0 && (
        <button onClick={resetOwn} className="press mt-3 w-full rounded-xl py-2 text-[12px] text-tax/80">
          Clear all my data
        </button>
      )}

      <DataVaultCard />

      <div className="mt-6">
        <Disclaimer />
      </div>

      {editing && (
        <AccountEditor
          account={editing}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            upsertAccount(a);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AccountRow({ account: a, onEdit, onRemove }: { account: Account; onEdit: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const meta = ACCOUNT_KIND_META[a.kind];
  const isTaxable = bucketOf(a.kind) === "taxable";
  const gain = isTaxable ? Math.max(0, a.balance - (a.costBasis ?? a.balance)) : 0;
  const holdings = a.holdings ?? [];

  return (
    <Card as="div">
      <div className="flex items-center justify-between">
        <button onClick={onEdit} className="press min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-lg">{meta.emoji}</span>
            <span className="truncate font-medium">{a.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill tone={bucketTone(a.kind)}>{meta.label}</Pill>
            {meta.hasRmd && <Pill tone="deferred">RMDs apply</Pill>}
            {!meta.hasRmd && bucketOf(a.kind) === "roth" && <Pill tone="roth">No RMDs</Pill>}
            {gain > 0 && <Pill tone="taxable">{moneyCompact(gain)} gain</Pill>}
          </div>
        </button>
        <div className="ml-3 text-right">
          <div className="tabular font-semibold">{moneyCompact(a.balance)}</div>
          <button onClick={onRemove} className="press text-[11px] text-tax/80">
            Remove
          </button>
        </div>
      </div>

      {holdings.length > 0 && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="press mt-2 flex w-full items-center justify-between border-t border-border pt-2 text-[12px] text-foreground/55"
          >
            <span>
              {holdings.length} holding{holdings.length > 1 ? "s" : ""}
            </span>
            <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
          </button>
          {open && (
            <div className="rise mt-1 overflow-x-auto">
              <table className="w-full text-right text-[12px]">
                <thead className="text-foreground/45">
                  <tr>
                    <th className="py-1 text-left font-medium">Holding</th>
                    <th className="py-1 font-medium">Shares</th>
                    <th className="py-1 font-medium">Price</th>
                    <th className="py-1 font-medium">Value</th>
                    {isTaxable && <th className="py-1 font-medium">Gain</th>}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {holdings.map((h, i) => {
                    const val = holdingValue(h);
                    const hgain = isTaxable && h.costPerShare != null ? (h.price - h.costPerShare) * h.shares : 0;
                    return (
                      <tr key={i} className="border-t border-border/40">
                        <td className="py-1 text-left">
                          <span className="font-semibold">{h.ticker}</span>
                          <span className="ml-1 text-[10px] uppercase text-foreground/40">
                            {HOLDING_TYPE_LABEL[h.type]}
                          </span>
                          <div className="text-[10px] text-foreground/45">{h.name}</div>
                        </td>
                        <td className="py-1">{h.shares.toLocaleString()}</td>
                        <td className="py-1">{money(h.price, { cents: true })}</td>
                        <td className="py-1 font-medium">{moneyCompact(val)}</td>
                        {isTaxable && (
                          <td className={`py-1 ${hgain > 0 ? "text-gain" : "text-foreground/40"}`}>
                            {hgain > 0 ? moneyCompact(hgain) : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AccountEditor({
  account,
  onClose,
  onSave,
}: {
  account: Account;
  onClose: () => void;
  onSave: (a: Account) => void;
}) {
  const [draft, setDraft] = useState<Account>(account);
  const meta = ACCOUNT_KIND_META[draft.kind];
  const isTaxable = bucketOf(draft.kind) === "taxable";
  const holdings = draft.holdings ?? [];
  const hasHoldings = holdings.length > 0;
  const cash = draft.kind === "cash";

  // When holdings are present, the balance (and cost basis) come from them.
  const setHoldings = (next: Holding[]) =>
    setDraft((d) => syncAccountFromHoldings({ ...d, holdings: next }));

  const save = () => {
    const cleaned = hasHoldings ? syncAccountFromHoldings({ ...draft }) : { ...draft, holdings: undefined };
    onSave({ ...cleaned, label: draft.label || meta.label });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="scrim-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="sheet-panel relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/15" />
        <h2 className="text-lg font-semibold">{account.label ? "Edit account" : "Add account"}</h2>

        <Field label="Type" className="mt-3">
          <select className={INPUT} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AccountKind })}>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_META[k].label}
              </option>
            ))}
          </select>
        </Field>
        <p className="mt-1 text-[11px] text-foreground/55">
          {meta.bucket === "pretax" && "Pre-tax: every dollar out is ordinary income. Subject to RMDs."}
          {meta.bucket === "roth" && "Roth: tax-free withdrawals, no lifetime RMDs."}
          {meta.bucket === "taxable" && "Taxable: only the gain is taxed (capital gains). No RMDs."}
        </p>

        <Field label="Label" className="mt-3">
          <input className={INPUT} value={draft.label} placeholder="e.g. Fidelity Rollover" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </Field>

        <Field label="Owner" className="mt-3">
          <div className="flex gap-2">
            {(["self", "spouse"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setDraft({ ...draft, owner: o })}
                className={`press flex-1 rounded-xl border py-2 text-sm capitalize ${
                  draft.owner === o ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </Field>

        {/* Holdings (skip for plain cash/savings accounts) */}
        {!cash && (
          <div className="mt-4">
            <div className="text-[12px] font-medium text-foreground/60">What do you own in this account?</div>
            <p className="mt-0.5 text-[11px] text-foreground/55">
              Add your stocks, ETFs, or funds and how many shares you have — we&apos;ll track the real prices for
              you. Only the ticker symbol is ever looked up; your share counts and balances stay on your device.
            </p>
            <HoldingsEditor holdings={holdings} isTaxable={isTaxable} bucket={bucketOf(draft.kind)} onChange={setHoldings} />
          </div>
        )}

        {/* Manual balance fallback when not itemizing holdings */}
        {!hasHoldings && (
          <>
            <Field label={cash ? "Balance" : "Or just enter a total balance"} className="mt-3">
              <MoneyInput value={draft.balance} onChange={(v) => setDraft({ ...draft, balance: v })} />
            </Field>
            {isTaxable && (
              <Field label="Cost basis (what you paid)" className="mt-3">
                <MoneyInput value={draft.costBasis ?? 0} onChange={(v) => setDraft({ ...draft, costBasis: v })} />
                <p className="mt-1 text-[11px] text-foreground/55">
                  Balance − basis = unrealized gain, which is what gets taxed when you sell.
                </p>
              </Field>
            )}
          </>
        )}

        {hasHoldings && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2 text-[13px]">
            <span className="text-foreground/65">Account value (from holdings)</span>
            <span className="tabular font-semibold text-primary">{money(draft.balance)}</span>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="press flex-1 rounded-xl border border-border py-3 text-sm font-medium">
            Cancel
          </button>
          <button onClick={save} className="press flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const YAHOO_TO_HOLDING: Record<string, HoldingType> = {
  EQUITY: "stock",
  ETF: "etf",
  MUTUALFUND: "mutual_fund",
};

/** Search-and-add holdings with live share valuation. */
function HoldingsEditor({
  holdings,
  isTaxable,
  bucket,
  onChange,
}: {
  holdings: Holding[];
  isTaxable: boolean;
  bucket: "pretax" | "roth" | "taxable";
  onChange: (next: Holding[]) => void;
}) {
  const [open, setOpen] = useState(false); // search screen open?
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced live search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      searchTickers(q, ctrl.signal)
        .then((r) => setResults(r))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const openSearch = () => {
    setQuery("");
    setResults([]);
    setOpen(true);
  };
  const closeSearch = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const add = async (r: SearchResult) => {
    if (holdings.some((h) => h.ticker === r.symbol)) {
      closeSearch();
      return;
    }
    setAdding(r.symbol);
    let price = 0;
    try {
      const series = await getSeries([r.symbol], "1mo");
      price = latestPrices(series)[r.symbol] ?? 0;
    } catch {
      /* leave price 0; user can still set shares */
    }
    const holding: Holding = {
      ticker: r.symbol,
      name: r.name,
      type: YAHOO_TO_HOLDING[r.type.toUpperCase()] ?? "stock",
      shares: 1,
      price,
      ...(isTaxable ? { costPerShare: price } : {}),
    };
    onChange([...holdings, holding]);
    setAdding(null);
    closeSearch();
  };

  const update = (i: number, patch: Partial<Holding>) =>
    onChange(holdings.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const remove = (i: number) => onChange(holdings.filter((_, j) => j !== i));
  const numFrom = (s: string) => Math.max(0, Number(s.replace(/[^0-9.]/g, "")) || 0);

  // ---- Search screen: tap "+ Add holding" to get here, pick an asset. ----
  if (open) {
    const q = query.trim();
    return (
      <div className="mt-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold">Add a holding</span>
          <button onClick={closeSearch} className="press text-[12px] font-medium text-foreground/60">
            Cancel
          </button>
        </div>
        <input
          ref={inputRef}
          className={INPUT}
          value={query}
          placeholder="Search a stock or fund — e.g. Apple, VTI, Vanguard…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-1 overflow-hidden rounded-xl border border-border bg-card">
          {!q && <div className="px-3 py-3 text-[12px] text-foreground/50">Type a company name or ticker symbol to search.</div>}
          {q && loading && results.length === 0 && <div className="px-3 py-3 text-[12px] text-foreground/50">Searching…</div>}
          {q && !loading && results.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-foreground/50">No matches — try a ticker like VTI or a full company name.</div>
          )}
          {results.map((r) => (
            <button
              key={r.symbol}
              onClick={() => add(r)}
              disabled={adding === r.symbol}
              className="press flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2.5 text-left last:border-0"
            >
              <span className="min-w-0">
                <span className="font-semibold">{r.symbol}</span>
                <span className="ml-1.5 text-[10px] uppercase text-foreground/40">{assetTypeLabel(r.type)}</span>
                <span className="block truncate text-[11px] text-foreground/55">{r.name}</span>
              </span>
              <span className="shrink-0 text-[12px] font-medium text-primary">{adding === r.symbol ? "Adding…" : "Add +"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- List of holdings + the "+ Add holding" button. ----
  return (
    <div className="mt-2">
      {holdings.length > 0 && (
        <div className="mb-2 space-y-2">
          {holdings.map((h, i) => (
            <div key={`${h.ticker}-${i}`} className="rounded-xl border border-border bg-background/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold">{h.ticker}</span>
                  <span className="ml-1.5 text-[10px] uppercase text-foreground/40">{HOLDING_TYPE_LABEL[h.type]}</span>
                  <div className="truncate text-[11px] text-foreground/55">{h.name}</div>
                </div>
                <button onClick={() => remove(i)} className="press shrink-0 text-[11px] text-tax/80">
                  Remove
                </button>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <label className="flex-1">
                  <span className="mb-1 block text-[10px] text-foreground/55">Shares</span>
                  <input
                    className={`${INPUT} py-1.5 text-sm`}
                    inputMode="decimal"
                    value={h.shares || ""}
                    onChange={(e) => update(i, { shares: numFrom(e.target.value) })}
                  />
                </label>
                {isTaxable && (
                  <label className="flex-1">
                    <span className="mb-1 block text-[10px] text-foreground/55">Cost / share</span>
                    <input
                      className={`${INPUT} py-1.5 text-sm`}
                      inputMode="decimal"
                      value={h.costPerShare ?? ""}
                      placeholder={h.price ? String(h.price) : ""}
                      onChange={(e) => update(i, { costPerShare: numFrom(e.target.value) })}
                    />
                  </label>
                )}
                <div className="flex-1 text-right">
                  <span className="mb-1 block text-[10px] text-foreground/55">Value</span>
                  <span className="tabular text-sm font-semibold">{h.price ? money(holdingValue(h)) : "—"}</span>
                </div>
              </div>
              {h.price > 0 && (
                <div className="mt-1 text-[10px] text-foreground/45">{money(h.price, { cents: true })}/share · updates daily</div>
              )}
              {/* Dividend (taxable holdings only — IRA/Roth dividends aren't taxed
                  yearly). Auto-filled from the market feed; edit to override. */}
              {isTaxable && dividendKind(h.type) !== "none" && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] text-foreground/55">
                      Dividend · {h.dividendManual ? "your override" : "from market feed"}
                    </span>
                    {h.dividendManual && (
                      <button onClick={() => update(i, { dividendManual: false })} className="press text-[10px] font-medium text-primary">
                        ↺ use market
                      </button>
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex-1">
                      <span className="mb-1 block text-[10px] text-foreground/55">Div / share / yr</span>
                      <input
                        className={`${INPUT} py-1.5 text-sm`}
                        inputMode="decimal"
                        value={h.dividendPerShare ?? ""}
                        placeholder={holdingDps(h).toFixed(2)}
                        onChange={(e) => update(i, { dividendPerShare: numFrom(e.target.value), dividendManual: true })}
                      />
                    </label>
                    <label className="flex-1">
                      <span className="mb-1 block text-[10px] text-foreground/55">Growth / yr %</span>
                      <input
                        className={`${INPUT} py-1.5 text-sm`}
                        inputMode="decimal"
                        value={h.dividendGrowthRate != null ? (h.dividendGrowthRate * 100).toFixed(1) : ""}
                        placeholder={(holdingDivGrowth(h) * 100).toFixed(1)}
                        onChange={(e) => update(i, { dividendGrowthRate: numFrom(e.target.value) / 100, dividendManual: true })}
                      />
                    </label>
                    <div className="flex-1 text-right">
                      <span className="mb-1 block text-[10px] text-foreground/55">Income / yr</span>
                      <span className="tabular text-sm font-semibold">{h.shares > 0 ? money(h.shares * holdingDps(h)) : "—"}</span>
                    </div>
                  </div>
                  {/* Qualified vs ordinary (non-qualified) — drives the tax rate.
                      Defaulted by type; flag REITs / non-qualified funds as ordinary. */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] text-foreground/55">Taxed as</span>
                    {(["qualified", "ordinary"] as const).map((k) => {
                      const active = holdingDividendKind(h) === k;
                      return (
                        <button
                          key={k}
                          onClick={() => update(i, { dividendOrdinary: k === "ordinary", dividendManual: true })}
                          className={`press rounded-full border px-2.5 py-0.5 text-[11px] ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/60"}`}
                        >
                          {k === "qualified" ? "Qualified" : "Ordinary"}
                        </button>
                      );
                    })}
                    <span className="text-[10px] text-foreground/40">
                      {holdingDividendKind(h) === "qualified" ? "preferential rate" : "ordinary-income rate"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
          {/* Account-type tax note: dividends inside tax-advantaged accounts aren't
              taxed yearly, so we only model the taxable ones. */}
          {!isTaxable && (
            <p className="rounded-xl bg-ss/[0.06] px-3 py-2 text-[11px] leading-relaxed text-foreground/60">
              💡 This is a {bucket === "roth" ? "Roth" : "tax-deferred"} account, so its dividends{" "}
              {bucket === "roth" ? "are never taxed" : "aren't taxed each year — they compound tax-deferred"}.
              We only model annual dividend tax on your <strong>taxable</strong> accounts.
            </p>
          )}
        </div>
      )}

      <button
        onClick={openSearch}
        className="press w-full rounded-xl border-2 border-dashed border-border py-2.5 text-sm font-semibold text-primary"
      >
        + Add holding
      </button>
    </div>
  );
}

const INPUT =
  "w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-base text-foreground outline-none transition-[box-shadow,border-color] duration-200 focus:border-primary focus:shadow-[0_0_0_4px_rgba(13,79,74,0.10)]";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-foreground/60">{label}</span>
      {children}
    </label>
  );
}

function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value ? value.toLocaleString("en-US") : "");
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50">$</span>
      <input
        className={`${INPUT} pl-6 tabular`}
        inputMode="numeric"
        value={display}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          setText(raw ? Number(raw).toLocaleString("en-US") : "");
          onChange(Number(raw) || 0);
        }}
        onBlur={() => setText(null)}
      />
    </div>
  );
}

function bucketTone(kind: AccountKind): "deferred" | "roth" | "taxable" {
  const b = bucketOf(kind);
  return b === "pretax" ? "deferred" : b === "roth" ? "roth" : "taxable";
}
