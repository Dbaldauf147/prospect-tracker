// Sample data for the standalone Lovable export.
//
// The real app feeds the Clients page from Firestore (the prospect
// roster) plus user-uploaded Deals / Commissions spreadsheets stored in
// localStorage. Here we hard-code a small but realistic dataset so all
// four subtabs (Clients, Old Clients, Deals, Commissions) render with
// content the moment the page loads.
//
//  - SAMPLE_PROSPECTS  → passed straight into <ClientsView prospects=…>
//  - SAMPLE_DEALS      → seeded into the Deals localStorage store
//  - SAMPLE_COMMISSIONS→ seeded into the Commissions localStorage store
//
// Every prospect's `cdm` matches SAMPLE_CDM_NAME so the page's
// CDM filter keeps them all. Deal `Client Name` values line up with the
// prospect `company` names so the per-client contract drill-down and the
// "Soonest Expiration / Days Until" columns light up.

import { COMMISSION_MONTH_NAMES, saveCommissionsOverride, loadCommissions } from '../utils/commissionsStore';
import { saveDealsOverride, loadDealsList } from '../utils/dealsStore';

export const SAMPLE_CDM_NAME = 'Dan Baldauf';

// --- helpers -------------------------------------------------------------

// Build an ISO-ish date string N days from today so the "Days Until"
// column shows a live spread (some expiring soon, some far out, some
// already past) no matter when the demo is opened.
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// --- prospects (the client roster) --------------------------------------

export const SAMPLE_PROSPECTS = [
  {
    id: 'p1', company: 'Northwind Manufacturing', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Industrial', website: 'northwind.example.com', numberOfSites: 12,
    servicesExplored: { energy: 'Yes', sustainability: 'Yes', procurement: '-' },
  },
  {
    id: 'p2', company: 'Cascade Retail Group', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Retail', website: 'cascaderetail.example.com', numberOfSites: 48,
    servicesExplored: { energy: 'Yes' },
  },
  {
    id: 'p3', company: 'Harbor Logistics', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Logistics', website: 'harborlogistics.example.com', numberOfSites: 7,
    servicesExplored: {},
  },
  {
    id: 'p4', company: 'Summit Healthcare Partners', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Healthcare', website: 'summithealth.example.com', numberOfSites: 21,
    servicesExplored: { energy: 'Yes', sustainability: 'Yes' },
  },
  {
    id: 'p5', company: 'Brightline Foods', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Food & Beverage', website: 'brightlinefoods.example.com', numberOfSites: 5,
    servicesExplored: { procurement: 'Yes' },
  },
  // --- Old Clients (show up on the "Old Clients" subtab) -----------------
  {
    id: 'p6', company: 'Meridian Textiles', status: 'Old Client', cdm: 'Dan Baldauf',
    type: 'Manufacturing', website: 'meridiantextiles.example.com', numberOfSites: 3,
    servicesExplored: {},
  },
  {
    id: 'p7', company: 'Pinecrest Hospitality', status: 'Old Client', cdm: 'Dan Baldauf',
    type: 'Hospitality', website: 'pinecrest.example.com', numberOfSites: 9,
    servicesExplored: { energy: 'Yes' },
  },
  // --- A couple of non-clients so the CDM/Status filters have something
  //     to exclude (they should NOT appear on Clients or Old Clients). ---
  {
    id: 'p8', company: 'Vertex Capital', status: 'Prospect', cdm: 'Dan Baldauf',
    type: 'Finance', website: 'vertexcapital.example.com', numberOfSites: 1,
    servicesExplored: {},
  },
  {
    id: 'p9', company: 'Acme Mining', status: 'Client', cdm: 'Someone Else',
    type: 'Mining', website: 'acmemining.example.com', numberOfSites: 4,
    servicesExplored: {},
  },
];

// --- deals / contracts (the Deals subtab + per-client drill-down) -------
// Flat objects keyed by the spreadsheet column headers the app expects.

