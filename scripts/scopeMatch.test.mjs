// Assertion tests for Scope → service matching. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/scopeMatch.test.mjs
//
// This rule decides which services an opportunity's Scope names, and
// three boards read it: the company card's Services Explored grid, the
// Opps 2 Scope picker, and the Pipeline coverage table (which the Issues
// tab's coverage warning is derived from). It used to be substring
// containment in either direction, which made "RA" match 14 of the 143
// catalogue services — "St[ra]tegic sourcing" and "[Ra]te optimization"
// among them.
//
// The tests below hold two lines at once: the shorthand that made the
// looseness worth having must keep working, and the collateral must stop.
import {
  scopeTokens, serviceWords, scopeTokenMatchesService, servicesInScope,
} from '../src/utils/scopeMatch.js';
import { SERVICE_CATEGORIES } from '../src/data/enums.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- splitting a Scope cell -------------------------------------------------

eq(scopeTokens('GHG; Budgets'), ['GHG', 'Budgets'], 'a scope splits on semicolons');
eq(scopeTokens('GHG, Budgets / EPS'), ['GHG', 'Budgets', 'EPS'], 'commas and slashes split too');
eq(scopeTokens('  GHG  '), ['GHG'], 'tokens are trimmed');
eq(scopeTokens(''), [], 'an empty scope names nothing');
eq(scopeTokens(null), [], 'a missing scope names nothing');

// ---- words ------------------------------------------------------------------

eq(serviceWords('Bill payment'), ['bill', 'payment'], 'a name becomes its words');
eq(serviceWords('RA + - pull through'), ['ra', 'pull', 'through'], 'punctuation is not a word');
eq(serviceWords('Open/Close'), ['open', 'close'], 'a slash separates words');
eq(serviceWords('UPRs'), ['upr'], 'a plural is stemmed so "UPR" and "UPRs" meet');
eq(serviceWords('EPS'), ['eps'], 'a short all-caps name is NOT stemmed into nonsense');
eq(serviceWords('Gas'), ['gas'], 'nor is any other three-letter word');

// ---- the shorthand that has to keep working ---------------------------------

eq(scopeTokenMatchesService('GHG', 'Comp GHG'), true, 'shorthand still finds the longer service');
eq(scopeTokenMatchesService('GHG', 'GHG'), true, 'an exact name matches itself');
eq(scopeTokenMatchesService('ghg', 'GHG'), true, 'case never matters');
eq(scopeTokenMatchesService('UPR', 'UPRs'), true, 'singular finds plural');
eq(scopeTokenMatchesService('UPRs', 'UPR'), true, 'and the other way round');
eq(scopeTokenMatchesService('RA', 'RA survey'), true, 'a family prefix still finds its family');
eq(scopeTokenMatchesService('Invoice collection - light', 'Invoice collection'), true, 'a scope written out more fully than the catalogue still matches');

// ---- the collateral that has to stop ----------------------------------------

eq(scopeTokenMatchesService('RA', 'Strategic sourcing'), false, 'RA no longer matches ST-RA-TEGIC sourcing');
eq(scopeTokenMatchesService('RA', 'Rate optimization'), false, 'nor RA-te optimization');
eq(scopeTokenMatchesService('UCA', 'Education calls'), false, 'nor UCA ed-UCA-tion calls');
eq(scopeTokenMatchesService('CA', 'Waste data capture'), false, 'a two-letter token stops spraying across the catalogue');
eq(scopeTokenMatchesService('SE', 'Open/Close'), false, 'and so does the other one');
eq(scopeTokenMatchesService('Rate', 'Corporate Compliance Screening'), false, 'co-RATE is not a rate');
eq(scopeTokenMatchesService('', 'GHG'), false, 'an empty token names nothing');
eq(scopeTokenMatchesService('GHG', ''), false, 'and nothing is never named');
eq(scopeTokenMatchesService('---', 'GHG'), false, 'a token with no words in it matches nothing');

// Word ORDER and adjacency matter: a run, not a bag of words.
eq(scopeTokenMatchesService('payment bill', 'Bill payment'), false, 'the words have to be in order');
eq(scopeTokenMatchesService('RA report', 'RA AV report'), false, 'and adjacent — a gap is a different service');

// ---- against the real catalogue ---------------------------------------------

const items = SERVICE_CATEGORIES.flatMap(c => c.items);

// The safety net that matters most: every catalogue name must still find
// itself, or a Scope picked from the board would stop matching the board.
const orphans = items.filter(i => !scopeTokenMatchesService(i, i));
eq(orphans, [], 'every catalogue service still matches its own name');

// Nothing that used to match something may now match nothing — that would
// be a service silently losing its automatic status.
const oldMatch = (t, i) => {
  const a = String(t).toLowerCase(); const b = String(i).toLowerCase();
  return b === a || b.includes(a) || a.includes(b);
};
const words = [...new Set(items.flatMap(i => i.split(/[^A-Za-z0-9]+/).filter(w => w.length >= 2)))];
const probes = [...new Set([...items, ...words])];
const wentSilent = probes.filter(t => items.some(i => oldMatch(t, i)) && !items.some(i => scopeTokenMatchesService(t, i)));
eq(wentSilent, [], 'no token that used to match something now matches nothing');

// And the headline: how far the over-matching actually went.
eq(items.filter(i => oldMatch('RA', i)).length, 14, 'the old rule matched 14 services for a scope of "RA"');
eq(items.filter(i => scopeTokenMatchesService('RA', i)).length, 6, 'the new one matches the 6 that are really RA');

// ---- a whole Scope cell -----------------------------------------------------

eq(servicesInScope('GHG; Bill payment', items), ['Bill payment', 'GHG', 'Comp GHG', 'Cat 3, 5, 6, and 7 (part of GHG)'].filter(s => items.includes(s)), 'a scope names every service its tokens do');
eq(servicesInScope('', items), [], 'an empty scope names nothing');
eq(servicesInScope('Strategic sourcing', items), ['Strategic sourcing'], 'a precise scope names exactly one service');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
