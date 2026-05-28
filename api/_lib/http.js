// Shared HTTP helpers for the serverless API: CORS, preflight, and
// Firebase ID-token verification with the same email-domain allowlist
// the client enforces (defense in depth).
import { adminAuth } from './firebaseAdmin.js';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

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
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
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

/**
 * Wrap a handler with CORS + preflight + auth. The wrapped handler is
 * called as (req, res, auth) where auth is the decoded token.
 */
export function withAuth(handler) {
  return async function wrapped(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    const auth = await requireAuth(req, res);
    if (!auth) return undefined;
    return handler(req, res, auth);
  };
}
