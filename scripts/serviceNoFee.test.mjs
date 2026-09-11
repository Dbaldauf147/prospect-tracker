// Assertion tests for the "no fee" mark on the Services Pricing rate card.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/serviceNoFee.test.mjs
//
// The mark exists to tell two states apart that the rate card could not tell
// apart before: a service nobody has priced yet (an empty card, a gap in the
// work) and a service that is deliberately given away (an answer). They look
// identical in storage and they are opposite facts about a deal, so what has
// to hold is that the mark reads as PRICED, prices to zero, and can never be
// quietly outranked by a rate — the failure mode a $0-typed-in-the-rate-box
// version of this would have had.
//
// The second half is the bulk write, which is the reason it exists at all: it
// reaches a dozen rate cards at once and it THROWS RATES AWAY. So it has to
// report itself honestly before it runs — the count it offers is the count it
// changes, and the rows it would strip are named.
import {
  setNoFee, planNoFee, pricingFor, estimateService, estimateScope,
  setPricingField, setPricingLine, setPricingSetupLine, feeBasisLabel,
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
const PRICED = { basis: 'per_site', rate: 900, rateHigh: 1200, setupLines: [{ basis: 'flat', rate: 5000 }] };

// ── The mark replaces the card, it doesn't sit on top of it ───────────
{
  const next = setNoFee({ Widgets: { ...PRICED, notes: 'bundled with GRESB' } }, ['Widgets']);
  check('the mark is stored', next.Widgets.noFee, true);
  check('and the rates it replaced are gone, not hidden under it',
    [next.Widgets.basis, next.Widgets.rate, next.Widgets.rateHigh, next.Widgets.setupLines],
    [undefined, undefined, undefined, undefined]);
  // The reason for the mark is usually written where the rates were.
  check('the pricing notes survive it', next.Widgets.notes, 'bundled with GRESB');

  // A service nothing was ever stored for can be marked too — that is the
  // common case, and it must not write an entry that says only "{}".
  const fresh = setNoFee({}, ['Fresh']);
  check('a service with no card at all takes the mark', fresh.Fresh, { noFee: true });

  // Unmarking leaves the service UNPRICED rather than restoring the rates:
  // they were cleared, not stashed. The UI says so before it marks.
  const off = setNoFee(next, ['Widgets'], false);
  check('unmarking drops the mark', off.Widgets.noFee, undefined);
  check('and does not bring the rates back', off.Widgets.rate, undefined);
  check('an entry with nothing left in it is deleted outright',
    setNoFee(setNoFee({}, ['Fresh']), ['Fresh'], false).Fresh, undefined);
}

// ── It prices to zero, and it prices as an ANSWER ─────────────────────
{
  const entry = pricingFor({ Widgets: { noFee: true } }, 'Widgets');
  check('the mark comes back off storage', entry.noFee, true);

  const est = estimateService({ entry, meta: RECURRING, counts: { sites: 819 }, dealSize: 400000 });
  check('a marked service is priced — not a gap in the card', est.priced, true);
  check('at nothing, in year one and across the term',
    [est.fee, est.feeHigh, est.value, est.valueHigh], [0, 0, 0, 0]);
  check('and it says why, where a fee would be', est.note, 'No fee');
  check('the phrase under the row says it too', feeBasisLabel(est), 'No fee');

  // The distinction the whole flag is for: an empty card is NOT this.
  const blank = estimateService({ entry: pricingFor({}, 'Nothing'), meta: RECURRING, counts: {}, dealSize: '' });
  check('an unpriced service still reads as unpriced', [blank.priced, blank.note], [false, 'No pricing basis set']);
}

// ── A rate can never outrank the mark ─────────────────────────────────
//
// setNoFee clears the card, so this only happens to an entry written before
// the mark existed or brought in by an import. It is the failure that would
// put money on the one row that says there is none, so it is pinned.
{
  const stored = { ...PRICED, noFee: true };
  const est = estimateService({
    entry: pricingFor({ Widgets: stored }, 'Widgets'),
    meta: RECURRING, counts: { sites: 819 }, dealSize: 400000,
  });
  check('a rate left under the mark charges nothing', [est.priced, est.fee, est.feeHigh], [true, 0, 0]);
  check('nor does a setup line under it', [est.setup, est.setupHigh], [0, 0]);
  check('and the breakdown is empty, so nothing shows a line it never billed',
    [est.breakdown.length, est.setupBreakdown.length], [0, 0]);
}

// ── Typing a price takes the mark off ─────────────────────────────────
//
// The other direction of the same rule: the figure someone just typed is the
// later answer, so it wins — but only a figure. Clearing a field is not a
// price, and a note sits alongside the mark rather than against it.
{
  const marked = { Widgets: { noFee: true, notes: 'bundled' } };
  check('a basis picked on the rate card clears the mark',
    setPricingField(marked, 'Widgets', 'basis', 'per_site').Widgets.noFee, undefined);
  check('a rate typed into the breakdown clears it',
    setPricingLine(marked, 'Widgets', 'per_site', { rate: 450 }).Widgets.noFee, undefined);
  check('so does a setup rate',
    setPricingSetupLine(marked, 'Widgets', 'flat', { rate: 5000 }).Widgets.noFee, undefined);
  check('clearing a field does not — an empty card is not a price',
    setPricingField(marked, 'Widgets', 'basis', '').Widgets.noFee, true);
  check('and editing the notes leaves the mark alone',
    setPricingField(marked, 'Widgets', 'notes', 'free for year one').Widgets.noFee, true);
  check('clearing the last rate leaves an unpriced service, not a marked one',
    setPricingLine({ Widgets: { basis: 'per_site', rate: 450 } }, 'Widgets', 'per_site', { rate: '' }).Widgets,
    undefined);
}

// ── What it does to a deal ────────────────────────────────────────────
{
  const rows = [
    { name: 'Widgets', meta: RECURRING },
    { name: 'Bundled', meta: RECURRING },
    { name: 'Untouched', meta: RECURRING },
  ];
  const pricing = { Widgets: { basis: 'per_site', rate: 900 }, Bundled: { noFee: true } };
  const scope = estimateScope({
    rows, services: ['Widgets', 'Bundled', 'Untouched'], pricing, counts: { sites: 20 }, dealSize: '',
  });
  check('the marked service adds nothing to the deal', scope.year1Total, 900 * 20);
  check('and it is no longer chased as unpriced', scope.unpriced, ['Untouched']);
}

// ── The bulk write counts itself honestly ─────────────────────────────
{
  const pricing = {
    Alpha: { basis: 'per_site', rate: 900 },        // priced — marking strips it
    Beta: { noFee: true },                          // already marked
    Gamma: { setupLines: [{ basis: 'flat', rate: 1000 }] }, // setup only, still money
    Delta: { basis: 'per_site' },                   // a basis picked, no money on it
  };
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  const plan = planNoFee({ names, pricing, on: true });
  check('a row already marked is left alone rather than padding the count',
    [plan.change, plan.same], [['Alpha', 'Gamma', 'Delta', 'Epsilon'], ['Beta']]);
  check('and the rows that would lose a rate are named — setup counts as one',
    plan.clearing, ['Alpha', 'Gamma']);

  const off = planNoFee({ names, pricing, on: false });
  check('unmarking changes only the marked row', [off.change, off.clearing], [['Beta'], []]);

  // The count offered is the count written.
  const next = setNoFee(pricing, plan.change, true);
  check('the write lands on exactly those rows',
    names.map(n => next[n]?.noFee === true), [true, true, true, true, true]);
  check('and takes the money with it', [next.Alpha.rate, next.Gamma.setupLines], [undefined, undefined]);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
