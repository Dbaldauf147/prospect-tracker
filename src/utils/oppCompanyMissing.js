// Issues > "Opp company not in Table View": the Accounts on the Opps tab
// that no Table View company answers to.
//
// An opp is tied to its company by name only, so an Account with no Table
// View company is invisible to everything that reads opps by company: the
// company popup's opp list and Services Explored grid, Clients > Retention
// (where it shows as "Not in Table"), the BFO prompts' BFO Company Name.
//
// A name counts as matched when it shares companyDedupeKey with a Table View
// company or one of that company's merge aliases (utils/companyAliases), the
// rule the sheet sync and the add-company guard use, or when it normalizes
// the same way the BFO lookups match names (normalizeBfoCompany), so nothing
// the rest of the app can already find is flagged.
//
// One row per company, not per opp: a company with ten opps is one thing to
// fix (add it, or rename / merge the spelling), and snoozing it should take
// all ten. Blank Accounts are skipped. Pure, so it is tested without a
// browser (scripts/oppCompanyMissing.test.mjs).
import { companyDedupeKey } from './companyKey.js';
import { recordCompanyKeys } from './companyAliases.js';

// Same as newBfoOpps.normalizeBfoCompany. Copied rather than imported: that
// module pulls in the service catalog, which Node can't load for the test.
function bfoNorm(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * [{ key, account, accounts, opps: [record], stages: { [stage]: n } }],
 * the unmatched companies, most opps first. Empty until the roster has
 * loaded: an empty roster would flag every opp.
 */
export function oppCompaniesMissing(oppRecords, prospects) {
  if (!Array.isArray(prospects) || prospects.length === 0) return [];
  const keys = new Set();
  const norms = new Set();
  for (const p of prospects) {
    if (!p) continue;
    for (const k of recordCompanyKeys(p)) keys.add(k);
    for (const name of [p.company, ...(Array.isArray(p.companyAliases) ? p.companyAliases : [])]) {
      const n = bfoNorm(name);
      if (n) norms.add(n);
    }
  }
  const groups = new Map();
  for (const r of oppRecords || []) {
    if (!r || typeof r !== 'object') continue;
    const account = String(r.Account ?? '').trim();
    if (!account || account === '-') continue;
    const key = companyDedupeKey(account);
    if (!key || keys.has(key) || norms.has(bfoNorm(account))) continue;
    let g = groups.get(key);
    if (!g) { g = { key, account, accounts: [], opps: [], stages: {} }; groups.set(key, g); }
    if (!g.accounts.includes(account)) g.accounts.push(account);
    g.opps.push(r);
    const stage = String(r.Stage ?? '').trim() || 'No stage';
    g.stages[stage] = (g.stages[stage] || 0) + 1;
  }
  return [...groups.values()].sort((a, b) => (b.opps.length - a.opps.length) || a.account.localeCompare(b.account));
}

// Words that say nothing about which company it is.
const FILLER = new Set(['the', 'of', 'and', 'a', 'an', 'group', 'holdings', 'partners', 'company', 'inc', 'llc', 'lp', 'trust', 'real', 'estate', 'capital', 'properties', 'management', 'investments', 'investment']);
const wordsOf = (name) => bfoNorm(name).split(' ').filter(w => w.length > 1);

/**
 * Table View company names ordered for mapping `account` to one: the
 * likeliest first (one name inside the other, then the most shared
 * distinctive words), then the rest A to Z. Returns { names, best }, `best`
 * the top name when it shares a distinctive word or contains / is contained
 * by the account, else ''.
 */
export function rankCompanyChoices(account, prospects) {
  const target = bfoNorm(account);
  const tWords = new Set(wordsOf(account));
  const seen = new Set();
  const scored = [];
  for (const p of prospects || []) {
    const name = String(p?.company || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const n = bfoNorm(name);
    let score = 0;
    if (n && target && (n.includes(target) || target.includes(n)) && Math.min(n.length, target.length) >= 3) score += 10;
    for (const w of wordsOf(name)) if (tWords.has(w)) score += FILLER.has(w) ? 0.25 : 2;
    scored.push({ name, score });
  }
  scored.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  const top = scored[0];
  return { names: scored.map(x => x.name), best: top && top.score >= 2 ? top.name : '' };
}

/** The Issues rows for them. `oppNumbers` maps opp _id to its Opp #. */
export function oppCompanyMissingIssues(oppRecords, prospects, oppNumbers = new Map()) {
  return oppCompaniesMissing(oppRecords, prospects).map((g) => {
    const nums = g.opps.map(r => oppNumbers.get(r._id)).filter(n => n != null).sort((a, b) => a - b);
    const stages = Object.entries(g.stages).map(([s, n]) => `${n} ${s}`).join(', ');
    const spellings = g.accounts.length > 1 ? ` Spelled ${g.accounts.map(a => `"${a}"`).join(', ')}.` : '';
    const count = g.opps.length;
    return {
      // Keyed by the company, so the row is snoozed once for all its opps.
      id: `opp-company-missing:${g.key}`,
      source: 'Opps',
      type: 'Opp company not in Table View',
      company: g.account,
      oppNumber: nums.length === 1 ? nums[0] : null,
      prospectId: null,
      daysUntil: null,
      expirationDate: null,
      // Resolution popup (Issues > Resolve): map these opps to an existing
      // Table View company by setting their Account to its name.
      resolve: { kind: 'oppCompany', account: g.account, accounts: g.accounts, oppIds: g.opps.map(r => r._id).filter(id => id != null) },
      detail: `${count} ${count === 1 ? 'opp names' : 'opps name'} "${g.account}" as the Account (${stages})`
        + `${nums.length > 1 ? `: Opp # ${nums.join(', ')}` : ''}, but no Table View company has that name.`
        + `${spellings} Add the company to Table View, or correct the Account to an existing company's name.`,
    };
  });
}
