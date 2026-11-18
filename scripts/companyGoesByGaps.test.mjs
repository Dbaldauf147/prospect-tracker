// node scripts/companyGoesByGaps.test.mjs
import assert from 'node:assert/strict';
import { companyGoesByGaps } from '../src/utils/companyGoesByGaps.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (err) { failed += 1; console.log(`FAIL ${name}\n  ${err.message}`); }
}

const cards = { 'brookfield (scion group)': 'Brookfield', 'price waterhouse coopers (pwc)': '', 'acme': '  ' };
const goesByOf = (name) => cards[name.toLowerCase()] || '';

test('lists companies with an empty Goes By, with recipient counts', () => {
  const gaps = companyGoesByGaps([
    { company: 'Brookfield (Scion Group)' },
    { company: 'Price Waterhouse Coopers (PWC)' },
    { company: 'price waterhouse coopers (pwc) ' },
    { company: 'Acme' },
  ], goesByOf);
  assert.deepEqual(gaps, [
    { company: 'Price Waterhouse Coopers (PWC)', recipients: 2 },
    { company: 'Acme', recipients: 1 },
  ]);
});

test('a company with no card at all counts as empty', () => {
  assert.deepEqual(companyGoesByGaps([{ company: 'Nobody Inc' }], goesByOf),
    [{ company: 'Nobody Inc', recipients: 1 }]);
});

test('recipients with no company are skipped', () => {
  assert.deepEqual(companyGoesByGaps([{ company: '' }, {}, null], goesByOf), []);
});

test('nothing to warn about when every card has a Goes By', () => {
  assert.deepEqual(companyGoesByGaps([{ company: 'Brookfield (Scion Group)' }], goesByOf), []);
  assert.deepEqual(companyGoesByGaps(undefined, goesByOf), []);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
