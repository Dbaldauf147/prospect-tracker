// Email-domain allowlist for who may register / sign in.
//
// Configure the allowed domains via the Vite env var
// VITE_ALLOWED_EMAIL_DOMAINS — a comma-separated list, e.g.
//   VITE_ALLOWED_EMAIL_DOMAINS="acme.com,acme.co.uk"
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
 * True if `email` may use the app. The admin is always allowed. When no
 * allowlist is configured we fail CLOSED (deny everyone but the admin)
 * so a missing env var can't silently re-open public registration.
 */
export function isEmailAllowed(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === ADMIN_EMAIL) return true;
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return false;
  return ALLOWED_EMAIL_DOMAINS.includes(emailDomain(e));
}

/** Human-readable description of who can sign up, for the login screen. */
export function allowlistDescription() {
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return 'Access is currently restricted.';
  const list = ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(', ');
  return `Sign-up is limited to ${list} email addresses.`;
}
