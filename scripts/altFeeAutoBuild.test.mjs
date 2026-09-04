// Assertion tests for building the Alternative Fee schedule from the
// Automated Fee Names on a Pricing Option. Plain Node — no test framework
// (the project has none). Run:
//   node scripts/altFeeAutoBuild.test.mjs
//
// This decides what the customer gets billed. The rules worth pinning are
// the ones that go wrong silently: a name carrying both setup and monthly
// costs needs two rows or half its cost never reaches a fee, a name carrying
// Setup AND One Time costs needs exactly one or the same markup is charged
// twice, and a name the schedule already has must not gain a second row
// behind the user's back.
import {
  buildAltFeeRowsFromAutomatedNames,
  altFeeBucketForCostType,
  altFeeBucketForScheduleType,
  altFeeUnitCount,
  ALT_FEE_UPFRONT,
  ALT_FEE_RECURRING,
} from '../src/utils/altFeeAutoBuild.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const cost = (over = {}) => ({ name: 'Per account', type: 'Recurring (monthly)', unit: '', cost: 100, passThrough: false, ...over });
const names = (rows) => rows.map(r => `${r.altItem}|${r.type}`);

// ── Which bucket a type prices into ───────────────────────────────────────
check('cost: recurring', altFeeBucketForCostType('Recurring (monthly)'), ALT_FEE_RECURRING);
check('cost: setup rolled bills monthly', altFeeBucketForCostType('Setup Rolled'), ALT_FEE_RECURRING);
check('cost: one time rolled bills monthly', altFeeBucketForCostType('One Time Rolled'), ALT_FEE_RECURRING);
check('cost: setup', altFeeBucketForCostType('Setup'), ALT_FEE_UPFRONT);
check('cost: one time', altFeeBucketForCostType('One Time'), ALT_FEE_UPFRONT);
check('cost: unknown type prices nothing', altFeeBucketForCostType('Credit'), '');
check('cost: blank', altFeeBucketForCostType(''), '');
check('schedule: recurring', altFeeBucketForScheduleType('Recurring (monthly)'), ALT_FEE_RECURRING);
check('schedule: setup', altFeeBucketForScheduleType('Setup'), ALT_FEE_UPFRONT);
check('schedule: untyped row is neither', altFeeBucketForScheduleType(''), '');

// ── Unit Count follows the unit ───────────────────────────────────────────
check('unit count: per site', altFeeUnitCount('Per Site', { siteCount: 1500, accountCount: 11000 }), 1500);
check('unit count: per account', altFeeUnitCount('Per Account', { siteCount: 1500, accountCount: 11000 }), 11000);
check('unit count: fixed', altFeeUnitCount('Fixed', { siteCount: 1500 }), 1);
check('unit count: no metadata to fill from', altFeeUnitCount('Per Site', {}), 1);

// ── One row per name per bucket ───────────────────────────────────────────
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Setup', type: 'Setup' }),
      cost({ name: 'Per account', type: 'Recurring (monthly)' }),
      cost({ name: 'Per account', type: 'Recurring (monthly)' }),
    ],
  });
  check('two names, three costs', names(rows), ['Setup|Setup', 'Per account|Recurring (monthly)']);
  check('fee is left to derive', [rows[0].fee, rows[0].startMonth], [null, null]);
}

// A name carrying both upfront and monthly costs needs both rows: one row
// derives one bucket, so a single row would drop the other bucket's cost.
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Program fee', type: 'Recurring (monthly)' }),
      cost({ name: 'Program fee', type: 'Setup' }),
    ],
  });
  check('both buckets get a row, upfront first',
    names(rows), ['Program fee|Setup', 'Program fee|Recurring (monthly)']);
}

// Setup and One Time are one bucket — two rows would each claim the whole
// upfront markup.
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Implementation', type: 'One Time' }),
      cost({ name: 'Implementation', type: 'Setup' }),
    ],
  });
  check('setup + one time share one row', names(rows), ['Implementation|Setup']);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [cost({ name: 'Implementation', type: 'One Time' })],
  });
  check('one-time-only upfront row reads as One Time', names(rows), ['Implementation|One Time']);
}

// Case differences are the same name.
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Per Account', type: 'Recurring (monthly)' }),
      cost({ name: 'per account', type: 'Recurring (monthly)' }),
    ],
  });
  check('case-insensitive, first casing wins', names(rows), ['Per Account|Recurring (monthly)']);
}

// ── What doesn't earn a row ───────────────────────────────────────────────
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: '' }),
      cost({ name: '   ' }),
      cost({ name: 'No money', cost: 0 }),
      cost({ name: 'No money either', cost: null }),
    ],
  });
  check('unnamed and cost-free lines build nothing', rows, []);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [cost({ name: 'Credit', type: 'Credit' })],
  });
  check('an unpriceable type still gets its name into the schedule, untyped',
    names(rows), ['Credit|']);
}

