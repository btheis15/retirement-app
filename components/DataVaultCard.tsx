"use client";

/**
 * "Your data & privacy" — save an encrypted backup file you control, or load
 * one. Everything is done on-device; the file never touches a server.
 *
 * The file is a JSON envelope encrypted with AES-GCM from a passphrase you
 * choose (see lib/crypto). Forget the passphrase and it's unrecoverable — that's
 * the privacy guarantee, not a bug.
 */

import { useRef, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, SectionTitle, Explainer, Callout } from "@/components/ui";
import { Household } from "@/lib/accounts";
import { PlannerSettings } from "@/lib/defaults";
import { encryptObject, decryptObject, isEnvelope, Envelope } from "@/lib/crypto";

interface Payload {
  app: "retirement-tax-optimizer";
  v: 1;
  household: Household;
  settings: Partial<PlannerSettings>;
}

function downloadFile(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const INPUT = "w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-base text-foreground outline-none focus:border-primary";

export function DataVaultCard() {
  const { household, settings } = useStore();
  const loadOwn = useStore().loadOwn;

  const [mode, setMode] = useState<"idle" | "export" | "import">("idle");
  const [pass, setPass] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pendingEnvelope, setPendingEnvelope] = useState<Envelope | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setMode("idle");
    setPass("");
    setHint("");
    setPendingEnvelope(null);
    setBusy(false);
  };

  const doExport = async () => {
    if (pass.length < 4) {
      setMsg({ kind: "err", text: "Use a passphrase of at least 4 characters." });
      return;
    }
    setBusy(true);
    try {
      const payload: Payload = { app: "retirement-tax-optimizer", v: 1, household, settings };
      const { envelope } = await encryptObject(payload, pass, hint.trim() || undefined);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadFile(`retirement-plan-${stamp}.retire`, JSON.stringify(envelope, null, 2));
      setMsg({ kind: "ok", text: "Saved. Keep this file somewhere safe (Files, iCloud Drive, your Mac)." });
      reset();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't create the file." });
      setBusy(false);
    }
  };

  const onPickFile = async (file: File) => {
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (isEnvelope(parsed)) {
        setPendingEnvelope(parsed);
        setMode("import");
        setPass("");
      } else if (parsed?.app === "retirement-tax-optimizer" && parsed.household) {
        // Unencrypted payload (allowed, but uncommon).
        loadOwn(parsed.household as Household, parsed.settings);
        setMsg({ kind: "ok", text: "Loaded your data." });
        reset();
      } else {
        setMsg({ kind: "err", text: "That doesn't look like a Retirement Plan file." });
      }
    } catch {
      setMsg({ kind: "err", text: "Couldn't read that file." });
    }
  };

  const doImport = async () => {
    if (!pendingEnvelope) return;
    setBusy(true);
    try {
      const { data } = await decryptObject<Payload>(pendingEnvelope, pass);
      if (!data?.household) throw new Error("File is missing your plan data.");
      loadOwn(data.household, data.settings);
      setMsg({ kind: "ok", text: "Unlocked and loaded your data." });
      reset();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't unlock the file." });
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Your data &amp; privacy</SectionTitle>
      <Explainer>
        Everything you enter lives only on this device — never uploaded, and I can&apos;t see it. Save an
        encrypted backup file you control (to move between devices or keep safe), or load one.
      </Explainer>
      <Card>
        {mode === "idle" && (
          <div className="space-y-2">
            <button
              onClick={() => {
                setMsg(null);
                setMode("export");
              }}
              className="press w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white"
            >
              ⬇️ Download my data (encrypted)
            </button>
            <button
              onClick={() => {
                setMsg(null);
                fileRef.current?.click();
              }}
              className="press w-full rounded-xl border border-border px-4 py-3 text-sm font-semibold text-primary"
            >
              📂 Load from a file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".retire,.json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {mode === "export" && (
          <div className="space-y-2">
            <p className="text-[13px] text-foreground/75">
              Choose a passphrase to lock the file. <strong>Write it down</strong> — there&apos;s no way to
              recover the file without it.
            </p>
            <input className={INPUT} type="password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
            <input className={INPUT} placeholder="Optional reminder hint (not the passphrase)" value={hint} onChange={(e) => setHint(e.target.value)} />
            <div className="flex gap-2 pt-1">
              <button onClick={reset} className="press flex-1 rounded-xl border border-border py-2.5 text-sm font-medium">
                Cancel
              </button>
              <button onClick={doExport} disabled={busy} className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Encrypting…" : "Download"}
              </button>
            </div>
          </div>
        )}

        {mode === "import" && pendingEnvelope && (
          <div className="space-y-2">
            <p className="text-[13px] text-foreground/75">Enter the passphrase for this file to unlock it.</p>
            {pendingEnvelope.hint && <p className="text-[12px] text-foreground/55">Hint: {pendingEnvelope.hint}</p>}
            <input className={INPUT} type="password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
            <div className="flex gap-2 pt-1">
              <button onClick={reset} className="press flex-1 rounded-xl border border-border py-2.5 text-sm font-medium">
                Cancel
              </button>
              <button onClick={doImport} disabled={busy} className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Unlocking…" : "Unlock & load"}
              </button>
            </div>
          </div>
        )}

        {msg && (
          <p className={`mt-3 rounded-xl px-3 py-2 text-[12px] ${msg.kind === "ok" ? "bg-gain/10 text-gain" : "bg-tax/10 text-tax"}`}>
            {msg.text}
          </p>
        )}
      </Card>
      <Callout tone="neutral" className="mt-2">
        <span className="text-[12px]">
          🔒 Only ticker symbols are ever sent off your device (to look up prices). Your balances, share counts,
          ages, and spending never leave it. On iPhone, an installed app&apos;s data is also encrypted by iOS when
          your phone is locked.
        </span>
      </Callout>
    </>
  );
}
