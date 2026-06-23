// Demo dataset for the standalone Opps + Dropdowns export.
//
// The real Opps page hydrates its rows from a per-user IndexedDB cache
// that's kept in sync with Firestore. In the export there's no backend,
// so `utils/opps2Store.js` (the SHIM) seeds THIS dataset into the
// localStorage-backed cache the first time the page loads. After that,
// your edits in the table persist locally and take precedence.
//
// Shape mirrors what the page expects:
//   { headers: string[], records: Row[], columnLinks, dropdownLists }
// Each row carries internal bookkeeping fields (_id / id / _rowUpdatedAt
// and optional _fieldUpdatedAt) plus one value per column header. Column
// values are plain strings; date columns use ISO `YYYY-MM-DD` so they
// round-trip through the table's date inputs. A few columns (Age, Last
// Spoke, Call In, Close Year/Month) are DERIVED by the page, so we leave
// them blank here.
//
// Stage / Status / Source / Chance? / Scope values are chosen to match
// the built-in dropdown lists (see ./dropdownLists.js) so the linked
// cells show valid selections.

export const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date',
  'BFO Link', 'BFO Company Name', 'Pricing Option',
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date', 'PE Owner',
];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const blanks = () => Object.fromEntries(DEFAULT_HEADERS.map((h) => [h, '']));

function row(id, ageDays, fields) {
  return {
    _id: id,
    id,
    _rowUpdatedAt: now - id * DAY,
    ...blanks(),
    ...fields,
  };
}

const RECORDS = [
  row(1, 39, {
    Account: 'Acme Property Group',
    'Open Year': '2026',
    Contact: 'Alice Johnson',
    Stage: 'Qualifying',
    Scope: 'CSRD readiness',
    Source: 'Self Gen - Prospecting Email',
    Type: 'Owner Operator',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-05-15',
    Status: 'I am waiting on the client',
    'Quoted Amount': '$48,000',
    Sites: '12',
    'Last Client Heard From Us': '2026-06-10',
    'Follow Up': '2026-06-30',
    Notes: 'Sustainability lead is building the internal business case.',
    'Next Steps': 'Send scoping summary\nConfirm number of in-scope sites',
    Competition: 'Watershed',
    'Waiting On': 'Client budget committee',
    'BFO Link': 'BFO-2026-0142',
    'BFO Company Name': 'Acme Property Group LLC',
    'Chance?': 'OK',
    'PE Owner': 'Blackstone',
  }),
  row(2, 12, {
    Account: 'Northwind Logistics',
    'Open Year': '2026',
    Contact: 'Bob Lee',
    Stage: 'Quoting',
    Scope: 'AEM',
    Source: 'Customer Referral',
    Type: 'Operator',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-06-08',
    Status: 'Client waiting on me',
    'Quoted Amount': '$72,500',
    Sites: '34',
    'Follow Up': '2026-07-02',
    Notes: 'Referred by an existing client; warm intro from their COO.',
    'Next Steps': 'Build pricing option\nWalk through AEM coverage',
    'Chance?': 'Expected',
  }),
  row(3, 64, {
    Account: 'Cedar & Vale Real Estate',
    'Open Year': '2026',
    Contact: 'Carla Mendes',
    Stage: 'Lead',
    Scope: 'Audits',
    Source: 'Marketing',
    Type: 'Equity REIT',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-04-20',
    Status: 'Not in direct contact w client',
    Sites: '8',
    'Follow Up': '2026-06-27',
    Notes: 'Inbound from the CSRD webinar. Still identifying the right owner.',
    'Next Steps': 'Find out the story\nIdentify decision maker',
    'Chance?': 'Weak',
  }),
  row(4, 88, {
    Account: 'Harbor Point Holdings',
    'Open Year': '2026',
    Contact: 'David Okoro',
    Stage: 'Contracting',
    Scope: 'CSRD readiness',
    Source: 'Existing Customer',
    Type: 'RE Investment Manager',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-03-26',
    Status: 'Client waiting on ESS team member',
    'Quoted Amount': '$110,000',
    Sites: '57',
    'Last Client Heard From Us': '2026-06-18',
    'Follow Up': '2026-06-25',
    Notes: 'Expansion of last year`s engagement. Legal redlining the MSA.',
    'Next Steps': 'Return redlines\nConfirm start date',
    'BFO Link': 'BFO-2026-0098',
    'BFO Company Name': 'Harbor Point Holdings Inc',
    'Pricing Option': 'Enterprise — 3yr',
    'Quoted On': '2026-05-30',
    'Chance?': 'Expected',
    'PE Owner': 'KKR',
  }),
  row(5, 6, {
    Account: 'Summit Facilities Mgmt',
    'Open Year': '2026',
    Contact: 'Erin Walsh',
    Stage: 'Quoted',
    Scope: 'AEM',
    Source: 'Partner',
    Type: 'Facility Manager',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-06-14',
    Status: 'Meeting scheduled',
    'Quoted Amount': '$31,200',
    Sites: '5',
    'Follow Up': '2026-06-26',
    Notes: 'Demo went well; pricing sent. Champion looping in their CFO.',
    'Next Steps': 'Hold pricing review call',
    'Quoted On': '2026-06-20',
    'Chance?': 'OK',
  }),
  row(6, 130, {
    Account: 'Lakeshore Capital Partners',
    'Open Year': '2025',
    Contact: 'Frank Idris',
    Stage: 'Sold',
    Scope: 'Audits',
    Source: 'Inside Sales',
    Type: 'Private Equity',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2025-12-02',
    Status: 'Client requested a pause',
    'Quoted Amount': '$95,000',
    Sites: '23',
    Notes: 'Closed last cycle; tracked here as a recently-won reference.',
    'Close Date': '2026-02-11',
    'BFO Link': 'BFO-2025-0771',
    'Chance?': 'Expected',
    'PE Owner': 'Lakeshore Capital',
  }),
];

export const SAMPLE_OPPS2 = {
  headers: DEFAULT_HEADERS,
  records: RECORDS,
  // Leave columnLinks/dropdownLists undefined so the page uses its
  // built-in defaults (Scope→solutions, Source→source, Stage→status,
  // Status→whoIsWaiting, Chance?→chance).
  columnLinks: undefined,
  dropdownLists: undefined,
};

// Wipe the seeded demo data (and any of your local edits) so the next
// load re-seeds fresh. Call from the browser console:
//   import('./data/sampleData.js').then(m => m.resetSampleData())
export function resetSampleData() {
  try {
    const prefix = 'odx::';
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
