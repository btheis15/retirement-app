"use client";

/**
 * Shared input primitives. ui.tsx stays presentational; anything a user TYPES
 * or TAPS to change data lives here.
 *
 * YearField is a native <select> on purpose: on an iPhone it opens the system
 * wheel picker — big targets, zero invalid states by construction (no "birth
 * year 3", no silent snap-back to explain), and every option answers the
 * mental-math question inline ("1958 — age 68"). A 65+ user never has to type
 * a year again.
 */

import { ReactNode, useEffect, useRef, useState } from "react";

/** The option list for a YearField — exported pure for the probe. */
export function yearOptions(min: number, max: number, labelFor?: (year: number) => string): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  for (let y = max; y >= min; y--) out.push({ value: y, label: labelFor ? labelFor(y) : String(y) });
  return out;
}

/** Idiot-proof year entry: a native select (system wheel on iOS). Options run
 *  max→min (recent years first). Pass `labelFor` to annotate each year — e.g.
 *  birth years as "1958 — age 68". */
export function YearField({
  value,
  onChange,
  min,
  max,
  labelFor,
  ariaLabel,
  className = "",
}: {
  value: number;
  onChange: (year: number) => void;
  min: number;
  max: number;
  labelFor?: (year: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const opts = yearOptions(min, max, labelFor);
  // A saved value outside [min,max] (old data) stays selectable so nothing is
  // silently moved — it's listed once, flagged, until the user picks anew.
  const outOfRange = value < min || value > max;
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`field-focus w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-[14px] font-semibold outline-none focus:border-primary ${className}`}
    >
      {outOfRange && <option value={value}>{value} (unusual — pick a year)</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Two-tap destructive confirm — no dialogs, no typing. First tap arms it
 *  ("Really remove? Tap again"), 3 seconds later it disarms itself. */
export function ConfirmTapButton({
  label,
  confirmLabel,
  onConfirm,
  className = "",
}: {
  label: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      onClick={() => {
        if (armed) {
          if (timer.current) clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
        }
      }}
      className={`press ${armed ? "font-bold text-tax" : ""} ${className}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** 5-second undo for cheap-to-reverse removals (kinder than a confirm). */
export function useUndo() {
  const [pending, setPending] = useState<{ label: string; restore: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offer = (label: string, restore: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    setPending({ label, restore });
    timer.current = setTimeout(() => setPending(null), 5000);
  };
  const act = () => {
    if (timer.current) clearTimeout(timer.current);
    pending?.restore();
    setPending(null);
  };
  return { pending, offer, act };
}

export function UndoSnackbar({ pending, onUndo }: { pending: { label: string } | null; onUndo: () => void }) {
  if (!pending) return null;
  return (
    <div className="rise fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 print:hidden">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lg">
        <span className="text-[13px] text-foreground/75">{pending.label}</span>
        <button onClick={onUndo} className="press text-[13px] font-bold text-primary">
          Undo
        </button>
      </div>
    </div>
  );
}
