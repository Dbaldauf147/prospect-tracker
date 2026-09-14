// "Met In Person" — one answer to whether a contact has been met, and the
// Key contacts a visit still hasn't reached.
//
// Four answers, not two. It was a checkbox, so everybody who hadn't been
// met read the same: the person you deliberately weren't going to chase,
// the person you asked last week and are waiting on, and the person nobody
// has got to yet were one answer between them, and the visit ladder asked
// about all three again every week. "Hold off" and "Asked" are the other
// two. Hold off parks somebody: not met, and not to be planned for either.
// Asked is the opposite — the ask is out and unanswered, so they stay on
// the list, but knowing it is out is the difference between chasing a
// reply and opening with the same invitation a second time.
//
// The flag itself is local: a dropdown in the contact popup, stored in
// settings.contactMetInPerson and never written back to HubSpot. Before it
// existed the answer lived in a "Met In Person" HubSpot tag, so a contact
// the checkbox has never been touched on falls back to that tag — otherwise
// everyone tagged over the years would have read as never met the day the
// checkbox shipped. That two-step rule was written out on the Key Contacts
// page and again in the contact popup; it lives here now, because the
// Prospecting page's visit list is a third reader, and three copies of a
// fallback rule are three chances for a contact to count as met on one page
// and not on another.

// Imported with the extension so this module also loads under plain Node
// (scripts/metInPerson.test.mjs), not just through the bundler.
import { contactDisplayName } from './contactRosters.js';

export const MET_IN_PERSON_TAG = 'met in person';

// The four answers. Stored as these strings; `no` is the default and the
// one a contact lands on when nothing else says otherwise.
export const MET_YES = 'yes';
export const MET_ASKED = 'asked';
export const MET_NO = 'no';
export const MET_HOLD = 'hold';

// In the order a meeting actually goes: met, asked and waiting, not asked,
// parked. The dropdown prints them as they come.
export const MET_STATE_OPTIONS = [
  { value: MET_YES, label: 'Yes' },
  { value: MET_ASKED, label: 'Asked' },
  { value: MET_NO, label: 'No' },
  { value: MET_HOLD, label: 'Hold off' },
];

/**
 * A stored value as one of the four answers, or null for "nothing stored".
 *
 * Reads the booleans the checkbox wrote, which are still what most of the
 * map holds: `true` is the box ticked, which is Yes, and `false` is the box
 * explicitly cleared, which is No. Nothing is rewritten on load — a
 * migration pass over the map would be a write nobody asked for, and the
 * two shapes read the same here.
 */
export function normalizeMetState(stored) {
  if (stored === true) return MET_YES;
  if (stored === false) return MET_NO;
  const s = String(stored ?? '').trim().toLowerCase();
  if (s === MET_YES) return MET_YES;
  if (s === MET_ASKED) return MET_ASKED;
  if (s === MET_NO) return MET_NO;
  if (s === MET_HOLD) return MET_HOLD;
  return null;
}

/**
 * Which of the four answers a contact carries.
 *
 * The stored value wins wherever there is one — including a stored No,
 * which is the user having explicitly said so and must not be overruled by
 * an old tag. The tag answers for everyone it has never been set on, and
 * everyone else is No, the default.
 */
export function metInPersonState(contact, metMap, fallback = hasMetInPersonTag) {
  const id = String(contact?.id ?? contact?.vid ?? '');
  if (id && metMap && Object.prototype.hasOwnProperty.call(metMap, id)) {
    const state = normalizeMetState(metMap[id]);
    if (state) return state;
  }
  return fallback(contact) ? MET_YES : MET_NO;
}

// The legacy answer: the HubSpot tag, however that column is spelled on the
// record (the cache has carried all three spellings at different points).
export function hasMetInPersonTag(contact) {
  return String(contact?.dans_tags || contact?.dan_s_tags || contact?.dans_tag || '')
    .toLowerCase()
    .includes(MET_IN_PERSON_TAG);
}

// Has this contact been met? Only Yes counts. "Hold off" is a decision not
// to chase somebody and "Asked" is an invitation nobody has answered yet —
// neither is a claim to have sat down with them, so every column and count
// that asks this question reads both as not met.
//
// `fallback` is there for the Key Contacts page, which lets a caller supply
// its own legacy selector; everyone else wants the tag.
export function resolveMetInPerson(contact, metMap, fallback = hasMetInPersonTag) {
  return metInPersonState(contact, metMap, fallback) === MET_YES;
}

// Where a visit would be to, as the contact records it.
function locationOf(contact) {
  return [String(contact?.city || '').trim(), String(contact?.state || '').trim()]
    .filter(Boolean)
    .join(', ');
}

