/**
 * AUDIT PROBE — brokerage positions-CSV import (lib/importHoldings.ts) + the
 * 40-symbol chunking fix in lib/prices.ts.
 * Run: npx tsx scripts/_audit_import_csv.mts
 *
 * Fixtures mimic each broker's real export quirks: Fidelity's disclaimer
 * footer + Pending Activity + SPAXX** + quoted descriptions with commas;
 * Schwab's multi-account "Positions for account …" sections + Cash & Cash
 * Investments + Account Total rows + BRK.B; Vanguard's holdings section
 * followed by a transactions section. Totals are hand-summed so an import
 * ties to the statement.
 */
import {
  parseDelimited,
  sniffDelimiter,
  parseMoneyish,
  normalizeSymbol,
  isOptionSymbol,
  looksLikeCusip,
  parseHoldingsText,
  guessColumnMapping,
  applyColumnMapping,
  rowToHolding,
  mergeHoldings,
  suggestAccountKind,
  parseTickerSharesList,
  ColumnMapping,
} from "../lib/importHoldings.ts";
import { chunkSymbols } from "../lib/prices.ts";
import type { Holding } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};
const near = (a: number | null, b: number, eps = 0.01) => a != null && Math.abs(a - b) < eps;

// ─── Scalars ─────────────────────────────────────────────────────────────────
check("parseMoneyish $1,234.56", parseMoneyish("$1,234.56") === 1234.56);
check("parseMoneyish (123.45) → −123.45", parseMoneyish("(123.45)") === -123.45);
check("parseMoneyish -- → null and '' → null", parseMoneyish("--") === null && parseMoneyish("") === null);
check("parseMoneyish n/a → null, junk → null", parseMoneyish("N/A") === null && parseMoneyish("abc") === null);
check("normalizeSymbol SPAXX** → SPAXX", normalizeSymbol("SPAXX**") === "SPAXX");
check("normalizeSymbol brk.b → BRK-B", normalizeSymbol("brk.b") === "BRK-B");
check("option OCC long form", isOptionSymbol("AAPL 240119C00150000"));
check("option compact form", isOptionSymbol("-AAPL240119C150"));
check("plain ticker is not an option", !isOptionSymbol("AAPL") && !isOptionSymbol("BRK-B"));
check("CUSIP detected", looksLikeCusip("912828XG0") && !looksLikeCusip("VANGUARD") && !looksLikeCusip("FXAIX"));
check("sniffDelimiter tab paste", sniffDelimiter("Symbol\tShares\nAAPL\t100") === "\t");
check("chunkSymbols 85 → [40,40,5]", JSON.stringify(chunkSymbols(Array.from({ length: 85 }, (_, i) => `S${i}`)).map((c) => c.length)) === "[40,40,5]");
check("parseDelimited quoted comma + CRLF + BOM", (() => {
  const g = parseDelimited('﻿a,"b, c",d\r\ne,"say ""hi""",f');
  return g[0][1] === "b, c" && g[1][1] === 'say "hi"' && g.length === 2;
})());

