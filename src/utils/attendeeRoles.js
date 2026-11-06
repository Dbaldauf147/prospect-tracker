// Which customer-side meeting attendees deserve to stand out on the
// Opportunity form's Attendees list (and the Excel export of it):
//
//   - PE owner: the attendee works for the company's PE owner (the
//     prospect's PE Owner field, possibly several firms). Their HubSpot
//     company is compared against each owner after stripping corporate
//     suffixes and punctuation, so "Strategic Value Partners, LLC" and
//     "Strategic Value Partners" are the same firm.
//   - Primary POC: the contact carries Dan's "Primary Point of Contact"
//     tag, the same flag the contacts pages and PE sheet read.
import { splitPeOwners } from './peOwners.js';
import { tagListHas } from './contactTagReview.js';

const SUFFIX = /\b(inc|incorporated|llc|llp|lp|ltd|limited|plc|corp|corporation|co|company|group|holdings|gmbh|ag|sa|nv)\b\.?/g;

export function normFirm(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Does `company` name the same firm as one of `owners` (a PE Owner
// string or an array of firm names)? Returns the matching owner, or ''.
export function matchPeOwner(company, owners) {
  const c = normFirm(company);
  if (!c) return '';
  const list = Array.isArray(owners) ? owners : splitPeOwners(owners);
  for (const o of list) {
    const n = normFirm(o);
    if (!n) continue;
    if (n === c) return o;
    // "KKR" vs "KKR Infrastructure": the shorter name has to be a whole
    // leading run of words of the longer one, and not a stub.
    const [short, long] = n.length <= c.length ? [n, c] : [c, n];
    if (short.length >= 3 && long.startsWith(short + ' ')) return o;
  }
  return '';
}

export function contactTags(contact) {
  return String(contact?.dans_tags || contact?.dan_s_tags || contact?.dans_tag || '')
    .split(';')
    .flatMap(t => t.split(','))
    .map(t => t.trim())
    .filter(Boolean);
}

export function isPrimaryPoc(contact) {
  return tagListHas(contactTags(contact), 'Primary Point of Contact');
}

// { peOwner: '<firm>' | '', primaryPoc: bool } for one attendee, reading
// its matched HubSpot contact.
export function attendeeRoles(attendee, owners) {
  const m = attendee?.match || null;
  return {
    peOwner: matchPeOwner(m?.company || '', owners),
    primaryPoc: isPrimaryPoc(m),
  };
}
