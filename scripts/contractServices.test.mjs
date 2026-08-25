// Assertion tests for contract → catalogue service matching. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/contractServices.test.mjs
//
// The Clients › Contract Services subtab asks Claude what services a contract
// puts in scope; the model answers in the CONTRACT's words. Everything the app
// stores is keyed by the catalogue's words. This module is the join, and it is
// the piece that decides whether a reviewer sees a pre-filled row or has to
// pick from a 140-entry dropdown.
//
// The failure worth guarding is not "missed a match" — that degrades to an
// unmatched row a human resolves in one click. It is a confident WRONG match,
// which writes a service the contract never mentioned onto a client record.
import {
  normServiceName, scoreMatch, matchCatalogService, mergeExtractedServices, ignoreKeyFor,
} from '../src/utils/contractServices.js';
import { SERVICE_CATEGORIES } from '../src/data/enums.js';

// The real catalogue in the shape buildServiceCatalog() hands the matcher —
// no renames, nothing hidden.
const CATALOG = SERVICE_CATEGORIES.map(c => ({
  name: c.name,
  items: c.items.map(i => ({ key: i, label: i })),
}));

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function matchKey(name) {
  return matchCatalogService(name, CATALOG)?.key ?? null;
}

// ---- normalization ----------------------------------------------------------

eq(normServiceName('E.E.D.'), 'eed', 'a dotted acronym glues back into one token');
eq(normServiceName('EED'), 'eed', 'and matches the undotted spelling');
eq(normServiceName('  Bill   Payment '), 'bill payment', 'whitespace collapses');
eq(normServiceName(null), '', 'null normalizes to empty');
// Single digits are NOT glued: nine Scope 3 categories depend on it.
eq(normServiceName('Cat 1 & 2'), 'cat 1 2', 'digits stay separate tokens');
eq(scoreMatch('Cat 1 & 2', 'Cat 12') < 0.5, true, '"Cat 1 & 2" and "Cat 12" are different services');

// ---- scoring ----------------------------------------------------------------

eq(scoreMatch('Bill payment', 'bill payment'), 1, 'case-insensitive exact match scores 1');
eq(scoreMatch('E.E.D.', 'EED'), 1, 'punctuation differences still score as exact');
eq(scoreMatch('Comp GHG', 'GHG'), 0.85, 'containment scores 0.85');
eq(scoreMatch('', 'GHG'), 0, 'an empty name scores 0');
eq(scoreMatch('Demand response', 'Peak Alerts') < 0.4, true, 'unrelated names score below the threshold');

// ---- matching contract wording onto the catalogue ---------------------------

eq(matchKey('Bill Payment Services'), 'Bill payment', 'a contract-worded name matches its catalogue entry');
eq(matchKey('Demand Response'), 'Demand response', 'casing alone is not a barrier');
eq(matchKey('Strategic Sourcing'), 'Strategic sourcing', 'exact catalogue names match themselves');

// Alias table: wording that shares no tokens with the catalogue entry.
eq(matchKey('EcoStruxure Resource Advisor'), 'RA dashboards & reporting', 'Resource Advisor resolves through the alias table');
eq(matchKey('EED Services'), 'E.E.D.', 'a short alias matches as a whole phrase');
eq(matchKey('Risk Managed Portfolio Services'), 'Risk managment', 'an alias reaches the catalogue’s misspelled key');
eq(matchKey('Greenhouse Gas Inventory'), 'GHG', 'an acronym-only catalogue entry is reachable by its long form');
eq(matchKey('Virtual Power Purchase Agreement'), 'PPA/VPPA', 'VPPA long form resolves');

// Alias order: the specific canonical must win over the generic one it would
// otherwise be swallowed by.
eq(matchKey('Advanced Visualization Portal'), 'RA AV report', 'the AV alias beats the generic Resource Advisor entry');

// ---- what must NOT match ----------------------------------------------------

eq(matchKey('Monthly Invoice Processing Fee'), null, 'a billing line item finds no service');
eq(matchKey(''), null, 'an empty name matches nothing');
eq(matchKey('Zamboni resurfacing'), null, 'a service the catalogue has no concept of stays unmatched');

// "RA" as a bare token used to drag 14 services in via substring containment
// (St-ra-tegic sourcing, -Ra-te optimization). Whatever it resolves to, it may
// not resolve to one of those.
const bareRa = matchKey('RA');
eq(bareRa === 'Strategic sourcing' || bareRa === 'Rate optimization', false, 'a bare "RA" cannot land on an unrelated service');

// ---- short catalogue keys must not swallow long contract names -------------
//
// The catalogue has a dozen two- and three-letter keys (EV, SSO, GRI, IDM,
// UCA, ECH, EPS, GHG). Under raw-substring containment every one of them was
// a landmine: "EV" scored 0.85 against "ASHRAE L-EV-el II Energy Audit" and
// won the row, so a real contract clause was about to be recorded as an
// electric-vehicle service. Containment is whole-token for this reason.
eq(scoreMatch('ASHRAE Level II Energy Audit', 'EV'), 0, '"EV" does not match inside the word "level"');
eq(matchKey('ASHRAE Level II Energy Audit'), 'Audits', 'an ASHRAE audit lands on Audits, not on EV');
eq(matchKey('Single Sign-On Configuration'), 'SSO', 'a long form still reaches its short key through the alias table');
eq(matchKey('Electric Vehicle Charging Infrastructure'), 'EV', 'EV is reachable by the name a contract would actually use');
eq(scoreMatch('Comp GHG', 'GHG'), 0.85, 'a short key still matches when it IS a whole token');

