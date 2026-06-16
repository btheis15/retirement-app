/**
 * On-device encryption via the Web Crypto API. Used for (a) the optional
 * passcode that encrypts your data at rest in this browser, and (b) the
 * downloadable backup file.
 *
 * A passphrase is stretched with PBKDF2-SHA256 (250k iterations) into a 256-bit
 * AES-GCM key. The key is NEVER stored or transmitted — it only exists in
 * memory while the app is unlocked, and is re-derived from your passphrase. If
 * you forget the passphrase, the data is unrecoverable by design (no server,
 * no backdoor).
 */

const ITERATIONS = 250_000;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("This browser doesn't support secure encryption.");
  return c.subtle;
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export interface Envelope {
  v: 1;
  kdf: "PBKDF2";
  it: number;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64 ciphertext
  hint?: string; // optional, non-secret passphrase reminder
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await subtle().importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt an object using an already-derived key (fast — for re-saves). */
export async function encryptWithKey(obj: unknown, key: CryptoKey, salt: Uint8Array, hint?: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return { v: 1, kdf: "PBKDF2", it: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), ...(hint ? { hint } : {}) };
}

/** Encrypt an object from a passphrase (derives a fresh key + salt). Returns the
 *  envelope plus the derived key/salt so the caller can re-save cheaply. */
export async function encryptObject(
  obj: unknown,
  passphrase: string,
  hint?: string,
): Promise<{ envelope: Envelope; key: CryptoKey; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const envelope = await encryptWithKey(obj, key, salt, hint);
  return { envelope, key, salt };
}

/** Decrypt an envelope with a passphrase. Throws if the passphrase is wrong. */
export async function decryptObject<T>(
  env: Envelope,
  passphrase: string,
): Promise<{ data: T; key: CryptoKey; salt: Uint8Array }> {
  const salt = fromB64(env.salt);
  const key = await deriveKey(passphrase, salt);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(env.iv) as BufferSource }, key, fromB64(env.ct) as BufferSource);
  } catch {
    throw new Error("Wrong passcode — couldn't unlock your data.");
  }
  const data = JSON.parse(new TextDecoder().decode(plain)) as T;
  return { data, key, salt };
}

export function isEnvelope(x: unknown): x is Envelope {
  return !!x && typeof x === "object" && (x as Envelope).v === 1 && (x as Envelope).kdf === "PBKDF2";
}