// ── Rows the schedule already carries ─────────────────────────────────────
{
  const costs = [
    cost({ name: 'Per account', type: 'Recurring (monthly)' }),
    cost({ name: 'Per account', type: 'Setup' }),
    cost({ name: 'Data feed', type: 'Setup' }),
  ];
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs,
    existingRows: [{ altItem: 'per account', type: 'Recurring (monthly)' }],
  });
  check('an existing row claims its bucket only',
    names(rows), ['Per account|Setup', 'Data feed|Setup']);

  const afterBoth = buildAltFeeRowsFromAutomatedNames({
    costs,
    existingRows: [
      { altItem: 'Per account', type: 'Recurring (monthly)' },
      { altItem: 'Per account', type: 'Setup' },
      { altItem: 'Data feed', type: 'One Time' },
    ],
  });
  check('nothing left to build', afterBoth, []);
}
{
  // An untyped row is the user's own placeholder: typing a type on it would
  // make a sibling row price the same costs twice, so it claims the name.
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Per account', type: 'Recurring (monthly)' }),
      cost({ name: 'Per account', type: 'Setup' }),
    ],
    existingRows: [{ altItem: 'Per account', type: '' }],
  });
  check('an untyped row claims every bucket of its name', rows, []);
}
{
  // Blank starter rows carry no name, so they claim nothing.
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [cost({ name: 'Per account', type: 'Recurring (monthly)' })],
    existingRows: Array.from({ length: 9 }, () => ({ altItem: '', type: '', fee: null })),
  });
  check('starter rows claim nothing', names(rows), ['Per account|Recurring (monthly)']);
}

// ── Unit, Unit Count and pass-through come off the costs ──────────────────
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Per account', unit: '', type: 'Recurring (monthly)' }),
      cost({ name: 'Per account', unit: 'Per Account', type: 'Recurring (monthly)' }),
      cost({ name: 'Per site', unit: 'Per Site', type: 'Setup' }),
    ],
    siteCount: 1500,
    accountCount: 11000,
  });
  check('first saved unit in the group wins, and fills its count',
    rows.map(r => [r.unit, r.unitCount]), [['Per Account', 11000], ['Per Site', 1500]]);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Supplier charges', passThrough: true }),
      cost({ name: 'Supplier charges', passThrough: true }),
      cost({ name: 'Mixed', passThrough: true }),
      cost({ name: 'Mixed', passThrough: false }),
    ],
  });
  check('all-pass-through fees bill at face value, mixed ones do not',
    rows.map(r => [r.altItem, r.passThrough]), [['Supplier charges', true], ['Mixed', false]]);
}

// ── Per-fee defaults ──────────────────────────────────────────────────────
// A fee told what it is answers for its own type: every cost carrying the
// name lands in that one bucket, so the name gets ONE row rather than one
// per cost bucket.
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Program fee', type: 'Setup' }),
      cost({ name: 'Program fee', type: 'Recurring (monthly)' }),
    ],
    feeDefaults: { 'program fee': { type: 'Recurring (monthly)' } },
  });
  check('a default type collapses a name to one row',
    names(rows), ['Program fee|Recurring (monthly)']);
}
{
  // …and it is the type the schedule already claims against, so building
  // twice doesn't stack a second row on it.
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Program fee', type: 'Setup' }),
      cost({ name: 'Program fee', type: 'Recurring (monthly)' }),
    ],
    existingRows: [{ altItem: 'Program fee', type: 'Recurring (monthly)' }],
    feeDefaults: { 'program fee': { type: 'Recurring (monthly)' } },
  });
  check('a default type claims its bucket once', rows, []);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [cost({ name: 'Credit', type: 'Credit' })],
    feeDefaults: { credit: { type: 'Setup' } },
  });
  check('a default type prices a name the cost types do not',
    names(rows), ['Credit|Setup']);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [cost({ name: 'Per account', unit: 'Per Site' })],
    feeDefaults: { 'per account': { unit: 'Per Account' } },
    siteCount: 1500,
    accountCount: 11000,
  });
  check('a default unit outranks the unit off the costs, and fills its count',
    rows.map(r => [r.unit, r.unitCount]), [['Per Account', 11000]]);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [cost({ name: 'Per Account', type: 'Setup' })],
    feeDefaults: { 'per account': { type: 'Recurring (monthly)', unit: 'Per Account' } },
  });
  check('defaults match the name case-insensitively',
    names(rows), ['Per Account|Recurring (monthly)']);
  check('fee and start month are still left to derive',
    [rows[0].fee, rows[0].startMonth], [null, null]);
}
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Program fee', type: 'Setup' }),
      cost({ name: 'Program fee', type: 'Recurring (monthly)' }),
    ],
    feeDefaults: { 'other fee': { type: 'Setup' } },
  });
  check('a default for some other fee changes nothing',
    names(rows), ['Program fee|Setup', 'Program fee|Recurring (monthly)']);
}

// ── Order follows the cost table ──────────────────────────────────────────
{
  const rows = buildAltFeeRowsFromAutomatedNames({
    costs: [
      cost({ name: 'Setup', type: 'Setup' }),
      cost({ name: 'Per account', type: 'Recurring (monthly)' }),
      cost({ name: 'Setup', type: 'Recurring (monthly)' }),
      cost({ name: 'Program fee', type: 'Setup' }),
    ],
  });
  check('names keep cost-table order, buckets stay together',
    names(rows), ['Setup|Setup', 'Setup|Recurring (monthly)', 'Per account|Recurring (monthly)', 'Program fee|Setup']);
}

// ── Degenerate input ──────────────────────────────────────────────────────
check('no arguments', buildAltFeeRowsFromAutomatedNames(), []);
check('no costs', buildAltFeeRowsFromAutomatedNames({ costs: [], existingRows: [] }), []);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
