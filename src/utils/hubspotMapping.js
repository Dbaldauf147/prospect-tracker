// My Accounts > Hubspot Mapping: Dan's companies in Schneider's HubSpot (an
// export of the companies he owns there, dropped on the tab) side by side
// with My Accounts, so he can see which accounts are in HubSpot, which
// aren't yet, and which HubSpot companies aren't on My Accounts.
//
// The export carries no domain, so a match is by name: the account's name,
// its "goes by" and its aliases, normalised the way companyNorm does it.
// Where an account has no exact match, a HubSpot company whose name starts
// with (or is the start of) the account's is offered as a possible match,
// and Dan can link it; his links are kept with the export.
//
// Pure: no browser APIs, so it runs under plain Node in the tests
// (scripts/hubspotMapping.test.mjs).

import { normalizeCompany } from './companyNorm.js';

const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /^\(no value\)$/i.test(s) ? '' : s;
};

function pick(row, ...labels) {
  for (const l of labels) {
    const hit = Object.keys(row).find(k => k.trim().toLowerCase() === l.toLowerCase());
    if (hit && clean(row[hit])) return clean(row[hit]);
  }
  return '';
}

/**
 * Rows of a HubSpot companies export (objects keyed by header, as
 * sheet_to_json gives them) as compact records. HubSpot's "(No value)"
 * cells read as blank; a row without a name is dropped.
 */
export function compactMappingCompanies(rows) {
  return (rows || []).map((r, i) => ({
    id: pick(r, 'Company ID', 'Record ID', 'Record ID - Company') || `row-${i + 1}`,
    name: pick(r, 'Company name', 'Name'),
    owner: pick(r, 'Company owner', 'Owner'),
    targetAccount: pick(r, 'Target Account'),
    lifecycle: pick(r, 'Lifecycle Stage'),
    lastActivity: pick(r, 'Last Activity Date'),
    lastContacted: pick(r, 'Last Contacted'),
    nextActivity: pick(r, 'Next Activity Date'),
    created: pick(r, 'Create Date'),
  })).filter(c => c.name);
}

const accountNames = (a) => [a.company, a.goesBy, ...(Array.isArray(a.aliases) ? a.aliases : [])]
  .map(normalizeCompany).filter(Boolean);

// "acme" and "acme realty partners": one is the other's first words. Short
// keys are left out, or "the" would match half the list.
const startsWithWords = (a, b) => a.length >= 4 && (b === a || b.startsWith(a + ' '));

export const MAPPING_STATUS = {
  matched: 'In both',
  accountOnly: 'Only in My Accounts',
  hubspotOnly: 'Only in HubSpot',
};

/**
 * One row per account and one per HubSpot company no account claims
 * (same-named records together):
 *   { key, status, account, hubspot: [records], how, suggestions }
 * `how` is 'name' | 'linked' | ''. `links` is { [accountId]: hubspotId },
 * Dan's own choices, which win over the name match.
 */
export function buildHubspotMapping(accounts = [], companies = [], { links = {} } = {}) {
  const byName = new Map();
  const byId = new Map();
  for (const c of companies) {
    byId.set(String(c.id), c);
    const n = normalizeCompany(c.name);
    if (n) (byName.get(n) || byName.set(n, []).get(n)).push(c);
  }

  const claimed = new Set();
  const rows = accounts.map(a => {
    const linked = links[a.id] && byId.get(String(links[a.id]));
    let hubspot = [];
    let how = '';
    if (linked) { hubspot = [linked]; how = 'linked'; }
    else {
      const seen = new Set();
      hubspot = accountNames(a).flatMap(n => byName.get(n) || []).filter(c => !seen.has(c.id) && seen.add(c.id));
      if (hubspot.length) how = 'name';
    }
    for (const c of hubspot) claimed.add(String(c.id));
    return { key: `a:${a.id || a.company}`, account: a, hubspot, how, suggestions: [] };
  });

  // Possible matches for the accounts left over, among the HubSpot companies
  // no account claimed.
  const unclaimed = companies.filter(c => !claimed.has(String(c.id)));
  const unclaimedKeys = unclaimed.map(c => [normalizeCompany(c.name), c]);
  for (const r of rows) {
    if (r.hubspot.length) continue;
    const names = accountNames(r.account);
    r.suggestions = unclaimedKeys
      .filter(([k]) => k && names.some(n => startsWithWords(n, k) || startsWithWords(k, n)))
      .map(([, c]) => c);
  }

  for (const r of rows) r.status = r.hubspot.length ? MAPPING_STATUS.matched : MAPPING_STATUS.accountOnly;
  // Same-named HubSpot records share a row, so duplicates show as one
  // company with "N records", as they do on a matched account.
  const groups = new Map();
  for (const [k, c] of unclaimedKeys) {
    const g = k || `id:${c.id}`;
    (groups.get(g) || groups.set(g, []).get(g)).push(c);
  }
  for (const hubspot of groups.values()) {
    rows.push({ key: `h:${hubspot[0].id}`, status: MAPPING_STATUS.hubspotOnly, account: null, hubspot, how: '', suggestions: [] });
  }
  return rows;
}
