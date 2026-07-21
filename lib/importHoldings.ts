/**
 * Brokerage POSITIONS-file import — the "stop typing your portfolio in by hand"
 * path. Parses the holdings/positions CSV every major brokerage lets you
 * download (Fidelity, Schwab incl. former TD Ameritrade, Vanguard), plus a
 * generic column-mapped fallback that covers pasted rows from any positions
 * web page or spreadsheet (E*TRADE, Merrill, Robinhood screens, Sheets…).
 *
 * Positions, not transactions: the app models what you own NOW (ticker,
 * shares, cost basis) — reconstructing lots from transaction history is a
 * different, far larger problem and a worse answer to "what do I have?".
 *
 * PRIVACY: pure functions over a string — the file is read and parsed entirely
 * on-device. Nothing here (or anywhere) uploads it; only ticker symbols are
 * ever looked up against the price feed afterwards.
 *
 * Row philosophy (so the imported total ties to the statement):
 *  - money-market/cash rows (SPAXX, VMFXX, "Cash & Cash Investments"…) become
 *    a cash holding: { type:"cash", ticker:"", price:1, shares:$value };
 *  - unpriceable real money (CUSIP bonds, CDs) imports as a fixed-dollar line
 *    the same way, flagged "won't track a market price";
 *  - options and negative rows (shorts) are EXCLUDED by default with a plain
 *    reason — the Holding model has no honest representation for them.
 */

import { AccountKind, Holding, HoldingType } from "./accounts";

// ─── CSV core ────────────────────────────────────────────────────────────────

/** Tolerant RFC-4180-ish parser: quoted fields, embedded commas/quotes/
 *  newlines, CRLF, and a leading BOM. Returns a grid of trimmed cells. */
