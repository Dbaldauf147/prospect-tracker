// Assertion tests for pulling a deal's Year-1 Setup / Recurring off the opp
// its BFO opportunity name ties it to. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/dealOppYear1.test.mjs
//
// This plan writes money into the Deals roster, so the failures worth
// guarding are the destructive ones: overwriting a figure typed off the
// signed agreement, or matching a deal to an opp it isn't actually tied to
// (the '-' placeholder both sides use for "no BFO opp yet").
import {
  indexOppYear1ByBfo, oppYear1ForDeal, planOppYear1Fills,
  DEAL_SETUP_KEY, DEAL_RECURRING_KEY, OPP_BFO_KEY,
} from '../src/utils/dealOppYear1.js';
import { pricingSnapshotYear1 } from '../src/utils/pricingOptionCalc.js';
import { DEAL_BFO_KEY } from '../src/utils/dealCommissions.js';

let pass = 0, fail = 0;
const ok = (c, n) => (c ? (pass += 1, console.log('PASS ', n)) : (fail += 1, console.log('FAIL ', n)));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// A saved Pricing Option: $20k setup billed in month 1, $2.5k/month
// recurring from month 1, three-year term, no escalator.
const option = (over = {}) => ({
  name: 'Option B',
  years: 3,
  escPct: 0,
  year1Total: 50_000,
  rows: [
    { type: 'Setup', fee: 20_000, unitCount: 1, startMonth: 1 },
    { type: 'Recurring', fee: 2_500, unitCount: 1, startMonth: 1 },
  ],
  ...over,
});

const opp = (bfo, over = {}) => ({ [OPP_BFO_KEY]: bfo, Account: 'Acme', _pricingOption: option(), ...over });
const deal = (over = {}) => ({ 'Client Name': 'Acme', 'Agreement Name': 'MSA', ...over });

// --- the snapshot maths ------------------------------------------------------
{
  const y1 = pricingSnapshotYear1(option());
  eq(y1.setupOneTime, 20_000, 'Year 1 setup is the one-time line');
  eq(y1.recurringAnnual, 30_000, 'Year 1 recurring is 12 months of the recurring line');
  eq(y1.recurringMonthly, 2_500, 'monthly recurring is the base fee');
  // A line that starts in month 4 bills nine months of year 1, not twelve —
  // the reason this reads rowYearRevenue rather than fee × 12.
  const late = pricingSnapshotYear1(option({
    rows: [{ type: 'Recurring', fee: 1_000, unitCount: 1, startMonth: 4 }],
  }));
  eq(late.recurringAnnual, 9_000, 'a late-starting recurring line bills its active months only');
  eq(pricingSnapshotYear1(null), null, 'no snapshot, no figures');
}

// --- the index ---------------------------------------------------------------
{
  const map = indexOppYear1ByBfo([
    opp('Acme - SUSUP - 2026'),
    opp('No option opp', { _pricingOption: null }),
    { Account: 'Blank', _pricingOption: option() },
    opp('-'),
    opp('#N/A'),
  ]);
  eq([...map.keys()], ['acme - susup - 2026'], 'only opps with a BFO name AND an option are indexed');
  const hit = map.get('acme - susup - 2026');
  eq([hit.setup, hit.recurring, hit.optionName], [20_000, 30_000, 'Option B'], 'the indexed figures');
}

// --- matching a deal ---------------------------------------------------------
{
  const map = indexOppYear1ByBfo([opp('Acme - SUSUP - 2026')]);
  ok(oppYear1ForDeal(map, deal({ [DEAL_BFO_KEY]: '  acme - SUSUP - 2026 ' }) ) != null,
    'the join is case- and whitespace-insensitive');
  eq(oppYear1ForDeal(map, deal({ [DEAL_BFO_KEY]: '-' })), null,
    'a "-" BFO name matches nothing — it means "no opp yet" on both sides');
  eq(oppYear1ForDeal(map, deal()), null, 'a deal with no BFO name matches nothing');
  eq(oppYear1ForDeal(map, deal({ [DEAL_BFO_KEY]: 'Other opp' })), null, 'no match, no figures');
}

// --- what would be written ---------------------------------------------------
{
  const map = indexOppYear1ByBfo([opp('Acme - SUSUP - 2026')]);
  const deals = [
    deal({ [DEAL_BFO_KEY]: 'Acme - SUSUP - 2026' }),                                  // both blank
    deal({ [DEAL_BFO_KEY]: 'Acme - SUSUP - 2026', [DEAL_SETUP_KEY]: 18_500 }),        // setup typed
    deal({ [DEAL_BFO_KEY]: 'Acme - SUSUP - 2026', [DEAL_SETUP_KEY]: 18_500, [DEAL_RECURRING_KEY]: 31_000 }),
    deal({ [DEAL_BFO_KEY]: 'Acme - SUSUP - 2026', [DEAL_SETUP_KEY]: '-' }),           // dash = blank
    deal({ [DEAL_BFO_KEY]: 'Unrelated opp' }),
  ];
  const plan = planOppYear1Fills(deals, map);
  eq(plan.map(f => f.index), [0, 1, 3], 'only deals with a blank cell an opp can fill');
  eq(plan[0].patch, { [DEAL_SETUP_KEY]: 20_000, [DEAL_RECURRING_KEY]: 30_000 }, 'both cells filled');
  eq(plan[1].patch, { [DEAL_RECURRING_KEY]: 30_000 },
    'a Setup typed off the agreement is never overwritten');
  eq(plan[2] === undefined || plan[2].index !== 2, true, 'a fully filled deal is left out');
  eq(plan[2].patch, { [DEAL_SETUP_KEY]: 20_000, [DEAL_RECURRING_KEY]: 30_000 }, 'a "-" cell counts as blank');
  eq(plan[0].optionName, 'Option B', 'the option name rides along for the read-out');

  // Re-planning after the write is empty — importing twice is a no-op.
  const after = deals.map((d, i) => {
    const f = plan.find(x => x.index === i);
    return f ? { ...d, ...f.patch } : d;
  });
  eq(planOppYear1Fills(after, map), [], 'nothing left to import after one pass');
}

// --- an option that prices nothing ------------------------------------------
{
  const map = indexOppYear1ByBfo([opp('Free pilot', {
    _pricingOption: option({ rows: [{ type: 'Recurring', fee: 0, unitCount: 1, startMonth: 1 }] }),
  })]);
  const plan = planOppYear1Fills([deal({ [DEAL_BFO_KEY]: 'Free pilot' })], map);
  eq(plan[0].patch, { [DEAL_SETUP_KEY]: 0, [DEAL_RECURRING_KEY]: 0 },
    'a genuine zero is a figure, not a reason to skip the deal');
}

// --- two opps under one BFO name --------------------------------------------
{
  const map = indexOppYear1ByBfo([
    opp('Shared name', { _pricingOption: null }),
    opp('Shared name', { Account: 'Second', _pricingOption: option({ name: 'Option C' }) }),
  ]);
  const hit = map.get('shared name');
  eq([hit.oppCount, hit.optionName], [2, 'Option C'],
    'the first opp carrying an option supplies the figures, and the count is kept');
}

// --- nothing to do -----------------------------------------------------------
eq(planOppYear1Fills([deal({ [DEAL_BFO_KEY]: 'x' })], new Map()), [], 'no opps indexed: nothing planned');
eq(planOppYear1Fills(undefined, undefined), [], 'no data at all: nothing planned');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
