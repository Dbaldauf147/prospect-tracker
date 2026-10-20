// Assertion tests for the price check's "In price check" tickbox picks.
//   node scripts/priceCheckExclusions.test.mjs
import { priceCheckLineKeys, priceCheckExcludedIds, setPriceCheckExcluded } from '../src/utils/priceCheckExclusions.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const items = [
  { id: 'a', description: 'Hunting License - Targeted Tariff Optimisation' },
  { id: 'b', description: 'Hunting License - Targeted Tariff Optimisation ' },
  { id: 'c', description: 'Bill audit' },
];
const H = 'hunting license - targeted tariff optimisation';
const ids = (s) => [...s].sort();

check('keys: repeated description numbered, unique one bare',
  [...priceCheckLineKeys(items).values()], [`${H} #1`, `${H} #2`, 'bill audit']);

let saved = setPriceCheckExcluded(items, [], 'b', true);
check('untick one of two same-named lines saves only that one', saved, [`${H} #2`]);
check('only that line is left out', ids(priceCheckExcludedIds(items, saved)), ['b']);

saved = setPriceCheckExcluded(items, saved, 'a', true);
check('untick the other too', ids(priceCheckExcludedIds(items, saved)), ['a', 'b']);
saved = setPriceCheckExcluded(items, saved, 'b', false);
check('tick one back leaves the other out', ids(priceCheckExcludedIds(items, saved)), ['a']);

check('unique line still saved by its description',
  setPriceCheckExcluded(items, [], 'c', true), ['bill audit']);

// A bare description saved before lines were told apart.
check('legacy bare description leaves out every line carrying it',
  ids(priceCheckExcludedIds(items, [H])), ['a', 'b']);
saved = setPriceCheckExcluded(items, [H], 'a', false);
check('ticking one back under a legacy pick keeps the other out', saved, [`${H} #2`]);
check('legacy split: only b left out', ids(priceCheckExcludedIds(items, saved)), ['b']);

check('a line with no description is not saved', setPriceCheckExcluded([{ id: 'x', description: '' }], [], 'x', true), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
