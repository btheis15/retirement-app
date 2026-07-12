"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/components/HouseholdProvider";

// Single source of truth for routes + labels + icons.
const TABS = [
  { href: "/", label: "Start", icon: "🎯" },
  { href: "/accounts", label: "Accounts", icon: "💼" },
  { href: "/plan", label: "Plan", icon: "📋" },
  { href: "/projection", label: "Forecast", icon: "📊" },
  { href: "/scenarios", label: "Compare", icon: "⚖️" },
  { href: "/learn", label: "Learn", icon: "📖" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const { ready, household } = useStore();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  // Same single-vs-joint convention as app/plan/page.tsx: a sentinel spouse
  // (missing, or birthYear <= 1900) means a genuinely single household.
  const isSingle = !household.spouse || household.spouse.birthYear <= 1900;
  const filingLabel = !ready ? "2026 rules" : isSingle ? "Filing single · 2026 rules" : "Filing jointly · 2026 rules";
  return (
    <>
      {/* Phone / tablet: frosted bottom tab bar (iOS-style: heavy blur + saturation,
          hairline top edge, and a soft pill behind the active tab's icon). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border/60 bg-card/75 backdrop-blur-xl backdrop-saturate-150 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`press flex flex-col items-center gap-0.5 pb-1.5 pt-1.5 text-[10px] transition-colors ${
                    active ? "font-semibold text-primary" : "font-medium text-foreground/50"
                  }`}
                >
                  <span
                    className={`tab-pop flex h-7 items-center justify-center rounded-full px-3.5 text-lg leading-none transition-colors ${
                      active ? "scale-110 bg-primary/10" : ""
                    }`}
                  >
                    {tab.icon}
                  </span>
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop (MacBook): left sidebar — roomier, always visible */}
      <nav className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border/70 bg-card/80 px-3 py-5 backdrop-blur-xl backdrop-saturate-150 lg:flex">
        <div className="px-2 pb-1 text-[15px] font-bold leading-tight text-primary">Retirement Tax Optimizer</div>
        <div className="mb-4 px-2 text-[11px] text-foreground/45">{filingLabel}</div>
        <ul className="flex flex-col gap-1">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <li key={tab.href} className="relative">
                {/* iOS-style active affordance: a slim brand bar hugging the rail */}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`press flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active ? "bg-primary/10 font-semibold text-primary" : "text-foreground/60 hover:bg-foreground/5"
                  }`}
                >
                  <span className="text-lg leading-none">{tab.icon}</span>
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
