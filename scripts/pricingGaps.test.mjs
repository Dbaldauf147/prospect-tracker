// What a scope estimate could not price, and why - the red errors under the
// Deal Size prompt.
//
// The failure this pins is a quiet one. A service the rate card CAN price,
// at an account nobody has recorded a count for, comes back priced, at $0.
// It is not in `unpriced`, so the footnote under the total never mentioned
// it, and a $0 beside a service name is indistinguishable from a service
// that is free. The Year 1 total was short by whatever that service is
// worth with nothing on screen saying so.
//
// So `gap` is the field that separates the three cases a $0 can be:
//
//   1. Nobody answered. A count or a deal size the estimate needed and the
//      account does not carry. THIS is the error.
//   2. Somebody answered none. A count typed as zero, a service marked no
//      fee. An answer, and never an error - flagging it would nag the user
//      about a decision they already made.
//   3. The rate card is blank. Also an error, but a different errand: it is
//      fixed on Dropdowns, not against this account, which is why the two
//      are grouped apart rather than listed together.
//
// Run: node scripts/pricingGaps.test.mjs
import { estimateScope, scopeGaps, PRICING_GAPS, PRICING_BASES } from '../src/utils/servicePricing.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${a}\n      want: ${e}`}`);
}

const bases = PRICING_BASES;
const recurring = { serviceType: 'recurring', years: 3 };
const rows = [
  { name: 'Invoice collection', bucket: 'DATA', meta: recurring },
  { name: 'Capital asset planning', bucket: 'DATA', meta: recurring },
  { name: 'RA dashboards', bucket: 'DATA', meta: recurring },
  { name: 'Client management', bucket: 'DATA', meta: recurring },
  { name: 'IDM', bucket: 'DATA', meta: recurring },
];
const pricing = {
  // Charged per account. The account has no account count recorded.
  'Invoice collection': { basis: 'per_account', rate: 1 },
  // Charged per meter. Also unrecorded.
  'Capital asset planning': { basis: 'per_meter', rate: 5 },
  // Charged per site, and sites ARE recorded - the row that has to stay black.
  'RA dashboards': { basis: 'per_site', rate: 18, rateHigh: 20 },
  // A cut of a deal size nobody has typed yet.
  'Client management': { basis: 'pct_deal', rate: 3 },
  // On the card by name only: no basis, no rate.
  'IDM': {},
};
const counts = { sites: 16 };
const est = estimateScope({ rows, services: rows.map(r => r.name), pricing, bases, counts, dealSize: null });
const lineBy = (name) => est.lines.find(l => l.name === name);

// --- the gap on each line -------------------------------------------------
check('a missing count names the unit it is missing',
  lineBy('Invoice collection').gap, { kind: 'units', unit: 'accounts', unitLabel: 'Accounts' });
check('a second missing count is its own gap, not the first one again',
  lineBy('Capital asset planning').gap, { kind: 'units', unit: 'meters', unitLabel: 'Meters' });
check('a missing deal size is a gap of its own kind',
  lineBy('Client management').gap, { kind: 'deal', unit: null, unitLabel: '' });
check('a blank rate card is a gap too',
  lineBy('IDM').gap, { kind: 'rate', unit: null, unitLabel: '' });
check('a line with everything it needs has no gap',
  lineBy('RA dashboards').gap, null);

// The $0 that started all this: priced, so absent from `unpriced`, and only
// `gap` tells it apart from a service that is genuinely free.
check('the count-less service still reports itself priced',
  [lineBy('Invoice collection').priced, lineBy('Invoice collection').fee], [true, 0]);
check('and is NOT in unpriced, which is why the footnote missed it',
  est.unpriced, ['IDM']);
check('but it IS carrying a gap', !!lineBy('Invoice collection').gap, true);