/**
 * The Key roster's not-yet-met contacts, grouped by the account you would
 * be visiting.
 *
 * Reads the roster out of a rosterTagCoverage result rather than gating the
 * contacts again: `coverage.key.people` is already "every contact tagged
 * Dan Key Target that the Clients tab hasn't excluded", computed once for
 * the whole app, and re-deriving it here is how two pages start disagreeing
 * about who is on the roster.
 *
 * Grouped by company because a trip is to a place, not to a person: four
 * names at one account is one visit to plan, and the four separate rows it
 * would otherwise be say nothing about how much of a day it takes. Accounts
 * with the most unmet contacts lead, since those are the ones a visit buys
 * the most from.
 *
 * Contacts marked "hold off" are left out: the ladder exists to say who to
 * go and see, and somebody deliberately parked is not that. They are
 * counted in `onHold` rather than dropped silently, so the page can say
 * how many it is not showing.
 *
 * Contacts marked "asked" stay on it, because an unanswered invitation is
 * still a visit that hasn't happened. Each one carries `asked` and they are
 * counted in `asked` too, so the list can say which names the ask is
 * already out on - the thing that turns a second identical invitation into
 * a follow-up.
 *
 * `isOwnedContact` is the other gate, and it runs before any of the Met In
 * Person reading: the Key roster is "tagged Dan Key Target" and nothing
 * else, so without it the list plans trips to accounts another CDM owns and
 * to ones already written off. Pass the predicate makeOwnedContactGate
 * builds (see ladderOwnership.js) and those names are off the list, the
 * counts beside it included — a contact left out this way is not somebody
 * on hold, it is somebody else's. Omit it and the roster is listed whole,
 * which is what a caller with no book to check against can honestly say.
 *
 * Returns { total, accounts, groups, onHold, asked } — or null while the
 * coverage hasn't landed, so a caller shows nothing rather than an empty
 * list that would read as "you have met everybody".
 */
export function keyContactsNotMet(coverage, metMap = null, isOwnedContact = null) {
  const people = coverage?.key?.people;
  if (!Array.isArray(people)) return null;
  const groups = new Map();
  let total = 0;
  let onHold = 0;
  let asked = 0;
  for (const person of people) {
    const contact = person?.contact || { id: person?.id };
    const company = String(person?.company || contact?.company || '').trim();
    // Before anything else: is this account even the user's to visit? The
    // gate reads the company name and the email, so it is handed whichever
    // of the two the coverage row and the record between them carry.
    if (isOwnedContact && !isOwnedContact({
      ...contact,
      company,
      email: String(person?.email || contact?.email || '').trim(),
    })) continue;
    const state = metInPersonState(contact, metMap);
    if (state === MET_YES) continue;
    if (state === MET_HOLD) { onHold += 1; continue; }
    total += 1;
    if (state === MET_ASKED) asked += 1;
    // Everyone with no company on the record shares one group at the
    // bottom: there is no account to visit, but they are still Key contacts
    // nobody has sat down with, and dropping them would leave the count on
    // the row disagreeing with the names under it.
    const key = company.toLowerCase() || ' nocompany';
    let group = groups.get(key);
    if (!group) {
      group = { company, location: '', people: [] };
      groups.set(key, group);
    }
    // The first location any of them names. They are colleagues at one
    // account, so a second city is usually a remote employee rather than a
    // second trip — not worth a row of its own on a ladder.
    if (!group.location) group.location = locationOf(contact);
    group.people.push({
      id: person?.id ?? (contact?.id == null ? null : String(contact.id)),
      name: person?.name || contactDisplayName(contact),
      email: String(person?.email || contact?.email || '').trim(),
      // The invitation is already out on this one. On the row it is the
      // difference between asking and chasing; it does not take them off
      // the list, because they still haven't been met.
      asked: state === MET_ASKED,
      // The record itself, so a name here opens the contact popup — which
      // is where the Met In Person answer is set, so the list can be
      // worked off from the row that raised it.
      contact: person?.contact || null,
    });
  }
  const out = [...groups.values()];
  for (const g of out) g.people.sort((a, b) => a.name.localeCompare(b.name));
  out.sort((a, b) => (
    b.people.length - a.people.length
    // The company-less group is last however many people are in it: it's a
    // list of names, not somewhere to go.
    || Number(!a.company) - Number(!b.company)
    || a.company.localeCompare(b.company)
  ));
  return { total, accounts: out.filter(g => g.company).length, groups: out, onHold, asked };
}