// ─── Fidelity ────────────────────────────────────────────────────────────────
const FIDELITY = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Average Cost Basis,Type
X12345678,ROTH IRA,AAPL,APPLE INC,100,$200.00,"$20,000.00","$14,000.00",$150.00,Cash
X12345678,ROTH IRA,SPAXX**,FIDELITY GOVERNMENT MONEY MARKET,25000.00,$1.00,"$25,000.00",--,--,Cash
Z98765432,Individual,VTI,"VANGUARD TOTAL MARKET, ETF",50,$260.00,"$13,000.00","$10,000.00",$200.00,Margin
Z98765432,Individual,Pending Activity,,,,"$1,234.00",,,
,,,,,,,,,
"The data and information in this spreadsheet are provided as a courtesy."
"Date downloaded 07/21/2026"`;
const fid = parseHoldingsText(FIDELITY);
check("fidelity: detected", fid.broker === "fidelity" && !fid.unmapped);
check("fidelity: 3 position rows (Pending Activity skipped)", fid.rows.length === 3, `${fid.rows.length}`);
check("fidelity: warnings mention pending + disclaimer", fid.warnings.length === 2, fid.warnings.join(" | "));
const fAapl = fid.rows.find((r) => r.symbol === "AAPL")!;
check("fidelity: AAPL shares/price/value", fAapl.shares === 100 && fAapl.price === 200 && fAapl.value === 20_000);
check("fidelity: avg cost preferred over total/qty (150 not 140)", near(fAapl.costPerShare, 150), `${fAapl.costPerShare}`);
check("fidelity: Type column never misreads securities as cash", fAapl.kind === "security" && fAapl.holdingType === "stock");
const fSpaxx = fid.rows.find((r) => /money market/i.test(r.description))!;
check("fidelity: SPAXX → cash line at $25,000", fSpaxx.kind === "cash" && fSpaxx.symbol === "" && near(fSpaxx.shares, 25_000) && fSpaxx.price === 1);
const fVti = fid.rows.find((r) => r.symbol === "VTI")!;
check("fidelity: quoted comma description intact", fVti.description === "VANGUARD TOTAL MARKET, ETF");
check("fidelity: 2 accounts detected", fid.accounts.length === 2);
const roth = fid.accounts.find((a) => a.id === "X12345678")!;
const indiv = fid.accounts.find((a) => a.id === "Z98765432")!;
check("fidelity: ROTH IRA → roth_ira, ties to $45,000", roth.suggestedKind === "roth_ira" && near(roth.totalValue, 45_000), `${roth.totalValue}`);
check("fidelity: Individual → brokerage, ties to $13,000", indiv.suggestedKind === "brokerage" && near(indiv.totalValue, 13_000));

// ─── Schwab (multi-account sections) ─────────────────────────────────────────
const SCHWAB = `"Positions for account Roth Contributory IRA XXXX-1234 as of 07/20/2026"
Symbol,Description,Qty (Quantity),Price,Mkt Val (Market Value),Cost Basis,Security Type
BRK.B,BERKSHIRE HATHAWAY INC CL B,10,"$450.00","$4,500.00","$4,000.00",Equity
SWVXX,SCHWAB VALUE ADVANTAGE MONEY INV,1000.00,"$1.00","$1,000.00",--,Money Market
Cash & Cash Investments,,,,"$2,500.00",,
Account Total,,,,"$8,000.00",,
"Positions for account Individual XXXX-5678 as of 07/20/2026"
Symbol,Description,Qty (Quantity),Price,Mkt Val (Market Value),Cost Basis,Security Type
VOO,VANGUARD S&P 500 ETF,20,"$500.00","$10,000.00","$8,000.00",ETF
Account Total,,,,"$10,000.00",,`;
const sch = parseHoldingsText(SCHWAB);
check("schwab: detected", sch.broker === "schwab" && !sch.unmapped);
check("schwab: totals skipped with a warning", sch.rows.length === 4 && sch.warnings.some((w) => w.includes("total")), `${sch.rows.length}`);
const sBrk = sch.rows.find((r) => r.symbol === "BRK-B")!;
check("schwab: BRK.B → BRK-B for the price feed", !!sBrk);
check("schwab: cost basis total/qty → $400/share", near(sBrk.costPerShare, 400), `${sBrk.costPerShare}`);
const sVoo = sch.rows.find((r) => r.symbol === "VOO")!;
check("schwab: Security Type ETF honored", sVoo.holdingType === "etf");
check("schwab: SWVXX + Cash & Cash Investments → cash lines", sch.rows.filter((r) => r.kind === "cash").length === 2);
check("schwab: 2 account sections", sch.accounts.length === 2);
const s1234 = sch.accounts.find((a) => a.id === "XXXX-1234")!;
check("schwab: section name → roth_ira, ties to $8,000 statement total", s1234.suggestedKind === "roth_ira" && near(s1234.totalValue, 8_000), `${s1234.totalValue}`);
check("schwab: second section ties to $10,000", near(sch.accounts.find((a) => a.id === "XXXX-5678")!.totalValue, 10_000));

// ─── Vanguard (holdings section + transactions section) ─────────────────────
const VANGUARD = `Account Number,Investment Name,Symbol,Shares,Share Price,Total Value
12345678,Vanguard Total Stock Market Index Fund,VTSAX,100.5,$120.00,"$12,060.00"
12345678,Vanguard Federal Money Market Fund,VMFXX,5000,$1.00,"$5,000.00"