// --- the grouping ---------------------------------------------------------
check('gaps group by the missing input, each naming the services it blocks',
  est.gaps.map(g => [g.kind, g.unitLabel, g.services]), [
    ['rate', '', ['IDM']],
    ['units', 'Accounts', ['Invoice collection']],
    ['units', 'Meters', ['Capital asset planning']],
    ['deal', '', ['Client management']],
  ]);
check('the rate-card errand reads first, since it is fixed somewhere else',
  est.gaps[0].kind, PRICING_GAPS[0]);
check('each group says what is missing in the words the row note uses',
  est.gaps.map(g => g.label), [
    'No price on the rate card',
    'No accounts entered',
    'No meters entered',
    'No deal size to take a percentage of',
  ]);

// Two services short of the SAME count are one errand, not two.
{
  const shared = [
    { name: 'Invoice collection', bucket: 'DATA', meta: recurring },
    { name: 'Invoice variance testing', bucket: 'DATA', meta: recurring },
  ];
  const e = estimateScope({
    rows: shared,
    services: shared.map(r => r.name),
    pricing: {
      'Invoice collection': { basis: 'per_account', rate: 1 },
      'Invoice variance testing': { basis: 'per_account', rate: 2 },
    },
    bases,
    counts: {},
    dealSize: null,
  });
  check('one missing count blocking two services is one grouped error',
    e.gaps.map(g => [g.kind, g.unitLabel, g.services]),
    [['units', 'Accounts', ['Invoice collection', 'Invoice variance testing']]]);
}

// --- what is NOT an error -------------------------------------------------
// A deliberate zero is an answer. The note still says so on the row; the
// gap stays null so nothing goes red over a decision somebody made.
// The count rides on the estimate, not on the rate card: a standing figure
// on the card is deliberately dropped (see pricingFor), so a zero typed for
// THIS deal is the only zero that means anything.
{
  const answered = [{ name: 'Invoice collection', bucket: 'DATA', meta: recurring }];
  const e = estimateScope({
    rows: answered,
    services: ['Invoice collection'],
    pricing: { 'Invoice collection': { basis: 'per_account', rate: 1 } },
    serviceUnits: { 'Invoice collection': 0 },
    bases,
    counts: { accounts: 500 },
    dealSize: null,
  });
  check('a count typed as none still says so on the row',
    e.lines[0].note, 'Set to no accounts');
  check('but it is not an error', e.lines[0].gap, null);
  check('so nothing is raised under the table', e.gaps, []);
}

// A service given away prices at $0 on purpose and has always reported
// itself priced. It must not be dressed up as a missing data point.
{
  const free = [{ name: 'Portal access', bucket: 'DATA', meta: recurring }];
  const e = estimateScope({
    rows: free,
    services: ['Portal access'],
    pricing: { 'Portal access': { noFee: true } },
    bases,
    counts: { sites: 16 },
    dealSize: null,
  });
  check('a no-fee service is not a gap', [e.lines[0].note, e.lines[0].gap], ['No fee', null]);
  check('and raises nothing', e.gaps, []);
}

// A fully answered scope returns an empty list rather than a shape the
// caller has to look inside - the panel renders nothing off that.
{
  const e = estimateScope({
    rows: [{ name: 'RA dashboards', bucket: 'DATA', meta: recurring }],
    services: ['RA dashboards'],
    pricing: { 'RA dashboards': { basis: 'per_site', rate: 18 } },
    bases,
    counts: { sites: 16 },
    dealSize: null,
  });
  check('nothing missing, nothing raised', e.gaps, []);
  check('and the fee is the one the card says', e.lines[0].fee, 288);
}

// --- scopeGaps on its own -------------------------------------------------
check('scopeGaps handles nothing at all', scopeGaps(null), []);
check('scopeGaps ignores a line carrying a gap kind it does not know',
  scopeGaps([{ name: 'X', gap: { kind: 'invented' } }]), []);

console.log(failures === 0 ? '\nAll pricing-gap checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
