// The title searches behind each contact persona.
//
// Seven searches, kept as they were worked out in the sheet they came from
// rather than tidied on the way in: these are the strings that get typed
// into HubSpot and ZoomInfo, so a term "corrected" here is a term that
// stops matching the people it used to. "Health and saftey", "Doesnt have"
// and "Power?" are all in the source exactly as they read below, and the
// last one is the author asking themselves a question rather than naming a
// title.
//
// A search is a scope plus one or more groups of terms. The GROUPS are the
// part worth keeping faithful: three of these columns were written with
// their own headings - "Not", "Include", "Doesnt have" - and four were
// written as a flat list of titles with no heading at all. A flat list is
// carried as one unlabelled include group rather than being given a
// heading it never had, and the page says so, because "these are the
// titles" and "these are the titles the author confirmed are the titles"
// are not the same claim.
//
// `kind` is 'include' for terms to search for and 'exclude' for terms that
// disqualify a hit. Nothing reads it yet - this page is a reference, and
// the searches are still run by hand in HubSpot - but it is the difference
// between the two halves of a column and dropping it would lose it.
//
// This list is the STARTING POINT, not the whole story. The page edits
// these searches and saves the result to settings.contactTitleSearches,
// which then stands in for this list entirely (see resolveTitleSearches).
// The seven below are what a user who has never edited sees, and what
// Reset puts back.

export const CONTACT_TITLE_SEARCHES = [
  {
    key: 'esg',
    name: 'ESG reporting',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: 'Not',
        kind: 'exclude',
        terms: [
          'Executive assistant', 'Intern', 'Analyst', 'Tax', 'Carpenter',
          'Investing', 'Credit', 'Asia', 'Fixed income', 'Research',
          'Health and saftey', 'Beyond Net Zero', 'Sustainable Finance',
          'Trading', 'Europe', 'Underwriter', 'Analytics', 'Underwriting',
        ],
      },
      {
        label: 'Include',
        kind: 'include',
        terms: [
          'CSR', 'Decarbonization', 'ESG', 'Sustainability', 'Net Zero',
          'Carbon', 'CSO', 'Sustainable', 'Climate', 'Corporate Responsibility',
          'Renewable',
        ],
      },
    ],
  },
  {
    key: 'utilities',
    name: 'Utilities',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Energy', 'Energy Manager', 'Energy Buyer', 'Energy Procurement',
          'Energy Risk', 'Property Management', 'Chief Operating Officer',
          'Building Operations', 'Facilities', 'Facility', 'Operations',
          'Procurement', 'Utilities', 'Utility', 'Accounting',
        ],
      },
    ],
  },
  {
    key: 'procurement',
    name: 'Procurement',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Energy Manager', 'Energy Buyer', 'Energy Procurement', 'Energy Risk',
          'Chief Operating Officer', 'Building Operations', 'Facilities',
          'Facility', 'Expense Management', 'Power?', 'Utilities',
          'Energy Analyst', 'Energy Contracts Manager', 'Energy Supply Manager',
          'Strategic Sourcing Manager', 'Utility Procurement',
          'Director Facilities', 'Director Property Management',
          'Vice President Facilities', 'Vice President Property Management',
          'Senior VP Facilities', 'Senior VP Property Management',
          'Procurement', 'Energy Supply', 'Strategic Sourcing',
          'Chief Procurement Officer', 'Energy',
        ],
      },
    ],
  },
  {
    key: 'engineering',
    name: 'Engineering',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Chief Operating Officer', 'Building Operations', 'Facilities',
          'Facility', 'Capital Budget', 'Building Systems', 'Engineer',
          'Engineering', 'HVAC', 'Maintenance', 'Mechanical', 'Operations',
        ],
      },
    ],
  },
  {
    key: 'climate-risk',
    name: 'Climate Risk',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Chief Compliance Officer', 'Chief Risk Officer',
          'Chief Risk and Compliance Officer', 'Director of Risk Management',
          'Compliance Manager', 'Risk and Compliance Analyst',
          'Regulatory Affairs Specialist', 'Internal Auditor',
        ],
      },
    ],
  },
  {
    key: 'private-equity',
    name: 'Private Equity',
    scope: 'North American Contacts Only',
    groups: [
      { label: 'Not', kind: 'exclude', terms: ['Human resources', 'Talent'] },
      {
        label: 'Include',
        kind: 'include',
        terms: [
          'Chief Transformation Officer', 'Head of Portfolio Operations',
          'Operating Partner', 'Operational Excellence', 'Portfolio Company',
          'Portfolio Operations', 'Portfolio Performance',
          'Portfolio Transformation', 'Procurement Director',
          'Strategic Sourcing Lead', 'Value Creation', 'Vendor Management',
          'Partnership', 'Chief Operating Officer', 'Operating Vice President',
        ],
      },
    ],
  },
  {
    key: 'cfo',
    name: 'CFO',
    scope: 'North American Contacts Only',
    groups: [
      { label: '', kind: 'include', terms: ['Chief Financial Officer', 'CFO'] },
      {
        label: 'Doesnt have',
        kind: 'exclude',
        terms: [
          'Does not include EMEA', 'Asia', 'Europe', 'Executive Assistant',
          'China', 'Credit', 'Fund',
        ],
      },
    ],
  },
];

