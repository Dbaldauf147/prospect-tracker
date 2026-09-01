// Turning an opportunity into a Services Pricing scenario.
//
// The rate card on Dropdowns › Services Pricing prices a scope; this works
// out what an opp's scope actually IS, and how many sites / accounts /
// meters to price it against, from what the app already knows:
//
//   services  — the catalogue services the opp's Scope text names, using
//               the same word-run rule the company card's Services Explored
//               board and Opps 2's Scope picker match on (utils/scopeMatch),
//               so an opp lights up the same services in all three places
//   counts    — a column on the opp itself first (Opps 2 headers are the
//               user's own, so an opp that carries "# of Meters" is the most
//               specific answer there is), then the company record's Scale
//               section (sites, accounts, meters, equipment, electric MWh),
//               then the row count of the company's saved site list
//   dealSize  — the opp's Quoted Amount, which is what a percentage-based
//               fee takes its cut of
//
// Every figure carries where it came from, so the import can say what it
// filled in and from where rather than silently seeding numbers. Nothing is
// guessed: a unit with no source is left out, and the caller reports it as
// still needing a number.
//
// Pure — records, prospects and the site-list map in, a scenario out — so
// scripts can exercise it without React or Firestore.

// Explicit .js extensions: this module is pinned by a plain-Node test
// (scripts/oppPricingImport.test.mjs), which resolves specifiers the way
// Node does rather than the way Vite does.
import { servicesInScope, scopeTokens, scopeTokenMatchesService } from './scopeMatch.js';
import { siteListFacts } from './siteListFacts.js';
import { companiesMatch } from './listFlags.js';
import { parseMoney } from './oppsMetrics.js';

