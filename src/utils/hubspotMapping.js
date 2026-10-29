// My Accounts > Hubspot Mapping: Dan's companies in Schneider's HubSpot (an
// export of the companies he owns there, dropped on the tab) side by side
// with My Accounts, so he can see which accounts are in HubSpot, which
// aren't yet, and which HubSpot companies aren't on My Accounts.
//
// A match is by website first, when the export carries one (Company Domain
// Name or Website URL) and the account has one (Website, else Email
// Domain), then by name: the account's name, its "goes by" and its aliases,
// normalised the way companyNorm does it. Both kinds of hit are kept, so a
// same-named duplicate with a different website still shows.
// Where an account has no exact match, the HubSpot companies no account
// claimed are scored against it by name (nameSimilarity, 0-100) and the
// closest are offered as possible matches, with the %, for Dan to map; a
// HubSpot company no account claimed is offered the closest unmatched
// accounts the same way. His links are kept with the export.
//
// Pure: no browser APIs, so it runs under plain Node in the tests
// (scripts/hubspotMapping.test.mjs).

import { normalizeCompany } from './companyNorm.js';
import { domainKey } from './seHubspotExisting.js';
import { matchesCdm } from './cdmMatch.js';

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
    domain: domainKey(pick(r, 'Company Domain Name', 'Domain')) || domainKey(pick(r, 'Website URL', 'Website')),
    owner: pick(r, 'Company owner', 'Owner'),
    targetAccount: pick(r, 'Target Account'),
    lifecycle: pick(r, 'Lifecycle Stage'),
    lastActivity: pick(r, 'Last Activity Date'),
    lastContacted: pick(r, 'Last Contacted'),
    nextActivity: pick(r, 'Next Activity Date'),
    created: pick(r, 'Create Date'),
  })).filter(c => c.name);
}

const accountDomain = (a) => domainKey(a.website) || domainKey(a.emailDomain);

const accountNames = (a) => [a.company, a.goesBy, ...(Array.isArray(a.aliases) ? a.aliases : [])]
  .map(normalizeCompany).filter(Boolean);

// Words that say what kind of firm it is rather than which one, so two
// names sharing only these ("ABC Capital", "XYZ Capital") don't look alike.
const GENERIC = new Set(['the', 'and', 'of', 'capital', 'partners', 'partner', 'real', 'estate', 'realty', 'properties', 'property', 'management', 'investment', 'investments', 'investors', 'advisors', 'advisers', 'fund', 'funds', 'trust', 'reit', 'asset', 'assets', 'global', 'international', 'us', 'usa', 'america', 'american', 'national', 'financial', 'equity', 'ventures', 'development', 'services', 'company', 'enterprises']);

// A name's letter pairs, counted, with their total kept alongside.
const bigrams = (s) => {
  const t = s.replace(/ /g, '');
  const map = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); map.set(g, (map.get(g) || 0) + 1); }
  return { map, list: [...map], total: Math.max(0, t.length - 1) };
};
function dice(a, b) {
  const total = a.total + b.total;
  if (!total) return 0;
  let shared = 0;
  // Walk the shorter list; an array walks faster than a Map.
  const [x, y] = a.list.length <= b.list.length ? [a, b] : [b, a];
  for (let i = 0; i < x.list.length; i++) {
    const m = y.map.get(x.list[i][0]);
    if (m) shared += Math.min(x.list[i][1], m);
  }
  return (2 * shared) / total;
}
function prepName(n) {
  const words = [...new Set(n.split(' ').filter(w => w && !GENERIC.has(w)))];
  return { n, grams: bigrams(n), coreGrams: bigrams(words.join(' ') || n), words, wordSet: new Set(words) };
}

/**
 * How alike two company names are, 0-100, after normalizeCompany. The
 * better of two readings: the letters (bigram overlap, which forgives a
 * typo or a missing "s", averaged over the whole name and its distinctive
 * part, so "ABC Capital" and "XYZ Capital" stay apart) and the distinctive
 * words (the share of the shorter name's non-generic words the other has,
 * half-weighted with the letters, so "Blackstone" vs "Blackstone Real
 * Estate" scores high but not 100).
 */
