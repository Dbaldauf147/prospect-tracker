// Assertion tests for hand-corrected mandate data. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/ordinanceOverrides.test.mjs
//
// These corrections change money: an edited penalty or threshold flows
// into every exposure total, deadline chart and export the reference
// feeds. So the tests pin what an override reaches (the screening, not
// just the popup it was typed into) and what it leaves alone.
import {
  applyOrdinanceOverrides, mandateFormValues, overridePatchFrom,
  overrideFor, overrideCount, overrideKey,
} from '../src/utils/ordinanceOverrides.js';
import { screenSite, getMandates } from '../src/utils/complianceMandates.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const ORDINANCES = [{
  govId: 'US-OH-Columb-01',
  government: 'Columbus',
  state: 'Ohio',
  bbs: {
    policyName: 'Building Performance in Columbus',
    status: 'Active/ Mandatory',
    active: true,
    deadline: '2026-06-01',
    deadlineRaw: '6/1/2026',
    thresholds: { public: null, nonResidential: 50000, multiFamily: 50000, statewide: null },
    maxPenalty: 1825000,
    url: 'https://www.columbus.gov/sustainable/benchmarking/',
  },
  audits: { status: 'Active/ Mandatory', active: true, deadline: null, deadlineRaw: null, thresholds: {}, maxPenalty: null },
  bps: { status: 'Pre-Development', active: false, thresholds: {}, maxPenalty: null },
  raw: {},
}];
const CITY_LOOKUP = { columbusoh: 'US-OH-Columb-01', columbus: 'US-OH-Columb-01' };
const SITE = { siteName: 'Scarborough', city: 'Columbus', state: 'OH', sqft: 60000, propertyType: 'Office' };

const screen = (ordinances) => screenSite(SITE, { ordinances, cityLookup: CITY_LOOKUP });
const KEY = overrideKey('US-OH-Columb-01');

// --- the published figures, before anything is corrected ----------------
{
  const r = screen(ORDINANCES);
  eq(r.bbs.penalty, 1825000, 'the published penalty is what screens today');
  eq(r.bbs.deadline, '2026-06-01', 'and the published deadline');
  eq(r.bbs.threshold, 50000, 'and the published threshold');
  eq(r.bbs.eligible, true, 'a 60,000 ft² building meets a 50,000 ft² requirement');
}

// --- a corrected penalty reaches the screening --------------------------
{
  const overrides = { [KEY]: { bbs: { maxPenalty: 4000, editedAt: '2026-08-06T00:00:00.000Z' } } };
  const r = screen(applyOrdinanceOverrides(ORDINANCES, overrides));
  eq(r.bbs.penalty, 4000, 'the corrected penalty is what the site is screened at');
  eq(r.bbs.deadline, '2026-06-01', 'and everything not corrected stays published');
}

// --- a corrected threshold can take a building out of scope -------------
{
  const overrides = { [KEY]: { bbs: { thresholds: { nonResidential: 100000 } } } };
  const r = screen(applyOrdinanceOverrides(ORDINANCES, overrides));
  eq(r.bbs.threshold, 100000, 'the corrected size requirement is used');
  eq(r.bbs.eligible, false, 'and a 60,000 ft² building now falls below it');
  eq(r.bbs.penalty, 1825000, 'the rate is still on file');
  // Only `eligible === true` contributes to a portfolio's exposure, so
  // this is the correction that takes a site out of the total.
  eq(r.bbs.applicable, false, 'so it stops counting as needing to report');
}

// --- switching an ordinance off -----------------------------------------
{
  const overrides = { [KEY]: { bbs: { active: false, status: 'Active/ Voluntary' } } };
  const r = screen(applyOrdinanceOverrides(ORDINANCES, overrides));
  eq([r.bbs.active, r.bbs.eligible], [false, false], 'an ordinance marked not-in-force screens nobody');
}

// --- switching one ON ----------------------------------------------------
// The BPS row is "Pre-Development" in the seed. A jurisdiction that has
// since adopted it has to be sayable without waiting for a new build.
{
  const overrides = {
    [KEY]: {
      bps: {
        active: true, status: 'Active/ Mandatory', deadline: '2027-05-01', deadlineRaw: '5/1/2027',
        thresholds: { nonResidential: 50000 }, maxPenalty: 20000, policyName: 'Columbus BPS',
      },
    },
  };
  const r = screen(applyOrdinanceOverrides(ORDINANCES, overrides));
  eq(r.bps.eligible, true, 'a newly-adopted mandate starts screening');
  eq(r.bps.penalty, 20000, 'with its own penalty');
  eq(r.bps.deadline, '2027-05-01', 'and its own deadline');
  eq(r.bps.policyName, 'Columbus BPS', 'and its own name');
}

