"use client";

/** Small shared UI primitives so pages stay consistent. Light-mode only. */

import { ReactNode, useState, useEffect } from "react";

/** True once mounted on a desktop-width viewport (lg breakpoint, 1024px). Returns
 *  false on the server and first client render (avoids hydration mismatch), then
 *  updates. Drives the "simple on phone, rich on desktop" split. */
export function useIsDesktop(query = "(min-width: 1024px)"): boolean {
  const [is, setIs] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setIs(m.matches);
    const onChange = (e: MediaQueryListEvent) => setIs(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return is;
}

/** Renders its children only on desktop. On phones it renders `mobileNote` (a
 *  short "see this on a larger screen" line) or nothing — so deep analytics stay
 *  off the action-focused mobile view AND don't run their compute there. */
export function DesktopOnly({ children, mobileNote }: { children: ReactNode; mobileNote?: ReactNode }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) return <>{children}</>;
  return mobileNote ? <>{mobileNote}</> : null;
}

/** A titled section that is COLLAPSED by default on mobile (tap to expand) and
 *  OPEN by default on desktop, where there's room. Once the user toggles it, their
 *  choice sticks. Shows an optional one-line `summary` while collapsed so the phone
 *  still conveys the gist without the full detail. */
export function Collapsible({
  title,
  eyebrow,
  summary,
  children,
  defaultOpenDesktop = true,
  className = "",
}: {
  title: ReactNode;
  eyebrow?: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpenDesktop?: boolean;
  className?: string;
}) {
  const isDesktop = useIsDesktop();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (isDesktop && defaultOpenDesktop);
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-card ${className}`} style={{ boxShadow: "var(--shadow-card)" }}>
      <button
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="press flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          {eyebrow && <span className="block text-[11px] font-semibold uppercase tracking-wide text-primary">{eyebrow}</span>}
          <span className="block font-semibold leading-snug">{title}</span>
          {!open && summary && <span className="mt-0.5 block text-[12px] leading-snug text-foreground/55">{summary}</span>}
        </span>
        <span className={`shrink-0 text-foreground/40 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && <div className="rise border-t border-border/60 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

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
    <Tag className={`rounded-2xl border border-border bg-card p-4 ${className}`} style={{ boxShadow: "var(--shadow-card)" }}>
      {children}
    </Tag>
  );
}

/** Layout-matched placeholder shown before localStorage hydration — avoids the
 *  full-viewport white flash on cold load / route change. */
export function PageSkeleton() {
  return (
    <div className="space-y-3 pt-4">
      <div className="h-7 w-2/3 animate-pulse rounded-lg bg-foreground/5" />
      <div className="h-44 animate-pulse rounded-2xl bg-foreground/5" />
      <div className="h-28 animate-pulse rounded-2xl bg-foreground/5" />
    </div>
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

/** A highlighted, plain-English teaching/summary box. Use for "here's what this
 *  means" callouts and headline takeaways. */
export function Callout({
  tone = "info",
  icon,
  title,
  children,
  className = "",
}: {
  tone?: "info" | "good" | "warn" | "neutral";
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const cls = {
    info: "border-ss/25 bg-ss/5",
    good: "border-gain/25 bg-gain/5",
    warn: "border-tax/25 bg-tax/5",
    neutral: "border-border bg-foreground/[0.03]",
  }[tone];
  return (
    <div className={`rounded-2xl border ${cls} p-4 ${className}`}>
      {title && (
        <div className="mb-1 flex items-center gap-2 font-semibold">
          {icon && <span className="text-lg leading-none">{icon}</span>}
          <span>{title}</span>
        </div>
      )}
      <div className="text-[13px] leading-relaxed text-foreground/75">{children}</div>
    </div>
  );
}

/** A short muted helper paragraph that sits under a SectionTitle to explain
 *  what the reader is looking at. */
export function Explainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`-mt-1 mb-2 text-[12px] leading-relaxed text-foreground/55 ${className}`}>{children}</p>;
}

/** A tappable "what's this?" click-through: a question row that expands to a
 *  plain-English explanation plus links to the authoritative source(s). Use
 *  liberally next to any jargon so nothing on the screen is a mystery. */
export function Info({
  q,
  children,
  sources,
  defaultOpen = false,
  className = "",
}: {
  q: ReactNode;
  children: ReactNode;
  sources?: readonly { label: string; url: string }[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`my-2 overflow-hidden rounded-xl border border-ss/25 bg-ss/[0.04] ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-semibold text-ss"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-[13px]">ⓘ</span>
          {q}
        </span>
        <span className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="rise border-t border-ss/15 px-3 pb-3 pt-2 text-[12px] leading-relaxed text-foreground/75">
          {children}
          {sources && sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary underline decoration-primary/30 underline-offset-2"
                >
                  {s.label} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Disclaimer({ className = "", state = "Illinois" }: { className?: string; state?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-foreground/45 ${className}`}>
      Educational estimates only — not tax, legal, or investment advice. Models 2026 federal tax and{" "}
      {state} state tax (other states aren&apos;t modeled). Uses reasonable assumptions; figures and
      future projections are estimates — verify with a qualified tax professional before acting.
    </p>
  );
}
