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
  feeBasisLabel, projectServiceLines, formatMoneyRange, formatRate,
  normalizeSetup, setupTotal, formatSetupSummary, setPricingSetup,
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

// ── A typed fee prices one of them, and the deal can carry several ────
{
  // The panel this is for: an integration quoted at $5,000 a rollout, on a
  // deal doing three of them.
  const three = estimateService({
    entry: { basis: 'per_project', avgFee: 5000, units: 3 }, meta: PROJECT, counts: {}, dealSize: '',
  });
  check('a typed fee times the count typed against the row', three.fee, 15000);
  check('and it is still a typed fee, with the count on the row', [three.typed, three.units], [true, 3]);

  const one = estimateService({
    entry: { basis: 'per_project', avgFee: 5000 }, meta: PROJECT, counts: {}, dealSize: '',
  });
  check('nobody counted, so it is worth what was typed', [one.fee, one.units], [5000, null]);

  // The rule that keeps this safe: an account-wide figure never multiplies
  // a lump sum. 819 sites × a typed $40,000 would be a $32m service.
  const shared = estimateService({
    entry: { basis: 'per_site', avgFee: 40000 }, meta: PROJECT, counts: { sites: 819 }, dealSize: '',
  });
  check('the shared count leaves a typed fee alone', shared.fee, 40000);

  const none = estimateService({
    entry: { basis: 'per_project', avgFee: 5000, units: 0 }, meta: PROJECT, counts: {}, dealSize: '',
  });
  check('none of them is worth nothing, and says so', [none.fee, none.note], [0, 'Set to no projects']);

  const ranged = estimateService({
    entry: { basis: 'per_project', avgFee: 5000, units: 3 }, meta: RECURRING, counts: {}, dealSize: '',
  });
  check('a multiplied typed fee is still one figure, not a range',
    [ranged.fee, ranged.feeHigh], [15000, 15000]);
  check('and it runs across the term', ranged.value, 45000);

  check('the line says how many it priced', feeBasisLabel({ typed: true, units: 3 }), 'Est. Fee × 3');
  check('and says nothing extra when it priced one', feeBasisLabel({ typed: true, units: null }), 'Est. Fee');

  // A typed row no longer asks the bar for a count it can't use.
  const scope = estimateScope({
    rows: [{ name: 'API/ETL', meta: PROJECT }], services: ['API/ETL'],
    pricing: { 'API/ETL': { basis: 'per_project', avgFee: 5000 } }, counts: {}, dealSize: '',
  });
  check('a typed row puts no count box on the estimator', [...scope.unitsUsed], []);
  check('while a rate-priced row still does',
    [...estimateScope({
      rows: [{ name: 'API/ETL', meta: PROJECT }], services: ['API/ETL'],
      pricing: { 'API/ETL': { basis: 'per_project', rate: 5000 } }, counts: {}, dealSize: '',
    }).unitsUsed],
    ['projects']);
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

// ── A rate range: low and high, all the way through ───────────────────
{
  // $450–$600 a site over 819 sites, on a three-year recurring service.
  const ranged = estimateService({
    entry: { basis: 'per_site', rate: 450, rateHigh: 600 }, meta: RECURRING,
    counts: { sites: 819 }, dealSize: '',
  });
  check('both ends of the rate price both ends of the fee',
    [ranged.fee, ranged.feeHigh], [368550, 491400]);
  check('and both run across the term', [ranged.value, ranged.valueHigh], [1105650, 1474200]);

  // The normal case is still one figure, not a range from x to nothing.
  const single = estimateService({
    entry: { basis: 'per_site', rate: 450 }, meta: RECURRING, counts: { sites: 819 }, dealSize: '',
  });
  check('no high rate, no range', [single.fee, single.feeHigh], [368550, 368550]);

  // A high typed under the low is a typo, not an inverted range.
  const backwards = estimateService({
    entry: { basis: 'per_site', rate: 600, rateHigh: 450 }, meta: RECURRING,
    counts: { sites: 10 }, dealSize: '',
  });
  check('a backwards pair still reads low to high', [backwards.fee, backwards.feeHigh], [4500, 6000]);

  // The floor holds up the bottom of a range the way it holds up a fee.
  const floored = estimateService({
    entry: { basis: 'per_site', rate: 1, rateHigh: 900, minFee: 5000 }, meta: PROJECT,
    counts: { sites: 10 }, dealSize: '',
  });
  check('the min fee floors the low end only when the high clears it',
    [floored.fee, floored.feeHigh], [5000, 9000]);

  // A typed fee is a figure, not a spread: someone typing it is stating
  // the fee, and a range either side of it would be invented.
  const typed = estimateService({
    entry: { basis: 'per_site', rate: 450, rateHigh: 600, avgFee: 40000 }, meta: PROJECT,
    counts: { sites: 819 }, dealSize: '',
  });
  check('a typed fee has no range', [typed.fee, typed.feeHigh], [40000, 40000]);

  // A percentage range takes its cut at both ends.
  const pct = estimateService({
    entry: { basis: 'pct_deal', rate: 3, rateHigh: 5 }, meta: PROJECT, counts: {}, dealSize: 300000,
  });
  check('a percentage range cuts both ways', [pct.fee, pct.feeHigh], [9000, 15000]);
}

// ── Totals add each end to its own end ────────────────────────────────
{
  const rows = [
    { name: 'Bill payment', meta: RECURRING },
    { name: 'Audits', meta: PROJECT },
  ];
  const est = estimateScope({
    rows, services: ['Bill payment', 'Audits'],
    // One service ranged, one not: the high total is the high end of the
    // first plus the ONLY end of the second, not the low total scaled up.
    pricing: { 'Bill payment': { basis: 'per_site', rate: 100, rateHigh: 150 }, 'Audits': { avgFee: 15000 } },
    counts: { sites: 10 }, dealSize: '',
  });
  check('the year-one range adds each end to its own end',
    [est.year1Total, est.year1TotalHigh], [16000, 16500]);
  check('so does the contract value', [est.contractValue, est.contractValueHigh], [18000, 19500]);
  check('recurring and one-off keep their own ends',
    [est.recurringAnnual, est.recurringAnnualHigh, est.oneTime, est.oneTimeHigh], [1000, 1500, 15000, 15000]);
  check('and the scope knows it is a range', est.ranged, true);

  const flat = estimateScope({
    rows, services: ['Audits'], pricing: { 'Audits': { avgFee: 15000 } }, counts: {}, dealSize: '',
  });
  check('a scope with no ranged service is not a range', flat.ranged, false);
  check('and its ends agree', [flat.year1Total, flat.year1TotalHigh], [15000, 15000]);
}

// ── How a range reads ─────────────────────────────────────────────────
{
  check('one figure when the ends agree', formatMoneyRange(45000, 45000), '$45,000');
  check('a range when they do not', formatMoneyRange(45000, 60000), '$45,000 – $60,000');
  check('no high end is one figure', formatMoneyRange(45000, null), '$45,000');
  check('nothing at all is nothing', formatMoneyRange(null, null), '');
  check('a backwards pair still reads low to high', formatMoneyRange(60000, 45000), '$45,000 – $60,000');
  check('a rate range reads as one', formatRate({ basis: 'per_site', rate: 450, rateHigh: 600 }), '$450–$600');
  check('a percentage range too', formatRate({ basis: 'pct_deal', rate: 3, rateHigh: 5 }), '3%–5%');
  check('a single rate is unchanged', formatRate({ basis: 'per_site', rate: 450 }), '$450');
}

// ── Clearing the basis takes the whole range with it ──────────────────
{
  const cleared = setPricingField(
    { 'Bill payment': { basis: 'per_site', rate: 450, rateHigh: 600, minFee: 1000 } },
    'Bill payment', 'basis', '',
  );
  check('no basis, no rates to read against it', cleared['Bill payment'], undefined);
}

// ── Setup fees ────────────────────────────────────────────────────────
//
// One-time money on a service whose fee usually isn't, so what these pin is
// where it lands: in the first year and in the contract value once, never in
// the annual and never multiplied by the term.
{
  const SETUP = [
    { label: 'Implementation', kind: 'fixed', amount: 5000 },
    { label: 'Site onboarding', kind: 'unit', amount: 150, basis: 'per_site' },
  ];

  check('a fixed component is dollars flat, a per-unit one multiplies its count',
    setupTotal(SETUP, { counts: { sites: 20 } }), 5000 + 150 * 20);
  check('no count for the unit is no per-unit money, not a skipped component',
    setupTotal(SETUP, { counts: {} }), 5000);
  check('an empty list is zero, so the figure is always addable',
    setupTotal([], { counts: { sites: 20 } }), 0);

  // A service sold on a slice of the account is stood up on that slice too.
  check('the service\u2019s own unit count wins over the shared one',
    setupTotal(SETUP, { counts: { sites: 819 }, ownUnit: 'sites', ownUnits: 40 }),
    5000 + 150 * 40);
  check('\u2026but only for a component charged on that same unit',
    setupTotal([{ kind: 'unit', amount: 10, basis: 'per_meter' }],
      { counts: { meters: 500 }, ownUnit: 'sites', ownUnits: 40 }), 10 * 500);

  // What the card shows: the rate, not the total, because the rate is what
  // was agreed and the total moves with the deal.
  check('the summary reads as rates', formatSetupSummary(SETUP), '$5,000 + $150/site');
  check('and nothing reads as nothing', formatSetupSummary([]), '');
}

{
  // Normalization: a component with no amount, or a per-unit one whose
  // basis is gone or isn't per-unit, can't price anything.
  check('a component with no amount drops out',
    normalizeSetup([{ kind: 'fixed' }, { kind: 'fixed', amount: 100 }]).length, 1);
  check('a per-unit component with no unit behind it drops out rather than going flat',
    normalizeSetup([{ kind: 'unit', amount: 100, basis: 'pct_deal' }]).length, 0);
  check('an unknown basis drops out too',
    normalizeSetup([{ kind: 'unit', amount: 100, basis: 'per_truck' }]).length, 0);
  check('anything that is not a list is an empty one', normalizeSetup('nope'), []);
  check('a negative amount is not a discount', normalizeSetup([{ kind: 'fixed', amount: -50 }]), []);

  // Stored like every other field: an empty list clears it, and an entry
  // with nothing left is deleted outright.
  const saved = setPricingSetup({}, 'Bill payment', [{ kind: 'fixed', amount: 5000 }]);
  check('a setup fee is stored on the entry', saved['Bill payment'].setup.length, 1);
  check('clearing it removes the entry that held nothing else',
    setPricingSetup(saved, 'Bill payment', [])['Bill payment'], undefined);
  check('and the rest of the entry survives one that does',
    setPricingSetup({ 'Bill payment': { basis: 'per_site', rate: 450, setup: [{ kind: 'fixed', amount: 1 }] } },
      'Bill payment', [])['Bill payment'].rate, 450);
}

{
  const entry = { basis: 'per_site', rate: 450, setup: [{ kind: 'fixed', amount: 5000 }] };
  const est = estimateService({ entry, meta: RECURRING, counts: { sites: 20 }, dealSize: '' });
  check('the setup fee rides alongside the recurring fee', est.setup, 5000);
  check('and stays out of the annual', est.fee, 9000);
  check('and out of the fee across the term', est.value, 27000);

  // A service with nothing but a setup fee is still money on the deal.
  const only = estimateService({
    entry: { setup: [{ kind: 'fixed', amount: 7500 }] }, meta: RECURRING, counts: {}, dealSize: '',
  });
  check('a setup-only service is priced', only.priced, true);
  check('at nothing recurring', only.fee, 0);
  check('and its setup fee', only.setup, 7500);
  check('flagged as setup-only, so a reader knows why the annual is zero', only.setupOnly, true);

  // A service with neither is unpriced exactly as before.
  const none = estimateService({ entry: {}, meta: RECURRING, counts: {}, dealSize: '' });
  check('nothing on the card is still unpriced', none.priced, false);
  check('with no setup fee to report', none.setup, 0);
}

{
  // Where it lands in a scope: the first year and the contract value once,
  // the one-time total rather than the annual.
  const rows = [{ name: 'Bill payment', meta: RECURRING }];
  const pricing = { 'Bill payment': { basis: 'per_site', rate: 450, setup: [{ kind: 'fixed', amount: 5000 }] } };
  const scope = estimateScope({ rows, services: ['Bill payment'], pricing, counts: { sites: 20 }, dealSize: '' });
  check('the annual is the recurring fee alone', scope.recurringAnnual, 9000);
  check('the setup fee is one-time money', scope.oneTime, 5000);
  check('it is named on its own as well', scope.setup, 5000);
  check('the first year carries both', scope.year1Total, 14000);
  check('the contract carries it once, not once a year', scope.contractValue, 9000 * 3 + 5000);
  check('and both ends of a range carry it', scope.oneTimeHigh, 5000);

  // Without one, every total reads exactly as it did before setup fees.
  const plain = estimateScope({
    rows, services: ['Bill payment'],
    pricing: { 'Bill payment': { basis: 'per_site', rate: 450 } },
    counts: { sites: 20 }, dealSize: '',
  });
  check('a service with no setup fee is untouched', plain.year1Total, 9000);
  check('and reports no setup money', plain.setup, 0);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
