/**
 * AUDIT PROBE — shared input primitives (components/inputs.tsx pure parts).
 * Run: npx tsx scripts/_audit_inputs.mts
 */
import { yearOptions } from "../components/inputs.tsx";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

// Bounds inclusive, recent-first ordering (the year you want is near the top).
const opts = yearOptions(1958, 1962);
check("inclusive bounds, 5 options", opts.length === 5);
check("recent-first", opts[0].value === 1962 && opts[4].value === 1958);
check("default labels are the year", opts[0].label === "1962");

// Age labels do the mental math (a 2026 birth-year picker).
const withAges = yearOptions(1958, 1960, (y) => `${y} — age ${2026 - y}`);
check("age labels correct across the range", withAges.map((o) => o.label).join("|") === "1960 — age 66|1959 — age 67|1958 — age 68");

// A one-year range still renders.
check("degenerate range", yearOptions(2026, 2026).length === 1);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
