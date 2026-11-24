// How each email format on a company card has actually done: of the
// addresses written that way that were emailed, how many arrived and how
// many failed. Shown on each row of the Email Domains picker
// (ProspectModal/EmailDomainsField.jsx), so a format is judged on what
// happened to the mail and not only on how many contacts are written in it.
//
// The evidence is the same the Email Campaigns page reads:
//   - a saved campaign row with a sent date is an email that went out;
//   - it failed when the campaign caught a bounce on it (contact.bounced)
//     or the address stands flagged from a forwarded failure notice
//     (settings.badEmails, utils/badEmails.js);
//   - otherwise it went out and nothing bounced, which is what the app
//     calls delivered (utils/deliveryStatus.js).
// A flagged address counts as failed even when no saved campaign sent to
// it: a failure notice only exists because something was sent.
//
// Counted per address, not per send, so one person mailed six times is one
// answer about the format rather than six.
import { detectLocalPattern, domainOf } from './emailDomainPattern.js';
import { badEmailInfo, contactFailedEmails, normEmail } from './badEmails.js';

const splitEmails = (raw) => String(raw || '').split(/[;,\s]+/).map(normEmail).filter(e => e.includes('@'));

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * @param entries  the picker's formats ("pattern@domain", or a bare domain)
 * @param data.campaigns        saved campaigns ({ contacts: [{ email, name, sentDate, bounced }] })
 * @param data.badEmails        settings.badEmails
 * @param data.contacts         the company's contacts ({ id, email, firstname, lastname })
 * @param data.failedByContact  settings.contactFailedEmails
 * @returns Map of lowercased entry -> { delivered, failed, sends,
 *          failedEmails: [address], deliveredEmails: [address] }; an entry
 *          nothing was ever sent to is left out. A bare domain counts every
 *          address on it.
 */
export function emailFormatDelivery(entries, { campaigns = [], badEmails = {}, contacts = [], failedByContact = {} } = {}) {
  const wanted = (entries || []).map(e => {
    const entry = String(e || '').trim().toLowerCase();
    const at = entry.lastIndexOf('@');
    return { entry, pattern: at > 0 ? entry.slice(0, at) : '', domain: at >= 0 ? entry.slice(at + 1) : entry };
  }).filter(w => w.domain);
  const out = new Map();
  if (!wanted.length) return out;
  const domains = new Set(wanted.map(w => w.domain));

  // Whose address is it: the format is read off the name.
  const names = new Map();
  for (const c of contacts || []) {
    const who = { first: c?.firstname || '', last: c?.lastname || '' };
    const email = normEmail(c?.email);
    if (email) names.set(email, who);
    // An address the contact moved off after it bounced is still theirs.
    for (const x of contactFailedEmails(failedByContact, c?.id ?? c?.vid)) {
      const old = normEmail(x.email);
      if (old && !names.has(old)) names.set(old, who);
    }
  }

  const seen = new Map(); // address -> { sends, failed }
  const at = (email) => {
    if (!seen.has(email)) seen.set(email, { sends: 0, failed: false });
    return seen.get(email);
  };
  for (const camp of campaigns || []) {
    for (const c of camp?.contacts || []) {
      if (!c?.sentDate) continue;
      const emails = splitEmails(c.email);
      emails.forEach((email, i) => {
        if (!domains.has(domainOf(email))) return;
        const a = at(email);
        a.sends += 1;
        // A bounce on a group row lands on its first address, as on the
        // Failed Emails tab (utils/failedCampaignEmails.js).
        if (c.bounced && i === 0) a.failed = true;
        if (!names.has(email) && emails.length === 1) {
          names.set(email, c.firstname || c.lastname ? { first: c.firstname || '', last: c.lastname || '' } : splitName(c.name));
        }
      });
    }
  }
  for (const key of Object.keys(badEmails && typeof badEmails === 'object' ? badEmails : {})) {
    const email = normEmail(key);
    if (domains.has(domainOf(email)) && badEmailInfo(badEmails, email)) at(email).failed = true;
  }

  for (const [email, a] of seen) {
    const who = names.get(email);
    const pattern = who ? detectLocalPattern(email, who.first, who.last) : null;
    const domain = domainOf(email);
    for (const w of wanted) {
      if (w.domain !== domain || (w.pattern && w.pattern !== pattern)) continue;
      if (!out.has(w.entry)) out.set(w.entry, { delivered: 0, failed: 0, sends: 0, failedEmails: [], deliveredEmails: [] });
      const t = out.get(w.entry);
      t.sends += a.sends;
      if (a.failed) { t.failed += 1; t.failedEmails.push(email); } else { t.delivered += 1; t.deliveredEmails.push(email); }
    }
  }
  for (const t of out.values()) { t.failedEmails.sort(); t.deliveredEmails.sort(); }
  return out;
}

/** The hover text for a format's delivery counts. */
export function emailFormatDeliveryTitle(t) {
  if (!t) return '';
  const list = (label, emails) => (emails.length ? `\n${label}: ${emails.slice(0, 12).join(', ')}${emails.length > 12 ? `, and ${emails.length - 12} more` : ''}` : '');
  return 'Addresses written this way that were emailed from a saved campaign, or that a failure notice came back for. '
    + 'Delivered means it went out and nothing bounced. Counted once per address, however many emails it got.'
    + list('Failed', t.failedEmails) + list('Delivered', t.deliveredEmails);
}
