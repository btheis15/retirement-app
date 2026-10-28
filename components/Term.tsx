"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { glossaryEntry } from "@/lib/glossary";

/** Inline jargon word with a tap/click/Enter popover (never hover-only).
 *  Usage: <Term id="irmaa">IRMAA</Term>. Closes on Escape, outside tap, or the close button. */
export function Term({ id, children }: { id: string; children: ReactNode }) {
  const entry = glossaryEntry(id);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <span ref={wrap} className="relative inline">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
        className="cursor-help border-b border-dotted border-current font-[inherit] text-inherit"
      >
        {children}
      </button>
      {open && (
        <span
          id={popId}
          role="dialog"
          aria-label={entry.term}
          className="absolute left-0 top-full z-30 mt-1 block w-72 max-w-[85vw] rounded-xl border border-border bg-card p-3 text-left text-[14px] font-normal normal-case leading-relaxed text-foreground shadow-lg"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="font-semibold">{entry.term}</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
              }}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[18px] text-foreground/65"
            >
              ×
            </button>
          </span>
          <span className="block">{entry.short}</span>
          <Link href="/learn#glossary" className="mt-2 inline-block text-[13px] font-semibold text-primary underline underline-offset-2">
            More on the Learn tab
          </Link>
        </span>
      )}
    </span>
  );
}
