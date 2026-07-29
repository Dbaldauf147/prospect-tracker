// Demo dataset for the standalone Agents export.
//
// The real Agents page reads from several browser caches that, in the
// full app, are hydrated from Firestore / HubSpot / pasted Salesforce
// exports:
//
//   • the Opps 2 cache          (`opps2-cache`  IndexedDB)  — the opps roster
//   • the HubSpot contacts cache(`hubspot-contacts` IndexedDB)
//   • the HubSpot activity cache(`hubspot-activity-cache` localStorage)
//   • the pasted BFO Activity   (`bfo-activity` IndexedDB, key `current`)
//   • per-user settings         (workEmail, marketingLeads, savedPrompts)
//
// There's no backend in the export, so this file holds sample values for
// all of them and `seedAgentsDemo()` writes them into the same
// localStorage-backed shims the page reads from. The opps roster is
// seeded lazily by `utils/opps2Store.js` (the SHIM) via `SAMPLE_OPPS2`;
// everything else is seeded once, on first load, by `seedAgentsDemo()`.
//
// After the first load your in-app edits persist locally and take
// precedence. To wipe everything and re-seed, run in the console:
//   import('./data/sampleData.js').then(m => m.resetSampleData())  // then reload

import { dbGet, dbPut } from '../utils/db';
import { userLsGet, userLsSet } from '../utils/userLs';

// ---------------------------------------------------------------------------
// The work email the Agents page matches outbound HubSpot emails against
// (Settings → CDM Name in the full app). Every seeded "sent" email is
// FROM this address so the Activity → Sent emails table lights up.
// ---------------------------------------------------------------------------
export const SAMPLE_WORK_EMAIL = 'dan.baldauf@se.com';

// ---------------------------------------------------------------------------
// Opps 2 roster (same store `oppsCache.loadOppsFromCache` + OppsView2 read).
// ---------------------------------------------------------------------------
export const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date',
  'BFO Link', 'BFO Company Name', 'BFO Address', 'Pricing Option',
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date', 'PE Owner',
];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const blanks = () => Object.fromEntries(DEFAULT_HEADERS.map((h) => [h, '']));

function row(id, fields) {
  return {
    _id: id,
    id,
    _rowUpdatedAt: now - id * DAY,
    ...blanks(),
    ...fields,
  };
}

