"use client";

/** Small shared UI primitives so pages stay consistent. Light-mode only. */

import { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${className}`}>{children}</Tag>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/55">{children}</h2>
      {hint && <span className="text-[11px] text-foreground/40">{hint}</span>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "tax" | "gain" | "roth" | "deferred" | "taxable";
}) {
  const toneClass = {
    default: "text-foreground",
    tax: "text-tax",
    gain: "text-gain",
    roth: "text-roth",
    deferred: "text-deferred",
    taxable: "text-taxable",
  }[tone];
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-foreground/50">{label}</span>
      <span className={`tabular text-xl font-semibold ${toneClass}`}>{value}</span>
      {sub && <span className="text-[11px] text-foreground/50">{sub}</span>}
    </div>
  );
}

export function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "tax" | "gain" | "roth" | "deferred" | "taxable" | "ss";
}) {
  const cls = {
    default: "bg-foreground/8 text-foreground/70",
    tax: "bg-tax/10 text-tax",
    gain: "bg-gain/10 text-gain",
    roth: "bg-roth/10 text-roth",
    deferred: "bg-deferred/10 text-deferred",
    taxable: "bg-taxable/10 text-taxable",
    ss: "bg-ss/10 text-ss",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-2 pt-2">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-foreground/60">{subtitle}</p>}
    </header>
  );
}

/** A horizontal stacked bar showing the split of a total across buckets. */
export function StackedBar({
  segments,
}: {
  segments: { value: number; className: string; label?: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-foreground/5">
      {segments.map((s, i) => (
        <div
          key={i}
          className={s.className}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={s.label}
        />
      ))}
    </div>
  );
}

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-foreground/45 ${className}`}>
      Educational estimates only — not tax, legal, or investment advice. Federal tax only (no state
      tax). Uses 2026 figures and reasonable assumptions; verify with a qualified tax professional
      before acting.
    </p>
  );
}