// --- a corrected deadline gives an audits mandate something to be due ---
// An audit ordinance with no published date screens as "nothing due".
{
  const before = screen(ORDINANCES);
  eq([before.audits.noDeadline, before.audits.eligible], [true, false], 'no deadline, nothing due');
  const overrides = { [KEY]: { audits: { deadline: '2026-12-31', deadlineRaw: '12/31/2026' } } };
  const after = screen(applyOrdinanceOverrides(ORDINANCES, overrides));
  eq(after.audits.eligible, true, 'a corrected deadline makes the audit due');
  eq(after.audits.deadlineRaw, '12/31/2026', 'and prints the corrected date');
}

// --- corrections are marked ---------------------------------------------
// Every figure a person typed has to be tellable from a published one,
// wherever it surfaces.
{
  const overrides = { [KEY]: { bbs: { maxPenalty: 4000, editedAt: '2026-08-06T00:00:00.000Z' } } };
  const applied = applyOrdinanceOverrides(ORDINANCES, overrides);
  const mandate = getMandates('US-OH-Columb-01', applied);
  eq(mandate.bbs.edited, true, 'a corrected category says so');
  eq(mandate.bbs.editedAt, '2026-08-06T00:00:00.000Z', 'and when');
  eq(!!mandate.audits.edited, false, 'an untouched one does not');
}

// --- the list identity is preserved when there is nothing to apply ------
// The screening caches its indexes by list identity: a fresh copy per
// render would throw that cache away on every keystroke.
{
  eq(applyOrdinanceOverrides(ORDINANCES, null) === ORDINANCES, true, 'no overrides returns the same list');
  eq(applyOrdinanceOverrides(ORDINANCES, {}) === ORDINANCES, true, 'an empty map does too');
  eq(applyOrdinanceOverrides(ORDINANCES, { 'somewhere-else': { bbs: { maxPenalty: 1 } } }) === ORDINANCES, true,
    'and so does a correction for a jurisdiction that isn’t in the list');
}

// --- the form: what it shows, and what it stores ------------------------
{
  const mandate = ORDINANCES[0];
  const values = mandateFormValues(mandate, 'bbs', {});
  eq(values.policyName, 'Building Performance in Columbus', 'the form opens on the published values');
  eq(values.maxPenalty, 1825000, 'including the penalty');
  eq(values.thresholds.nonResidential, 50000, 'and the thresholds');
  eq(values.active, true, 'and whether it is in force');

  const edited = mandateFormValues(mandate, 'bbs', { [KEY]: { bbs: { maxPenalty: 4000 } } });
  eq(edited.maxPenalty, 4000, 'a correction already on file shows instead');
  eq(edited.policyName, 'Building Performance in Columbus', 'beside the published values it did not touch');

  const patch = overridePatchFrom({
    ...values, maxPenalty: '$4,000', deadline: '2027-01-15', thresholds: { nonResidential: '75,000', multiFamily: '' },
  }, { now: new Date('2026-08-06T00:00:00.000Z') });
  eq(patch.maxPenalty, 4000, 'a typed dollar figure is stored as a number');
  eq(patch.thresholds.nonResidential, 75000, 'and so is a typed threshold');
  eq(patch.thresholds.multiFamily, null, 'a cleared threshold stores as null, not as the published value');
  eq(patch.deadlineRaw, '1/15/2027', 'the printed date is derived from the one that was picked');
  eq(patch.editedAt, '2026-08-06T00:00:00.000Z', 'and the correction is stamped');
}

// --- reading corrections back --------------------------------------------
{
  const overrides = { [KEY]: { bbs: { maxPenalty: 4000 }, bps: { active: true } } };
  eq(overrideFor(overrides, 'US-OH-Columb-01', 'bbs').maxPenalty, 4000, 'a correction is found by Government ID');
  eq(overrideFor(overrides, 'US-OH-Columb-01', 'audits'), null, 'an untouched category has none');
  eq(overrideCount(overrides), 2, 'corrections are counted across categories');
  eq(overrideCount({}), 0, 'and an empty map has none');
  eq(overrideKey('US-MI-Ann Ar-01'), 'usmiannar01', 'a Government ID with a space keys cleanly');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
