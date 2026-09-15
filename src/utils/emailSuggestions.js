// The addresses to offer a contact whose email nobody has yet, and which one
// of them to back. Pure - no React, no DOM.
//
// The contact form has offered a handful of shapes at the company's domain
// for a while - first.last@, firstlast@, flast@, first@ - and left the user
// to pick. Four chips in a row all look equally likely, so picking meant
// guessing, and guessing wrong means an address that bounces or, worse, one
// that quietly reaches nobody.
//
// The app already knows better than that. A company record carries an Email
// Domains field holding the convention its addresses are built to, and
// behind that sits every contact already on the account with an address that
// can be read back into a convention. So one suggestion is marked as the
// likely one, and it is marked on evidence:
//
//   'recorded'  the company's Email Domains field names the pattern. This
//               is somebody's stated answer for this company and it wins.
//   'learned'   no pattern on file, but the people already at that domain
//               are written one way more than any other. Carries the count,
//               so the form can say what it is leaning on.
//   'common'    neither. first.last@ is the commonest corporate convention
//               there is, so it is still the one to try first - but the
//               form says that is all it is, because a star that means "we
//               know" and a star that means "usually" have to be tellable
//               apart by whoever is about to send an email.
//
// A pattern on record can be one the four fixed shapes never produce
// (lastname.firstname@, firstname_lastname@). When it is, it is added to the
// list rather than starring nothing: the point of knowing a company's
// convention is to offer what it builds.

import {
  buildEmailFromPattern,
  estimateEmailDomain,
} from './emailDomainPattern.js';

const namePart = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Read the Email Domains field into the domains to suggest at, keeping the
 * pattern half where one was recorded.
 *
 * Entries come in both shapes: "amh.com" is a bare domain and
 * "firstname.lastname@amh.com" names the convention too. A domain appears
 * once, and the first entry naming a pattern for it is the one that counts.
 */
function readDomains(emailDomains = []) {
  const out = [];
  const seen = new Map();
  for (const raw of emailDomains || []) {
    const entry = String(raw || '').replace(/^@/, '').trim();
    if (!entry) continue;
    const at = entry.lastIndexOf('@');
    const domain = (at === -1 ? entry : entry.slice(at + 1)).toLowerCase().trim();
    const patternKey = at === -1 ? '' : entry.slice(0, at).toLowerCase().trim();
    if (!domain || !domain.includes('.')) continue;
    if (!seen.has(domain)) {
      const rec = { domain, patternKey, entry };
      seen.set(domain, rec);
      out.push(rec);
    } else if (patternKey && !seen.get(domain).patternKey) {
      // A bare domain listed first does not get to silence a pattern
      // recorded further down the same field.
      const rec = seen.get(domain);
      rec.patternKey = patternKey;
      rec.entry = entry;
    }
  }
  return out;
}

/**
 * Addresses to offer for this person, best first.
 *
 * @param firstname / lastname  the name as typed on the form
 * @param emailDomains  the company's Email Domains field, already split
 * @param contacts      the company's contacts, to learn a convention from
 *                      when the field records none
 * @returns {Array<{email: string, primary: boolean, basis: string,
 *                  why: string}>}
 *   `primary` marks the one to back - at most one, and only when there is
 *   something to offer at all. `basis` is 'recorded' | 'learned' | 'common'
 *   and `why` says it in a sentence, for the chip's tooltip.
 */
export function emailSuggestions({
  firstname = '', lastname = '', emailDomains = [], contacts = [],
} = {}) {
  const first = namePart(firstname);
  const last = namePart(lastname);
  if (!first && !last) return [];
  const domains = readDomains(emailDomains);
  if (domains.length === 0) return [];

  // The shapes the form has always offered, at every domain on file.
  const list = [];
  for (const { domain } of domains) {
    if (first && last) {
      list.push(`${first}.${last}@${domain}`);
      list.push(`${first}${last}@${domain}`);
      list.push(`${first[0]}${last}@${domain}`);
    }
    if (first) list.push(`${first}@${domain}`);
  }
  let unique = [...new Set(list)];
  if (unique.length === 0) return [];

  // Which one to back, in order of what is actually known.
  let primary = '';
  let basis = 'common';
  let why = '';

  for (const d of domains) {
    if (!d.patternKey) continue;
    const built = buildEmailFromPattern(d.entry, first, last);
    if (!built) continue;
    primary = built;
    basis = 'recorded';
    why = `The Email Domains field on this company says addresses at ${d.domain} are built as ${d.patternKey}.`;
    break;
  }

  if (!primary) {
    const learned = estimateEmailDomain(contacts);
    // Only a domain this company actually lists: a convention learned off a
    // parent company's roster is not evidence about an address here.
    const onFile = learned.entry && domains.some(d => d.domain === learned.domain);
    const built = onFile ? buildEmailFromPattern(learned.entry, first, last) : '';
    if (built) {
      primary = built;
      basis = 'learned';
      const people = `${learned.votes} of the ${learned.domainCount} contact${learned.domainCount === 1 ? '' : 's'}`;
      why = `${people} already at ${learned.domain} ${learned.votes === 1 ? 'is' : 'are'} written this way. Nothing is recorded in the Email Domains field, so this is read off them.`;
    }
  }

  if (!primary) {
    // Nothing on file and nobody to learn from. first.last@ is the
    // commonest convention there is, which is a reason to try it first and
    // not a reason to believe it.
    primary = unique[0];
    basis = 'common';
    why = 'Nothing on record for this company and no contacts at it to learn from, so this is just the commonest convention. Worth checking before you send.';
  }

  // A recorded or learned pattern can build something the four fixed shapes
  // never do. Offer it rather than starring a chip that is not there.
  if (!unique.includes(primary)) unique = [primary, ...unique];

  return unique
    .map(email => ({
      email,
      primary: email === primary,
      basis: email === primary ? basis : '',
      why: email === primary ? why : '',
    }))
    // The one to back leads. The rest keep the order they were built in, so
    // the list does not reshuffle itself as a name is typed.
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
}