export function nameSimilarity(a, b) {
  return scorePrepared(prepName(normalizeCompany(a)), prepName(normalizeCompany(b)));
}
function scorePrepared(a, b) {
  if (!a.n || !b.n) return 0;
  if (a.n === b.n) return 100;
  const letters = (dice(a.grams, b.grams) + dice(a.coreGrams, b.coreGrams)) / 2;
  let words = 0;
  const [fewer, more] = a.words.length <= b.words.length ? [a, b] : [b, a];
  if (fewer.words.length) {
    let hit = 0;
    for (const w of fewer.words) if (more.wordSet.has(w)) hit++;
    words = hit / fewer.words.length;
  }
  return Math.round(100 * Math.max(letters, 0.5 * words + 0.5 * letters));
}

// A possible match has to be at least this alike, and a row shows the best few.
export const SUGGEST_MIN_SCORE = 60;
const SUGGEST_MAX = 3;
function bestMatches(names, pool) {
  const out = [];
  for (const item of pool) {
    let score = 0;
    for (const n of names) for (const m of item.names) {
      score = Math.max(score, scorePrepared(n, m));
    }
    if (score >= SUGGEST_MIN_SCORE) out.push({ ...item.ref, score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, SUGGEST_MAX);
}

// Words a firm's name can carry or drop and still be the same firm in
// HubSpot ("Silver Lake" / "Silver Lake Partners", "WSP" / "WSP Global").
// normalizeCompany has already taken off Inc, Co, Group and the like.
const DUP_SUFFIX = new Set(['the', 'and', 'partners', 'partner', 'global', 'properties']);
const dupWords = (s) => normalizeCompany(s).split(' ').filter(w => w && !DUP_SUFFIX.has(w));
const dupParen = (s) => dupWords((String(s || '').match(/\(([^)]+)\)/) || [])[1] || '').join(' ');
function prepDup(name) {
  const words = dupWords(name);
  // Written in capitals, the way an acronym is ("TIAA", not "Aimco").
  return { words, joined: words.join(''), spaced: words.join(' '), paren: dupParen(name), caps: !/[a-z]/.test(String(name)) };
}
function dupPrepared(a, b) {
  if (!a.words.length || !b.words.length) return false;
  // Same words, spaces aside ("DivcoWest" / "Divco West Properties").
  if (a.joined === b.joined) return true;
  // One is the other's acronym in brackets ("TIAA" / "... (TIAA)"), in
  // capitals: "Aimco" the REIT is not "AIMCo" the pension manager.
  if ((a.paren && b.caps && a.paren === b.spaced) || (b.paren && a.caps && b.paren === a.spaced)) return true;
  // One starts with the other, and what's left over is the longer name's
  // bracketed acronym ("Jones Lang LaSalle (JLL)") or an "a ... Co." clause
  // ("Westinghouse (a Brookfield Co.)"), not more of a different name
  // ("Berkeley Capital Group" is not "Berkeley Partners").
  const [short, long] = a.words.length <= b.words.length ? [a, b] : [b, a];
  if (!short.words.every((w, i) => long.words[i] === w)) return false;
  const rest = long.words.slice(short.words.length);
  return rest[0] === 'a' || rest[0] === 'an' || (!!long.paren && rest.join(' ') === long.paren);
}

/**
 * Whether two HubSpot company names are most likely the same firm entered
 * twice, by the narrow rules in dupPrepared. Looser than an exact match,
 * far stricter than nameSimilarity: a sister company or a portfolio company
 * ("Brookfield (Selenta)", "Duke Realty, a Prologis Co.") is not a duplicate.
 */
export function likelyDuplicateName(a, b) {
  return dupPrepared(prepDup(a), prepDup(b));
}

// Whether an account's Status and its HubSpot Lifecycle Stage disagree, as
// a sentence saying how, or '' when they don't. HubSpot only has one stage
// that means a customer (Evangelist comes after it), so the check is that
// one line: a Client should be a Customer there, and a Customer there
// should be a Client (or an Old Client, which HubSpot has no stage for).
// Anything short of Customer is fine for a prospect, whichever it is.
const CUSTOMER_STAGES = new Set(['customer', 'evangelist']);
const CLIENT_STATUSES = new Set(['client', 'old client']);
export function statusDiscrepancy(accountStatus, lifecycles = []) {
  const stages = lifecycles.map(l => clean(l)).filter(Boolean);
  if (!stages.length) return '';
  const status = clean(accountStatus);
  const isClient = status.toLowerCase() === 'client';
  const customer = stages.filter(l => CUSTOMER_STAGES.has(l.toLowerCase()));
  const shown = [...new Set(stages)].join(', ');
  if (isClient && !customer.length) return `Client here, ${shown} in HubSpot`;
  if (customer.length && !CLIENT_STATUSES.has(status.toLowerCase())) return `${status || 'No status'} here, ${[...new Set(customer)].join(', ')} in HubSpot`;
  return '';
}

export const MAPPING_STATUS = {
  matched: 'In both',
  accountOnly: 'Only in My Accounts',
  hubspotOnly: 'Only in HubSpot',
};

/**
 * One row per account and one per HubSpot company no account claims
 * (same-named records together):
 *   { key, status, account, hubspot: [records], how, suggestions, statusFlag, duplicates }
 * `duplicates` is, on a matched account, the HubSpot records no account
 * claimed whose names are likely the same firm (likelyDuplicateName):
 * "Silver Lake Partners" on Silver Lake's row rather than a row of its own.
 * `statusFlag` is statusDiscrepancy's sentence for a matched account.
 * `suggestions` is [{ hubspotId, accountId, name, score }], best first: on an
 * unmatched account the HubSpot companies it may be, on a HubSpot-only row
 * the unmatched accounts it may be.
 * `how` is 'website' | 'name' | 'linked' | ''. `links` is { [accountId]: hubspotId },
 * Dan's own choices, which win over the name match.
 * `tracker` is every company on the tracker (the Table tab), not just My
 * Accounts. A HubSpot-only row gets `tracker`: the records there with its
 * website or name, so a company that is on the Table tab but not on My
 * Accounts (another CDM's, say) says so instead of looking missing.
 */
export function buildHubspotMapping(accounts = [], companies = [], { links = {}, tracker = [] } = {}) {
  const byName = new Map();
  const byDomain = new Map();
  const byId = new Map();
  for (const c of companies) {
    byId.set(String(c.id), c);
    if (c.domain) (byDomain.get(c.domain) || byDomain.set(c.domain, []).get(c.domain)).push(c);
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
      const domain = accountDomain(a);
      const viaDomain = domain ? byDomain.get(domain) || [] : [];
      const viaName = accountNames(a).flatMap(n => byName.get(n) || []);
      hubspot = [...viaDomain, ...viaName].filter(c => !seen.has(c.id) && seen.add(c.id));
      if (hubspot.length) how = viaDomain.length ? 'website' : 'name';
    }
    for (const c of hubspot) claimed.add(String(c.id));
    return { key: `a:${a.id || a.company}`, account: a, hubspot, how, suggestions: [], tracker: [], duplicates: [] };
  });

  // A HubSpot company no account claimed whose name is a likely duplicate
  // of a matched account's (likelyDuplicateName) goes on that account's row
  // as `duplicates` instead of a row of its own.
  const hosts = rows.filter(r => r.hubspot.length).map(r => ({
    row: r,
    names: [r.account.company, r.account.goesBy, ...(Array.isArray(r.account.aliases) ? r.account.aliases : []), ...r.hubspot.map(c => c.name)]
      .filter(Boolean).map(prepDup),
  }));
  const dupNames = new Map();
  for (const c of companies) {
    if (claimed.has(String(c.id))) continue;
    if (!dupNames.has(c.name)) {
      const p = prepDup(c.name);
      dupNames.set(c.name, hosts.find(h => h.names.some(n => dupPrepared(n, p)))?.row || null);
    }
    const host = dupNames.get(c.name);
    if (host) { host.duplicates.push(c); claimed.add(String(c.id)); }
  }

  // Possible matches between the accounts left over and the HubSpot
  // companies no account claimed, both ways.
  const unclaimed = companies.filter(c => !claimed.has(String(c.id)));
  const unclaimedKeys = unclaimed.map(c => [normalizeCompany(c.name), c]);
  // Same-named records are scored once, as the first of them.
  const hubspotPool = [];
  const pooled = new Set();
  for (const [k, c] of unclaimedKeys) {
    if (!k || pooled.has(k)) continue;
    pooled.add(k);
    hubspotPool.push({ names: [prepName(k)], ref: { hubspotId: String(c.id), name: c.name } });
  }
  const accountPool = [];
  for (const r of rows) {
    if (r.hubspot.length) continue;
    const names = accountNames(r.account).map(prepName);
    r.suggestions = bestMatches(names, hubspotPool).map(m => ({ ...m, accountId: r.account.id }));
    if (names.length && r.account.id) accountPool.push({ names, ref: { accountId: r.account.id, name: r.account.company } });
  }

  for (const r of rows) {
    r.status = r.hubspot.length ? MAPPING_STATUS.matched : MAPPING_STATUS.accountOnly;
    r.statusFlag = r.hubspot.length ? statusDiscrepancy(r.account.status, r.hubspot.map(c => c.lifecycle)) : '';
  }
  const trackerByName = new Map();
  const trackerByDomain = new Map();
  for (const p of tracker) {
    const d = accountDomain(p);
    if (d) (trackerByDomain.get(d) || trackerByDomain.set(d, []).get(d)).push(p);
    for (const n of new Set(accountNames(p))) (trackerByName.get(n) || trackerByName.set(n, []).get(n)).push(p);
  }
  const onTracker = (hubspot) => {
    const seen = new Set();
    return hubspot.flatMap(c => [
      ...(c.domain ? trackerByDomain.get(c.domain) || [] : []),
      ...(trackerByName.get(normalizeCompany(c.name)) || []),
    ]).filter(p => !seen.has(p) && seen.add(p));
  };

  // Same-named HubSpot records share a row, so duplicates show as one
  // company with "N records", as they do on a matched account.
  const groups = new Map();
  for (const [k, c] of unclaimedKeys) {
    const g = k || `id:${c.id}`;
    (groups.get(g) || groups.set(g, []).get(g)).push(c);
  }
  for (const [k, hubspot] of groups) {
    const suggestions = k.startsWith('id:') ? [] : bestMatches([prepName(k)], accountPool).map(m => ({ ...m, hubspotId: String(hubspot[0].id) }));
    rows.push({ key: `h:${hubspot[0].id}`, status: MAPPING_STATUS.hubspotOnly, account: null, hubspot, how: '', suggestions, statusFlag: '', tracker: onTracker(hubspot), duplicates: [] });
  }
  return rows;
}

