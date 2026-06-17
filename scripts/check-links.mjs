/**
 * Link-rot checker for the citations the app shows users. Extracts every external
 * URL from the source registry (lib/sources.ts) and the Learn "models & methods"
 * cards (app/learn/page.tsx), pings each, and flags anything that looks dead.
 *
 *   node scripts/check-links.mjs
 *
 * Categories: OK (2xx/3xx) · BOT-BLOCKED (403/429 — real link, rejects scrapers) ·
 * DEAD (404/410/5xx/network). Exit code is non-zero only if something is DEAD, so
 * it can gate CI without failing on bot-blocked-but-valid links.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["lib/sources.ts", "app/learn/page.tsx"];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 15000;

async function collectUrls() {
  const found = new Map(); // url -> Set(files)
  for (const rel of FILES) {
    let text;
    try {
      text = await readFile(join(root, rel), "utf8");
    } catch {
      continue;
    }
    // URLs live inside string literals ("..." or `...`); capture to the closing
    // quote so URLs containing parentheses (e.g. "…SWR (1).PDF") aren't truncated.
    for (const m of text.matchAll(/["'`](https?:\/\/[^"'`]+)["'`]/g)) {
      const url = m[1];
      if (!found.has(url)) found.set(url, new Set());
      found.get(url).add(rel);
    }
  }
  return found;
}

async function check(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // GET (not HEAD — many servers reject/ misreport HEAD), but bail after headers.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/pdf,*/*" },
    });
    return { status: res.status };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function classify(status) {
  if (status >= 200 && status < 400) return "OK";
  if (status === 403 || status === 429) return "BOT-BLOCKED";
  return "DEAD";
}

const urls = await collectUrls();
console.log(`Checking ${urls.size} unique URLs from ${FILES.join(", ")}…\n`);

const results = await Promise.all(
  [...urls.keys()].map(async (url) => ({ url, files: [...urls.get(url)], ...(await check(url)) })),
);
results.sort((a, b) => a.url.localeCompare(b.url));

const buckets = { OK: [], "BOT-BLOCKED": [], DEAD: [] };
for (const r of results) buckets[classify(r.status)].push(r);

const icon = { OK: "✅", "BOT-BLOCKED": "🤖", DEAD: "❌" };
for (const cat of ["DEAD", "BOT-BLOCKED", "OK"]) {
  for (const r of buckets[cat]) {
    const code = r.status || r.error;
    console.log(`${icon[cat]} ${String(code).padEnd(8)} ${r.url}`);
  }
}

console.log(
  `\n${buckets.OK.length} OK · ${buckets["BOT-BLOCKED"].length} bot-blocked (real, manual check) · ${buckets.DEAD.length} DEAD`,
);
if (buckets.DEAD.length) {
  console.log("\nDEAD links need attention:");
  for (const r of buckets.DEAD) console.log(`  ${r.url}  (${r.status || r.error}) — in ${r.files.join(", ")}`);
  process.exit(1);
}
