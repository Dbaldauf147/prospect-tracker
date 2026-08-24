// Shared HTTP helpers for the serverless API: CORS, preflight, and
// Firebase ID-token verification with the same email-domain allowlist
// the client enforces (defense in depth).
import { adminAuth } from './firebaseAdmin.js';
import { withDeadline, isDeadline } from './deadline.js';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

// Verifying a token is a network call: on a cold start firebase-admin
// also fetches Google's signing keys first. Generous for that, short
// enough that the browser hears a reason rather than hitting its own
// timeout on a function still waiting.
const VERIFY_TIMEOUT_MS = 10000;

function allowedDomains() {
  return String(process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function isEmailAllowed(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === ADMIN_EMAIL) return true;
  const domains = allowedDomains();
  if (domains.length === 0) return false;
  const at = e.lastIndexOf('@');
  return at >= 0 && domains.includes(e.slice(at + 1));
}

// Allowed browser origin(s) for CORS. Defaults to same-origin only.
function corsOrigin(req) {
  const configured = String(process.env.APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const reqOrigin = req.headers.origin;
  if (configured.length === 0) return reqOrigin || '';
  if (reqOrigin && configured.includes(reqOrigin)) return reqOrigin;
  return configured[0];
}

export function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Verify the caller's Firebase ID token (Authorization: Bearer <token>)
 * and enforce the allowlist. On failure, writes the HTTP response and
 * returns null. On success returns the decoded token { uid, email, ... }.
 * Always call applyCors() and handle OPTIONS before this.
 */
export async function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization bearer token' });
    return null;
  }
  // Initialise the admin SDK separately so a missing/invalid service
  // account surfaces as a clear config error instead of masquerading as
  // an expired token.
  let adminAuthInstance;
  try {
    adminAuthInstance = adminAuth();
  } catch (err) {
    console.error('requireAuth: admin SDK init failed:', err);
    res.status(500).json({ error: 'Server auth not configured (FIREBASE_SERVICE_ACCOUNT_KEY missing or invalid)' });
    return null;
  }
  let decoded;
  try {
    decoded = await withDeadline(
      adminAuthInstance.verifyIdToken(token),
      VERIFY_TIMEOUT_MS,
      'Verifying your sign-in',
    );
  } catch (err) {
    // A stalled verification is not a bad token: answering 401 would send
    // the user off to re-authenticate over what is really Google being
    // unreachable from this function.
    if (isDeadline(err)) {
      console.error('requireAuth: verifyIdToken timed out');
      res.status(504).json({ error: `${err.message} That's this server reaching Google, not your session: try again shortly.` });
      return null;
    }
    // err.code distinguishes the common cases: auth/id-token-expired,
    // auth/argument-error (malformed / wrong project), etc.
    console.error('requireAuth: verifyIdToken failed:', err?.code || err?.message || err);
    res.status(401).json({ error: 'Invalid or expired token', code: err?.code || null });
    return null;
  }
  if (!isEmailAllowed(decoded.email)) {
    res.status(403).json({ error: 'Account not authorized' });
    return null;
  }
  return decoded;
}

export function isAdminEmail(email) {
  return String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
}

// gRPC status codes the Firestore admin SDK throws for conditions that
// are about the project rather than the request. The raw message for
// these says what happened but not what to do about it — "Quota
// exceeded." reads like a bug in the route that reported it.
const FIRESTORE_HINTS = {
  4: 'Firestore took too long to answer. Usually transient — try again.',
  7: "Firestore refused the request. The server's service account is missing access to this data.",
  8: 'The Firebase project is out of Firestore quota, so every read is being refused — this is project-wide, not specific to this feature. On the free (Spark) plan the daily allowance resets at midnight US Pacific; a project that keeps hitting it needs fewer reads or the Blaze plan.',
  14: 'Firestore was unreachable. Usually transient — try again.',
};

/**
 * Answer a thrown error as JSON.
 *
 * Anything a handler throws — a Firestore call that can't reach the
 * database, a missing module, a typo — otherwise unwinds into the
 * platform's own 500, whose body is not JSON. The client reads no
 * `error` field there and can only report the bare status, so every
 * distinct server-side fault arrives on screen as the same useless
 * "Request failed (500)". Say what actually broke instead; these routes
 * are behind a verified-identity allowlist, so the detail goes to
 * someone entitled to it.
 */
export function failWith(res, err, label) {
  let detail = String(err?.message || err || 'Unknown error');
  const code = err?.code ? String(err.code) : null;
  const hint = FIRESTORE_HINTS[err?.code];
  if (hint) detail = `${detail} ${hint}`;
  console.error(`${label || 'handler'} failed:`, code || '', detail, err?.stack || '');
  // A response already on the wire is the handler's own answer: replacing
  // it would throw again, on top of a reply the client has.
  if (res.headersSent || res.writableEnded) return undefined;
  // A step that ran out of time is not a broken server, and 504 lets the
  // client say "try again" rather than "this is broken".
  const status = isDeadline(err) ? 504 : 500;
  return res.status(status).json({ error: detail, code });
}

/**
 * Wrap a handler with CORS + preflight + auth. The wrapped handler is
 * called as (req, res, auth) where auth is the decoded token. A throw
 * from the handler is answered as JSON rather than crashing the
 * invocation (see failWith).
 */
export function withAuth(handler) {
  return async function wrapped(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    const auth = await requireAuth(req, res);
    if (!auth) return undefined;
    try {
      return await handler(req, res, auth);
    } catch (err) {
      return failWith(res, err, String(req.url || '').split('?')[0]);
    }
  };
}
