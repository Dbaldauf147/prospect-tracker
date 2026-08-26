// Assertion tests for how two company names are compared to decide they
// are the SAME company. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/companyKey.test.mjs
//
// Both directions of this are expensive. Too strict and every spelling
// variant mints a second account — with its own document id, and so none
// of the Target Account / divisions / HQ mappings keyed to the first;
// that is what put 47 companies on the roster twice. Too loose and the
// duplicate collapse DELETES a genuinely separate account, which is
// worse: Brookfield alone is filed under 78 fund/region qualifiers.
import { companyDedupeKey, normalizeCompanyName, identifyingQualifier } from '../src/utils/companyKey.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}
const same = (a, b, name) => eq(companyDedupeKey(a) === companyDedupeKey(b), true, name);
const apart = (a, b, name) => eq(companyDedupeKey(a) === companyDedupeKey(b), false, name);

// ── The same company, entered two ways ─────────────────────────────────
same('Brookfield Inc.', 'Brookfield', 'a corporate suffix is not an identity');
same('H.I.G. Capital', 'HIG Capital, LLC', 'punctuated initials match their run-together spelling');
same('H.I.G Capital', 'H.I.G. Capital', 'and a missing final period changes nothing');
same('Lend Lease', 'LendLease', 'a word break is not an identity');
same('Citi Bank', 'Citibank', 'nor is this one');
same('Price Waterhouse Coopers (PWC)', 'PricewaterhouseCoopers LLP', 'nor two of them');
same('Edens (a Blackstone co.)', 'Edens', 'an ownership note says who owns it, not who it is');
same('Stream Data Centers (an Apollo co.)', 'Stream Data Centers', 'including the "an" spelling');
same('Nuveen Real Estate, a TIAA Co.', 'Nuveen Real Estate', 'and the same note written without parentheses');
same('Square Mile Capital Management, an Affinius Capital Co.', 'Square Mile Capital Management (an Affinius Capital Co.)',
  'so the two ways of writing it agree');
apart('Clayton, Dubilier & Rice', 'Clayton', 'a comma\u2019d name is not an ownership note');
same('Swissport (a SVP co.)', 'Swissport (a Towerbrook co.)', 'so a company that changed hands is still one company');
same('Chamberlain (BX-PC)', 'Chamberlain', 'a portfolio-list tag is not an identity');
same('Biomed (BX-PE)', 'Biomed (PE)', 'whichever list it came from');
same('Pritzker Private Capital (PPC-PC)', 'Pritzker Private Capital (PPC)', 'or however that list is abbreviated');
same('Clayton, Dubilier & Rice (CD&R)', 'Clayton, Dubilier & Rice', 'a name’s own acronym adds nothing');
same('Clayton, Dubilier & Rice (CDR)', 'Clayton, Dubilier & Rice (CD&R)', 'however the acronym is punctuated');
same('American Industrial Partners (AIP)  (BX-PC)', 'American Industrial Partners', 'acronym and list tag together');
same('IRG (Industrial Realty Group)', 'IRG', 'nor does the name spelled out behind its acronym');
same('Berkshire Residential Investments (Berkshire Group)', 'Berkshire Residential Investments',
  'nor a tag repeating words the name already has');
same('Copeland (Emerson) (BX-PC)', 'Copeland (Emerson)', 'a real qualifier survives having a list tag stripped beside it');

// ── Genuinely separate accounts ────────────────────────────────────────
apart('Brookfield (Dubai)', 'Brookfield (NAM Multifamily)', 'a region tag is the whole identity');
apart('Brookfield (Self Storage)', 'Brookfield', 'and a segment tag separates a fund from the parent');
apart('Prologis (Data Centers)', 'Prologis', 'even when the parent has no tag at all');
apart('Brookfield Logistics (France)', 'Brookfield Logistics (US)', 'two regions of one business line');
apart('Edmond de Rothschild REIM (UK) Limited', 'Edmond de Rothschild REIM (Suisse) SA', 'two national entities');
apart('Fund A', 'Fund B', 'a lone trailing letter is not an initialism to collapse');
apart('CH Guenther', 'C.H. Guenther & Son (a Pritzker Private Capital co.)',
  'names that differ by more than punctuation stay apart — this pair needs a manual merge');
apart('Blackstone', 'Blackstone GP Stakes', 'a brand prefix does not make one company');

// ── Pieces ─────────────────────────────────────────────────────────────
eq(normalizeCompanyName('Affinius Capital, a USAA Co.'), 'affinius capital', 'the base drops a trailing ownership note');
eq(normalizeCompanyName('H.I.G. Capital'), 'hig capital', 'the base keeps word breaks for callers that need them');
eq(identifyingQualifier('Brookfield (Dubai)'), 'dubai', 'an identifying qualifier survives');
eq(identifyingQualifier('Edens (a Blackstone co.)'), '', 'an ownership note does not');
eq(identifyingQualifier('Chamberlain (BX)'), '', 'and neither does a list tag');
eq(companyDedupeKey(''), '', 'an empty name has no key');
eq(companyDedupeKey(null), '', 'and neither does no name at all');
eq(companyDedupeKey('(BX-PC)'), '', 'a name that is nothing but a list tag has no key either');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