// Every term in one search, both halves, for the search box on the page.
export function searchTerms(entry) {
  return (entry?.groups || []).flatMap(g => g.terms || []);
}

// How many terms a search carries, said on its card so two columns of
// chips can be told apart at a glance.
export function termCount(entry) {
  return searchTerms(entry).length;
}

// The searches to show: whatever the user has saved, else the seven above.
//
// A saved list REPLACES the defaults rather than layering over them. A
// patch model would have to answer what happens to a default search the
// user deleted, and every answer to that is a search that comes back on
// the next release - which, for a page whose whole job is to say what to
// type, is worse than no defaults at all. Reset is the way back.
//
// Settings can hold whatever an older version of this page wrote, or a
// half-finished hand edit, so the saved value is put back through
// normalizeTitleSearches before anything renders it.
export function resolveTitleSearches(settings) {
  const saved = settings?.contactTitleSearches;
  if (!Array.isArray(saved)) return CONTACT_TITLE_SEARCHES;
  const clean = normalizeTitleSearches(saved);
  // An empty saved list is a real state - the user deleted every search -
  // and it is not the same as never having edited. Only a value that
  // isn't a list at all falls back to the defaults.
  return clean;
}

// Coerce a stored list into the shape the page renders, dropping nothing
// the user can see: a search with no terms left is still a search they can
// type into, and a group whose heading was cleared is an unheaded group,
// which this data has four of already.
export function normalizeTitleSearches(list) {
  const out = [];
  const usedKeys = new Set();
  for (const raw of (Array.isArray(list) ? list : [])) {
    if (!raw || typeof raw !== 'object') continue;
    let key = String(raw.key || '').trim() || slugifyKey(raw.name);
    // Two searches sharing a key would collide as React keys and, worse,
    // would edit each other. Suffix rather than drop: a duplicate is a
    // search somebody wrote, and it renders fine once it is distinct.
    if (!key || usedKeys.has(key)) key = uniqueKey(key || 'search', usedKeys);
    usedKeys.add(key);
    out.push({
      key,
      name: String(raw.name ?? '').trim(),
      scope: String(raw.scope ?? '').trim(),
      groups: (Array.isArray(raw.groups) ? raw.groups : []).map(g => ({
        label: String(g?.label ?? '').trim(),
        kind: g?.kind === 'exclude' ? 'exclude' : 'include',
        // Terms keep their own spacing-trimmed text and their order.
        // Blank entries are dropped because an empty chip is not a term,
        // but duplicates are kept: a list that silently loses its second
        // "Energy" is a list that no longer matches what gets pasted into
        // the search box.
        terms: (Array.isArray(g?.terms) ? g.terms : [])
          .map(t => String(t ?? '').trim())
          .filter(Boolean),
      })),
    });
  }
  return out;
}

// A key for a newly added search, derived from its name so the stored data
// stays readable, and suffixed when the slug is taken or the name is empty.
export function slugifyKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function uniqueKey(base, usedKeys) {
  const stem = slugifyKey(base) || 'search';
  if (!usedKeys.has(stem)) return stem;
  let n = 2;
  while (usedKeys.has(`${stem}-${n}`)) n += 1;
  return `${stem}-${n}`;
}
