"use client";

import { useEffect, useRef, useState } from "react";

// Text-size control. Sets CSS `zoom` on <html> (scales hard-px sizes too and
// reflows like browser zoom). The same key is read by an inline script in
// app/layout.tsx before first paint, so there is no flash.
export const TEXT_SIZE_KEY = "rto-text-size";

const CHOICES = [
  { id: "standard", label: "Standard", scale: 1, sample: "text-[15px]" },
  { id: "larger", label: "Larger", scale: 1.12, sample: "text-[17px]" },
  { id: "largest", label: "Largest", scale: 1.25, sample: "text-[20px]" },
] as const;

type SizeId = (typeof CHOICES)[number]["id"];

function apply(scale: number) {
  document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
}

export function TextSize() {
  const [size, setSize] = useState<SizeId>("standard");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEXT_SIZE_KEY);
      if (saved === "larger" || saved === "largest") setSize(saved);
    } catch {
      /* storage unavailable — stay at Standard */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const choose = (id: SizeId) => {
    setSize(id);
    apply(CHOICES.find((c) => c.id === id)!.scale);
    try {
      localStorage.setItem(TEXT_SIZE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      ref={wrap}
      className="print:hidden fixed right-3 z-50"
      style={{ top: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      <button
        ref={btn}
        type="button"
        aria-label="Text size"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="press flex h-11 min-w-11 items-center justify-center rounded-full border border-border/70 bg-card/90 px-3 text-[15px] font-semibold text-primary shadow-sm backdrop-blur-xl"
      >
        A<span className="text-[19px] leading-none">a</span>
      </button>
      {open && (
        <div
          role="group"
          aria-labelledby="text-size-label"
          className="absolute right-0 mt-2 w-60 rounded-2xl border border-border/70 bg-card p-3 shadow-lg"
        >
          <div id="text-size-label" className="mb-2 text-[15px] font-semibold text-foreground">
            Text size
          </div>
          <div className="flex flex-col gap-2">
            {CHOICES.map((c) => {
              const active = size === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(c.id)}
                  className={`flex min-h-11 items-center justify-between rounded-xl border px-3 py-2 text-left ${
                    active
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border/70 text-foreground"
                  }`}
                >
                  <span className={c.sample}>{c.label}</span>
                  {active && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