export function parseDelimited(text: string, delimiter?: "," | "\t"): string[][] {
  const delim = delimiter ?? sniffDelimiter(text);
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** Tab wins when tabs outnumber commas on the first non-empty lines — covers
 *  clipboard paste from web tables, Excel, and Google Sheets. */
export function sniffDelimiter(text: string): "," | "\t" {
  const head = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).join("\n");
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

// ─── Scalar normalization ────────────────────────────────────────────────────

/** "$1,234.56" → 1234.56 · "(123.45)" → −123.45 · "--"/"N/A"/"" → null.
 *  Strips $, commas, %, and trailing asterisks. */
export function parseMoneyish(s: string | undefined): number | null {
  if (s == null) return null;
  let t = s.trim();
  if (!t || t === "--" || t === "—" || /^n\/?a$/i.test(t)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[$,%\s]/g, "").replace(/\*+$/, "");
  if (t.startsWith("-")) {
    negative = true;
    t = t.slice(1);
  }
  if (!t || !/^[0-9.]+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** SPAXX** → SPAXX · brk.b → BRK-B (Yahoo's dash convention) · trims junk. */
export function normalizeSymbol(raw: string): string {
  let t = (raw ?? "").trim().toUpperCase().replace(/\*+$/, "");
  const dotClass = t.match(/^([A-Z]{1,6})\.([A-Z])$/);
  if (dotClass) t = `${dotClass[1]}-${dotClass[2]}`;
  return t;
}

const CASH_SYMBOLS = new Set([
  "SPAXX", "FDRXX", "FCASH", "FZFXX", "FDLXX", "CORE", // Fidelity
  "VMFXX", "VMRXX", "VUSXX", // Vanguard
  "SWVXX", "SNVXX", "SNSXX", "SNOXX", "SWGXX", // Schwab
  "SPRXX", "QACDS",
]);

export function isCashRow(symbol: string, description: string): boolean {
  if (CASH_SYMBOLS.has(normalizeSymbol(symbol))) return true;
  return /money market|cash & cash investments|cash reserves|cash sweep|core position|held in (fcash|money market)|government cash/i.test(
    description || "",
  );
}

/** OCC-style option symbols ("AAPL 240119C00150000", "-AAPL240119C150"). */
export function isOptionSymbol(raw: string): boolean {
  const t = (raw ?? "").trim().toUpperCase().replace(/^-/, "");
  return /^[A-Z.]{1,6}\s?\d{6}[CP]\d{1,8}(\.\d+)?$/.test(t) || /\s(CALL|PUT)$/i.test(raw ?? "");
}

/** 9-char CUSIP-ish identifiers (bonds/CDs) — real money, but not priceable. */
export function looksLikeCusip(raw: string): boolean {
  const t = (raw ?? "").trim().toUpperCase();
  return /^[0-9A-Z]{9}$/.test(t) && /\d/.test(t) && !/^[A-Z]+$/.test(t);
}

// ─── Row + result types ──────────────────────────────────────────────────────

export interface ImportedRow {
  rawSymbol: string;
  /** Normalized ticker; "" when none usable (cash/fixed-dollar rows). */
  symbol: string;
  description: string;
  shares: number | null;
  price: number | null;
  /** Market value straight from the file. */
  value: number | null;
  costPerShare: number | null;
  kind: "security" | "cash" | "fixed";
  holdingType: HoldingType;
  accountId: string | null;
  accountName: string | null;
  /** Preview checkbox default. */
  include: boolean;
  /** Plain-language reason shown in the preview (skips, caveats). */
  problem?: string;
}

export interface DetectedAccount {
  id: string;
  name: string | null;
  rowCount: number;
  totalValue: number;
  suggestedKind: AccountKind;
}

export interface ImportParseResult {
  broker: "fidelity" | "schwab" | "vanguard" | "generic";
  brokerLabel: string;
  rows: ImportedRow[];
  /** ≥1 — single-account files get one synthetic entry. */
  accounts: DetectedAccount[];
  warnings: string[];
  headers: string[];
  headerRowIndex: number;
  /** Generic file where symbol+shares couldn't be found → show the mapping UI. */
  unmapped: boolean;
  /** Parsed grid, for the mapping step. */
  raw: string[][];
}

// ─── Shared row assembly ─────────────────────────────────────────────────────

interface RawPosition {
  symbol: string;
  description: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  costPerShare: number | null;
  costTotal: number | null;
  typeHint?: string;
  accountId: string | null;
  accountName: string | null;
}

function holdingTypeFor(symbol: string, typeHint?: string): HoldingType {
  const hint = (typeHint ?? "").toLowerCase();
  if (/bond/.test(hint)) return "bond_fund";
  if (/etf/.test(hint)) return "etf";
  if (/mutual|fund/.test(hint)) return "mutual_fund";
  if (/cash|money market/.test(hint)) return "cash";
  // US mutual-fund tickers are 5 letters ending in X (FXAIX, VTSAX…).
  if (/^[A-Z]{4}X$/.test(symbol)) return "mutual_fund";
  return "stock";
}

function toImportedRow(p: RawPosition): ImportedRow {
  const symbol = normalizeSymbol(p.symbol);
  const value = p.value ?? (p.shares != null && p.price != null ? p.shares * p.price : null);
  const base: ImportedRow = {
    rawSymbol: p.symbol,
    symbol,
    description: p.description,
    shares: p.shares,
    price: p.price,
    value,
    costPerShare: p.costPerShare ?? (p.costTotal != null && p.shares ? p.costTotal / p.shares : null),
    kind: "security",
    holdingType: holdingTypeFor(symbol, p.typeHint),
    accountId: p.accountId,
    accountName: p.accountName,
    include: true,
  };
  if (isOptionSymbol(p.symbol)) {
    return { ...base, kind: "fixed", include: false, problem: "An options contract — the planner doesn't model options. Excluded." };
  }
  if ((value ?? 0) < 0 || (p.shares ?? 0) < 0) {
    return { ...base, kind: "fixed", include: false, problem: "A negative/short position — excluded (the planner has no honest way to model it)." };
  }
  if (isCashRow(p.symbol, p.description)) {
    return {
      ...base,
      kind: "cash",
      symbol: "",
      holdingType: "cash",
      shares: value,
      price: 1,
      costPerShare: null,
      problem: undefined,
    };
  }
  if (!symbol || looksLikeCusip(symbol)) {
    if ((value ?? 0) > 0) {
      return {
        ...base,
        kind: "fixed",
        symbol: "",
        holdingType: "cash",
        shares: value,
        price: 1,
        costPerShare: null,
        problem: "No ticker (a bond/CD?) — imported as a fixed dollar amount; it won't track a market price.",
      };
    }
    return { ...base, kind: "fixed", include: false, problem: "Couldn't read a ticker or a value from this row." };
  }
  if (p.shares == null || p.shares <= 0) {
    if ((value ?? 0) > 0) {
      return { ...base, shares: null, problem: "No share count in the file — we'll import its dollar value as a fixed amount.", kind: "fixed", symbol: "", holdingType: "cash", price: 1 };
    }
    return { ...base, include: false, problem: "No share count or value on this row." };
  }
  return base;
}

/** Name → account-kind heuristics (first match wins). */
export function suggestAccountKind(name: string): AccountKind {
  const n = (name ?? "").toLowerCase();
  if (/roth/.test(n)) return "roth_ira";
  if (/rollover/.test(n)) return "rollover_401k";
  if (/401\s?\(?k\)?/.test(n)) return "traditional_401k";
  if (/403/.test(n)) return "traditional_403b";
  if (/457/.test(n)) return "govt_457b";
  if (/\btsp\b/.test(n)) return "tsp_traditional";
  if (/\bsep\b/.test(n)) return "sep_ira";
  if (/simple/.test(n)) return "simple_ira";
  if (/\bira\b|traditional|contributory|rollover/.test(n)) return "traditional_ira";
  if (/checking|savings|cash management|\bcma\b/.test(n)) return "cash";
  return "brokerage";
}

function buildAccounts(rows: ImportedRow[]): DetectedAccount[] {
  const byId = new Map<string, DetectedAccount>();
  for (const r of rows) {
    const id = r.accountId ?? "__single__";
    const cur = byId.get(id) ?? {
      id,
      name: r.accountName,
      rowCount: 0,
      totalValue: 0,
      suggestedKind: suggestAccountKind(r.accountName ?? ""),
    };
    cur.rowCount++;
    cur.totalValue += r.include ? (r.value ?? 0) : 0;
    byId.set(id, cur);
  }
  return [...byId.values()];
}

// ─── Broker adapters ─────────────────────────────────────────────────────────

interface BrokerAdapter {
  id: ImportParseResult["broker"];
  label: string;
  /** > 0 = recognized; the highest score wins. */
  detect(grid: string[][]): number;
  extract(grid: string[][]): { rows: ImportedRow[]; warnings: string[]; headers: string[]; headerRowIndex: number };
}

const idx = (headers: string[], ...names: string[]) => {
  const lower = headers.map((h) => h.toLowerCase());
  for (const n of names) {
    const i = lower.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
};

const fidelityAdapter: BrokerAdapter = {
  id: "fidelity",
  label: "Fidelity",
  detect(grid) {
    const h = (grid[0] ?? []).map((c) => c.toLowerCase());
    const has = (n: string) => h.some((c) => c.includes(n));
    return has("account number") && has("symbol") && has("quantity") && (has("last price") || has("current value")) ? 10 : 0;
  },
  extract(grid) {
    const headers = grid[0];
    const warnings: string[] = [];
    const cSym = idx(headers, "symbol");
    const cDesc = idx(headers, "description");
    const cQty = idx(headers, "quantity");
    const cPrice = idx(headers, "last price");
    const cValue = idx(headers, "current value");
    const cAvgCost = idx(headers, "average cost basis");
    const cCostTotal = idx(headers, "cost basis total");
    const cAcctNum = idx(headers, "account number");
    const cAcctName = idx(headers, "account name");
    const rows: ImportedRow[] = [];
    let skippedPending = 0;
    let footer = 0;
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      // Everything after the first blank line is Fidelity's disclaimer footer.
      if (r.every((c) => !c)) {
        footer = grid.length - i - 1;
        break;
      }
      const sym = r[cSym] ?? "";
      const desc = (cDesc >= 0 ? r[cDesc] : "") ?? "";
      if (/pending activity/i.test(sym) || /pending activity/i.test(desc)) {
        skippedPending++;
        continue;
      }
      if (!sym && !desc) continue;
      rows.push(
        toImportedRow({
          symbol: sym,
          description: desc,
          shares: parseMoneyish(r[cQty]),
          price: cPrice >= 0 ? parseMoneyish(r[cPrice]) : null,
          value: cValue >= 0 ? parseMoneyish(r[cValue]) : null,
          costPerShare: cAvgCost >= 0 ? parseMoneyish(r[cAvgCost]) : null,
          costTotal: cCostTotal >= 0 ? parseMoneyish(r[cCostTotal]) : null,
          // NOTE: Fidelity's "Type" column is the ACCOUNT type (Cash/Margin),
          // not the security type — never use it as a holding-type hint.
          typeHint: undefined,
          accountId: cAcctNum >= 0 ? r[cAcctNum] || null : null,
          accountName: cAcctName >= 0 ? r[cAcctName] || null : null,
        }),
      );
    }
    if (skippedPending) warnings.push(`Skipped ${skippedPending} "Pending Activity" row${skippedPending > 1 ? "s" : ""} (unsettled cash — not a holding).`);
    if (footer > 0) warnings.push(`Ignored ${footer} disclaimer line${footer > 1 ? "s" : ""} at the end of the file.`);
    return { rows, warnings, headers, headerRowIndex: 0 };
  },
};

const schwabAdapter: BrokerAdapter = {
  id: "schwab",
  label: "Schwab",
  detect(grid) {
    const first = (grid[0]?.[0] ?? "").toLowerCase();
    if (/^"?positions for /.test(first)) return 10;
    for (const row of grid.slice(0, 4)) {
      const h = row.map((c) => c.toLowerCase());
      const has = (n: string) => h.some((c) => c.includes(n));
      if (has("symbol") && (has("qty") || has("quantity")) && (has("mkt val") || has("market value"))) return 8;
    }
    return 0;
  },
  extract(grid) {
    const warnings: string[] = [];
    const rows: ImportedRow[] = [];
    let headers: string[] = [];
    let headerRowIndex = 0;
    let acctId: string | null = null;
    let acctName: string | null = null;
    let cols: { sym: number; desc: number; qty: number; price: number; value: number; costTotal: number; type: number } | null = null;
    let totals = 0;
    for (let i = 0; i < grid.length; i++) {
      const r = grid[i];
      const first = r[0] ?? "";
      const sectionMatch = first.match(/^positions for (?:account )?(.+?)(?: as of.*)?$/i);
      if (sectionMatch) {
        // "Positions for account Roth Contributory IRA XXXX-1234 as of ..."
        const label = sectionMatch[1].trim();
        const num = label.match(/([X\d]{2,}[-–][\d]{2,4})\s*$/);
        acctId = num ? num[1] : label;
        acctName = num ? label.replace(num[1], "").trim() || label : label;
        cols = null; // next header row redefines the columns for this section
        continue;
      }
      const lower = r.map((c) => c.toLowerCase());
      const has = (n: string) => lower.some((c) => c.includes(n));
      if (has("symbol") && (has("qty") || has("quantity"))) {
        headers = r;
        headerRowIndex = i;
        cols = {
          sym: idx(r, "symbol"),
          desc: idx(r, "description"),
          qty: idx(r, "qty", "quantity"),
          price: idx(r, "price"),
          value: idx(r, "mkt val", "market value"),
          costTotal: idx(r, "cost basis"),
          type: idx(r, "security type"),
        };
        continue;
      }
      if (!cols) continue;
      const sym = r[cols.sym] ?? "";
      const desc = (cols.desc >= 0 ? r[cols.desc] : "") ?? "";
      if (!sym && !desc) continue;
      if (/^(account )?total/i.test(sym) || /^(account )?total/i.test(desc)) {
        totals++;
        continue;
      }
      rows.push(
        toImportedRow({
          symbol: /cash & cash investments/i.test(sym) ? "" : sym,
          description: /cash & cash investments/i.test(sym) ? sym : desc,
          shares: parseMoneyish(r[cols.qty]),
          price: cols.price >= 0 ? parseMoneyish(r[cols.price]) : null,
          value: cols.value >= 0 ? parseMoneyish(r[cols.value]) : null,
          costPerShare: null,
          costTotal: cols.costTotal >= 0 ? parseMoneyish(r[cols.costTotal]) : null,
          typeHint: cols.type >= 0 ? r[cols.type] : undefined,
          accountId: acctId,
          accountName: acctName,
        }),
      );
    }
    if (totals) warnings.push(`Skipped ${totals} total row${totals > 1 ? "s" : ""} (we compute totals from the holdings).`);
    return { rows, warnings, headers, headerRowIndex };
  },
};

const vanguardAdapter: BrokerAdapter = {
  id: "vanguard",
  label: "Vanguard",
  detect(grid) {
    for (const row of grid.slice(0, 3)) {
      const h = row.map((c) => c.toLowerCase());
      const has = (n: string) => h.some((c) => c === n || c.includes(n));
      if (has("investment name") && has("symbol") && has("shares") && (has("share price") || has("total value"))) return 10;
    }
    return 0;
  },
  extract(grid) {
    const warnings: string[] = [];
    const rows: ImportedRow[] = [];
    let headerRowIndex = grid.findIndex((r) => r.some((c) => /investment name/i.test(c)));
    if (headerRowIndex < 0) headerRowIndex = 0;
    const headers = grid[headerRowIndex];
    const cAcct = idx(headers, "account number");
    const cName = idx(headers, "investment name");
    const cSym = idx(headers, "symbol");
    const cShares = idx(headers, "shares");
    const cPrice = idx(headers, "share price");
    const cValue = idx(headers, "total value");
    let sawTransactions = false;
    for (let i = headerRowIndex + 1; i < grid.length; i++) {
      const r = grid[i];
      if (r.every((c) => !c)) {
        // The download-center file appends a transactions section after a blank
        // line — positions only; ignore the rest.
        sawTransactions = grid.slice(i + 1).some((row) => row.some((c) => /trade date|transaction/i.test(c)));
        break;
      }
      const sym = r[cSym] ?? "";
      const name = (cName >= 0 ? r[cName] : "") ?? "";
      if (!sym && !name) continue;
      rows.push(
        toImportedRow({
          symbol: sym,
          description: name,
          shares: parseMoneyish(r[cShares]),
          price: cPrice >= 0 ? parseMoneyish(r[cPrice]) : null,
          value: cValue >= 0 ? parseMoneyish(r[cValue]) : null,
          costPerShare: null,
          costTotal: null,
          typeHint: undefined,
          accountId: cAcct >= 0 ? r[cAcct] || null : null,
          accountName: cAcct >= 0 && r[cAcct] ? `Vanguard ${r[cAcct]}` : null,
        }),
      );
    }
    if (sawTransactions) warnings.push("Ignored the transactions section — we import current holdings, not history.");
    return { rows, warnings, headers, headerRowIndex };
  },
};

const ADAPTERS: BrokerAdapter[] = [fidelityAdapter, schwabAdapter, vanguardAdapter];

// ─── Generic fallback: fuzzy column mapping ──────────────────────────────────

export interface ColumnMapping {
  symbol: number;
  shares: number;
  costBasis?: number;
  price?: number;
  value?: number;
  description?: number;
}

export function guessColumnMapping(headers: string[]): Partial<ColumnMapping> {
  const out: Partial<ColumnMapping> = {};
  const sym = idx(headers, "symbol", "ticker");
  const shares = idx(headers, "qty", "quantity", "shares", "units");
  const cost = idx(headers, "average cost", "avg cost", "cost basis", "cost/share", "cost per share");
  const price = idx(headers, "last price", "price");
  const value = idx(headers, "current value", "market value", "mkt val", "total value", "value");
  const desc = idx(headers, "description", "name");
  if (sym >= 0) out.symbol = sym;
  if (shares >= 0) out.shares = shares;
  if (cost >= 0) out.costBasis = cost;
  if (price >= 0 && price !== cost) out.price = price;
  if (value >= 0) out.value = value;
  if (desc >= 0) out.description = desc;
  return out;
}

export function applyColumnMapping(
  raw: string[][],
  headerRowIndex: number,
  map: ColumnMapping,
): { rows: ImportedRow[]; warnings: string[] } {
  const rows: ImportedRow[] = [];
  for (let i = headerRowIndex + 1; i < raw.length; i++) {
    const r = raw[i];
    if (r.every((c) => !c)) continue;
    const sym = r[map.symbol] ?? "";
    const desc = map.description != null ? (r[map.description] ?? "") : "";
    if (!sym && !desc) continue;
    // Skip obvious non-position rows (totals, disclaimers spilling into col 0).
    if (/^(account )?total|^disclaimer|^past performance|^date generated/i.test(sym + desc)) continue;
    const costRaw = map.costBasis != null ? parseMoneyish(r[map.costBasis]) : null;
    const shares = parseMoneyish(r[map.shares]);
    // A "cost basis" column might be per-share or total — treat values larger
    // than 20× the price as totals.
    const price = map.price != null ? parseMoneyish(r[map.price]) : null;
    const perShare = costRaw != null && shares ? (price != null && costRaw > price * 20 ? costRaw / shares : costRaw) : null;
    rows.push(
      toImportedRow({
        symbol: sym,
        description: desc,
        shares,
        price,
        value: map.value != null ? parseMoneyish(r[map.value]) : null,
        costPerShare: perShare,
        costTotal: null,
        typeHint: undefined,
        accountId: null,
        accountName: null,
      }),
    );
  }
  return { rows, warnings: [] };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function parseHoldingsText(text: string): ImportParseResult {
  // Keep blank rows — they're structural (Fidelity's footer break, Vanguard's
  // holdings/transactions separator). Adapters handle them explicitly.
  const grid = parseDelimited(text);
  let best: BrokerAdapter | null = null;
  let bestScore = 0;
  for (const a of ADAPTERS) {
    const s = a.detect(grid);
    if (s > bestScore) {
      best = a;
      bestScore = s;
    }
  }
  if (best) {
    const { rows, warnings, headers, headerRowIndex } = best.extract(grid);
    return {
      broker: best.id,
      brokerLabel: best.label,
      rows,
      accounts: buildAccounts(rows),
      warnings,
      headers,
      headerRowIndex,
      unmapped: false,
      raw: grid,
    };
  }
  // Generic: find the first plausible header row, auto-map when symbol+shares
  // are identifiable, otherwise hand back the grid for the mapping UI.
  let headerRowIndex = 0;
  let guess: Partial<ColumnMapping> = {};
  for (let i = 0; i < Math.min(grid.length, 8); i++) {
    const g = guessColumnMapping(grid[i]);
    if (g.symbol != null && g.shares != null) {
      headerRowIndex = i;
      guess = g;
      break;
    }
  }
  const headers = grid[headerRowIndex] ?? [];
  if (guess.symbol != null && guess.shares != null) {
    const { rows, warnings } = applyColumnMapping(grid, headerRowIndex, guess as ColumnMapping);
    return {
      broker: "generic",
      brokerLabel: "your file",
      rows,
      accounts: buildAccounts(rows),
      warnings,
      headers,
      headerRowIndex,
      unmapped: false,
      raw: grid,
    };
  }
  return {
    broker: "generic",
    brokerLabel: "your file",
    rows: [],
    accounts: [],
    warnings: [],
    headers,
    headerRowIndex,
    unmapped: true,
    raw: grid,
  };
}

// ─── To the app's model ──────────────────────────────────────────────────────

export function rowToHolding(row: ImportedRow, opts: { taxable: boolean }): Holding {
  if (row.kind !== "security") {
    return {
      ticker: "",
      name: row.description || (row.kind === "cash" ? "Cash / money market" : "Fixed-value holding"),
      type: "cash",
      shares: Math.max(0, row.value ?? row.shares ?? 0),
      price: 1,
    };
  }
  return {
    ticker: row.symbol,
    name: row.description || row.symbol,
    type: row.holdingType,
    shares: row.shares ?? 0,
    price: row.price ?? (row.value != null && row.shares ? row.value / row.shares : 0),
    ...(opts.taxable && row.costPerShare != null ? { costPerShare: row.costPerShare } : {}),
  };
}

/**
 * Merge imported holdings into an account's existing ones.
 *  - "update" (the re-import/sync default): match by ticker (ticker-less rows
 *    by name) — refresh shares/price/costPerShare, PRESERVE the user's manual
 *    dividend overrides, append new positions, keep unmatched existing ones.
 *    Idempotent: importing the same file twice changes nothing the second time.
 *  - "replace": the file becomes the account's holdings, wholesale.
 */
export function mergeHoldings(existing: Holding[], incoming: Holding[], strategy: "update" | "replace"): Holding[] {
  if (strategy === "replace") return incoming;
  const key = (h: Holding) => (h.ticker ? `t:${h.ticker}` : `n:${h.name.toLowerCase()}`);
  const out = existing.map((h) => ({ ...h }));
  const byKey = new Map(out.map((h) => [key(h), h]));
  for (const inc of incoming) {
    const cur = byKey.get(key(inc));
    if (cur) {
      cur.shares = inc.shares;
      cur.price = inc.price;
      if (inc.costPerShare != null) cur.costPerShare = inc.costPerShare;
      // dividendPerShare/dividendGrowthRate/dividendManual/dividendOrdinary stay.
    } else {
      out.push({ ...inc });
      byKey.set(key(inc), out[out.length - 1]);
    }
  }
  return out;
}

// ─── Quick-add: "AAPL 100" lines (shared with the holdings editor) ───────────

export function parseTickerSharesList(text: string): {
  rows: { symbol: string; shares: number }[];
  rejected: { line: string; reason: string }[];
} {
  const rows: { symbol: string; shares: number }[] = [];
  const rejected: { line: string; reason: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z.\-]{0,9})[\s,;\t]+([\d,]+(?:\.\d+)?)\s*$/);
    if (!m) {
      rejected.push({ line, reason: "Expected “SYMBOL shares”, e.g. “AAPL 100”." });
      continue;
    }
    const shares = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(shares) || shares <= 0) {
      rejected.push({ line, reason: "Share count must be a positive number." });
      continue;
    }
    rows.push({ symbol: normalizeSymbol(m[1]), shares });
  }
  return { rows, rejected };
}
