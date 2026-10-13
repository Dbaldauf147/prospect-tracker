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
import { tagKey } from './contactTagReview.js';

// Every row carries Decision Maker, so a column of it would only repeat the
// count.
const DM_TAG = tagKey('Decision Maker');

// A contact's Dan's Tags, one entry per tag, spelling variants of one tag
// ("Efficiency / Renewables", "Efficiency/Renewables") folded together.
function tagsOf(c) {
  const seen = new Map();
  for (const raw of String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').split(';')) {
    const t = clean(raw);
    const k = tagKey(t);
    if (t && k !== DM_TAG && !seen.has(k)) seen.set(k, t);
  }
  return seen;
}

// Text as it should read. Some HubSpot job titles arrive with U+FFFD, the
// "?" in a black diamond a browser draws for a character it couldn't
// decode. In every one seen so far it stood where a space was (a
// non-breaking space mangled on import: "Managing\uFFFDDirector,\uFFFDHead"),
// so it is read as a space, which also lets that title fold into the row
// of the same title typed cleanly.
const clean = (s) => String(s || '').replace(/\uFFFD/g, ' ').replace(/\s+/g, ' ').trim();

const titleKey = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();

// The commonest spelling in a Map(spelling -> count). Ties go by code point,
// which puts capitals first ("VP" over "vp") and keeps the label from
// changing with the order the cache happened to load in.
const commonest = (spellings) => [...spellings.entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];

const contactName = (c) =>
  [c?.firstname, c?.lastname].map(clean).filter(Boolean).join(' ')
  || String(c?.email || '').trim()
  || 'Unnamed contact';

/**
 * Decision makers' job titles, alphabetical.
 *
 * Returns `{ titles: [{ title, count, contacts, tagCounts }], tags, untitled }`.
 * `contacts` is `[{ name, company, tags }]` sorted by name; `tagCounts` is
 * { tag key: how many of this title's holders carry it }; `tags` is every
 * tag the decision makers carry besides Decision Maker itself, as
 * `[{ key, label, count }]`, commonest first, for the page's tag columns;
 * `untitled` is how many decision makers have no job title on file. `isDm` defaults to the
 * shared Decision Maker gate so this page counts the same people the DMs
 * tab lists.
 */
export function decisionMakerTitles(contacts, isDm = isDecisionMakerContact) {
  const byKey = new Map();
  const tagTotals = new Map();
  let untitled = 0;
  for (const c of contacts || []) {
    if (!isDm(c)) continue;
    const raw = clean(c?.jobtitle);
    if (!raw) { untitled += 1; continue; }
    // Counted over the titled ones only, so a column's total is the sum
    // of the rows under it.
    const tags = tagsOf(c);
    for (const [k, label] of tags) {
      const t = tagTotals.get(k);
      if (t) {
        t.count += 1;
        t.spellings.set(label, (t.spellings.get(label) || 0) + 1);
      } else {
        tagTotals.set(k, { key: k, count: 1, spellings: new Map([[label, 1]]) });
      }
    }
    const key = titleKey(raw);
    let row = byKey.get(key);
    if (!row) { row = { spellings: new Map(), contacts: [], tagCounts: {} }; byKey.set(key, row); }
    row.spellings.set(raw, (row.spellings.get(raw) || 0) + 1);
    for (const k of tags.keys()) row.tagCounts[k] = (row.tagCounts[k] || 0) + 1;
    row.contacts.push({ name: contactName(c), company: clean(c?.company), tags: [...tags.keys()] });
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const titles = [...byKey.values()].map(row => {
    const title = commonest(row.spellings);
    const people = row.contacts.sort((a, b) => collator.compare(a.name, b.name));
    return { title, count: people.length, contacts: people, tagCounts: row.tagCounts };
  });
  titles.sort((a, b) => collator.compare(a.title, b.title) || a.title.localeCompare(b.title));
  const tags = [...tagTotals.values()]
    .map(t => ({ key: t.key, label: commonest(t.spellings), count: t.count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
  return { titles, tags, untitled };
}
