// Reading and writing Firestore documents over plain HTTPS.
//
// The Firestore SDK does not speak ordinary HTTP. It holds long-lived
// WebChannel streams open and sends reads and writes down them, which is
// what makes live snapshots work — and is also what makes it possible for
// the whole client to stop working mid-session:
//
//   * a proxy, a VPN or a filtering extension can mangle the stream while
//     ordinary HTTPS to the same host sails through, and the SDK then
//     queues the write and waits forever (see firestoreSync's analysis
//     save, which is why this encoder was first written); and
//
//   * the SDK can crash its own async queue. A watch-stream bug throws
//     "INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)" — a duplicate
//     target acknowledgement taking its pending-response count negative —
//     and from that moment every call, read or write, rejects with
//     "(ID: b815) AsyncQueue is already failed" for the life of the tab.
//
// The REST API is one ordinary request. It goes through anything that lets
// HTTPS through, it returns a real HTTP status, and it is subject to the
// same security rules as the SDK because it carries the same signed ID
// token. So it is both the fallback that can still save the user's work and
// the only thing in the app that can say WHY a save failed: a 429 is a
// quota, a 403 is rules, a failed fetch is the network.
import { auth, db } from '../firebase';
import { withTimeout } from './withTimeout.js';

export const FIRESTORE_REST_TIMEOUT_MS = 30_000;

// Firestore's REST value encoding, for the shapes these documents hold.
// Numbers are split on integer-ness because the API rejects "1.0" as an
// integerValue and reads an integer double back as a double.
export function toRestValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toRestValue) } };
  if (typeof v === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toRestValue(x)])) } };
  }
  return { stringValue: String(v) };
}

export const toRestFields = (obj) => Object.fromEntries(
  Object.entries(obj || {}).map(([k, v]) => [k, toRestValue(v)]),
);

// The inverse, so a document read back over REST reaches the app as the
// same plain object the SDK would have handed it. Integers arrive as
// strings (JSON has no 64-bit integer), which matters here: _lastWriteAt is
// a millisecond timestamp and the stale check compares it numerically.
export function fromRestValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fromRestValue);
  if ('mapValue' in v) return fromRestFields(v.mapValue?.fields);
  // referenceValue, geoPointValue — nothing in this app stores them, and
  // guessing a shape would be worse than handing back what arrived.
  return v.referenceValue ?? v.geoPointValue ?? null;
}

export const fromRestFields = (fields) => Object.fromEntries(
  Object.entries(fields || {}).map(([k, v]) => [k, fromRestValue(v)]),
);

// One segment of a field path, quoted when it isn't a bare identifier.
// Settings paths are keyed by company slug ("veris-residential"), and a
// hyphen is not legal in an unquoted field path — an unquoted mask is
// rejected with 400 rather than writing the wrong thing, but it still
// loses the save.
function quoteSegment(segment) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) return segment;
  return '`' + String(segment).replace(/[\\`]/g, (c) => '\\' + c) + '`';
}

export const toFieldPath = (segments) => segments.map(quoteSegment).join('.');

function restUrl(docPath) {
  const projectId = db?.app?.options?.projectId || auth?.app?.options?.projectId;
  if (!projectId) throw new Error('No Firebase project id available for a REST call');
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
}

async function idToken(timeoutMs) {
  const user = auth?.currentUser;
  if (!user?.getIdToken) throw new Error('Not signed in, so a REST call cannot be authorised');
  return withTimeout(Promise.resolve(user.getIdToken()), timeoutMs, 'getting an auth token');
}

// fetch, with a network failure told apart from a database one. A blocked
// host, a killed connection or the timeout below is not the server saying
// no, and a message that reads like a database error sends whoever is
// looking at it to the wrong place.
async function restFetch(url, init, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const wrapped = new Error(`the request never completed (${err?.name || 'error'}: ${err?.message || err})`);
    wrapped.networkFailure = true;
    throw wrapped;
  }
  return res;
}

async function restError(res) {
  const body = await res.text().catch(() => '');
  let detail = body.slice(0, 300);
  try { detail = JSON.parse(body)?.error?.message || detail; } catch { /* keep the raw body */ }
  const err = new Error(`HTTP ${res.status}: ${detail}`);
  err.status = res.status;
  return err;
}

// Create or overwrite one document by path, over HTTPS. A PATCH with no
// update mask replaces the document, which is what the analysis chunks
// want: each write IS the whole document. Throws with the status and the
// server's own message, which is the point — unlike the SDK, this cannot
// fail silently.
export async function restSetDoc(docPath, data, timeoutMs = FIRESTORE_REST_TIMEOUT_MS) {
  const token = await idToken(timeoutMs);
  const res = await restFetch(restUrl(docPath), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toRestFields(data) }),
  }, timeoutMs);
  if (!res.ok) throw await restError(res);
  return true;
}

// Update specific field paths on one document, leaving every other field
// alone — the REST equivalent of updateDoc(), and the only safe way to fall
// back on a document like userSettings, where a full overwrite would erase
// everything the caller didn't happen to be writing.
//
// A field path is a LIST of segments rather than a dotted string, because
// the two callers disagree about what a dot means: a path write targets
// `utilityLookupAccounts.veris-residential` (two segments), while a
// whole-key write targets one key that is free to contain a dot. Guessing
// between them writes to the wrong field. dottedFieldEntries and
// keyFieldEntries below say which is which.
//
// A null or undefined value deletes that path: it goes into the update mask
// but not into the body, which is how the API spells a field delete. The
// document is created if it does not exist.
export async function restUpdateFields(docPath, fieldEntries, timeoutMs = FIRESTORE_REST_TIMEOUT_MS) {
  const entries = [...fieldEntries].filter(([segments]) => segments.length);
  if (!entries.length) return true;
  const fields = {};
  for (const [segments, value] of entries) {
    if (value == null) continue; // in the mask, absent from the body = delete
    let cur = fields;
    for (let i = 0; i < segments.length - 1; i++) {
      if (!cur[segments[i]]?.mapValue) cur[segments[i]] = { mapValue: { fields: {} } };
      cur = cur[segments[i]].mapValue.fields;
    }
    cur[segments[segments.length - 1]] = toRestValue(value);
  }
  const token = await idToken(timeoutMs);
  const mask = entries
    .map(([segments]) => `updateMask.fieldPaths=${encodeURIComponent(toFieldPath(segments))}`)
    .join('&');
  const res = await restFetch(`${restUrl(docPath)}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }, timeoutMs);
  if (!res.ok) throw await restError(res);
  return true;
}

/** { 'a.b': v } → one write to the nested field b under a. */
export const dottedFieldEntries = (pathValues) => Object.entries(pathValues || {})
  .map(([path, value]) => [path.split('.'), value]);

/** { 'a.b': v } → one write to the top-level field literally named "a.b". */
export const keyFieldEntries = (obj) => Object.entries(obj || {})
  .map(([key, value]) => [[key], value]);

// One document, read over HTTPS. Returns null when it does not exist —
// a 404 here is an answer, not a failure.
export async function restGetDoc(docPath, timeoutMs = FIRESTORE_REST_TIMEOUT_MS) {
  const token = await idToken(timeoutMs);
  const res = await restFetch(restUrl(docPath), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }, timeoutMs);
  if (res.status === 404) return null;
  if (!res.ok) throw await restError(res);
  const body = await res.json();
  return fromRestFields(body?.fields);
}
