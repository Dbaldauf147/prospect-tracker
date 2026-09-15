// Assertion tests for the Impact tie on the Services Pricing rate card -
// which figure elsewhere on the site says what a service is worth to the
// client. Plain Node - no test framework (the project has none). Run:
//   node scripts/serviceImpact.test.mjs
//
// The tie is one string on a rate card entry, so most of what can go wrong
// with it is a rule about what it is NOT: it is not a price, so it must not
// take the no-fee mark off a service given away free, and it must survive
// the mark being put on; and it is not free text, so a key left behind by a
// source that no longer exists has to read as "not tied" rather than as a
// tie to a figure nothing produces.
import {
  IMPACT_SOURCES, impactAmount, impactAmountTitle, impactKey, impactLabel,
  impactMissingTitle, impactSourceFor, impactTitle,
} from '../src/utils/serviceImpact.js';
import { pricingFor, setPricingField, setNoFee } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// ── The source list ───────────────────────────────────────────────────
//
// Adding a source is meant to be one entry in one array, so what is pinned
// is the shape the rest of the app reads it through: a key nothing else
// answers to, a label for the column, and a field naming where on the
// company record the figure is actually read from. A source missing that
// last one is a tie to nowhere.
{
  const keys = IMPACT_SOURCES.map(s => s.key);
  check('every source key is unique', keys.length, new Set(keys).size);
  check('every source is complete',
    IMPACT_SOURCES.filter(s => s.key && s.label && s.short && s.field && s.where && s.blurb).length,
    IMPACT_SOURCES.length);
  check('the two figures off the analysis are on the list',
    keys.includes('indicativeAnnualSavings') && keys.includes('maxYearlyExposure'), true);
  check('a source resolves by key', impactSourceFor('maxYearlyExposure').label, 'Est. Max Yearly Exposure');
  check('and an unknown key resolves to nothing', impactSourceFor('whatever'), null);
}

// ── A stored key is cleaned on the way out ────────────────────────────
{
  check('a live key comes through', impactKey('indicativeAnnualSavings'), 'indicativeAnnualSavings');
  check('a retired one reads as untied', impactKey('someRetiredFigure'), '');
  check('so does junk', [impactKey(''), impactKey(null), impactKey(42)], ['', '', '']);
  check('the column shows the label, not the key',
    impactLabel('indicativeAnnualSavings'), 'Indicative Annual Savings');
  check('an untied row has nothing to show', impactLabel(''), '');
  // Both halves of the tooltip: what the figure counts, and whose figure it
  // is. The second is the one a reader would otherwise get wrong.
  check('the tooltip says whose number it is',
    impactTitle('indicativeAnnualSavings').includes('company’s'), true);
}

// ── The tie rides on the rate card entry ──────────────────────────────
{
  const pricing = setPricingField({}, 'Energy Procurement', 'impact', 'indicativeAnnualSavings');
  check('it is stored as the key', pricing['Energy Procurement'].impact, 'indicativeAnnualSavings');
  check('and read back off the entry',
    pricingFor(pricing, 'Energy Procurement').impact, 'indicativeAnnualSavings');

  const cleared = setPricingField(pricing, 'Energy Procurement', 'impact', '');
  check('clearing it leaves no entry behind', cleared['Energy Procurement'], undefined);

  // Nothing about the tie is a number, so it must not be parsed like one:
  // parseMoney would turn every key into null and store nothing at all.
  const priced = setPricingField(
    setPricingField({}, 'Bill Pay', 'basis', 'per_meter'), 'Bill Pay', 'rate', 9,
  );
  const tied = setPricingField(priced, 'Bill Pay', 'impact', 'maxYearlyExposure');
  const entry = pricingFor(tied, 'Bill Pay');
  check('a tie sits alongside the price rather than on top of it',
    [entry.basis, entry.rate, entry.impact], ['per_meter', 9, 'maxYearlyExposure']);
}

