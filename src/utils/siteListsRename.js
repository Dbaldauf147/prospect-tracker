// Carry a company rename through the user's uploaded site lists:
//   • Master Site List ('master-site-list-override') — normalized `company`
//     field (MASTER_FIELDS).
//   • Utility-Lookup Sites list ('sites-list-override') — company stored under
//     a raw uploaded header, re-detected by pattern the same way
//     SitesView.detectSitesMapping() does on load.
// Both live in uploadedListStore (IDB, mirrored to Firestore). The external
// reference lists (CDP/CSRD/GRESB/…) in the same store are deliberately NOT
// touched — those are outside rosters, not the user's own company data.

import { loadList, saveList } from './uploadedListStore';

const MASTER_KEY = 'master-site-list-override';
const SITES_KEY = 'sites-list-override';

const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Mirror of the company-column patterns in SitesView.detectSitesMapping so we
// find the Sites list's company cells under whatever header the upload used
// (Company / Portfolio / Parent / Account Name / Customer Name / …).
const SITES_COMPANY_PATTERNS = [
  /^company\s*name$/i, /^company$/i, /\bcompany\b/i, /\bportfolio\b/i,
  /parent\s*(co|company|org)/i, /\baccount\s*name\b/i, /\bcustomer\s*name\b/i,
  /\borganization\b/i, /\bclient\b/i,
];
function detectSitesCompanyCol(headers) {
  for (const re of SITES_COMPANY_PATTERNS) {
    const hit = headers.find(h => re.test(h));
    if (hit) return hit;
  }
  return null;
}

function planRows(rows, col, old, next) {
  if (!Array.isArray(rows) || !col) return null;
  let count = 0;
  const out = rows.map(r => {
    if (r && eq(r[col], old)) { count++; return { ...r, [col]: next }; }
    return r;
  });
  return count > 0 ? { rows: out, count } : null;
}

// Read both lists and compute what a rename would change (no writes). Async —
// the lists live in IDB / Firestore.
export async function planSiteListsRename(oldName, newName) {
  const old = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!old || !next || eq(old, next)) return { master: null, sites: null, count: 0 };
  const [master, sites] = await Promise.all([
    loadList(MASTER_KEY).catch(() => null),
    loadList(SITES_KEY).catch(() => null),
  ]);
  const masterPlan = planRows(master, 'company', old, next);
  const sitesCol = Array.isArray(sites) && sites.length ? detectSitesCompanyCol(Object.keys(sites[0])) : null;
  const sitesPlan = planRows(sites, sitesCol, old, next);
  return {
    master: masterPlan,
    sites: sitesPlan,
    count: (masterPlan?.count || 0) + (sitesPlan?.count || 0),
  };
}

export async function applySiteListsRename(plan) {
  if (!plan) return;
  if (plan.master) await saveList(MASTER_KEY, plan.master.rows);
  if (plan.sites) await saveList(SITES_KEY, plan.sites.rows);
}
