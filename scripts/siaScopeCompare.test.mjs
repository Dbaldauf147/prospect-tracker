// Assertion tests for the SIA-versus-estimate comparison.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/siaScopeCompare.test.mjs
//
// The rules worth pinning: both sides are measured over year one and foot
// to the totals each side already shows elsewhere; a fee covering two
// services is counted in full against both rather than halved; a gap is
// measured from the end of the range the quote passed, never from a
// midpoint the rate card never quoted; and a service on one side only still
// gets a row, because that asymmetry is the finding.
import {
  servicesByFeeName, siaYear1ByService, gapAgainstRange, compareSiaToEstimate,
} from '../src/utils/siaScopeCompare.js';
import { buildPricingOptionSnapshot } from '../src/utils/pricingOptionCalc.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- fee name → services ----------------------------------------------
// A cost line item names its services; its Linked To tag names the fee row
// that bills it. So the fee covers everything its cost rows deliver.
{
  const map = servicesByFeeName({
    items: [
      { description: 'AP processing', linkedTo: 'Bill payment' },
      { description: 'Invoice audit', linkedTo: 'Bill payment' },
      { description: 'Supplier RFP', linkedTo: 'Sourcing' },
      // No mapping saved for this line item - it names nothing, so it adds
      // nothing rather than tying the fee to a blank service.
      { description: 'Unmapped work', linkedTo: 'Sourcing' },
      // Nothing bills this one yet.
      { description: 'AP processing', linkedTo: '' },
    ],
    lineItemServices: {
      'ap processing': ['Bill payment', 'Invoice recalculation'],
      'invoice audit': ['Invoice recalculation'],
      'supplier rfp': ['Strategic sourcing'],
    },
  });
  check('a fee covers every service its cost rows deliver',
    map.get('bill payment'), ['Bill payment', 'Invoice recalculation']);
  check('and does not repeat one two cost rows share',
    map.get('bill payment').length, 2);
  check('a fee with one mapped cost row', map.get('sourcing'), ['Strategic sourcing']);
  check('an untagged cost row bills through no fee', map.has(''), false);
}

// --- what the SIA bills each service in year 1 ------------------------
// One setup fee in month 1, one monthly fee per site, and a fee that
// doesn't start until year 2. Year one is the first twelve months of that,
// not the term.
const snapshot = buildPricingOptionSnapshot({
  name: 'Option 1',
  years: 3,
  escPct: 0,
  services: ['Bill payment', 'Strategic sourcing'],
  rows: [
    { feeSchedule: 'Implementation', type: 'Setup', fee: 20000, unitCount: 1, startMonth: 1, services: ['Bill payment'] },
    { feeSchedule: 'Bill pay', type: 'Recurring (monthly)', fee: 1000, unitCount: 4, startMonth: 1, services: ['Bill payment'] },
    { feeSchedule: 'Sourcing', type: 'Recurring (monthly)', fee: 2000, unitCount: 1, startMonth: 1, services: ['Strategic sourcing'] },
    // Starts in year 2: real money on the deal, none of it in year 1.
    { feeSchedule: 'Dashboards', type: 'Recurring (monthly)', fee: 500, unitCount: 1, startMonth: 13, services: ['RA dashboards'] },
    // Nobody mapped the line items behind this one.
    { feeSchedule: 'Admin', type: 'One Time', fee: 5000, unitCount: 1, startMonth: 2 },
    // A blank padding row off the end of the fee schedule.
    { feeSchedule: '', type: '', fee: null, unitCount: 1, startMonth: null },
  ],
});

{
  const by = siaYear1ByService(snapshot);
  check('setup plus twelve months of the per-site fee',
    by.byService.get('bill payment').year1, 20000 + 1000 * 4 * 12);
  check('the other service bills its own twelve months',
    by.byService.get('strategic sourcing').year1, 24000);
  // The fee is real; year one just isn't when it bills.
  check('a year-2 fee shows the service at nothing in year 1',
    by.byService.get('ra dashboards').year1, 0);
  check('the total foots to the snapshot’s own Year 1 total',
    by.total, snapshot.year1Total);
  check('unmapped fees are named, not swallowed',
    by.unmapped.map(u => [u.name, u.year1]), [['Admin', 5000]]);
  check('and totalled', by.unmappedTotal, 5000);
  // The padding row bills nothing, so it is not money anybody has to place.
  check('a blank row is not unmapped money', by.unmapped.length, 1);
  check('attribution is present', by.mapped, true);
}

// A snapshot saved before fees carried their services: everything lands as
// unmapped, and `mapped` says the per-service split isn't available rather
// than showing every service at zero.
{
  const old = buildPricingOptionSnapshot({
    name: 'Old option',
    years: 1,
    rows: [{ feeSchedule: 'Bill pay', type: 'Recurring (monthly)', fee: 1000, unitCount: 1, startMonth: 1 }],
  });
  const by = siaYear1ByService(old);
  check('no attribution to be had', [by.mapped, by.byService.size], [false, 0]);
  check('all of it unmapped', by.unmappedTotal, 12000);
  check('no snapshot, no answer', siaYear1ByService(null), null);
}