// Every catalogue name must match itself, and match itself best. A short key
// captured by some other entry shows up here rather than in production.
const selfMisses = [];
for (const cat of CATALOG) {
  for (const it of cat.items) {
    if (matchCatalogService(it.key, CATALOG)?.key !== it.key) selfMisses.push(it.key);
  }
}
eq(selfMisses, [], 'every catalogue service matches itself');

// A canonical missing from the catalogue resolves to nothing rather than
// inventing a key — this is what a hidden or renamed service looks like.
const TINY = [{ name: 'DATA', items: [{ key: 'Bill payment', label: 'Bill payment' }] }];
eq(matchCatalogService('EcoStruxure Resource Advisor', TINY), null, 'an alias whose canonical is not in the catalogue resolves to nothing');
eq(matchCatalogService('Bill Payment', []), null, 'an empty catalogue matches nothing');

// A user's rename is matchable too, and still resolves back to the stored key.
const RENAMED = [{ name: 'DATA', items: [{ key: 'Bill payment', label: 'Utility Bill Pay' }] }];
eq(matchCatalogService('Utility Bill Pay', RENAMED)?.key, 'Bill payment', 'a renamed label matches but returns the canonical key');

// ---- merging several documents ---------------------------------------------

const master = {
  fileName: 'MSA.pdf',
  result: { services: [
    { name: 'Bill Payment Services', action: 'add', kind: 'recurring', evidence: 'Vendor shall provide Bill Payment Services.' },
    { name: 'Demand Response', action: 'add', kind: 'recurring', evidence: 'Demand Response enrollment.' },
  ] },
};
const amendment = {
  fileName: 'Amendment 1.pdf',
  result: { services: [
    { name: 'Demand Response', action: 'remove', kind: 'recurring', evidence: 'Demand Response shall be terminated.' },
    { name: 'Bill Pay', action: 'add', kind: 'recurring', evidence: 'Bill Pay continues.' },
  ] },
};

const merged = mergeExtractedServices([master, amendment], CATALOG);
eq(merged.length, 2, 'two documents naming three service mentions merge to two rows');

const billPay = merged.find(r => r.match?.key === 'Bill payment');
eq(billPay.removed, false, 'a service re-affirmed by the amendment stays in scope');
eq(billPay.sources, ['MSA.pdf', 'Amendment 1.pdf'], 'both documents are credited on the merged row');
eq(billPay.evidence.length, 2, 'evidence quotes accumulate across documents');

const dr = merged.find(r => r.match?.key === 'Demand response');
eq(dr.removed, true, 'a later amendment’s removal supersedes the master’s add');

// Order is the whole basis of that: oldest first, so reversing the input
// reverses the verdict. Callers must pass documents in the order analyzed.
const reversed = mergeExtractedServices([amendment, master], CATALOG);
eq(reversed.find(r => r.match?.key === 'Demand response').removed, false, 'reversed order lets the master re-add it — documents are replayed in the order given');

// An unmatched service still gets a row, keyed by name so a reviewer can map it.
const unmatched = mergeExtractedServices([
  { fileName: 'SOW.pdf', result: { services: [{ name: 'Zamboni resurfacing', action: 'add', kind: 'one_time', evidence: 'Resurfacing.' }] } },
], CATALOG);
eq(unmatched.length, 1, 'an unmatched service still produces a review row');
eq(unmatched[0].match, null, 'and carries no catalogue match');

// Junk in, nothing out — a nameless entry is dropped rather than becoming a
// blank row a reviewer has to puzzle over.
eq(mergeExtractedServices([{ fileName: 'x.pdf', result: { services: [{ name: '   ', action: 'add' }] } }], CATALOG).length, 0, 'a blank service name is dropped');
eq(mergeExtractedServices([], CATALOG).length, 0, 'no documents means no rows');
eq(mergeExtractedServices([{ fileName: 'x.pdf', result: {} }], CATALOG).length, 0, 'a result with no services array is tolerated');

// ---- ignore keys ------------------------------------------------------------
// An "this wording isn't a service" decision is remembered across contracts,
// so its key has to survive the way the same clause is re-worded from one
// document to the next. These are the drifts that actually occur.

eq(ignoreKeyFor({ name: 'Global Research & Analytics', match: null }),
   ignoreKeyFor({ name: 'Global research and analytics', match: null }),
   '"&" and "and" are one remembered ignore');
eq(ignoreKeyFor({ name: 'Board Reporting Narrative', match: null }),
   ignoreKeyFor({ name: 'board reporting narrative', match: null }),
   'casing does not split a remembered ignore');
eq(ignoreKeyFor({ name: 'Summary of Findings', match: null }),
   ignoreKeyFor({ name: 'Summary Findings', match: null }),
   'a dropped joining word does not split a remembered ignore');
eq(ignoreKeyFor({ name: 'Anything', match: { key: 'Bill payment' } }),
   'k:Bill payment',
   'a matched row is remembered by its catalogue key, not its wording');
eq(ignoreKeyFor({ name: 'Zamboni resurfacing', match: null }), 'n:zamboni resurfacing',
   'an unmatched row is remembered by its normalized name');
// Blunt, but not so blunt it folds two real services together.
const differs = ignoreKeyFor({ name: 'Cat 1 emissions', match: null })
  !== ignoreKeyFor({ name: 'Cat 12 emissions', match: null });
eq(differs, true, 'two services that differ only by number stay two remembered decisions');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
