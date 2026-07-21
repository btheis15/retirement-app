"use client";

/**
 * "Import from your brokerage" — the UI over lib/importHoldings.ts.
 * pick (file / drag / paste) → [map columns if unrecognized] → preview
 * (per-account destinations, include-checkboxes, problems) → done.
 *
 * PRIVACY: the file is read with FileReader and parsed on this device. It is
 * never uploaded; after import only ticker symbols are looked up for prices.
 */

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Info } from "@/components/ui";
import {
  parseHoldingsText,
  applyColumnMapping,
  guessColumnMapping,
  rowToHolding,
  mergeHoldings,
  ImportParseResult,
  ImportedRow,
  DetectedAccount,
  ColumnMapping,
} from "@/lib/importHoldings";
import { Account, AccountKind, ACCOUNT_KIND_META, bucketOf, syncAccountFromHoldings } from "@/lib/accounts";
import { SOURCES } from "@/lib/sources";
import { money } from "@/lib/format";

const INPUT =
  "field-focus w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-[14px] outline-none focus:border-primary";

const KIND_CHOICES: AccountKind[] = [
  "traditional_ira", "rollover_401k", "traditional_401k", "roth_ira", "roth_401k", "brokerage", "cash",
  "traditional_403b", "govt_457b", "tsp_traditional", "sep_ira", "simple_ira", "solo_401k", "roth_403b", "tsp_roth",
];

type Dest = { mode: "existing"; accountId: string } | { mode: "new"; kind: AccountKind; owner: "self" | "spouse" };

/** Match a detected account to an existing one: last-4 digits of the broker's
 *  account id appearing in the label, or the file's account name inside it. */
function matchExisting(det: DetectedAccount, accounts: Account[]): Account | null {
  const last4 = det.id.replace(/[^0-9]/g, "").slice(-4);
  if (last4.length === 4) {
    const byNum = accounts.find((a) => a.label.replace(/[^0-9]/g, "").includes(last4));
    if (byNum) return byNum;
  }
  const name = (det.name ?? "").toLowerCase();
  if (name.length >= 4) {
    const byName = accounts.find((a) => a.label.toLowerCase().includes(name) || name.includes(a.label.toLowerCase()));
    if (byName) return byName;
  }
  return null;
}