const RECORDS = [
  // Tagged to a BFO opp → shows up in Close Dates / Amount / Stage prompts
  // (joined to the pasted BFO Activity rows below).
  row(1, {
    Account: 'Acme Property Group',
    'Open Year': '2026',
    Contact: 'Alice Johnson <alice.johnson@acmeproperty.com>',
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
    'BFO Link': 'Acme Property — CSRD Readiness 2026',
    'BFO Company Name': 'Acme Property Group LLC',
    'BFO Address': 'https://se.lightning.force.com/lightning/r/Opportunity/0068V00000ACME01/view',
    'Chance?': 'OK',
    'PE Owner': 'Blackstone',
  }),
  // BFO Opportunity Name is the "-" placeholder (needs a BFO opp created)
  // → surfaces in the "New BFO Opp" table.
  row(2, {
    Account: 'Northwind Logistics',
    'Open Year': '2026',
    Contact: 'Bob Lee <bob.lee@northwindlogistics.com>',
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
    'BFO Link': '-',
    'Chance?': 'Expected',
  }),
  // "-" placeholder → "New BFO Opp" table.
  row(3, {
    Account: 'Cedar & Vale Real Estate',
    'Open Year': '2026',
    Contact: 'Carla Mendes <carla.mendes@cedarvale.com>',
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
    'BFO Link': '-',
    'Chance?': 'Weak',
  }),
  // Tagged to a BFO opp → Close Dates / Amount / Stage prompts.
  row(4, {
    Account: 'Harbor Point Holdings',
    'Open Year': '2026',
    Contact: 'David Okoro <david.okoro@harborpointholdings.com>',
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
    'BFO Link': 'Harbor Point — CSRD Expansion',
    'BFO Company Name': 'Harbor Point Holdings Inc',
    'BFO Address': 'https://se.lightning.force.com/lightning/r/Opportunity/0068V00000HARB01/view',
    'Pricing Option': 'Enterprise — 3yr',
    'Quoted On': '2026-05-30',
    'Chance?': 'Expected',
    'PE Owner': 'KKR',
  }),
  // No BFO Opportunity Name yet → "New BFO Opp" table + a meeting today.
  row(5, {
    Account: 'Summit Facilities Mgmt',
    'Open Year': '2026',
    Contact: 'Erin Walsh <erin.walsh@summitfm.com>',
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
    'BFO Link': '-',
    'Quoted On': '2026-06-20',
    'Chance?': 'OK',
  }),
  // Tagged with a BFO Opportunity Name but MISSING its BFO Address →
  // surfaces in the "AI BFO Prep" table (copy the BFO website address in).
  row(7, {
    Account: 'Beacon Hill Trust',
    'Open Year': '2026',
    Contact: 'Grace Okafor <grace.okafor@beaconhilltrust.com>',
    Stage: 'Quoting',
    Scope: 'AEM',
    Source: 'Self Gen - Prospecting Email',
    Type: 'Owner Operator',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-06-30',
    Status: 'Client waiting on me',
    'Quoted Amount': '$54,000',
    Sites: '18',
    'Follow Up': '2026-07-24',
    'Call In': '4',
    Notes: 'BFO opp created; still need to paste the Salesforce record link.',
    'Next Steps': 'Grab BFO website address',
    'BFO Link': 'Beacon Hill — AEM Rollout',
    'BFO Company Name': 'Beacon Hill Trust',
    'Chance?': 'OK',
  }),
  // Lost/closed → feeds the "Close Not Solds" prompt via its BFO row.
  row(6, {
    Account: 'Lakeshore Capital Partners',
    'Open Year': '2026',
    Contact: 'Frank Idris <frank.idris@lakeshorecap.com>',
    Stage: 'Not Sold',
    Scope: 'Audits',
    Source: 'Inside Sales',
    Type: 'Private Equity',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-01-02',
    Status: 'Client requested a pause',
    'Quoted Amount': '$95,000',
    Sites: '23',
    Notes: 'Price pain; went with an incumbent. Tracked for the close-out flow.',
    'Reason Not Sold': 'Price pain',
    'BFO Link': 'Lakeshore Capital — Audit Program',
    'BFO Company Name': 'Lakeshore Capital Partners',
    'BFO Address': 'https://se.lightning.force.com/lightning/r/Opportunity/0068V00000LAKE01/view',
    'Chance?': 'Weak',
    'PE Owner': 'Lakeshore Capital',
  }),
];

export const SAMPLE_OPPS2 = {
  headers: DEFAULT_HEADERS,
  records: RECORDS,
  columnLinks: undefined,
  dropdownLists: undefined,
};

// ---------------------------------------------------------------------------
// HubSpot contacts cache (`hubspot-contacts` IndexedDB, key `cache`).
// email → company powers the Activity table's Company column and the
// fuzzy Opps-tab match for each outbound email / meeting.
// ---------------------------------------------------------------------------
export const SAMPLE_HUBSPOT_CONTACTS = {
  fetchedAt: new Date(now).toISOString(),
  contacts: [
    { id: 'c1', email: 'alice.johnson@acmeproperty.com', firstname: 'Alice', lastname: 'Johnson', company: 'Acme Property Group' },
    { id: 'c2', email: 'bob.lee@northwindlogistics.com', firstname: 'Bob', lastname: 'Lee', company: 'Northwind Logistics' },
    { id: 'c3', email: 'carla.mendes@cedarvale.com', firstname: 'Carla', lastname: 'Mendes', company: 'Cedar & Vale Real Estate' },
    { id: 'c4', email: 'david.okoro@harborpointholdings.com', firstname: 'David', lastname: 'Okoro', company: 'Harbor Point Holdings' },
    { id: 'c5', email: 'erin.walsh@summitfm.com', firstname: 'Erin', lastname: 'Walsh', company: 'Summit Facilities Mgmt' },
    { id: 'c6', email: 'grace.okafor@beaconhilltrust.com', firstname: 'Grace', lastname: 'Okafor', company: 'Beacon Hill Trust' },
    { id: 'c7', email: 'dan.baldauf@se.com', firstname: 'Dan', lastname: 'Baldauf', company: 'Schneider Electric' },
  ],
};

