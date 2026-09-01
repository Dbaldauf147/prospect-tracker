// Assertion tests for the Services Pricing rate card. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/servicePricing.test.mjs
//
// This is deal money: what a service is worth, and what a set of them adds
// up to over a contract. The rules worth pinning are the ones a reader
// can't infer from a single number on screen — that a fee typed into the
// Est. Fee column beats whatever the basis would have worked out, that a
// minimum fee floors a thin scope but doesn't invent one out of an empty
// scope, and that recurring and one-off money are kept apart on the way to
// a contract value.
import {
  estimateService, estimateScope, pricingFor, setPricingField, contractYears, formatMoney,
  feeBasisLabel, projectServiceLines,
} from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const RECURRING = { serviceType: 'Recurring', years: '3 years' };
const PROJECT = { serviceType: 'Project', years: '1 year' };

// ── A typed fee is the answer ─────────────────────────────────────────
{
  const both = estimateService({
    entry: { basis: 'per_site', rate: 900, avgFee: 30000 },
    meta: RECURRING, counts: { sites: 20 }, dealSize: '',
  });
  check('a typed fee beats the basis', both.fee, 30000);
  check('it is flagged as typed', both.typed, true);
  check('and still runs across the term', both.value, 90000);
  check('the count it would have used is not claimed', both.units, null);

  const alone = estimateService({ entry: { avgFee: 40000 }, meta: RECURRING, counts: {}, dealSize: '' });
  check('a typed fee alone prices a service', [alone.priced, alone.fee, alone.value], [true, 40000, 120000]);

  const project = estimateService({ entry: { avgFee: 40000 }, meta: PROJECT, counts: {}, dealSize: '' });
  check('a one-off project is worth its fee once', project.value, 40000);
}

// ── Clearing a basis keeps a typed fee ────────────────────────────────
{
  const start = { Widgets: { basis: 'per_site', rate: 900, minFee: 5000, avgFee: 30000 } };
  const cleared = setPricingField(start, 'Widgets', 'basis', '');
  check('clearing the basis drops the rate and floor', cleared.Widgets, { avgFee: 30000 });

  const noFee = setPricingField({ Widgets: { basis: 'per_site', rate: 900 } }, 'Widgets', 'basis', '');
  check('with nothing left, the entry goes entirely', noFee.Widgets, undefined);

  const unset = setPricingField(start, 'Widgets', 'avgFee', '');
  check('clearing the typed fee leaves the model behind',
    unset.Widgets, { basis: 'per_site', rate: 900, minFee: 5000 });
}

// ── Minimum fees floor a thin scope, not an empty one ─────────────────
{
  const thin = estimateService({
    entry: { basis: 'per_meter', rate: 12.5, minFee: 5000 },
    meta: RECURRING, counts: { meters: 200 }, dealSize: '',
  });
  check('a thin scope is floored at the minimum', thin.fee, 5000);

  const empty = estimateService({
    entry: { basis: 'per_meter', rate: 12.5, minFee: 5000 },
    meta: RECURRING, counts: {}, dealSize: '',
  });
  check('no count means no fee, not the minimum', [empty.priced, empty.fee], [true, 0]);
  check('and it says why', empty.note, 'No meters entered');
}

// ── Percentage fees cut the deal size ─────────────────────────────────
{
  const pct = estimateService({
    entry: { basis: 'pct_deal', rate: 3.5 }, meta: RECURRING, counts: {}, dealSize: 1000000,
  });
  check('a percentage takes its cut', pct.fee, 35000);
  const noDeal = estimateService({
    entry: { basis: 'pct_deal', rate: 3.5, minFee: 9000 }, meta: RECURRING, counts: {}, dealSize: '',
  });
  check('no deal size means no fee, not the minimum', noDeal.fee, 0);
}

// ── Nothing to price on ───────────────────────────────────────────────
{
  const none = estimateService({ entry: {}, meta: RECURRING, counts: {}, dealSize: '' });
  check('an empty entry is unpriced', [none.priced, none.fee], [false, null]);
  const rateless = estimateService({ entry: { basis: 'per_site' }, meta: RECURRING, counts: { sites: 5 }, dealSize: '' });
  check('a basis with no rate is unpriced', [rateless.priced, rateless.note], [false, 'No rate set']);
}

// ── Rolling a scope up ────────────────────────────────────────────────
{
  const rows = [
    { name: 'Bill payment', meta: RECURRING },
    { name: 'Audits', meta: PROJECT },
    { name: 'Broker fee', meta: RECURRING },
    { name: 'Unpriced', meta: PROJECT },
  ];
  const pricing = {
    'Bill payment': { avgFee: 40000 },
    Audits: { basis: 'flat', rate: 25000 },
    'Broker fee': { basis: 'pct_deal', rate: 3.5 },
  };
  const out = estimateScope({
    rows, services: rows.map(r => r.name), pricing, counts: {}, dealSize: 1000000,
  });
  check('recurring money is annual', out.recurringAnnual, 75000);
  check('one-off money is kept apart', out.oneTime, 25000);
  check('contract value runs the recurring across its term', out.contractValue, 250000);
  check('unpriced services are named, not counted', out.unpriced, ['Unpriced']);
}

// ── Odds and ends ─────────────────────────────────────────────────────
{
  check('years parse off the metadata', contractYears({ years: '3 years' }), 3);
  check('an unreadable term is one year, never zero', contractYears({ years: 'TBD' }), 1);
  check('a typed fee reads back off the entry', pricingFor({ A: { avgFee: '12,500' } }, 'A').avgFee, 12500);
  check('whole dollars for deal figures', formatMoney(2500), '$2,500');
  check('cents survive on a small rate', formatMoney(12.5), '$12.50');
}

