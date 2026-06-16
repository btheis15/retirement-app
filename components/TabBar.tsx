"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Single source of truth for routes + labels + icons.
const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/accounts", label: "Accounts", icon: "💼" },
  { href: "/plan", label: "Plan", icon: "🎯" },
  { href: "/projection", label: "Forecast", icon: "📊" },
  { href: "/scenarios", label: "Compare", icon: "⚖️" },
  { href: "/learn", label: "Learn", icon: "📖" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`press flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                  active ? "font-semibold text-primary" : "text-foreground/50"
                }`}
              >
                <span className={`text-lg leading-none transition-transform ${active ? "scale-110" : ""}`}>
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
