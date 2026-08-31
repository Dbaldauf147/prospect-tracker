// Assertion tests for the predictive-text ranking behind the Deals tab's
// "Mapped to Client" cell. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/clientSuggest.test.mjs
//
// What's worth holding is the ranking: the whole point of typing into the
// cell instead of scrolling a 130-entry dropdown is that the name you meant
// comes first. A plain substring filter doesn't do that.
import { normSuggest, suggestClients, exactClientMatch } from '../src/utils/clientSuggest.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// --- normalization ---------------------------------------------------------

check('case and punctuation fall away', normSuggest('ACME Energy, LLC.'), 'acme energy llc');
check('ampersands survive as a word break', normSuggest('AT&T'), 'at t');
check('nullish normalizes to empty', normSuggest(null), '');

// --- ranking ---------------------------------------------------------------

const OPTIONS = [
  'Northern Star Waste',
  'Star Energy',
  'Starbucks Corporation',
  'Lone Star Texas Grill',
  'Acme Energy, LLC',
  'Zenith Holdings',
];

same('a prefix match outranks a mid-name match',
  suggestClients(OPTIONS, 'star'),
  ['Star Energy', 'Starbucks Corporation', 'Northern Star Waste', 'Lone Star Texas Grill']);
same('an exact match comes first of all',
  suggestClients(['Star Energy Group', 'Star Energy'], 'star energy'),
  ['Star Energy', 'Star Energy Group']);
same('terms can be non-adjacent',
  suggestClients(OPTIONS, 'star tex'),
  ['Lone Star Texas Grill']);
same('every term has to match',
  suggestClients(OPTIONS, 'star nothinglikethis'),
  []);
same('punctuation in the option does not block a match',
  suggestClients(OPTIONS, 'acme energy llc'),
  ['Acme Energy, LLC']);
same('an empty query browses the whole list',
  suggestClients(OPTIONS, '   '),
  OPTIONS);
same('the limit caps the list', suggestClients(OPTIONS, '', { limit: 2 }), OPTIONS.slice(0, 2));
same('a junk option list yields nothing', suggestClients(null, 'star'), []);

// --- committing typed text -------------------------------------------------

check('a loose exact match resolves to the real name',
  exactClientMatch(OPTIONS, '  acme energy llc  '), 'Acme Energy, LLC');
check('a partial name resolves to nothing', exactClientMatch(OPTIONS, 'acme'), '');
check('empty text resolves to nothing', exactClientMatch(OPTIONS, '  '), '');

console.log(failures === 0 ? '\nAll clientSuggest tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
