// Reviewing Company pins (contactLocalFields[id]._companyOverride) against
// what HubSpot says now.
//
// Recover company mappings (#3503) put back every backup pin for a contact
// that was unmapped now, if the pin named one of your accounts. That is also
// exactly what a job change looks like: HubSpot moved on to the new employer
// (unmapped), an old backup still pinned the old one (an account), and the
// recovery moved the contact back to where they used to work. The same went
// for a pin cleared on purpose. Both tools here sort those out:
//
//  - pinRisk says why a pin looks like it would move someone back to a job
//    they have left, or '' when it doesn't.
//  - findSuspectPins lists the pins on contacts now that look that way, with
//    whether the backups show the pin was gone and came back (a recovered
//    pin, rather than one typed on purpose), for the undo.
//  - pinRecoveryRows is the recovery's own preview, with the risky ones
//    unticked.
import { contactDisplayName, rosterCompaniesMatch } from './contactRosters.js';

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pinOf = (entry) => (isMap(entry) && typeof entry._companyOverride === 'string' ? entry._companyOverride.trim() : '');

/** The contact's Company as HubSpot has it, without the pin. */
export function hubspotCompanyOf(c) {
  return String(c?.company || c?.companyText || '').trim();
}

/**
 * Why putting `pin` on this contact (the raw HubSpot record, no pin applied)
 * looks like moving them back to a job they have left; '' when it doesn't.
 * HubSpot having no company, or a spelling of the same one, is not a risk:
 * that is what a pin lost to the stale save looks like.
 */
export function pinRisk(contact, pin) {
  const p = String(pin || '').trim();
  if (!p) return '';
  const tags = String(contact?.dans_tags || contact?.dan_s_tags || contact?.dans_tag || '')
    .split(';').map(t => t.trim().toLowerCase());
  if (tags.includes('left')) return 'Tagged Left';
  const hs = hubspotCompanyOf(contact);
  if (!hs) return '';
  if (hs.toLowerCase() === 'changed jobs') return 'HubSpot has them as Changed Jobs';
  if (sameCompany(hs, p)) return '';
  return `HubSpot has them at ${hs}`;
}

// The app's usual near-name match, plus one name being the other with more
// words after it ("OXEA" and "OXEA GmbH"), which the usual one leaves out
// for a short name but which is never a job change.
function sameCompany(a, b) {
  if (rosterCompaniesMatch(a, b)) return true;
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.startsWith(short) && /^[\s,.(&-]/.test(long.slice(short.length));
}

const newestFirst = (sources) => (sources || [])
  .filter(s => isMap(s?.data?.contactLocalFields))
  .slice()
  .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));

/**
 * Whether the backups show this contact's pin was gone and then came back:
 * some backup holds the pin, and a newer one doesn't. `sorted` is newest
 * first. Returns { lostIn, heldIn } (backup labels) or null.
 */
function pinGap(id, pin, sorted) {
  const want = pin.toLowerCase();
  let lostIn = null;
  for (const s of sorted) {
    const have = pinOf(s.data.contactLocalFields[id]).toLowerCase();
    if (have === want) {
      if (lostIn) return { lostIn, heldIn: s.label || '' };
    } else if (!lostIn) {
      lostIn = s.label || 'a backup';
    }
  }
  return null;
}

/**
 * The pins on contacts now that look like they hold someone at a job they
 * have left: the pin names one of your accounts and pinRisk flags it.
 * `contacts` are the raw HubSpot records, `accountNames` a Set of lowercase
 * account names, `sources` the settings backups (any order; each with `at`).
 *
 * Returns [{ id, name, email, hubspotCompany, pin, why, restored, from, contact }]
 * with the pins the backups show coming back (`restored`, the ones the
 * recovery most likely put there) first, then by name.
 */
export function findSuspectPins({ contacts = [], localFields = {}, accountNames = new Set(), sources = [] }) {
  const sorted = newestFirst(sources);
  const out = [];
  for (const c of contacts) {
    const id = String(c?.id || c?.vid || '');
    if (!id) continue;
    const pin = pinOf(localFields?.[id]);
    if (!pin || !accountNames.has(pin.toLowerCase())) continue;
    const why = pinRisk(c, pin);
    if (!why) continue;
    const gap = pinGap(id, pin, sorted);
    out.push({
      id,
      name: contactDisplayName(c),
      email: String(c?.email || '').trim(),
      hubspotCompany: hubspotCompanyOf(c),
      pin,
      why,
      restored: !!gap,
      from: gap ? `missing in ${gap.lostIn}, held in ${gap.heldIn}` : '',
      contact: c,
    });
  }
  return out.sort((a, b) => (Number(b.restored) - Number(a.restored)) || a.name.localeCompare(b.name));
}

/**
 * The recovery's preview: one row per pin it found (`found` from
 * recoverChangedJobsFlags), with the contact as HubSpot has it and why the
 * pin looks risky. Risky rows are left unticked (`tick`).
 */
export function pinRecoveryRows(found, contactById) {
  return (found || []).map((f) => {
    const c = contactById.get(String(f.id)) || null;
    const why = c ? pinRisk(c, f.value) : '';
    return {
      id: String(f.id),
      name: c ? contactDisplayName(c) : `contact ${f.id}`,
      email: String(c?.email || '').trim(),
      hubspotCompany: c ? hubspotCompanyOf(c) : '',
      pin: String(f.value || ''),
      why,
      tick: !why,
      from: f.from || '',
      contact: c,
    };
  }).sort((a, b) => (Number(a.tick) - Number(b.tick)) || a.name.localeCompare(b.name));
}
