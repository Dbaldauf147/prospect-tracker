// Assertion tests for the My Accounts "All Missing History" subtab
// (src/utils/missingHistory.js). Plain Node, no framework. Run:
//   node scripts/missingHistory.test.mjs
//
// The claims:
//   1. A reading sums every Company Data field's missing count, and is null
//      when there are no companies to read.
//   2. The first reading on record is also logged as the day before.
//   3. After that a day is rewritten only when its numbers move.
import { missingReading, missingStepsReading, isStepsDay, withMissingDay, previousDay, withBaseline, baselineDay } from '../src/utils/missingHistory.js';
import { allMissingStepsFor } from '../src/utils/allMissingSteps.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// 1
const r = missingReading([
  { numberOfSites: 10, numberOfAccounts: 0, website: 'a.com' },
  { numberOfSites: '', zoomCompanyId: '  ' },
]);
check('sites missing once', r.fields.numberOfSites, 1);
check('0 is an answer', r.fields.numberOfAccounts, 1);
check('blank text is missing', r.fields.zoomCompanyId, 2);
check('total is the sum of the fields', r.total, Object.values(r.fields).reduce((a, b) => a + b, 0));
check('total', r.total, 1 + 1 + 2 + 2 + 2 + 2 + 2 + 1);
check('companies', r.companies, 2);
check('nothing to read', missingReading([]), null);

// 2
check('previous day across a month', previousDay('2026-10-01'), '2026-09-30');
const first = withMissingDay({}, '2026-10-15', { total: 5, fields: {}, companies: 1 }, 1);
check('first reading logs today and yesterday', Object.keys(first).sort(), ['2026-10-14', '2026-10-15']);
check('yesterday carries the same number', first['2026-10-14'].total, 5);
check('yesterday is marked seeded', first['2026-10-14'].seeded, true);

// 3
const same = withMissingDay(first, '2026-10-15', { total: 5, fields: {}, companies: 1 }, 2);
check('unchanged reading writes nothing', same === first, true);
const moved = withMissingDay(first, '2026-10-15', { total: 3, fields: {}, companies: 1 }, 3);
check('a changed reading rewrites today', moved['2026-10-15'].total, 3);
check('the seeded yesterday follows today on the first day', moved['2026-10-14'].total, 3);
const tomorrow = withMissingDay(moved, '2026-10-16', { total: 2, fields: {}, companies: 1 }, 4);
check('a later day does not reseed', Object.keys(tomorrow).sort(), ['2026-10-14', '2026-10-15', '2026-10-16']);

// 4. The headline is All Missing Steps: the Company Data column, summed.
{
  const entries = [
    { record: { numberOfSites: 10, numberOfAccounts: 4, equipmentCount: 2, zoomCompanyId: '1' } },
    { record: { numberOfSites: '' } },
  ];
  const each = entries.map(e => allMissingStepsFor({ record: e.record }));
  const s = missingStepsReading(entries);
  check('steps: total is the column summed', s.total, each[0].allMissingSteps + each[1].allMissingSteps);
  check('steps: split into ladder and blank fields', [s.stepsRemaining, s.missingData], [each[0].stepsRemaining + each[1].stepsRemaining, 0 + 3]);
  check('steps: per-field counts still kept', s.fields.numberOfSites, 1);
  check('steps: marked', isStepsDay(s), true);
  check('steps: nothing to read', missingStepsReading([]), null);
  // A company with a decision maker on every tag isn't counted missing its Zoom id.
  const everyTag = { id: 9, dans_tags: 'Decision Maker; ESG; Procurement; Utilities; Climate Risk; Capital Planning; Efficiency/Renewables' };
  const dmRead = missingStepsReading([{ record: {}, dms: [everyTag] }, { record: {} }]);
  check('steps: every DM waives the Zoom id', [dmRead.fields.zoomCompanyId, dmRead.fields.zoomCompanyName], [1, 2]);
  // An older field-count day doesn't stop the first steps day seeding yesterday.
  const old = { '2026-10-13': { total: 900, fields: {}, companies: 2 }, '2026-10-14': { total: 950, fields: {}, companies: 2 } };
  const next = withMissingDay(old, '2026-10-15', s, 9);
  check('steps: first steps day seeds yesterday over an old-basis day', [isStepsDay(next['2026-10-14']), next['2026-10-14'].seeded], [true, true]);
  check('steps: older days kept', next['2026-10-13'].total, 900);
}

// 5. The seed follows today for the whole first day: a first reading
// taken mid-load (100 of 180 companies) mustn't stay as yesterday.
{
  const partial = { total: 1577, fields: {}, companies: 100, basis: 'steps' };
  const full = { total: 3669, fields: {}, companies: 180, basis: 'steps' };
  const a = withMissingDay({}, '2026-10-15', partial, 1);
  const b = withMissingDay(a, '2026-10-15', full, 2);
  check('seed: yesterday follows the full reading', [b['2026-10-14'].total, b['2026-10-14'].seeded], [3669, true]);
  // The stored case: today already full, yesterday still the partial seed.
  const stuck = { '2026-10-14': { ...partial, seeded: true }, '2026-10-15': full };
  const fixed = withMissingDay(stuck, '2026-10-15', full, 3);
  check('seed: a stuck seed is repaired by the next reading', fixed['2026-10-14'].total, 3669);
  check('seed: nothing to repair writes nothing', withMissingDay(fixed, '2026-10-15', full, 4) === fixed, true);
  const next = withMissingDay(fixed, '2026-10-16', { ...full, total: 3600 }, 5);
  check('seed: a later day leaves the seed alone', [next['2026-10-14'].total, next['2026-10-15'].total], [3669, 3669]);
}

{
  const s = missingStepsReading([
    { record: { company: 'A' } },
    { record: { company: 'B' }, zoomExcluded: true },
  ]);
  check('steps: a company excluded from ZoomInfo owes no Zoom id', [s.fields.zoomCompanyId, s.fields.zoomCompanyName, s.fields.numberOfSites], [1, 1, 2]);
}

{
  // Freezing the seeded first day as the baseline.
  const reading = (total) => ({ total, stepsRemaining: total, missingData: 0, fields: {}, companies: 180, basis: 'steps' });
  const seeded = withMissingDay({}, '2026-10-15', reading(3684), 1);
  const frozen = withBaseline(seeded, '2026-10-14', 2);
  check('baseline: marked', [baselineDay(frozen), frozen['2026-10-14'].baseline], ['2026-10-14', true]);
  check('baseline: unknown day writes nothing', withBaseline(frozen, '2026-09-01') === frozen, true);
  const later = withMissingDay(frozen, '2026-10-15', reading(3600), 3);
  check('baseline: same-day reading no longer drags the seed', [later['2026-10-14'].total, later['2026-10-15'].total], [3684, 3600]);
  check('baseline: a reading on the baseline day writes nothing', withMissingDay(frozen, '2026-10-14', reading(1), 4) === frozen, true);
  const moved = withBaseline(later, '2026-10-15', 5);
  check('baseline: only one at a time', [moved['2026-10-14'].baseline, moved['2026-10-15'].baseline], [undefined, true]);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