// ---------------------------------------------------------------------------
// HubSpot activity cache (`hubspot-activity-cache` localStorage, user-scoped).
// A few outbound emails + one meeting, all stamped for today so they land
// in the Activity window.
// ---------------------------------------------------------------------------
function isoAt(hour, minute, dayOffset = 0) {
  const d = new Date(now + dayOffset * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export const SAMPLE_ACTIVITY = {
  fetchedAt: new Date(now).toISOString(),
  emails: [
    {
      id: 'e1', hs_object_id: 'e1',
      hs_timestamp: isoAt(9, 12),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'alice.johnson@acmeproperty.com',
      hs_email_subject: 'CSRD scoping summary + in-scope sites',
      hs_email_status: 'SENT',
    },
    {
      id: 'e2', hs_object_id: 'e2',
      hs_timestamp: isoAt(11, 4),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'bob.lee@northwindlogistics.com',
      hs_email_subject: 'Northwind — AEM coverage + pricing option',
      hs_email_status: 'SENT',
    },
    {
      id: 'e3', hs_object_id: 'e3',
      hs_timestamp: isoAt(14, 37),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'david.okoro@harborpointholdings.com',
      hs_email_subject: 'Redlines returned — MSA start date',
      hs_email_status: 'SENT',
    },
    // Prospecting note to a lead who isn't on the Opps tab — exercises the
    // inline "pick opportunity" flow + Marketing Lead match.
    {
      id: 'e4', hs_object_id: 'e4',
      hs_timestamp: isoAt(15, 58),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'grace.tam@meridianreit.com',
      hs_email_subject: 'Intro — energy + sustainability program',
      hs_email_status: 'SENT',
    },
  ],
  calls: [],
  meetings: [
    {
      id: 'm1', hs_object_id: 'm1',
      hs_timestamp: isoAt(13, 0),
      hs_meeting_start_time: isoAt(13, 0),
      hs_meeting_end_time: isoAt(13, 30),
      hs_meeting_title: 'Summit Facilities — pricing review',
      hs_meeting_location: 'Zoom',
      hs_meeting_outcome: 'COMPLETED',
      _contactIds: ['c5'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pasted BFO Activity (`bfo-activity` IndexedDB, key `current`). Shape is
// { headers, rows } — the Salesforce Opportunity printable view the user
// pastes on the BFO Activity tab. Joined to the opps above by Opportunity
// Name to drive the Close Dates / Amount Updates / Stage Change / Close
// Not Solds prompts.
// ---------------------------------------------------------------------------
function bfoCloseDate(dayOffset) {
  const d = new Date(now + dayOffset * DAY);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const BFO_HEADERS = ['Account Name', 'Opportunity Name', 'Stage', 'Sales Stage', 'Close Date', 'Amount', 'Status'];

export const SAMPLE_BFO_ACTIVITY = {
  fetchedAt: new Date(now).toISOString(),
  headers: BFO_HEADERS,
  rows: [
    {
      'Account Name': 'Acme Property Group LLC',
      'Opportunity Name': 'Acme Property — CSRD Readiness 2026',
      'Stage': '3 - Qualify Opportunity',
      'Sales Stage': '3 - Qualify Opportunity', // opps Stage "Qualifying" expects 4 → Stage Change surfaces it
      'Close Date': bfoCloseDate(45),           // stage <=4 & <100 days → Close Dates slips it
      'Amount': '$40,000',                       // != Quoted $48,000 → Amount Updates surfaces it
      'Status': 'Open',
    },
    {
      'Account Name': 'Harbor Point Holdings Inc',
      'Opportunity Name': 'Harbor Point — CSRD Expansion',
      'Stage': '5 - Prepare & Bid',
      'Sales Stage': '5 - Prepare & Bid',        // opps Stage "Contracting" also expects 5 → no Stage Change
      'Close Date': bfoCloseDate(40),            // stage 5 & <60 days → Close Dates slips it
      'Amount': '$100,000',                      // != Quoted $110,000 → Amount Updates surfaces it
      'Status': 'Open',
    },
    {
      'Account Name': 'Lakeshore Capital Partners',
      'Opportunity Name': 'Lakeshore Capital — Audit Program',
      'Stage': '4 - Influence and Develop',
      'Sales Stage': '4 - Influence and Develop',
      'Close Date': bfoCloseDate(20),
      'Amount': '$95,000',
      'Status': 'Lost',                          // opps Stage "Not Sold" → Close Not Solds flow
    },
  ],
};

// ---------------------------------------------------------------------------
// Marketing Leads (settings.marketingLeads). One is missing a Salesforce
// link (→ "Marketing Leads" agent, which asks the assistant to paste the
// record URL); the others carry a status that can drift from Salesforce
// (→ "Marketing Lead Status Update" agent).
// ---------------------------------------------------------------------------
export const SAMPLE_MARKETING_LEADS = [
  { id: 'ml1', name: 'Grace Tam', email: 'grace.tam@meridianreit.com', company: 'Meridian REIT', status: '2 - Attempting to Contact', sfUrl: '' },
  { id: 'ml2', name: 'Henry Park', email: 'henry.park@brightpathcap.com', company: 'Brightpath Capital', status: '3 - Connected', sfUrl: 'https://se.lightning.force.com/lightning/r/Lead/00Q8V00000HENRY1/view' },
  { id: 'ml3', name: 'Priya Nair', email: 'priya.nair@vantageproperties.com', company: 'Vantage Properties', status: '4 - Qualifying', sfUrl: '00Q8V00000PRIYA1' },
];

// The BFO Activity page's "Leads" subtab — the pasted Salesforce Leads
// printable view (`bfo-activity` IndexedDB, key `leads-current`). Two of
// the marketing leads above carry a DIFFERENT status here than on the
// Marketing Leads page, so the "Marketing Lead Status Update" agent has
// discrepancies to reconcile.
export const SAMPLE_BFO_LEADS = {
  fetchedAt: new Date(now).toISOString(),
  headers: ['Name', 'Company', 'Status'],
  rows: [
    { Name: 'Park, Henry', Company: 'Brightpath Capital', Status: '1 - New' },       // vs '3 - Connected'
    { Name: 'Nair, Priya', Company: 'Vantage Properties', Status: '2 - Attempting to Contact' }, // vs '4 - Qualifying'
  ],
};

// Default per-user settings for the export (workEmail + marketing leads).
// The savedPrompts library falls back to its built-in seed list until the
// user edits it, so we leave it undefined here.
export const SAMPLE_SETTINGS = {
  workEmail: SAMPLE_WORK_EMAIL,
  marketingLeads: SAMPLE_MARKETING_LEADS,
};

// ---------------------------------------------------------------------------
// Seed the non-opps caches once, on first load. Idempotent via a flag so
// the user's later edits (ignored emails, tags, pasted BFO rows) survive a
// reload. The opps roster itself is seeded separately by the opps2Store SHIM.
// ---------------------------------------------------------------------------
const SEED_FLAG_KEY = 'agents-demo-seeded-v1';

export async function seedAgentsDemo() {
  try {
    if (userLsGet(SEED_FLAG_KEY) === '1') return;

    // HubSpot contacts (IndexedDB shim).
    if (!(await dbGet('hubspot-contacts', 'cache'))) {
      await dbPut('hubspot-contacts', SAMPLE_HUBSPOT_CONTACTS, 'cache');
    }
    // Pasted BFO Activity rows (IndexedDB shim, key `current`).
    if (!(await dbGet('bfo-activity', 'current'))) {
      await dbPut('bfo-activity', SAMPLE_BFO_ACTIVITY, 'current');
    }
    // Pasted BFO Activity "Leads" subtab (IndexedDB shim, key `leads-current`).
    if (!(await dbGet('bfo-activity', 'leads-current'))) {
      await dbPut('bfo-activity', SAMPLE_BFO_LEADS, 'leads-current');
    }
    // HubSpot activity cache (user-scoped localStorage).
    if (userLsGet('hubspot-activity-cache') == null) {
      userLsSet('hubspot-activity-cache', JSON.stringify(SAMPLE_ACTIVITY));
    }

    userLsSet(SEED_FLAG_KEY, '1');
  } catch (err) {
    console.warn('seedAgentsDemo failed', err);
  }
}

// Wipe the seeded demo data (and any local edits) so the next load
// re-seeds fresh. Call from the browser console:
//   import('./data/sampleData.js').then(m => m.resetSampleData())
export function resetSampleData() {
  try {
    for (const prefix of ['agx::', 'u:_anon:', 'u:demo-user:']) {
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) toDelete.push(k);
      }
      toDelete.forEach((k) => localStorage.removeItem(k));
    }
    localStorage.removeItem('agents-demo-seeded-v1');
  } catch { /* ignore */ }
}
