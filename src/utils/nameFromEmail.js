// Guess a person's name from their email address, for the contact form's
// "paste the address first, fill the name in after" flow. Pure — no React,
// no DOM.
//
// The address is the only evidence here, so the guesses stay conservative. A
// separated local part (jennie.newman) names both halves outright. A
// run-together one (jnewman) can only be read as an initial plus a surname,
// and the leading letter isn't a first name, so that case offers the surname
// alone rather than inventing one.

import { FREE_MAIL_DOMAINS } from './companyGuess';

// "smith-jones" and "o'brien" are each one name, so capitalize across the
// punctuation rather than only at the front.
function capitalize(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// Particles that belong to the surname following them: "van der berg" is one
// last name, not a first and a last.
const SURNAME_PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'di', 'da', 'dos', 'du',
  'la', 'le', 'den', 'der', 'ten', 'ter', 'af', 'bin', 'ibn', 'mac', 'mc',
]);

// Shared mailboxes aren't people, so there's no name in them to offer.
const ROLE_LOCALS = new Set([
  'info', 'sales', 'support', 'help', 'helpdesk', 'admin', 'administrator',
  'contact', 'contactus', 'hello', 'hi', 'team', 'office', 'mail', 'email',
  'hr', 'jobs', 'careers', 'recruiting', 'marketing', 'press', 'media',
  'billing', 'accounting', 'accounts', 'accountspayable', 'ap', 'ar',
  'invoices', 'orders', 'service', 'customerservice', 'inquiries',
  'enquiries', 'noreply', 'no-reply', 'donotreply', 'webmaster', 'postmaster',
  'abuse', 'security', 'legal', 'privacy', 'general', 'main', 'reception',
  'front desk', 'frontdesk', 'leasing', 'operations', 'ops', 'purchasing',
]);

// Longer than this, a run-together local part is far more likely a whole name
// jammed together (jennifermartinez) than an initial plus a surname
// (jmartinez) — and "Ennifermartinez" is a suggestion nobody wants offered.
const MAX_RUN_TOGETHER = 12;

// Split the local part into name tokens. Dots and underscores separate names;
// a hyphen only does so when neither of those is present, so that
// "mary.smith-jones" keeps the hyphenated surname intact.
function tokenize(local) {
  const parts = /[._]/.test(local) ? local.split(/[._]+/) : local.split(/-+/);
  return parts
    .map(t => t.replace(/[^a-z'’-]/g, ''))
    .filter(Boolean);
}

/**
 * Read a first/last name out of an email address.
 *
 * @param {string} email  the address as typed
 * @returns {{firstname: string, lastname: string} | null}
 *   The parts the address supports — either may be an empty string when the
 *   address doesn't evidence it — or null when there's nothing worth offering.
 */
export function nameFromEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = raw.slice(at + 1);
  if (!domain.includes('.')) return null;
  // Plus-addressing ("jennie.newman+crm@") tags a delivery, not the person.
  const local = raw.slice(0, at).split('+')[0]
    // Trailing digits disambiguate a duplicate in a directory (jnewman2);
    // they're never part of the name.
    .replace(/\d+$/, '');
  if (!local || ROLE_LOCALS.has(local) || ROLE_LOCALS.has(local.replace(/[.\-_]/g, ''))) return null;

  let tokens = tokenize(local);
  // A middle initial sits between the names without being one.
  tokens = tokens.filter((t, i) => i === 0 || i === tokens.length - 1 || t.length > 1);

  if (tokens.length >= 2) {
    const [head, ...rest] = tokens;
    // A leading particle means the local part is all surname ("van.der.berg").
    if (SURNAME_PARTICLES.has(head)) {
      return { firstname: '', lastname: tokens.map(capitalize).join(' ') };
    }
    // Everything from the first particle onward is the surname; without one,
    // the surname is the last token and anything between is a middle name.
    const particleAt = rest.findIndex(t => SURNAME_PARTICLES.has(t));
    const lastTokens = particleAt === -1 ? rest.slice(-1) : rest.slice(particleAt);
    const lastname = lastTokens.map(capitalize).join(' ');
    // "j.newman" gives a surname and an initial; "jennie.n" the reverse.
    if (head.length === 1) return { firstname: '', lastname };
    if (lastname.length === 1) return { firstname: capitalize(head), lastname: '' };
    return { firstname: capitalize(head), lastname };
  }

  // One run-together token. The only reading available is initial + surname,
  // and self-chosen handles at free-mail providers ("bigdog@gmail.com")
  // follow no such convention, so only guess on a company domain.
  const one = tokens[0] || '';
  if (one.length < 4 || one.length > MAX_RUN_TOGETHER) return null;
  if (!/^[a-z]+$/.test(one)) return null;
  if (FREE_MAIL_DOMAINS.has(domain)) return null;
  return { firstname: '', lastname: capitalize(one.slice(1)) };
}