Account Number,Trade Date,Settlement Date,Transaction Type,Transaction Description,Shares,Principal Amount
12345678,07/01/2026,07/02/2026,Buy,Buy,10,"$1,200.00"`;
const van = parseHoldingsText(VANGUARD);
check("vanguard: detected", van.broker === "vanguard");
check("vanguard: transactions section ignored (warned)", van.rows.length === 2 && van.warnings.some((w) => w.includes("transactions")), `${van.rows.length}`);
const vVtsax = van.rows.find((r) => r.symbol === "VTSAX")!;
check("vanguard: VTSAX fractional shares + mutual-fund type", vVtsax.shares === 100.5 && vVtsax.holdingType === "mutual_fund");
check("vanguard: VMFXX → cash $5,000", near(van.rows.find((r) => r.kind === "cash")!.shares, 5_000));

// ─── Generic paste + the mapping fallback ────────────────────────────────────
const PASTE = `Symbol\tName\tShares\tLast Price\tCurrent Value
AAPL\tApple Inc\t100\t$200.00\t$20,000.00
912828XG0\tUS TREASURY NOTE 2.5% 2031\t\t\t$9,800.00
NVDA 260116C00120000\tNVDA CALL\t2\t$5.00\t$1,000.00`;
const gen = parseHoldingsText(PASTE);
check("generic: tab paste auto-mapped", gen.broker === "generic" && !gen.unmapped, `${gen.unmapped}`);
check("generic: AAPL imported", gen.rows.some((r) => r.symbol === "AAPL" && r.kind === "security"));
const gBond = gen.rows.find((r) => /TREASURY/.test(r.description))!;
check("generic: CUSIP bond → fixed-$ line INCLUDED (ties to statement)", gBond.kind === "fixed" && gBond.include && near(gBond.shares, 9_800), gBond.problem ?? "");
const gOpt = gen.rows.find((r) => /CALL/.test(r.description))!;
check("generic: option EXCLUDED with a reason", gOpt.include === false && !!gOpt.problem);
const junk = parseHoldingsText("hello world\nnothing,to,see");
check("generic: unrecognizable → unmapped (mapping UI)", junk.unmapped === true);
const mapping = guessColumnMapping(["Ticker", "Description", "Units", "Avg Cost", "Market Value"]);
check("guessColumnMapping fuzzy names", mapping.symbol === 0 && mapping.shares === 2 && mapping.costBasis === 3 && mapping.value === 4);
const applied = applyColumnMapping(parseDelimited("Ticker,Units\nVTI,25\nTotal,"), 0, { symbol: 0, shares: 1 } as ColumnMapping);
check("applyColumnMapping skips total rows", applied.rows.length === 1 && applied.rows[0].symbol === "VTI");

// ─── rowToHolding + mergeHoldings ────────────────────────────────────────────
const h = rowToHolding(fAapl, { taxable: true });
check("rowToHolding: taxable carries costPerShare", h.costPerShare === 150 && h.ticker === "AAPL" && h.shares === 100);
check("rowToHolding: pre-tax drops costPerShare", rowToHolding(fAapl, { taxable: false }).costPerShare === undefined);
check("rowToHolding: cash row → $1 fixed line", rowToHolding(fSpaxx, { taxable: true }).type === "cash");
const existing: Holding[] = [
  { ticker: "AAPL", name: "Apple", type: "stock", shares: 50, price: 190, dividendPerShare: 2, dividendManual: true },
  { ticker: "MSFT", name: "Microsoft", type: "stock", shares: 10, price: 400 },
];
const incoming: Holding[] = [
  { ticker: "AAPL", name: "APPLE INC", type: "stock", shares: 100, price: 200, costPerShare: 150 },
  { ticker: "VTI", name: "Vanguard", type: "etf", shares: 25, price: 260 },
];
const merged = mergeHoldings(existing, incoming, "update");
check("merge update: shares/price refreshed, dividends preserved", (() => {
  const a = merged.find((x) => x.ticker === "AAPL")!;
  return a.shares === 100 && a.price === 200 && a.dividendPerShare === 2 && a.dividendManual === true;
})());
check("merge update: unmatched existing kept, new appended", merged.length === 3 && merged.some((x) => x.ticker === "MSFT") && merged.some((x) => x.ticker === "VTI"));
check("merge update: idempotent", JSON.stringify(mergeHoldings(merged, incoming, "update")) === JSON.stringify(merged));
check("merge replace: file wins wholesale", mergeHoldings(existing, incoming, "replace").length === 2);

// ─── suggestAccountKind + parseTickerSharesList ──────────────────────────────
check("kinds: rollover beats ira", suggestAccountKind("Rollover IRA") === "rollover_401k");
check("kinds: 401(k), TSP, CMA", suggestAccountKind("My 401(k)") === "traditional_401k" && suggestAccountKind("TSP account") === "tsp_traditional" && suggestAccountKind("Cash Management CMA") === "cash");
const list = parseTickerSharesList("AAPL 100\nVTI, 250.5\nbrk.b\t33\nnope!!\nMSFT -5");
check("paste list: 3 good rows incl. comma/tab/dot-class", list.rows.length === 3 && list.rows[1].shares === 250.5 && list.rows[2].symbol === "BRK-B");
check("paste list: rejects carry reasons", list.rejected.length === 2 && list.rejected.every((r) => r.reason.length > 5));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
