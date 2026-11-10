// The Options tab's "Setup + One Time" line: Setup rows at fee x units,
// plus One Time rows as the grid's year columns bill them (inside the
// term, escalated to the year they land in).
import assert from 'node:assert/strict';
import { setupAndOneTimeTotal, buildPricingOptionSnapshot } from '../src/utils/pricingOptionCalc.js';

const rows = [
  { type: 'Setup', fee: '2000', unitCount: '', startMonth: '1' },
  { type: 'Recurring (monthly)', fee: '565', unitCount: '', startMonth: '1' },
  { type: 'Setup', fee: '300', unitCount: '45', startMonth: '1' },
  { type: 'One Time', fee: '600', unitCount: '45', startMonth: '1' },
  { type: 'One Time', fee: '618', unitCount: '45', startMonth: '13' },
  { type: 'One Time', fee: '700', unitCount: '45', startMonth: '40' }, // past a 3-yr term
];

// Setup: 2000 + 13500. One Time: 27000 + 618*45*1.04 (Year 2 escalated).
const expected = 2000 + 13500 + 27000 + 618 * 45 * 1.04;
const got = setupAndOneTimeTotal(rows, 3, 4);
assert.ok(Math.abs(got - expected) < 1e-6, `got ${got}, want ${expected}`);

// No One Time rows: unchanged from the old Setup-only figure.
assert.equal(setupAndOneTimeTotal(rows.slice(0, 3), 3, 4), 15500);
assert.equal(setupAndOneTimeTotal(null, 3, 4), 0);

// The snapshot saved to the Opp carries the same figure.
const snap = buildPricingOptionSnapshot({ years: 3, escPct: 4, rows });
assert.ok(Math.abs(snap.setupTotal - expected) < 1e-6);

console.log('setupOneTimeTotal: ok');
