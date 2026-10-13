// The job titles the Decision Maker tag has actually landed on, for the
// Titles page's Decision Makers tab.
//
// The searches on that page say which titles a persona is pulled BY; this
// says which titles the people who turned out to sign actually hold. Laid
// side by side, a title that keeps showing up here and appears in no search
// is a search term somebody should add.
//
// One row per title, A to Z, with the decision makers who hold it. Titles
// are grouped ignoring case and spacing ("VP, Sustainability" and
// "vp,  sustainability" are one title typed twice), and the row shows the
// spelling most of them carry.

import { isDecisionMakerContact } from './decisionMakerCoverage.js';

const titleKey = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();

const contactName = (c) =>
  [c?.firstname, c?.lastname].map(s => String(s || '').trim()).filter(Boolean).join(' ')
  || String(c?.email || '').trim()
  || 'Unnamed contact';

/**
 * Decision makers' job titles, alphabetical.
 *
 * Returns `{ titles: [{ title, count, contacts }], untitled }`, where
 * `contacts` is `[{ name, company }]` sorted by name and `untitled` is how
 * many decision makers have no job title on file. `isDm` defaults to the
 * shared Decision Maker gate so this page counts the same people the DMs
 * tab lists.
 */
export function decisionMakerTitles(contacts, isDm = isDecisionMakerContact) {
  const byKey = new Map();
  let untitled = 0;
  for (const c of contacts || []) {
    if (!isDm(c)) continue;
    const raw = String(c?.jobtitle || '').replace(/\s+/g, ' ').trim();
    if (!raw) { untitled += 1; continue; }
    const key = titleKey(raw);
    let row = byKey.get(key);
    if (!row) { row = { spellings: new Map(), contacts: [] }; byKey.set(key, row); }
    row.spellings.set(raw, (row.spellings.get(raw) || 0) + 1);
    row.contacts.push({ name: contactName(c), company: String(c?.company || '').trim() });
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const titles = [...byKey.values()].map(row => {
    // The commonest spelling. Ties go by code point, which puts capitals
    // first ("VP" over "vp") and keeps the label from changing with the
    // order the cache happened to load in.
    const title = [...row.spellings.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
    const people = row.contacts.sort((a, b) => collator.compare(a.name, b.name));
    return { title, count: people.length, contacts: people };
  });
  titles.sort((a, b) => collator.compare(a.title, b.title) || a.title.localeCompare(b.title));
  return { titles, untitled };
}