export const SAMPLE_DEALS = [
  {
    'Client Name': 'Northwind Manufacturing', 'Agreement Name': 'Northwind — Electricity Supply 2024',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-400),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(25), 'Auto renewal?': 'Yes', 'Esc': 0.03,
    'Setup': 5000, 'Recurring Revenue': 4200, 'Commission': 1260, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1001',
  },
  {
    'Client Name': 'Northwind Manufacturing', 'Agreement Name': 'Northwind — Natural Gas 2024',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-300),
    'Payment Terms': 'Net 45', 'End Date': daysFromNow(210), 'Auto renewal?': 'No', 'Esc': 0.025,
    'Setup': 3000, 'Recurring Revenue': 2600, 'Commission': 780, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1002',
  },
  {
    'Client Name': 'Cascade Retail Group', 'Agreement Name': 'Cascade — Portfolio Electricity',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-200),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(75), 'Auto renewal?': 'Yes', 'Esc': 0.02,
    'Setup': 12000, 'Recurring Revenue': 9800, 'Commission': 2940, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1003',
  },
  {
    'Client Name': 'Harbor Logistics', 'Agreement Name': 'Harbor — Demand Response',
    'Paperwork completed': 'Pending', 'Current Term Start Date': daysFromNow(-120),
    'Payment Terms': 'Net 60', 'End Date': daysFromNow(-10), 'Auto renewal?': 'No', 'Esc': 0,
    'Setup': 2000, 'Recurring Revenue': 1500, 'Commission': 450, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1004',
  },
  {
    'Client Name': 'Summit Healthcare Partners', 'Agreement Name': 'Summit — Sustainability Advisory',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-90),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(300), 'Auto renewal?': 'Yes', 'Esc': 0.03,
    'Setup': 8000, 'Recurring Revenue': 6500, 'Commission': 1950, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1005',
  },
  {
    'Client Name': 'Brightline Foods', 'Agreement Name': 'Brightline — Procurement (Expired)',
    'Paperwork completed': 'Expired', 'Current Term Start Date': daysFromNow(-800),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(-120), 'Auto renewal?': 'No', 'Esc': 0,
    'Setup': 1500, 'Recurring Revenue': 0, 'Commission': 0, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1006',
  },
  {
    'Client Name': 'Meridian Textiles', 'Agreement Name': 'Meridian — Electricity (Cancelled)',
    'Paperwork completed': 'Cancelled', 'Current Term Start Date': daysFromNow(-600),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(-200), 'Auto renewal?': 'No', 'Esc': 0,
    'Setup': 1000, 'Recurring Revenue': 0, 'Commission': 0, 'Commission Rate': 0.3,
    'Closed Won': 'No', 'BFO Link': 'BFO-1007',
  },
];

// --- commissions (the Commissions subtab) -------------------------------
// Identity columns + monthly revenue + FY total + monthly commission.

function makeCommissionRow({ name, account, bfo, project, pct, fyRevenue }) {
  const row = {
    Name: name, 'Account Name': account, 'BFO Name': bfo, 'Project Name': project,
    'Comm Start Date': daysFromNow(-200), 'Comm End Date': daysFromNow(165), '%': pct,
    'FY Revenue': fyRevenue,
  };
  // Spread the FY revenue across the months with a little variation, and
  // derive the monthly commission from the percentage.
  const monthly = fyRevenue / 12;
  for (const m of COMMISSION_MONTH_NAMES) {
    row[`${m} Revenue`] = Math.round(monthly);
    row[m] = Math.round(monthly * pct);
  }
  return row;
}

export const SAMPLE_COMMISSIONS = [
  makeCommissionRow({ name: 'Dan Baldauf', account: 'Northwind Manufacturing', bfo: 'BFO-1001', project: 'Electricity Supply 2024', pct: 0.3, fyRevenue: 50400 }),
  makeCommissionRow({ name: 'Dan Baldauf', account: 'Cascade Retail Group', bfo: 'BFO-1003', project: 'Portfolio Electricity', pct: 0.3, fyRevenue: 117600 }),
  makeCommissionRow({ name: 'Dan Baldauf', account: 'Summit Healthcare Partners', bfo: 'BFO-1005', project: 'Sustainability Advisory', pct: 0.3, fyRevenue: 78000 }),
];

// --- seeding -------------------------------------------------------------

// Seed the localStorage-backed Deals / Commissions stores, but only when
// they're empty — so any edits you make in the running demo survive a
// reload. Call resetSampleData() to force a re-seed.
export function seedSampleData() {
  try {
    if (loadDealsList().count === 0) saveDealsOverride(SAMPLE_DEALS);
  } catch (err) { console.warn('Failed to seed sample deals', err); }
  try {
    if (loadCommissions().count === 0) saveCommissionsOverride(SAMPLE_COMMISSIONS);
  } catch (err) { console.warn('Failed to seed sample commissions', err); }
}

export function resetSampleData() {
  try { saveDealsOverride(SAMPLE_DEALS); } catch {}
  try { saveCommissionsOverride(SAMPLE_COMMISSIONS); } catch {}
}
