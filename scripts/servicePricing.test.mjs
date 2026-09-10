// Assertion tests for the Services Pricing rate card. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/servicePricing.test.mjs
//
// This is deal money: what a service is worth, and what a set of them adds
// up to over a contract. The rules worth pinning are the ones a reader
// can't infer from a single number on screen — that a fee typed into a
// service's Typed fee box beats whatever the basis would have worked out,
// that a minimum fee floors a thin scope but doesn't invent one out of an empty
// scope, and that recurring and one-off money are kept apart on the way to
// a contract value.
import {
  estimateService, estimateScope, pricingFor, setPricingField, contractYears, formatMoney,
  feeBasisLabel, projectServiceLines, formatMoneyRange, formatRate,
  normalizeSetupLines, setupLinesFor, estimateSetup, formatSetupSummary, setPricingSetupLine,
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

// ── A typed fee and a minimum fee are retired ─────────────────────────
//
// Both used to sit on the card and quietly outrank the model: a typed fee
// replaced whatever the basis worked out to, a minimum fee floored it. They
// are gone from the pricing panel, and pricingFor drops them on the way out
// of storage — so a figure somebody saved months ago is still in settings
// and still reaches nothing. What this pins is that second half, because it
// is the half a stored number could silently undo.
{
  const stored = { basis: 'per_site', rate: 900, minFee: 5000, avgFee: 30000 };

  const entry = pricingFor({ Widgets: stored }, 'Widgets');
  check('a stored typed fee never reaches the estimate', entry.avgFee, null);
  check('nor does a stored minimum fee', entry.minFee, null);
  check('the basis and rate come through untouched',
    [entry.basis, entry.rate], ['per_site', 900]);

  const rows = [{ name: 'Widgets', meta: RECURRING }];
  const priced = estimateScope({
    rows, services: ['Widgets'], pricing: { Widgets: stored },
    counts: { sites: 20 }, dealSize: '',
  });
  check('so the service prices off its basis, not the figure typed over it',
    priced.recurringAnnual, 900 * 20);
  check('and no line claims to be a typed fee', priced.lines[0].typed, false);

  // The floor is the quieter of the two: it only showed up on a thin scope,
  // which is exactly where nobody would notice it had stopped.
  const thin = estimateScope({
    rows, services: ['Widgets'], pricing: { Widgets: stored },
    counts: { sites: 2 }, dealSize: '',
  });
  check('a thin scope is worth what it is worth, not the old floor',
    thin.recurringAnnual, 1800);

  // A service that had nothing BUT a typed fee has nothing left. It is not
  // quietly worth zero — it comes back unpriced and named, so the scope it
  // is in says the total is short rather than printing a confident figure.
  const feeOnly = estimateScope({
    rows: [{ name: 'Audits', meta: PROJECT }], services: ['Audits'],
    pricing: { Audits: { avgFee: 40000 } }, counts: {}, dealSize: '',
  });
  check('a service priced only that way is unpriced now', feeOnly.unpriced, ['Audits']);
  check('and contributes nothing rather than its old figure', feeOnly.year1Total, 0);
}

// ── Storage keeps what it was given ───────────────────────────────────
//
// setPricingField still writes and clears the retired fields — nothing goes
// out of its way to destroy a figure that is merely no longer read.
{
  const start = { Widgets: { basis: 'per_site', rate: 900, minFee: 5000, avgFee: 30000 } };
  const cleared = setPricingField(start, 'Widgets', 'basis', '');
  check('clearing the basis drops the rate and floor', cleared.Widgets, { avgFee: 30000 });

  const noFee = setPricingField({ Widgets: { basis: 'per_site', rate: 900 } }, 'Widgets', 'basis', '');
  check('with nothing left, the entry goes entirely', noFee.Widgets, undefined);

  const unset = setPricingField(start, 'Widgets', 'avgFee', '');
  check('clearing a retired figure leaves the model behind',
    unset.Widgets, { basis: 'per_site', rate: 900, minFee: 5000 });
}

// ── A count nobody entered prices at nothing, and says so ─────────────
{
  const thin = estimateService({
    entry: { basis: 'per_meter', rate: 12.5 },
    meta: RECURRING, counts: { meters: 200 }, dealSize: '',
  });
  check('a thin scope is worth exactly what its count comes to', thin.fee, 2500);

  const empty = estimateService({
    entry: { basis: 'per_meter', rate: 12.5 },
    meta: RECURRING, counts: {}, dealSize: '',
  });
  check('no count means no fee', [empty.priced, empty.fee], [true, 0]);
  check('and it says why', empty.note, 'No meters entered');
}

// ── Percentage fees cut the deal size ─────────────────────────────────
{
  const pct = estimateService({
    entry: { basis: 'pct_deal', rate: 3.5 }, meta: RECURRING, counts: {}, dealSize: 1000000,
  });
  check('a percentage takes its cut', pct.fee, 35000);
  const noDeal = estimateService({
    entry: { basis: 'pct_deal', rate: 3.5 }, meta: RECURRING, counts: {}, dealSize: '',
  });
  check('no deal size means no fee', noDeal.fee, 0);
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
    'Bill payment': { basis: 'recurring_annual', rate: 40000 },
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
  check('a retired figure reads back as nothing', pricingFor({ A: { avgFee: '12,500' } }, 'A').avgFee, null);
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
    'Bill Pay': { basis: 'recurring_annual', rate: 40000 },
    'Budgets': { basis: 'per_site', rate: 500 },
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
  check('a flat annual says so', by['Bill Pay'], 'Recurring annual');
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
    'Solar feasibility': { basis: 'per_project', rate: 10000 },
  };

  const shared = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 10, projects: 2 }, dealSize: 0,
  });
  const listed = projectServiceLines(shared.lines);
  check('only the per-project services are listed',
    listed.map(l => l.name), ['Lighting retrofit', 'Chiller replacement', 'Solar feasibility']);
  check('a shared count prices every row that has no number of its own',
    listed.map(l => l.fee), [90000, 160000, 20000]);

  // Every per-project row is priced on a count now that no fee can be stated
  // outright, so one on its own still puts the shared box on the estimator.
  check('a row with no count of its own asks for the shared one',
    estimateScope({
      rows, services: ['Solar feasibility'], pricing, counts: {}, dealSize: 0,
    }).unitsUsed.has('projects'), true);

  // The point of the panel: one row's count moves one row's fee.
  const perService = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 10, projects: 2 }, dealSize: 0,
    serviceUnits: { 'Lighting retrofit': 3, 'Chiller replacement': 1, 'Solar feasibility': 1 },
  });
  const own = projectServiceLines(perService.lines);
  check('each row prices on its own count', own.map(l => l.fee), [135000, 80000, 10000]);
  check('...and the shared count no longer has a row to answer for',
    perService.unitsUsed.has('projects'), false);
  check('the deal adds them up as one-off money', perService.oneTime, 135000 + 80000 + 10000);

  // A row left blank is not a row set to zero: it falls back.
  const partial = estimateScope({
    rows, services: rows.map(r => r.name), pricing,
    counts: { sites: 10, projects: 2 }, dealSize: 0,
    serviceUnits: { 'Lighting retrofit': 3 },
  });
  check('a blank row still falls back to the shared count',
    projectServiceLines(partial.lines).map(l => l.fee), [135000, 160000, 20000]);
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
    pricing: { 'Bill payment': { basis: 'per_site', rate: 100, rateHigh: 150 }, 'Audits': { basis: 'flat', rate: 15000 } },
    counts: { sites: 10 }, dealSize: '',
  });
  check('the year-one range adds each end to its own end',
    [est.year1Total, est.year1TotalHigh], [16000, 16500]);
  check('so does the contract value', [est.contractValue, est.contractValueHigh], [18000, 19500]);
  check('recurring and one-off keep their own ends',
    [est.recurringAnnual, est.recurringAnnualHigh, est.oneTime, est.oneTimeHigh], [1000, 1500, 15000, 15000]);
  check('and the scope knows it is a range', est.ranged, true);

  const flat = estimateScope({
    rows, services: ['Audits'], pricing: { 'Audits': { basis: 'flat', rate: 15000 } }, counts: {}, dealSize: '',
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

// ── Picking a basis before there is a rate to read against it ─────────
//
// The most obvious way to start pricing a service: open the panel, pick
// what it is charged on, then fill the rate in. The pick has to survive
// being saved on its own — writing the (empty) line list back used to take
// the basis with it, so the dropdown looked like it did nothing.
{
  const picked = setPricingField({}, 'RA dashboards', 'basis', 'per_site');
  check('a basis picked on an unpriced service is stored',
    picked['RA dashboards'], { basis: 'per_site' });
  check('and reads back off the card', pricingFor(picked, 'RA dashboards').basis, 'per_site');
  check('changing it again moves it',
    setPricingField(picked, 'RA dashboards', 'basis', 'per_meter')['RA dashboards'].basis, 'per_meter');
  check('and clearing it takes the entry that held nothing else',
    setPricingField(picked, 'RA dashboards', 'basis', '')['RA dashboards'], undefined);

  // It is a choice, not a price: nothing prices off a basis with no rate.
  const est = estimateService({
    entry: pricingFor(picked, 'RA dashboards'), meta: RECURRING, counts: { sites: 20 }, dealSize: '',
  });
  check('a bare basis is not a priced service', [est.priced, est.note], [false, 'No rate set']);

  // And it survives on a service priced on setup alone, which has a basis
  // to name the count its setup line multiplies but no recurring rate.
  const setupOnly = setPricingField(
    { Svc: { setupLines: [{ basis: 'per_site', rate: 40 }] } }, 'Svc', 'basis', 'per_site',
  );
  check('a setup-only service keeps the basis it was given', setupOnly.Svc.basis, 'per_site');
  check('and keeps its setup line', setupOnly.Svc.setupLines.length, 1);
}

// ── Setup fees ────────────────────────────────────────────────────────
//
// One-time money on a service whose fee usually isn't, so what these pin is
// where it lands: in the first year and in the contract value once, never in
// the annual and never multiplied by the term. Priced on the same bases the
// recurring fee is, and quoted as a range the same way.
{
  const SETUP = [
    { basis: 'flat', rate: 5000 },
    { basis: 'per_site', rate: 150 },
  ];
  const at = (opts) => estimateSetup({ setupLines: SETUP, ...opts });

  check('a flat line is dollars flat, a per-unit one multiplies its count',
    at({ counts: { sites: 20 } }).total, 5000 + 150 * 20);
  check('no count for the unit is no per-unit money, not a skipped line',
    at({ counts: {} }).total, 5000);
  check('an empty list is zero, so the figure is always addable',
    estimateSetup({ setupLines: [], counts: { sites: 20 } }).total, 0);

  // A service sold on a slice of the account is stood up on that slice too.
  check('the service’s own unit count wins over the shared one',
    at({ counts: { sites: 819 }, ownUnit: 'sites', ownUnits: 40 }).total, 5000 + 150 * 40);
  check('…but only for a line charged on that same unit',
    estimateSetup({
      setupLines: [{ basis: 'per_meter', rate: 10 }],
      counts: { meters: 500 }, ownUnit: 'sites', ownUnits: 40,
    }).total, 10 * 500);

  // The high end: the half of a quote that actually gets negotiated.
  const ranged = estimateSetup({
    setupLines: [{ basis: 'per_site', rate: 100, rateHigh: 150 }], counts: { sites: 20 },
  });
  check('a setup line carries a range', [ranged.total, ranged.totalHigh], [2000, 3000]);
  check('and a line without one prices flat at both ends',
    [at({ counts: {} }).total, at({ counts: {} }).totalHigh], [5000, 5000]);
  check('a high rate typed under the low one is read as the typo it is',
    estimateSetup({ setupLines: [{ basis: 'flat', rate: 900, rateHigh: 100 }] }).totalHigh, 900);

  // A percentage setup fee is a cut taken up front, and it needs the deal
  // size the recurring side needs.
  check('a percentage setup line takes its cut of the deal',
    estimateSetup({ setupLines: [{ basis: 'pct_deal', rate: 2 }], dealSize: 500000 }).total, 10000);

  // A per-unit setup line has to put its count box up, or a service sold on
  // setup alone would quietly price at zero.
  check('a per-unit setup line asks for its count',
    at({ counts: {} }).unitsNeeded, ['sites']);
  check('unless the count is typed against the service',
    at({ counts: {}, ownUnit: 'sites', ownUnits: 40 }).unitsNeeded, []);

  // What the card shows: the rate, not the total, because the rate is what
  // was agreed and the total moves with the deal.
  check('the summary reads as rates', formatSetupSummary(SETUP), '$5,000 + $150/site');
  check('a range says both ends',
    formatSetupSummary([{ basis: 'per_site', rate: 100, rateHigh: 150 }]), '$100 to $150/site');
  check('and nothing reads as nothing', formatSetupSummary([]), '');
}

{
  // Normalization: one line per basis, and a line with no rate or no basis
  // behind it can't price anything.
  check('a line with no rate drops out',
    normalizeSetupLines([{ basis: 'flat' }, { basis: 'per_site', rate: 100 }]).length, 1);
  check('an unknown basis drops out',
    normalizeSetupLines([{ basis: 'per_truck', rate: 100 }]).length, 0);
  check('a second line on the same basis has nowhere to show, so it drops',
    normalizeSetupLines([{ basis: 'flat', rate: 100 }, { basis: 'flat', rate: 200 }]).length, 1);
  check('anything that is not a list is an empty one', normalizeSetupLines('nope'), []);
  check('a negative rate is not a discount', normalizeSetupLines([{ basis: 'flat', rate: -50 }]), []);

  // Stored like the recurring lines: clearing the low rate takes the line,
  // and an entry with nothing left is deleted outright.
  const saved = setPricingSetupLine({}, 'Bill payment', 'flat', { rate: 5000 });
  check('a setup line is stored on the entry', saved['Bill payment'].setupLines.length, 1);
  check('clearing it removes the entry that held nothing else',
    setPricingSetupLine(saved, 'Bill payment', 'flat', { rate: '' })['Bill payment'], undefined);
  check('and the rest of the entry survives it',
    setPricingSetupLine(
      { 'Bill payment': { basis: 'per_site', rate: 450, setupLines: [{ basis: 'flat', rate: 1 }] } },
      'Bill payment', 'flat', { rate: '' },
    )['Bill payment'].rate, 450);
  check('a high end alone is half a range, so it needs the low one first',
    setPricingSetupLine({}, 'Bill payment', 'flat', { rateHigh: 900 })['Bill payment'], undefined);
  const both = setPricingSetupLine(saved, 'Bill payment', 'flat', { rateHigh: 7000 });
  check('and set after it, it sticks', both['Bill payment'].setupLines[0].rateHigh, 7000);
}

{
  // The shape setup fees were saved in before they were priced per basis is
  // still read, because a fee somebody saved is real money. A fixed
  // component is a flat line, a per-unit one keeps its basis, and two
  // landing on the same basis add up rather than one of them dropping.
  const legacy = {
    setup: [
      { label: 'Implementation', kind: 'fixed', amount: 5000 },
      { label: 'Kickoff', kind: 'fixed', amount: 1500 },
      { label: 'Site onboarding', kind: 'unit', amount: 150, basis: 'per_site' },
    ],
  };
  const lines = setupLinesFor(legacy);
  check('a legacy fixed component reads as a flat setup line',
    lines.find(l => l.basis === 'flat').rate, 6500);
  check('and a per-unit one keeps the basis it named',
    lines.find(l => l.basis === 'per_site').rate, 150);
  check('a legacy fee has no high end, so the range stays open',
    lines.every(l => l.rateHigh === null), true);
  check('it prices exactly as it did', estimateSetup({
    setupLines: lines, counts: { sites: 20 },
  }).total, 6500 + 150 * 20);

  // The new key wins outright, and the first edit migrates the service off
  // the old one — leaving both behind would double the fee.
  check('the new key wins when both are there',
    setupLinesFor({ ...legacy, setupLines: [{ basis: 'flat', rate: 99 }] }),
    [{ basis: 'flat', rate: 99, rateHigh: null }]);
  const migrated = setPricingSetupLine({ Svc: legacy }, 'Svc', 'per_meter', { rate: 10 });
  check('an edit writes the converted lines back beside it',
    migrated.Svc.setupLines.map(l => l.basis), ['flat', 'per_site', 'per_meter']);
  check('and drops the legacy list, so nothing is counted twice',
    migrated.Svc.setup, undefined);
}

{
  const entry = pricingFor(
    { 'Bill payment': { basis: 'per_site', rate: 450, setupLines: [{ basis: 'flat', rate: 5000 }] } },
    'Bill payment',
  );
  const est = estimateService({ entry, meta: RECURRING, counts: { sites: 20 }, dealSize: '' });
  check('the setup fee rides alongside the recurring fee', est.setup, 5000);
  check('and stays out of the annual', est.fee, 9000);
  check('and out of the fee across the term', est.value, 27000);
  check('the fee grid gets it line by line', est.setupBreakdown.length, 1);

  // A service with nothing but a setup fee is still money on the deal.
  const only = estimateService({
    entry: pricingFor({ Svc: { setupLines: [{ basis: 'flat', rate: 7500 }] } }, 'Svc'),
    meta: RECURRING, counts: {}, dealSize: '',
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
  const pricing = { 'Bill payment': { basis: 'per_site', rate: 450, setupLines: [{ basis: 'flat', rate: 5000 }] } };
  const scope = estimateScope({ rows, services: ['Bill payment'], pricing, counts: { sites: 20 }, dealSize: '' });
  check('the annual is the recurring fee alone', scope.recurringAnnual, 9000);
  check('the setup fee is one-time money', scope.oneTime, 5000);
  check('it is named on its own as well', scope.setup, 5000);
  check('the first year carries both', scope.year1Total, 14000);
  check('the contract carries it once, not once a year', scope.contractValue, 9000 * 3 + 5000);
  check('and both ends of a flat one carry it', scope.oneTimeHigh, 5000);

  // A setup fee quoted as a range spreads the totals it lands in, rather
  // than pinning the top of the year to the bottom of the setup.
  const ranged = estimateScope({
    rows, services: ['Bill payment'],
    pricing: { 'Bill payment': { basis: 'per_site', rate: 450, setupLines: [{ basis: 'flat', rate: 5000, rateHigh: 8000 }] } },
    counts: { sites: 20 }, dealSize: '',
  });
  check('the top of the year carries the top of the setup', ranged.year1TotalHigh, 17000);
  check('and it is named on its own too', [ranged.setup, ranged.setupHigh], [5000, 8000]);
  check('a setup range makes the scope a range', ranged.ranged, true);

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
