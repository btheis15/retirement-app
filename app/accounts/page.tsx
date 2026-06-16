"use client";

import { useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Disclaimer } from "@/components/ui";
import { money, moneyCompact } from "@/lib/format";
import {
  Account,
  AccountKind,
  ACCOUNT_KIND_META,
  HOLDING_TYPE_LABEL,
  bucketOf,
  sumBuckets,
  holdingValue,
} from "@/lib/accounts";
import { rmdStartAge } from "@/lib/tax/constants";

const KIND_OPTIONS: AccountKind[] = [
  "rollover_401k",
  "traditional_401k",
  "traditional_ira",
  "roth_ira",
  "roth_401k",
  "brokerage",
  "cash",
];

export default function AccountsPage() {
  const { ready, mode, household, updateHousehold, upsertAccount, removeAccount, setMode, resetOwn } = useStore();
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
            You&apos;re viewing the <strong>$5M example</strong>. Editing anything will start your own
            plan (the example stays intact).
          </p>
          <button
            onClick={() => setMode("own")}
            className="press mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Start my own (blank)
          </button>
        </Card>
      )}

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
            <div className="mt-2 grid grid-cols-3 gap-3">
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
              <Field label="SS claim age">
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={p.ssClaimAge}
                  onChange={(e) => updateHousehold({ [who]: { ...p, ssClaimAge: num(e.target.value) } } as never)}
                />
              </Field>
            </div>
            <p className="mt-1 text-[11px] text-foreground/55">
              RMDs begin at age {rmdStartAge(p.birthYear)} for {p.label || (who === "self" ? "you" : "your spouse")}{" "}
              (SECURE 2.0, based on birth year).
            </p>
            <Field label="Social Security (annual, when claimed)" className="mt-2">
              <MoneyInput value={p.socialSecurityAnnual} onChange={(v) => updateHousehold({ [who]: { ...p, socialSecurityAnnual: v } } as never)} />
            </Field>
          </Card>
        );
      })}

      {/* Income & spending */}
      <SectionTitle>Income & spending</SectionTitle>
      <Card>
        <Field label="Desired annual spending (after tax)">
          <MoneyInput value={household.annualSpending} onChange={(v) => updateHousehold({ annualSpending: v })} />
        </Field>
        <Field label="Pension / annuity (annual, fully taxable)" className="mt-2">
          <MoneyInput value={household.pensionAnnual} onChange={(v) => updateHousehold({ pensionAnnual: v })} />
        </Field>
        <Field label="Brokerage dividends (annual, qualified)" className="mt-2">
          <MoneyInput value={household.brokerageDividendsAnnual} onChange={(v) => updateHousehold({ brokerageDividendsAnnual: v })} />
        </Field>
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="scrim-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="sheet-panel relative w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
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

        <Field label="Balance" className="mt-3">
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

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="press flex-1 rounded-xl border border-border py-3 text-sm font-medium">
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...draft, label: draft.label || meta.label })}
            className="press flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-base text-foreground outline-none focus:border-primary";

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
