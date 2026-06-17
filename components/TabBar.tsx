"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <>
      {/* Phone / tablet: bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur lg:hidden"
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
                  className={`press flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                    active ? "font-semibold text-primary" : "text-foreground/50"
                  }`}
                >
                  <span className={`tab-pop text-lg leading-none ${active ? "scale-110" : ""}`}>
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
      <nav className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border bg-card/95 px-3 py-5 backdrop-blur lg:flex">
        <div className="px-2 pb-1 text-[15px] font-bold leading-tight text-primary">Retirement Tax Optimizer</div>
        <div className="mb-4 px-2 text-[11px] text-foreground/45">Filing jointly · 2026 rules</div>
        <ul className="flex flex-col gap-1">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <li key={tab.href}>
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
