// The Account Potential table's search box, which now reads every column
// rather than four of them. Plain Node, no test framework (the project has
// none). Run:
//   node scripts/accountPotentialSearch.test.mjs
//
// The point of the change is that the numbers on this table are what people
// look up: "which one is the 133,500?", "what else is quoted at $6-30?",
// "which service is the $801,000 line?". None of those found anything
// before, because the money and the counts are PRINTED with dollar signs,
// thousands commas and an en dash between the ends of a range, and nobody
// types them back that way.
//
// So both sides get folded to the same shape, and these tests are mostly
// about that folding surviving: a typed "1435951" has to reach a printed
// "$1,435,951", a typed "$6-30" has to reach a printed "$6-$30" (en dash),
// and a term that folds away to nothing must not quietly match every row.
import { rowSearchText, searchable } from '../src/utils/accountPotentialSearch.js';
import { PRICING_BASES } from '../src/utils/servicePricing.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const bases = PRICING_BASES;

// One row of the table as the tab builds it: the Capital asset planning
// line off the ACC account, which prints as
//   1 | Capital asset planning | RA Modules | Per equipment | $6-$30 | 133,500 | $801,000 - $4,005,000
const row = {
  _rank: 1,
  name: 'Capital asset planning',
  serviceBucket: 'RA Modules',
  basisLabel: 'Per equipment',
  _entry: { basis: 'per_equipment', rate: 6, rateHigh: 30, notes: 'Quoted per meter on the RA side' },
  units: 133500,
  _unitLabel: 'Equipment',
  setupLines: [{ basis: 'flat', rate: 15000 }],
  _setupFee: 15000,
  _setupFeeHigh: 15000,
  fee: 801000,
  feeHigh: 4005000,
  notes: 'Quoted per meter on the RA side',
};

const text = rowSearchText(row, bases);
const finds = (typed) => text.includes(searchable(typed.trim()));

// The four fields that always worked keep working.
check('name', finds('capital asset'), true);
check('bucket', finds('RA Modules'), true);
check('basis', finds('per equipment'), true);
check('notes', finds('per meter'), true);

// The columns this change is for.
check('units, as printed', finds('133,500'), true);
check('units, as typed without the comma', finds('133500'), true);
check('units, a leading fragment', finds('1335'), true);
check('rate card, low end', finds('$6'), true);
check('rate card, the range with a plain hyphen', finds('$6-30'), true);
check('rate card, high end', finds('30'), true);
check('setup fee', finds('15000'), true);
check('year 1 fee, as printed', finds('$801,000'), true);
check('year 1 fee, bare digits', finds('801000'), true);
check('year 1 fee, top of the range', finds('4,005,000'), true);
check('rank', finds('1'), true);
check('units placeholder label', finds('equipment'), true);

// And it still says no.
check('a service that is not this one', finds('GHG reporting'), false);
check('a number nothing on the row shows', finds('999999'), false);

// A blank cell prints a muted dash, which is punctuation and not content:
// searching "-" must not drag in every unpriced row. The row above has no
// blank cells, so take one that does.
const bare = {
  _rank: null,
  name: 'Budgets (account level)',
  serviceBucket: 'DATA',
  basisLabel: '',
  _entry: { basis: '', rate: null },
  units: null,
  _unitLabel: '',
  setupLines: [],
  _setupFee: 0,
  _setupFeeHigh: 0,
  fee: null,
  feeHigh: null,
  notes: '',
};
const bareText = rowSearchText(bare, bases);
check('an unpriced row is just its words', bareText, 'budgets (account level) data');
check('no dash smuggled in from the blank cells', bareText.includes('-'), false);

// The fold itself. A term that is nothing but punctuation folds away to the
// empty string, which the tab reads as "no search" - the whole table, not a
// match on every row, and either way not a crash.
check('a term of only a dollar sign folds to nothing', searchable('$'), '');
check('case folds', searchable('RA Modules'), 'ra modules');
check('en dash becomes a hyphen', searchable('$6–$30'), '6-30');
check('nullish is the empty string', searchable(null), '');
check('a list skips its blanks', searchable(['a', '', null, 'b']), 'a b');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