// --- Year 1, and saying where a fee came from -----------------------------
//
// The Deal Size popup lists a deal's scope with the fee each service is worth
// in its FIRST year, so two things have to hold: that figure is the recurring
// annual money plus the one-off money (they only agree in year one, which is
// why the contract value keeps them apart), and every line can say how it was
// arrived at — a number the reader watches move needs a reason on the row.
{
  const rows = [
    { name: 'Bill Pay', meta: { serviceType: 'Recurring', years: '3 years' } },
    { name: 'Budgets', meta: { serviceType: 'Project' } },
    { name: 'Risk', meta: { serviceType: 'Recurring', years: '2 years' } },
    { name: 'Data', meta: { serviceType: 'Project' } },
  ];
  const pricing = {
    'Bill Pay': { avgFee: 40000 },
    'Budgets': { basis: 'per_site', rate: 500, minFee: 2000 },
    'Risk': { basis: 'pct_deal', rate: 3 },
    'Data': {},
  };
  const est = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 12 }, dealSize: 100000,
  });
  check('year 1 is the recurring year plus the one-off work',
    est.year1Total, est.recurringAnnual + est.oneTime);
  check('…which is what the priced lines bill in their first year',
    est.year1Total, 40000 + 6000 + 3000);
  check('…and not the contract value, which runs the recurring years out',
    est.contractValue, 40000 * 3 + 6000 + 3000 * 2);
  check('an unpriced service is named rather than counted as nothing', est.unpriced, ['Data']);

  const by = Object.fromEntries(est.lines.map(l => [l.name, feeBasisLabel(l)]));
  check('a typed fee says so', by['Bill Pay'], 'Est. Fee');
  check('a per-unit fee shows its rate and the count it multiplied', by.Budgets, '$500 per site × 12');
  check('a percentage says what it is a percentage of', by.Risk, '3% of deal size');
  check('an unpriced service has nothing to say', by.Data, '');
  check('a flat fee names its basis',
    feeBasisLabel({ entry: { basis: 'flat', rate: 9000 } }), 'Flat fee');
  check('and junk is tolerated', feeBasisLabel(null), '');
}

// --- Project work is counted per service, not per deal --------------------
//
// Sites and accounts are facts about the account: one shared count answers
// for every service reading it. How many projects is a fact about the
// SERVICE — three lighting retrofits and one chiller replacement is four
// projects, and neither service is priced on four. So the estimator lists
// the per-project services and takes a count for each; what this pins is
// which rows end up in that list, and that a count typed against one row
// prices only that row.
{
  const rows = [
    { name: 'Lighting retrofit', meta: PROJECT },
    { name: 'Chiller replacement', meta: PROJECT },
    { name: 'Bill payment', meta: RECURRING },
    { name: 'Solar feasibility', meta: PROJECT },
  ];
  const pricing = {
    'Lighting retrofit': { basis: 'per_project', rate: 45000 },
    'Chiller replacement': { basis: 'per_project', rate: 80000 },
    'Bill payment': { basis: 'per_site', rate: 500 },
    // Priced per project, but with the fee typed straight in.
    'Solar feasibility': { basis: 'per_project', rate: 10000, avgFee: 12000 },
  };

  const shared = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 10, projects: 2 }, dealSize: 0,
  });
  const listed = projectServiceLines(shared.lines);
  check('only the per-project services are listed',
    listed.map(l => l.name), ['Lighting retrofit', 'Chiller replacement', 'Solar feasibility']);
  check('a shared count prices every row that has no number of its own',
    listed.map(l => l.fee), [90000, 160000, 12000]);
  check('a typed fee stays in the list rather than dropping out of the scope',
    listed.find(l => l.name === 'Solar feasibility').typed, true);

  // A typed fee doesn't depend on a count, so it must not be what keeps the
  // estimator asking for one — otherwise the panel would report a shared
  // count as pricing a row whose fee it can't move.
  check('a typed fee does not ask the estimator for a count',
    estimateScope({
      rows, services: ['Solar feasibility'], pricing, counts: {}, dealSize: 0,
    }).unitsUsed.has('projects'), false);

  // The point of the panel: one row's count moves one row's fee.
  const perService = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 10, projects: 2 }, dealSize: 0,
    serviceUnits: { 'Lighting retrofit': 3, 'Chiller replacement': 1 },
  });
  const own = projectServiceLines(perService.lines);
  check('each row prices on its own count', own.map(l => l.fee), [135000, 80000, 12000]);
  check('...and the shared count no longer has a row to answer for',
    perService.unitsUsed.has('projects'), false);
  check('the deal adds them up as one-off money', perService.oneTime, 135000 + 80000 + 12000);

  // A row left blank is not a row set to zero: it falls back.
  const partial = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 10, projects: 2 }, dealSize: 0,
    serviceUnits: { 'Lighting retrofit': 3 },
  });
  check('a blank row still falls back to the shared count',
    projectServiceLines(partial.lines).map(l => l.fee), [135000, 160000, 12000]);
  check('...so the shared box is still asked for', partial.unitsUsed.has('projects'), true);

  check('nothing per-project in scope means no list',
    projectServiceLines(estimateScope({
      rows, services: ['Bill payment'], pricing, counts: { sites: 10 }, dealSize: 0,
    }).lines).length, 0);
  check('junk in, empty list out', projectServiceLines(null), []);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
