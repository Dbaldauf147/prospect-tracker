// Bulk Add's CDM / Other Reps column reads the account the row's Company
// NAMES, not whichever account the email domain matched: a domain match
// to the wrong company must not lend that company's CDM to the row.
//
// Run: node scripts/bulkCdmByCompany.test.mjs
import { prospectForRowCompany } from '../src/utils/companyLookup.js';
import { companiesMatch } from '../src/utils/listFlags.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const prospects = [
  { id: 'qc', company: 'Quantum (Quantum Capital Group)', cdm: 'Someone Else' },
  { id: 'qe', company: 'Quantum Energy Partners', cdm: 'Dan Baldauf' },
  { id: 'bh', company: 'BRIDGE Housing', cdm: '-' },
  { id: 'mo', company: 'Mutual of Omaha', cdm: 'Dan Baldauf' },
  { id: 'n1', company: 'Blue Owl Inc', cdm: 'A' },
  { id: 'n2', company: 'Blue Owl LLC', cdm: 'B' },
];
const by = (id) => prospects.find(p => p.id === id);
const pick = (company, matchedId) => prospectForRowCompany(prospects, company, matchedId ? by(matchedId) : null, { fuzzy: companiesMatch })?.id ?? null;

check('the named company wins over a wrong domain match', pick('Quantum Energy Partners', 'qc'), 'qe');
check('exact match ignores case and spaces', pick('  quantum energy partners ', null), 'qe');
check('a company the tracker lacks shows no CDM, not the domain match\'s', pick('Bridge Investment Group', 'bh'), null);
check('a close variant finds the account', pick('Mutual of Omaha Insurance', null), 'mo');
check('the domain match is kept when it is the named company', pick('Mutual of Omaha Insurance', 'mo'), 'mo');
check('an ambiguous variant resolves to nothing', pick('Blue Owl', null), null);
check('a blank Company falls back to the domain match', pick('', 'qc'), 'qc');
check('blank and unmatched is nothing', pick('', null), null);
check('without a fuzzy rule only exact names match', prospectForRowCompany(prospects, 'Mutual of Omaha Insurance', null)?.id ?? null, null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
