/**
 * On-device history of quarterly reviews (one snapshot per quarter, per data
 * mode), so each new report can say what changed "since your last review".
 * localStorage only — like everything else in the app, nothing leaves the
 * device. Every access is guarded: private windows and blocked storage just
 * mean no history, never a broken report.
 */

import { ReviewSnapshot } from "@/lib/quarterly";

const KEY = (mode: "demo" | "own") => `rto-reviews-${mode}`;
const KEEP = 12; // three years of quarters

export function loadReviews(mode: "demo" | "own"): ReviewSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY(mode));
    const list = raw ? (JSON.parse(raw) as ReviewSnapshot[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => a.at - b.at) : [];
  } catch {
    return [];
  }
}

/** Upsert this quarter's snapshot (a later view in the same quarter replaces
 *  it) and return the updated, oldest-first list. */
export function saveReview(mode: "demo" | "own", snap: ReviewSnapshot): ReviewSnapshot[] {
  const list = loadReviews(mode).filter((s) => s.quarter !== snap.quarter);
  list.push(snap);
  list.sort((a, b) => a.at - b.at);
  const trimmed = list.slice(-KEEP);
  try {
    localStorage.setItem(KEY(mode), JSON.stringify(trimmed));
  } catch {
    /* storage unavailable — the report still renders */
  }
  return trimmed;
}

/** The most recent review from an EARLIER quarter than `quarterKey`. */
export function previousReview(list: ReviewSnapshot[], quarterKey: string): ReviewSnapshot | null {
  const earlier = list.filter((s) => s.quarter < quarterKey);
  return earlier.length ? earlier[earlier.length - 1] : null;
}
