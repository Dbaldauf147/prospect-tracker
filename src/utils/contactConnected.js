// The contact popup's "Connected?" tick (settings.contactConnected, keyed by
// HubSpot contact id), and the opps that make a contact connected without
// one.
//
// The tick used to be saved as a whole copy of the map taken when the page
// last rendered ({ ...settings.contactConnected, [id]: on }). A save that
// overlapped another, or ran from a page holding an older copy, could put
// the old value back, and the popups opened through useContactEditSettings
// (Prospecting, Agenda, Relationships, Email Campaigns) had no writer at
// all, so the tick there never saved. contactConnectedUpdate is the one
// writer: a function of the settings as they are when the save runs, which
// updateSettings also redoes on the stored copy if this one was behind.
import { contactName } from './relationshipStrength.js';
import { rosterCompaniesMatch } from './contactRosters.js';

/** The updateSettings() function that sets one contact's tick. */
export function contactConnectedUpdate(contactId, on) {
  return (settings) => {
    const id = String(contactId ?? '').trim();
    if (!id) return null;
    const cur = settings?.contactConnected;
    const map = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    if (!!map[id] === !!on && (id in map)) return null;
    return { contactConnected: { ...map, [id]: !!on } };
  };
}

// Same company for this purpose: the app's near-name match, or one name
// being the other with more words after it ("CBRE" on the opp, "CBRE
// Investment Management" in HubSpot).
function sameCompany(a, b) {
  if (rosterCompaniesMatch(a, b)) return true;
  const x = String(a || '').toLowerCase().trim();
  const y = String(b || '').toLowerCase().trim();
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.startsWith(short) && /^[\s,.(&-]/.test(long.slice(short.length));
}

/**
 * The opps indexed for oppNamingContact: by the email each stored for a
 * tagged contact (`_contactEmails`, name -> email), and by each name in its
 * Contact list. Built once per opps load, so a table of thousands of
 * contacts doesn't split every opp's Contact text again for each one.
 */
export function buildOppContactIndex(oppsRecords) {
  const byEmail = new Map();
  const byName = new Map();
  for (const r of oppsRecords || []) {
    const listed = String(r?.Contact ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!listed.length) continue;
    const emails = r?._contactEmails && typeof r._contactEmails === 'object' ? r._contactEmails : {};
    for (const n of listed) {
      const e = String(emails[n] || '').trim().toLowerCase();
      if (e && !byEmail.has(e)) byEmail.set(e, r);
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(r);
    }
  }
  return { byEmail, byName };
}

/**
 * The first opp this contact is named on, or null. Named means the opp's
 * Contact list holds them: by the email the opp stored for them when they
 * were tagged (`_contactEmails`), or by full name at an Account that is
 * their company (any account when HubSpot has no company for them).
 * `opps` is the opps list or an index from buildOppContactIndex.
 */
export function oppNamingContact(contact, opps) {
  if (!contact || !opps) return null;
  const index = Array.isArray(opps) ? buildOppContactIndex(opps) : opps;
  const email = String(contact.email || '').trim().toLowerCase();
  if (email && index.byEmail.has(email)) return index.byEmail.get(email);
  const name = contactName(contact).toLowerCase();
  if (!name) return null;
  const company = String(contact.company || '').trim();
  for (const r of index.byName.get(name) || []) {
    const acct = String(r?.Account || '').trim();
    if (!company || !acct || sameCompany(company, acct)) return r;
  }
  return null;
}

/**
 * Whether a contact counts as Connected, and why: { on, manual, opp }.
 * `manual` is the tick, `opp` the opp naming them (null when none); `opps`
 * as for oppNamingContact. Being
 * on an opp makes them connected whatever the tick says.
 */
export function connectedState(contact, connectedMap, opps) {
  const id = String(contact?.id ?? contact?.vid ?? '');
  const manual = !!(id && connectedMap && connectedMap[id]);
  const opp = oppNamingContact(contact, opps);
  return { on: manual || !!opp, manual, opp };
}