// Headers on the opp itself that carry a count, per pricing unit. Opps 2
// headers are whatever the user named their columns, so these are matched
// tolerantly — and most specific first, since "Sites" and "Site Count" can
// both be present.
const OPP_COUNT_HEADERS = {
  sites: [/^#?\s*(of\s*)?sites?$/i, /^number\s*of\s*sites?$/i, /\bsites?\s*count\b/i, /\bsites?\b/i],
  accounts: [/^#?\s*(of\s*)?accounts?$/i, /^number\s*of\s*accounts?$/i, /utility\s*accounts?/i, /\baccounts?\b/i],
  meters: [/^#?\s*(of\s*)?meters?$/i, /^number\s*of\s*meters?$/i, /\bmeters?\s*count\b/i, /\bmeters?\b/i],
  invoices: [/^#?\s*(of\s*)?invoices?$/i, /^number\s*of\s*invoices?$/i, /^#?\s*(of\s*)?bills?$/i, /\binvoices?\b/i],
  mwh: [/^mwh$/i, /^annual\s*mwh$/i, /\bmwh\b/i],
  users: [/^#?\s*(of\s*)?users?$/i, /^number\s*of\s*users?$/i, /\busers?\b/i],
  // Plural only on the loose pattern: a "Project #" column is an identifier,
  // not a count of anything, and reading one as a count would price a deal
  // off an opp number.
  projects: [/^#?\s*(of\s*)?projects?$/i, /^number\s*of\s*projects?$/i, /\bprojects?\s*count\b/i, /\bprojects\b/i],
  equipment: [/^#?\s*(of\s*)?equipment$/i, /^number\s*of\s*equipment$/i, /\bequipment\s*count\b/i, /\bequipment\b/i],
};

// A comparison key for site-list lookup — NOT the storage slug. The stored
// slugs are written by `(name||'').toLowerCase().replace(/[^a-z0-9]/g,'-')`,
// so punctuation becomes a dash rather than disappearing, and a company can
// end up filed as "acme--inc" from one spelling and "acme-inc" from another.
// Reducing both sides past the separators means the lookup matches either.
export function siteListKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function siteListEntryFor(siteLists, company) {
  if (!siteLists || !company) return null;
  const want = siteListKey(company);
  if (!want) return null;
  for (const [slug, entry] of Object.entries(siteLists)) {
    if (siteListKey(slug) === want) return entry;
  }
  return null;
}

// A count off an opp record, by header. Returns { value, header } so the
// import can name the column it read.
function countFromOpp(opp, patterns) {
  const keys = Object.keys(opp || {}).filter(k => !k.startsWith('_'));
  for (const pattern of patterns) {
    for (const key of keys) {
      if (!pattern.test(key.trim())) continue;
      const n = parseMoney(opp[key]);
      if (n !== null && n > 0) return { value: n, header: key };
    }
  }
  return null;
}

function positive(value) {
  const n = parseMoney(value);
  return n !== null && n > 0 ? n : null;
}

/** The prospect record for an opp's Account, or null. */
export function prospectForOpp(opp, prospects) {
  const account = String(opp?.Account || '').trim();
  if (!account) return null;
  const rows = prospects || [];
  // An exact name beats a fuzzy one: companiesMatch deliberately accepts
  // suffix and extra-word drift, which is right for finding a company and
  // wrong for choosing between two that both nearly match.
  const lower = account.toLowerCase();
  return rows.find(p => String(p?.company || '').trim().toLowerCase() === lower)
    || rows.find(p => companiesMatch(p?.company, account))
    || null;
}

/**
 * The scenario an opp implies.
 *
 *   {
 *     account, scope, stage,
 *     company,            // the prospect this resolved to, when one did
 *     services,           // catalogue services the Scope names
 *     unmatchedTokens,    // Scope items that named no service
 *     counts,             // { sites, accounts, … } — only what was found
 *     countSources,       // { sites: 'the opp column "Sites"', … }
 *     dealSize,           // Quoted Amount, or ''
 *     dealSizeSource,
 *   }
 *
 * `serviceNames` is the live service vocabulary — pass the same list the
 * pricing table is showing, so an import can only ever tick a service that
 * has a row to be ticked.
 */
export function oppScenario({ opp, prospects, siteLists, serviceNames }) {
  const account = String(opp?.Account || '').trim();
  const scope = String(opp?.Scope || '').trim();
  const prospect = prospectForOpp(opp, prospects);
  const company = prospect?.company || account;

  const services = servicesInScope(scope, serviceNames || []);
  // Scope items that named nothing in the catalogue. Reported rather than
  // dropped: a token matching no service is usually a service the user
  // spells differently, and the estimate is short by whatever it was.
  const unmatchedTokens = scopeTokens(scope).filter(
    token => !(serviceNames || []).some(name => scopeTokenMatchesService(token, name))
  );

  const counts = {};
  const countSources = {};
  const take = (unit, value, source) => {
    if (value === null || counts[unit] !== undefined) return;
    counts[unit] = value;
    countSources[unit] = source;
  };

  // Most specific first: this opp's own column, then the company record,
  // then the company's site list.
  for (const [unit, patterns] of Object.entries(OPP_COUNT_HEADERS)) {
    const hit = countFromOpp(opp, patterns);
    if (hit) take(unit, hit.value, `the opp’s “${hit.header}” column`);
  }
  take('sites', positive(prospect?.numberOfSites), `Number of Sites on the ${company} record`);
  take('accounts', positive(prospect?.numberOfAccounts), `Number of Accounts on the ${company} record`);
  take('meters', positive(prospect?.numberOfMeters), `Meters on the ${company} record`);
  take('equipment', positive(prospect?.equipmentCount), `Equipment on the ${company} record`);
  take('mwh', positive(prospect?.annualMwh), `Electric MWh on the ${company} record`);

  const entry = siteListEntryFor(siteLists, company);
  if (entry) {
    const facts = siteListFacts(entry);
    take('sites', positive(facts.sites), `the saved site list for ${company}`);
  }

  const quoted = positive(opp?.['Quoted Amount']);

  return {
    id: opp?._id || '',
    account,
    scope,
    stage: String(opp?.Stage || '').trim(),
    company,
    matchedProspect: !!prospect,
    services,
    unmatchedTokens,
    counts,
    countSources,
    dealSize: quoted === null ? '' : quoted,
    dealSizeSource: quoted === null ? '' : 'the opp’s Quoted Amount',
  };
}

/** Opps worth offering in the picker, newest-looking work first. */
const CLOSED_STAGES = new Set(['sold', 'not sold']);

export function pickableOpps(records, term) {
  const t = String(term || '').trim().toLowerCase();
  const rows = (records || []).filter(r => r && String(r.Account || '').trim());
  const matched = t
    ? rows.filter(r => ['Account', 'Scope', 'Stage', 'BFO Link', 'Contact']
      .some(k => String(r[k] || '').toLowerCase().includes(t)))
    : rows;
  // Open opps first — an import is nearly always for live work — then by
  // account so the list reads alphabetically inside each group.
  return matched.slice().sort((a, b) => {
    const ca = CLOSED_STAGES.has(String(a.Stage || '').trim().toLowerCase()) ? 1 : 0;
    const cb = CLOSED_STAGES.has(String(b.Stage || '').trim().toLowerCase()) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return String(a.Account || '').localeCompare(String(b.Account || ''));
  });
}