/**
 * The Only in HubSpot companies owned by `ownerName`, as rows for a HubSpot
 * import (Record ID, Company name, Company Domain Name, Company owner): Dan
 * takes them off his name in HubSpot from this list. One row per HubSpot
 * record, so same-named records each come along. A record with no owner in
 * the export counts as his (the export is of his companies); one owned by
 * someone else is left out. Record ID is blank when the export had no
 * Company ID column, since the row numbers stood in for it.
 */
export function hubspotOnlyOwnedRows(mapping = [], ownerName = '') {
  const out = [];
  for (const r of mapping) {
    if (r.status !== MAPPING_STATUS.hubspotOnly) continue;
    for (const c of r.hubspot || []) {
      if (c.owner && ownerName && !matchesCdm(c.owner, ownerName)) continue;
      out.push({
        'Record ID': /^row-\d+$/.test(String(c.id)) ? '' : String(c.id),
        'Company name': c.name || '',
        'Company Domain Name': c.domain || '',
        'Company owner': c.owner || '',
      });
    }
  }
  return out;
}

/**
 * The HubSpot company owners on a row who aren't `ownerName` (matchesCdm),
 * once each. A record with no owner is nobody's, so it isn't listed.
 */
export function otherOwners(row, ownerName = '') {
  if (!ownerName) return [];
  const out = [];
  for (const c of row?.hubspot || []) {
    const o = String(c?.owner || '').trim();
    if (o && !matchesCdm(o, ownerName) && !out.includes(o)) out.push(o);
  }
  return out;
}

/**
 * The Hubspot Mapping subtab's "Owned by others" report: the matched
 * accounts (In both) where a HubSpot company they map to has a Company
 * owner who isn't `ownerName`.
 */
export function ownedByOthersRows(mapping = [], ownerName = '') {
  return (mapping || []).filter(r => r.status === MAPPING_STATUS.matched && r.account && otherOwners(r, ownerName).length > 0);
}
