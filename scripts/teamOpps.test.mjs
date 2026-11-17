// All Team Activity (utils/teamOpps): parsing the grouped Salesforce report,
// matching its accounts to Dan's, the pull-to-pull diff and the twice-a-month
// due rule. Plain Node:  node scripts/teamOpps.test.mjs
import assert from 'node:assert/strict';
import {
  parseTeamOppsPaste, buildMyAccountIndex, accountMatch, diffTeamOpps, teamOppsDue, teamOppKey,
} from '../src/utils/teamOpps.js';

const T = (...cells) => cells.join('\t');
const paste = [
  T('Opportunity Leader', 'Stage Group', 'Sales Stage', 'Opportunity Name', 'Account Name', 'Close Date', 'Amount (converted)', 'Probability (%)'),
  T('Alexander Giles (16)', 'Early Stage (10)', '3 - Qualify Opportunity (3)', 'SB-SUS-NEW-Santee', 'Santee Cooper - Headquarters', '2/28/2027', 'USD 70,000.00', '10%'),
  T('', '', '', 'SB-SUP-Andritz', 'Andritz, Inc.', '3/31/2027', 'USD 75,000.00', '10%'),
  T('', '', 'Subtotal', '', '', '', 'USD 215,000.00', ''),
  T('', '', '4 - Influence and Develop (7)', 'SB - Carrier Decarb', 'Carrier Global Corporation - Headquarters', '1/31/2027', 'USD 100,000.00', '20%'),
  T('', 'Subtotal', '', '', '', '', 'USD 760,000.00', ''),
  T('', '', '', '', '', '', 'Avg: USD 76,000.00', ''),
  T('', 'Late Stage (6)', '5 - Prepare & Bid (5)', 'SB-Flowserve CSRD', 'Flowserve World Headquarters - Irving, TX', '3/31/2027', 'USD 75,000.00', '30%'),
].join('\n');

const { rows } = parseTeamOppsPaste(paste);
assert.equal(rows.length, 4, 'subtotal / avg lines dropped');
assert.deepEqual(rows.map(r => r['Opportunity Leader']), Array(4).fill('Alexander Giles'), 'leader filled down, count stripped');
assert.equal(rows[1]['Sales Stage'], '3 - Qualify Opportunity');
assert.equal(rows[2]['Sales Stage'], '4 - Influence and Develop');
assert.equal(rows[2]['Stage Group'], 'Early Stage');
assert.equal(rows[3]['Stage Group'], 'Late Stage');

const idx = buildMyAccountIndex([
  { company: 'Carrier Global', names: ['Carrier Global Corporation'] },
  { company: 'Flowserve', names: [] },
  { company: 'Santee Cooper', names: [] },
]);
assert.equal(accountMatch('Carrier Global Corporation - Headquarters', idx), 'Carrier Global');
assert.equal(accountMatch('Flowserve World Headquarters - Irving, TX', idx), 'Flowserve');
assert.equal(accountMatch('Santee Cooper - Headquarters', idx), 'Santee Cooper');
assert.equal(accountMatch('Andritz, Inc.', idx), '');
assert.equal(accountMatch('', idx), '');

// Diff: nothing flagged on the first pull.
const first = diffTeamOpps(null, rows);
assert.ok([...first.byKey.values()].every(v => v.kind === ''));
assert.equal(first.gone.length, 0);
// Second pull: one moved stage, one new, one gone.
const next = rows.slice(1).map(r => ({ ...r }));
next[1]['Sales Stage'] = '5 - Prepare & Bid';
next.push({ 'Opportunity Name': 'Brand new', 'Account Name': 'Santee Cooper', 'Opportunity Leader': 'Pat Lee' });
const d = diffTeamOpps(rows, next);
assert.equal(d.byKey.get(teamOppKey(next[1])).kind, 'changed');
assert.deepEqual(d.byKey.get(teamOppKey(next[1])).changes, ['Sales Stage: 4 - Influence and Develop > 5 - Prepare & Bid']);
assert.equal(d.byKey.get(teamOppKey(next[0])).kind, '');
assert.equal(d.byKey.get(teamOppKey(next[3])).kind, 'new');
assert.deepEqual(d.gone.map(r => r['Opportunity Name']), ['SB-SUS-NEW-Santee']);

// Due on the 1st and the 15th.
const at = (y, m, dd, h = 12) => new Date(y, m - 1, dd, h).getTime();
assert.equal(teamOppsDue(null, at(2026, 11, 17)).due, true, 'never pulled');
assert.equal(teamOppsDue(at(2026, 11, 15, 9), at(2026, 11, 17)).due, false, 'pulled since the 15th');
assert.equal(teamOppsDue(at(2026, 11, 14), at(2026, 11, 17)).due, true, 'last pull before the 15th');
assert.equal(new Date(teamOppsDue(at(2026, 11, 15, 9), at(2026, 11, 17)).nextDueMs).getDate(), 1, 'next due the 1st');
assert.equal(new Date(teamOppsDue(at(2026, 11, 2), at(2026, 11, 3)).nextDueMs).getDate(), 15, 'next due the 15th');
assert.equal(teamOppsDue(at(2026, 11, 20), at(2026, 12, 1, 8)).due, true, 'due on the 1st');

console.log('teamOpps: all assertions passed');