// A fee covering two services counts in full against both: the row bills
// what it bills, and splitting it down the middle would invent a division
// nobody made.
{
  const shared = buildPricingOptionSnapshot({
    name: 'Shared',
    years: 1,
    rows: [{
      feeSchedule: 'Managed services', type: 'Recurring (monthly)', fee: 1000, unitCount: 1,
      startMonth: 1, services: ['Bill payment', 'Budgets'],
    }],
  });
  const by = siaYear1ByService(shared);
  check('counted in full against the first', by.byService.get('bill payment').year1, 12000);
  check('and in full against the second', by.byService.get('budgets').year1, 12000);
  check('while the total counts the row once', by.total, 12000);
  check('the row says it is shared', by.byService.get('budgets').lines[0].shared, true);
}

// --- where a quote lands against a range -------------------------------
check('above the top, measured from the top',
  gapAgainstRange(100, 40, 80), { state: 'over', amount: 20, ranged: true });
check('below the bottom, measured from the bottom',
  gapAgainstRange(30, 40, 80), { state: 'under', amount: 10, ranged: true });
check('inside the range is no gap at all',
  gapAgainstRange(60, 40, 80), { state: 'within', amount: 0, ranged: true });
check('on the end is inside it', gapAgainstRange(80, 40, 80), { state: 'within', amount: 0, ranged: true });
// One figure, not a range: the service is quoted at one number and the gap
// is measured against that number from either side.
check('a single-figure estimate over', gapAgainstRange(55, 50, 50), { state: 'over', amount: 5, ranged: false });
check('a single-figure estimate under', gapAgainstRange(45, 50, 50), { state: 'under', amount: 5, ranged: false });
check('no actual, no gap', gapAgainstRange(null, 40, 80), null);
check('no estimate, no gap', gapAgainstRange(100, null, null), null);

// --- the comparison ----------------------------------------------------
// The estimate side is estimateScope's shape: a line per service with its
// annual fee and the setup it bills once, which is what year one is.
const estimate = {
  year1Total: 100000,
  unpriced: ['Water Cost Recovery'],
  lines: [
    { name: 'Bill payment', priced: true, fee: 40000, feeHigh: 80000, setup: 10000, setupHigh: 10000 },
    { name: 'Strategic sourcing', priced: true, fee: 30000, feeHigh: 30000, setup: 0, setupHigh: 0 },
    { name: 'Budgets', priced: true, fee: 20000, feeHigh: 25000, setup: 0, setupHigh: 0 },
    { name: 'Water Cost Recovery', priced: false, fee: 0, feeHigh: 0, setup: 0, setupHigh: 0 },
  ],
};

{
  const cmp = compareSiaToEstimate({ snapshot, estimate });
  const row = (name) => cmp.rows.find(r => r.name === name);
  // Bill payment: estimated $50,000 to $90,000 (fee plus the setup inside
  // it), quoted $68,000. Inside the range, so no gap to report.
  check('setup rides inside the estimated year 1',
    [row('Bill payment').estimated, row('Bill payment').estimatedHigh], [50000, 90000]);
  check('quoted against it', row('Bill payment').actual, 68000);
  check('and lands inside the range', row('Bill payment').gap.state, 'within');
  // Sourcing: estimated $30,000 flat, quoted $24,000.
  check('a service quoted under its estimate',
    [row('Strategic sourcing').gap.state, row('Strategic sourcing').gap.amount], ['under', 6000]);
  // In the Scope, priced by the card, and the SIA charges for none of it.
  check('scope the quote never charges for', row('Budgets').actual, null);
  check('so there is no gap to print', row('Budgets').gap, null);
  // Priced by neither side, still on the table: it is in the deal.
  check('an unpriced service keeps its row',
    [row('Water Cost Recovery').estimated, row('Water Cost Recovery').priced], [null, false]);
  // The SIA bills it, the Scope never listed it.
  check('a service the SIA bills that the scope missed',
    [row('RA dashboards').inScope, row('RA dashboards').actual], [false, 0]);
  check('the union is every service on either side', cmp.rows.length, 5);
  // The totals compare whole against whole: $100,000 to $145,000 estimated
  // against the SIA's own Year 1 total.
  check('estimated totals foot to the estimate',
    [cmp.totals.estimated, cmp.totals.estimatedHigh], [100000, 145000]);
  check('the actual total is the whole quote', cmp.totals.actual, snapshot.year1Total);
  check('including the fees no service claims', cmp.totals.unmappedTotal, 5000);
  check('and the deal came in under the low end',
    [cmp.totals.gap.state, cmp.totals.gap.amount], ['under', 100000 - snapshot.year1Total]);
  check('the unpriced are named for the footnote', cmp.unpriced, ['Water Cost Recovery']);
}

// A scope the rate card can price nothing in has no estimate, and zero is
// not one: measured against zero every quote reads as wildly over.
{
  const cmp = compareSiaToEstimate({
    snapshot,
    estimate: { year1Total: 0, unpriced: ['Bill payment'], lines: [{ name: 'Bill payment', priced: false, fee: 0, feeHigh: 0, setup: 0, setupHigh: 0 }] },
  });
  check('no priced line, no estimated total', cmp.totals.estimated, null);
  check('and nothing to call a gap', cmp.totals.gap, null);
}

// An opp with nothing in Scope still gets the quote listed - the SIA's own
// services are the whole table.
{
  const cmp = compareSiaToEstimate({ snapshot, estimate: null });
  check('every row comes from the SIA side', cmp.rows.every(r => !r.inScope), true);
  check('the quote is still totalled', cmp.totals.actual, snapshot.year1Total);
}

check('no snapshot, no comparison', compareSiaToEstimate({ snapshot: null, estimate }), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
