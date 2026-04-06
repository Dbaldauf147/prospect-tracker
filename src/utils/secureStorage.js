/**
 * Encrypted localStorage wrapper for sensitive PII data (OAuth tokens, etc.).
 *
 * - Uses AES-GCM via the Web Crypto API (SubtleCrypto).
 * - A random 256-bit encryption key is generated per browser session and held
 *   in sessionStorage, so it is automatically discarded when the tab/window
 *   closes.  This means encrypted values become unreadable after a session
 *   ends, which is the desired behaviour for short-lived tokens.
 * - Falls back to plain localStorage when the Web Crypto API is unavailable
 *   (older browsers, non-secure contexts).
 */

const SESSION_KEY_NAME = '__secure_storage_key__';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function cryptoAvailable() {
  try {
    return !!(window.crypto && window.crypto.subtle);
  } catch {
    return false;
  }
}

/** Export the CryptoKey to a raw base64 string so we can persist it in sessionStorage. */
async function exportKey(cryptoKey) {
  const raw = await window.crypto.subtle.exportKey('raw', cryptoKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/** Import a base64 string back into a CryptoKey. */
async function importKey(base64) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/** Get (or generate) the per-session AES-256-GCM key. */
async function getSessionKey() {
  const existing = sessionStorage.getItem(SESSION_KEY_NAME);
  if (existing) {
    return importKey(existing);
  }
  const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  sessionStorage.setItem(SESSION_KEY_NAME, await exportKey(key));
  return key;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Encrypt `value` (any JSON-serialisable value) and store it under `key` in
 * localStorage.  The ciphertext and a random IV are stored together.
 */
export async function secureSet(key, value) {
  if (!cryptoAvailable()) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  try {
    const cryptoKey = await getSessionKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);

    // Store IV + ciphertext as a base64 JSON envelope
    const payload = {
      iv: btoa(String.fromCharCode(...iv)),
      ct: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // If encryption fails for any reason, fall back to plain storage.
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/**
 * Read and decrypt the value stored under `key`.
 * Returns the parsed JSON value, or `null` if the key is missing or
 * decryption fails (e.g. stale key from a previous session).
 */
export async function secureGet(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;

  if (!cryptoAvailable()) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  try {
    const { iv, ct } = JSON.parse(raw);
    // If the stored value doesn't look like our encrypted envelope, try
    // parsing it as plain JSON (migration / fallback path).
    if (!iv || !ct) return JSON.parse(raw);

    const cryptoKey = await getSessionKey();
    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    const ctBytes = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
    const plaintext = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, cryptoKey, ctBytes);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    // Decryption failed — stale session key or corrupted data.
    return null;
  }
}

/**
 * Remove `key` from localStorage.
 */
export function secureClear(key) {
  localStorage.removeItem(key);
}
