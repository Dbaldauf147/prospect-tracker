// Email-domain allowlist for who may register / sign in.
//
// Registration is currently OPEN: anyone with a syntactically valid
// email may sign up and gets their own isolated workspace. The optional
// Vite env var VITE_ALLOWED_EMAIL_DOMAINS is still parsed (and kept for
// reference / future re-locking) but is no longer enforced by
// isEmailAllowed. To re-restrict sign-up to specific domains, set that
// env var AND switch isEmailAllowed back to the domain check below.
//
// The admin account is always allowed regardless of the list so the
// owner can never lock themselves out.

export const ADMIN_EMAIL = 'baldaufdan@gmail.com';

function parseDomains(raw) {
  return String(raw || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export const ALLOWED_EMAIL_DOMAINS = parseDomains(import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS);

/** Domain portion of an email, lower-cased. Returns '' for malformed input. */
export function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return '';
  return String(email).slice(at + 1).trim().toLowerCase();
}

/**
 * True if `email` may use the app. Registration is open, so any
 * syntactically valid email address is allowed (the admin is always
 * allowed too). Each user gets their own isolated workspace; only the
 * admin can touch the shared prospects/lists collections.
 */
export function isEmailAllowed(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === ADMIN_EMAIL) return true;
  // Basic shape check: something@something.tld with no whitespace.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

/** Human-readable description of who can sign up, for the login screen. */
export function allowlistDescription() {
  return 'Sign up with any email address to get your own private workspace.';
}