export function ImportHoldingsSheet({ targetAccount, onClose }: { targetAccount?: Account | null; onClose: () => void }) {
  const { household, setAccounts } = useStore();
  const [step, setStep] = useState<"pick" | "map" | "preview" | "done">("pick");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportParseResult | null>(null);
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [dests, setDests] = useState<Record<string, Dest>>({});
  const [merge, setMerge] = useState<Record<string, "update" | "replace">>({});
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const [summary, setSummary] = useState<{ holdings: number; accounts: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const groups = useMemo(() => {
    const byId = new Map<string, { det: DetectedAccount; rows: ImportedRow[] }>();
    for (const r of rows) {
      const id = targetAccount ? "__target__" : (r.accountId ?? "__single__");
      const cur = byId.get(id);
      if (cur) cur.rows.push(r);
      else {
        byId.set(id, {
          det: {
            id,
            name: targetAccount ? targetAccount.label : (r.accountName ?? null),
            rowCount: 0,
            totalValue: 0,
            suggestedKind: "brokerage",
          },
          rows: [r],
        });
      }
    }
    for (const g of byId.values()) {
      g.det.rowCount = g.rows.length;
      g.det.totalValue = g.rows.reduce((s, r) => s + (r.include ? (r.value ?? 0) : 0), 0);
      const src = result?.accounts.find((a) => a.id === g.det.id);
      if (src) g.det.suggestedKind = src.suggestedKind;
    }
    return [...byId.values()];
  }, [rows, result, targetAccount]);

  const ingest = (text: string) => {
    setError(null);
    let res: ImportParseResult;
    try {
      res = parseHoldingsText(text);
    } catch {
      setError("Couldn't read that file. Is it the positions/holdings CSV (not a PDF or statement)?");
      return;
    }
    if (res.unmapped) {
      if (res.raw.length < 2) {
        setError("That doesn't look like a positions file — no rows with a ticker and share count were found.");
        return;
      }
      setResult(res);
      setMapping(guessColumnMapping(res.headers));
      setStep("map");
      return;
    }
    if (res.rows.length === 0) {
      setError(
        res.raw.some((r) => r.some((c) => /trade date|transaction/i.test(c)))
          ? "That looks like a transaction history. Download the POSITIONS (holdings) file instead — it lists what you own right now."
          : "No holdings found in that file.",
      );
      return;
    }
    seed(res, res.rows);
  };

  const seed = (res: ImportParseResult, parsed: ImportedRow[]) => {
    setResult(res);
    setRows(parsed);
    const d: Record<string, Dest> = {};
    const m: Record<string, "update" | "replace"> = {};
    const ids = targetAccount ? ["__target__"] : [...new Set(parsed.map((r) => r.accountId ?? "__single__"))];
    for (const id of ids) {
      if (targetAccount) {
        d[id] = { mode: "existing", accountId: targetAccount.id };
        m[id] = "update";
        continue;
      }
      const det = res.accounts.find((a) => a.id === id) ?? { id, name: null, rowCount: 0, totalValue: 0, suggestedKind: "brokerage" as AccountKind };
      const hit = matchExisting(det, household.accounts);
      d[id] = hit ? { mode: "existing", accountId: hit.id } : { mode: "new", kind: det.suggestedKind, owner: "self" };
      m[id] = "update";
    }
    setDests(d);
    setMerge(m);
    setStep("preview");
  };

  const onFile = async (f: File | undefined | null) => {
    if (!f) return;
    try {
      ingest(await f.text());
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const applyMap = () => {
    if (!result || mapping.symbol == null || mapping.shares == null) return;
    const { rows: mapped } = applyColumnMapping(result.raw, result.headerRowIndex, mapping as ColumnMapping);
    if (mapped.length === 0) {
      setError("Those columns didn't yield any holdings — double-check the symbol and shares columns.");
      return;
    }
    seed({ ...result, unmapped: false }, mapped);
  };

  const doImport = () => {
    const next: Account[] = household.accounts.map((a) => ({ ...a, holdings: a.holdings ? [...a.holdings] : undefined }));
    let imported = 0;
    let totalValue = 0;
    let accountCount = 0;
    for (const g of groups) {
      const dest = dests[targetAccount ? "__target__" : g.det.id];
      if (!dest) continue;
      const included = g.rows.filter((r) => r.include);
      if (included.length === 0) continue;
      accountCount++;
      let acct: Account;
      if (dest.mode === "existing") {
        const found = next.find((a) => a.id === dest.accountId);
        if (!found) continue;
        acct = found;
      } else {
        acct = {
          id: `a${Date.now()}-${accountCount}`,
          label: g.det.name || `${result?.brokerLabel ?? "Imported"} ${ACCOUNT_KIND_META[dest.kind].label}`,
          kind: dest.kind,
          owner: dest.owner,
          balance: 0,
          holdings: [],
        };
        next.push(acct);
      }
      const taxable = bucketOf(acct.kind) === "taxable";
      const incoming = included.map((r) => rowToHolding(r, { taxable }));
      const mergedHoldings = mergeHoldings(acct.holdings ?? [], incoming, merge[targetAccount ? "__target__" : g.det.id] ?? "update");
      Object.assign(acct, syncAccountFromHoldings({ ...acct, holdings: mergedHoldings }));
      imported += incoming.length;
      totalValue += included.reduce((s, r) => s + (r.value ?? 0), 0);
    }
    setAccounts(next);
    setSummary({ holdings: imported, accounts: accountCount, total: totalValue });
    setStep("done");
  };

  const privacy = (
    <p className="mt-3 text-[11px] leading-snug text-foreground/50">
      🔒 Your file is read right here on your device — it never leaves it. Only ticker symbols are ever looked up, to
      fetch prices.
    </p>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="scrim-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="sheet-panel relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/15" />

        {step === "pick" && (
          <>
            <h2 className="text-lg font-semibold">
              {targetAccount ? `Update “${targetAccount.label}” from a CSV` : "Import from your brokerage"}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              Download your <strong>positions</strong> (holdings) file from Fidelity, Schwab, Vanguard, or any broker —
              not the transaction history — and open it here. Or paste rows copied straight off your positions page.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
              className={`press mt-4 w-full rounded-2xl border-2 border-dashed p-6 text-center ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <div className="text-2xl" aria-hidden>
                ⬇️
              </div>
              <div className="mt-1 text-[14px] font-semibold">Choose your CSV file</div>
              <div className="mt-0.5 text-[11px] text-foreground/50">…or drag it onto this box</div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {pasteOpen ? (
              <div className="mt-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                  placeholder={"Paste rows copied from your positions page or a spreadsheet…"}
                  className={`${INPUT} font-mono text-[12px]`}
                />
                <button
                  onClick={() => pasteText.trim() && ingest(pasteText)}
                  className="press mt-2 w-full rounded-xl bg-primary py-2 text-[13px] font-semibold text-background"
                >
                  Read what I pasted
                </button>
              </div>
            ) : (
              <button onClick={() => setPasteOpen(true)} className="press mt-2 w-full rounded-xl border border-border py-2 text-[12px] font-medium text-foreground/60">
                Or paste it instead
              </button>
            )}
            {error && <div className="mt-3 rounded-xl bg-tax/10 px-3 py-2 text-[12px] leading-snug text-tax">{error}</div>}
            <div className="mt-4 space-y-1">
              <Info q="How do I download this from Fidelity?" sources={[SOURCES.fidelityPositions]}>
                Log in on a computer → <strong>Accounts &amp; Trade → Portfolio</strong> → the <strong>Positions</strong>{" "}
                tab → the small <strong>download icon</strong> at the top right of the positions table. It saves a CSV of
                every account — open that file here. (One file can carry all your Fidelity accounts; we&apos;ll sort them
                out.)
              </Info>
              <Info q="How do I download this from Schwab (or old TD Ameritrade)?" sources={[SOURCES.schwabPositions]}>
                Log in on a computer → <strong>Accounts → Positions</strong> → the <strong>Export</strong> link at the top
                right of the table → keep CSV. Former TD Ameritrade accounts now live at Schwab and export the same way.
              </Info>
              <Info q="How do I download this from Vanguard?" sources={[SOURCES.vanguardDownload]}>
                Log in → <strong>My accounts → Transaction history → Download center</strong> → choose a{" "}
                <strong>spreadsheet-compatible CSV</strong> and include <strong>holdings</strong>. The file has your
                holdings up top (we ignore the transactions part below them).
              </Info>
            </div>
            {privacy}
          </>
        )}

        {step === "map" && result && (
          <>
            <h2 className="text-lg font-semibold">Which column is which?</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">
              We didn&apos;t recognize this layout — point us at the right columns and we&apos;ll take it from there.
            </p>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["symbol", "Ticker symbol", true],
                  ["shares", "Shares / quantity", true],
                  ["costBasis", "Cost basis (optional)", false],
                  ["value", "Value (optional)", false],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-[12px] font-medium text-foreground/60">{label}</span>
                  <select
                    className={`${INPUT} mt-1`}
                    value={mapping[key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">—</option>
                    {result.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-border p-2 text-[11px] text-foreground/60">
              {result.raw.slice(result.headerRowIndex, result.headerRowIndex + 4).map((r, i) => (
                <div key={i} className="truncate">
                  {r.join(" · ")}
                </div>
              ))}
            </div>
            {error && <div className="mt-3 rounded-xl bg-tax/10 px-3 py-2 text-[12px] text-tax">{error}</div>}
            <button
              onClick={applyMap}
              disabled={mapping.symbol == null || mapping.shares == null}
              className={`press mt-3 w-full rounded-xl py-2.5 text-[13px] font-semibold ${mapping.symbol != null && mapping.shares != null ? "bg-primary text-background" : "bg-foreground/10 text-foreground/40"}`}
            >
              Continue
            </button>
          </>
        )}

        {step === "preview" && result && (
          <>
            <h2 className="text-lg font-semibold">
              Found {rows.filter((r) => r.include).length} investments
              {groups.length > 1 ? ` across ${groups.length} accounts` : ""} —{" "}
              {money(groups.reduce((s, g) => s + g.det.totalValue, 0))}
            </h2>
            <p className="mt-1 text-[12px] text-foreground/55">
              From your {result.brokerLabel} file. Uncheck anything you don&apos;t want; pick where each account&apos;s
              holdings should land.
            </p>
            {result.warnings.map((w) => (
              <p key={w} className="mt-1 text-[11px] text-foreground/45">
                ℹ️ {w}
              </p>
            ))}
            <div className="mt-3 space-y-3">
              {groups.map((g) => {
                const gid = targetAccount ? "__target__" : g.det.id;
                const dest = dests[gid];
                const destAcct = dest?.mode === "existing" ? household.accounts.find((a) => a.id === dest.accountId) : null;
                const hasExistingHoldings = !!destAcct?.holdings?.length;
                return (
                  <div key={gid} className="rounded-2xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">
                          {g.det.name || (gid === "__single__" ? "Your holdings" : gid)}
                        </div>
                        <div className="text-[11px] text-foreground/50">
                          {g.rows.filter((r) => r.include).length} holdings · {money(g.det.totalValue)}
                        </div>
                      </div>
                    </div>
                    {!targetAccount && dest && (
                      <div className="mt-2">
                        <span className="text-[11px] font-medium text-foreground/55">Into:</span>
                        <select
                          className={`${INPUT} mt-1`}
                          value={dest.mode === "existing" ? dest.accountId : "__new__"}
                          onChange={(e) =>
                            setDests((d) => ({
                              ...d,
                              [gid]:
                                e.target.value === "__new__"
                                  ? { mode: "new", kind: g.det.suggestedKind, owner: "self" }
                                  : { mode: "existing", accountId: e.target.value },
                            }))
                          }
                        >
                          <option value="__new__">＋ New account — {ACCOUNT_KIND_META[g.det.suggestedKind].label}</option>
                          {household.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label} ({ACCOUNT_KIND_META[a.kind].label})
                            </option>
                          ))}
                        </select>
                        {dest.mode === "new" && (
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                            <select
                              className={INPUT}
                              value={dest.kind}
                              onChange={(e) => setDests((d) => ({ ...d, [gid]: { ...dest, kind: e.target.value as AccountKind } }))}
                              aria-label="New account type"
                            >
                              {KIND_CHOICES.map((k) => (
                                <option key={k} value={k}>
                                  {ACCOUNT_KIND_META[k].label}
                                </option>
                              ))}
                            </select>
                            <div className="flex gap-1">
                              {(["self", "spouse"] as const).map((o) => (
                                <button
                                  key={o}
                                  onClick={() => setDests((d) => ({ ...d, [gid]: { ...dest, owner: o } }))}
                                  className={`press rounded-xl border px-2.5 text-[12px] ${dest.owner === o ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/60"}`}
                                >
                                  {o === "self" ? household.self.label || "You" : household.spouse.label || "Spouse"}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {(hasExistingHoldings || targetAccount) && (
                      <div className="mt-2 flex gap-1.5">
                        {(
                          [
                            ["update", "Update matching & add new"],
                            ["replace", "Replace its holdings"],
                          ] as const
                        ).map(([k, label]) => (
                          <button
                            key={k}
                            onClick={() => setMerge((m) => ({ ...m, [gid]: k }))}
                            className={`press rounded-xl border px-2.5 py-1.5 text-[11px] ${(merge[gid] ?? "update") === k ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground/60"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 divide-y divide-border/50">
                      {g.rows.map((r, i) => (
                        <label key={i} className="flex items-start gap-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={r.include}
                            onChange={(e) => setRows((rs) => rs.map((x) => (x === r ? { ...x, include: e.target.checked } : x)))}
                            className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[13px] font-semibold">
                                {r.symbol || (
                                  <span>
                                    {(r.description || "—").slice(0, 28)} <span className="rounded bg-foreground/10 px-1 text-[9px] font-medium text-foreground/55">fixed $</span>
                                  </span>
                                )}
                              </span>
                              <span className="tabular shrink-0 text-[12px] text-foreground/70">{r.value != null ? money(Math.round(r.value)) : "—"}</span>
                            </span>
                            <span className="block truncate text-[10px] text-foreground/45">
                              {r.symbol ? r.description : ""}
                              {r.shares != null && r.symbol ? ` · ${r.shares} sh` : ""}
                              {r.costPerShare != null ? ` · cost $${Math.round(r.costPerShare)}/sh` : ""}
                            </span>
                            {r.problem && <span className="block text-[10px] leading-snug text-amber-600 dark:text-amber-400">{r.problem}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={doImport}
              disabled={rows.every((r) => !r.include)}
              className={`press mt-4 w-full rounded-xl py-2.5 text-[14px] font-semibold ${rows.some((r) => r.include) ? "bg-primary text-background" : "bg-foreground/10 text-foreground/40"}`}
            >
              Import {rows.filter((r) => r.include).length} holdings
            </button>
            {privacy}
          </>
        )}

        {step === "done" && summary && (
          <>
            <h2 className="text-lg font-semibold">✅ Imported</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-foreground/75">
              <strong>{summary.holdings} holdings</strong>
              {summary.accounts > 1 ? (
                <>
                  {" "}
                  into <strong>{summary.accounts} accounts</strong>
                </>
              ) : null}{" "}
              — about <strong>{money(Math.round(summary.total))}</strong>. Prices refresh automatically each day; your
              balances now move with the market.
            </p>
            {rows.some((r) => !r.include && r.problem) && (
              <div className="mt-3 rounded-xl border border-border p-2.5">
                <div className="text-[11px] font-semibold text-foreground/60">Left out (you can add these by hand)</div>
                {rows
                  .filter((r) => !r.include && r.problem)
                  .map((r, i) => (
                    <p key={i} className="mt-1 text-[11px] leading-snug text-foreground/50">
                      {r.rawSymbol || r.description}: {r.problem}
                    </p>
                  ))}
              </div>
            )}
            <p className="mt-2 text-[12px] leading-snug text-foreground/55">
              Next time your statement changes, just download a fresh file and use{" "}
              <strong>“⟳ Update from CSV”</strong> on the account — matching holdings update in place and your manual
              tweaks are kept.
            </p>
            <button onClick={onClose} className="press mt-4 w-full rounded-xl bg-primary py-2.5 text-[14px] font-semibold text-background">
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
