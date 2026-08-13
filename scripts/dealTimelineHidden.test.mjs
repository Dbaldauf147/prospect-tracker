// Assertion tests for the per-deal store of services hidden on the rollout
// timeline. Plain Node — no test framework (the project has none). Run:
//   node scripts/dealTimelineHidden.test.mjs
//
// Only the pure map surgery is tested here; the localStorage wrappers around
// it are three lines each and there is no localStorage under Node. What's
// worth holding is the scoping — one deal's hidden services must never leak
// onto another's chart — and the empty-entry cleanup, which is what keeps the
// store from accumulating a dead key per deal anybody experimented on.
import { normHiddenName, readHiddenFrom, writeHiddenTo } from '../src/utils/dealTimelineHiddenStore.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}
const sorted = (set) => [...set].sort();

// --- names -----------------------------------------------------------------

check('names are lowercased and trimmed', normHiddenName('  Bill Payment '), 'bill payment');
check('a nullish name normalizes to empty', normHiddenName(null), '');

// --- reading ---------------------------------------------------------------

const map = { 'opp:1': ['bill payment', 'budgets'], 'opp:2': ['rate optimization'] };
same('a plan reads back what it stored', sorted(readHiddenFrom(map, 'opp:1')), ['bill payment', 'budgets']);
same('and only what IT stored', sorted(readHiddenFrom(map, 'opp:2')), ['rate optimization']);
same('an unknown plan hides nothing', sorted(readHiddenFrom(map, 'opp:99')), []);
same('a blank plan key hides nothing', sorted(readHiddenFrom(map, '')), []);
same('a junk map hides nothing', sorted(readHiddenFrom(null, 'opp:1')), []);
same('a junk entry hides nothing', sorted(readHiddenFrom({ 'opp:1': 'nope' }, 'opp:1')), []);
// Stored names are normalized on the way out too, so a hand-edited or
// older entry still lines up with what the popup compares against.
same('stored names are normalized on read',
  sorted(readHiddenFrom({ 'opp:1': [' Bill Payment ', ''] }, 'opp:1')), ['bill payment']);

// --- writing ---------------------------------------------------------------

same('writing stores normalized, sorted, de-duplicated names',
  writeHiddenTo({}, 'opp:1', ['Budgets', ' bill payment ', 'BUDGETS']),
  { 'opp:1': ['bill payment', 'budgets'] });

same('writing one plan leaves the others alone',
  writeHiddenTo(map, 'opp:1', ['audits']),
  { 'opp:1': ['audits'], 'opp:2': ['rate optimization'] });

// Unhiding everything must clear the entry, not store an empty array.
same('an empty selection deletes the entry', writeHiddenTo(map, 'opp:1', []), { 'opp:2': ['rate optimization'] });
same('and so does a selection of only blanks', writeHiddenTo(map, 'opp:1', ['', '  ']), { 'opp:2': ['rate optimization'] });

// A popup opened on something with no stable identity must not write into a
// shared "" bucket, or the next such deal would open with these hidden.
same('a blank plan key writes nothing', writeHiddenTo(map, '', ['audits']), map);

// The input is never mutated — the caller holds the old map.
const before = { 'opp:1': ['budgets'] };
const after = writeHiddenTo(before, 'opp:1', ['audits']);
same('the source map is not mutated', before, { 'opp:1': ['budgets'] });
check('and a new object comes back', after === before, false);

// Round trip: what goes in comes back out, through both halves.
same('a write round-trips through a read',
  sorted(readHiddenFrom(writeHiddenTo({}, 'opp:7', ['Rate Optimization', 'GHG']), 'opp:7')),
  ['ghg', 'rate optimization']);

// A Set is what the popup holds, and it has to be accepted directly.
same('a Set writes as cleanly as an array',
  writeHiddenTo({}, 'opp:1', new Set(['Budgets'])), { 'opp:1': ['budgets'] });

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