// ── It is not a price ─────────────────────────────────────────────────
//
// A service delivered free can be the one that saves the account the most.
// Saying so must not start billing for it, and marking it free must not
// throw the fact away.
{
  const free = setNoFee({}, ['Benchmarking']);
  const tied = setPricingField(free, 'Benchmarking', 'impact', 'maxYearlyExposure');
  check('naming an impact leaves the no-fee mark alone', pricingFor(tied, 'Benchmarking').noFee, true);
  check('and the tie is there beside it', pricingFor(tied, 'Benchmarking').impact, 'maxYearlyExposure');

  // The other direction: the mark clears the rates, and the tie is not one
  // of them.
  const priced = setPricingField(
    setPricingField({ Audit: {} }, 'Audit', 'basis', 'flat'), 'Audit', 'rate', 5000,
  );
  const withTie = setPricingField(priced, 'Audit', 'impact', 'indicativeAnnualSavings');
  const marked = pricingFor(setNoFee(withTie, ['Audit']), 'Audit');
  check('marking no fee clears the rate', [marked.basis, marked.rate], ['', null]);
  check('but keeps what the service is worth to them', marked.impact, 'indicativeAnnualSavings');

  // A rate typed onto a free service still takes the mark off, which is the
  // rule the impact field had to be carved out of rather than allowed to
  // quietly break.
  const repriced = setPricingField(setNoFee({}, ['Benchmarking']), 'Benchmarking', 'basis', 'flat');
  check('a price still unmarks it', pricingFor(repriced, 'Benchmarking').noFee, false);
}

// ── Resolving the figure against one company ──────────────────────────
//
// The rate card can only name the figure, because it is the same card for
// every account. Account Potential is about one account, so it resolves the
// name into an amount off that company's record - and the three answers it
// can give are three different things, which is the whole of what this
// has to get right.
{
  const client = { company: 'Vibrantz Technology', indicativeAnnualSavings: 1284000, maxYearlyExposure: '' };

  check('a named figure resolves to the amount on the record',
    impactAmount('indicativeAnnualSavings', client).amount, 1284000);
  check('and it carries the source, so a cell can say which figure it is',
    impactAmount('indicativeAnnualSavings', client).source.short, 'saved');

  // Named, but the record does not have it. Not zero: zero savings is a
  // claim, and this is the absence of one.
  check('a figure the record is missing resolves to no amount',
    impactAmount('maxYearlyExposure', client).amount, null);
  check('an empty record is the same answer',
    impactAmount('indicativeAnnualSavings', {}).amount, null);
  check('and so is no record at all',
    impactAmount('indicativeAnnualSavings', null).amount, null);

  // No tie at all is a different answer again: nobody has said what this
  // service is worth to anybody, which is not a fact about this company.
  check('an untied service resolves to nothing', impactAmount('', client), null);
  check('so does a retired key', impactAmount('someRetiredFigure', client), null);

  // Typed money comes off a company card as a string more often than not.
  check('a typed figure is read as a number',
    impactAmount('indicativeAnnualSavings', { indicativeAnnualSavings: '$1,284,000' }).amount, 1284000);
  check('and something that is not a number is not zero',
    impactAmount('indicativeAnnualSavings', { indicativeAnnualSavings: 'lots' }).amount, null);

  // A figure of zero IS a figure - a screening that found no mandates says
  // nothing is at risk, and that is an answer rather than a blank.
  check('zero is a figure, not a blank',
    impactAmount('maxYearlyExposure', { maxYearlyExposure: 0 }).amount, 0);

  // The two tooltips the account page needs: one naming whose estate the
  // amount describes, one saying where a missing figure comes from.
  check('the amount tooltip names the account',
    impactAmountTitle('indicativeAnnualSavings', 'Vibrantz Technology').includes('Vibrantz Technology'), true);
  check('the missing tooltip says where the figure comes from',
    impactMissingTitle('maxYearlyExposure', 'Vibrantz Technology').includes('Master Analysis'), true);
  check('an untied cell falls back to the rate card wording',
    impactAmountTitle('', 'Vibrantz Technology'), impactTitle(''));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
