// Assertion tests for the Indicative Savings row status — the short phrase
// each market carries saying why it is or isn't showing a savings number.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/savingsStatus.test.mjs
//
// The thing worth pinning down is PRECEDENCE. Several reasons are true at
// once on a typical $0 row — a Limited market with no qualifying sites has no
// deregulated sites, no spend and no eligible spend as well — and the status
// is only useful if it names the most specific one every time.
//
// The other half is that the amber tint and the status stay one decision:
// every tinted row has a reason, every row with a reason is tinted. They used
// to be separate tests over different fields, which is how rows with spend
// entirely at leased locations ended up showing $0 with nothing saying so.
import {
  SAVINGS_STATUS,
  savingsStatusFor,
  hasProjectedSavings,
  isNoSavingsRow,
} from '../src/components/SitesView/savingsStatus.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A healthy deregulated market: sites, spend, a band, and contract room.
const healthy = (over = {}) => ({
  state: 'TX',
  status: 'yes',
  deregulatedSites: 12,
  leasedSites: 0,
  spend: 4_000_000,
  savingsEligibleSpend: 4_000_000,
  lowPct: 0.02,
  highPct: 0.04,
  year5: { low: 400_000, mid: 600_000, high: 800_000 },
  ...over,
});

// ---- the ordinary case ---------------------------------------------------

check('a market with sites, spend, a band and contract room is eligible',
  savingsStatusFor(healthy()), SAVINGS_STATUS.ELIGIBLE);
check('and it is not tinted', isNoSavingsRow(healthy()), false);

// ---- precedence ----------------------------------------------------------

// AZ / MI: retail choice exists but we can only serve a customer already
// holding third-party supply. Every other reason is true here too.
check('a limited market says so, not "no deregulated sites"',
  savingsStatusFor({ ...healthy(), status: 'Limited', deregulatedSites: 0, spend: 0, savingsEligibleSpend: 0 }),
  SAVINGS_STATUS.LIMITED);
// A Limited market that reached deregulated spend has third-party supply in
// place already — which is the condition its gating asks for — so it is a live
// opportunity, not a dud, and must not be greyed out with the others.
check('a limited market that DOES project savings reads as eligible',
  savingsStatusFor({ ...healthy(), status: 'Limited' }), SAVINGS_STATUS.ELIGIBLE);
check('and it is not tinted',
  isNoSavingsRow({ ...healthy(), status: 'Limited' }), false);

check('no qualifying sites beats no spend',
  savingsStatusFor({ ...healthy(), deregulatedSites: 0, spend: 0, savingsEligibleSpend: 0 }),
  SAVINGS_STATUS.NO_DEREG_SITES);
check('sites but no cost data reads as no spend on file',
  savingsStatusFor({ ...healthy(), spend: 0, savingsEligibleSpend: 0 }),
  SAVINGS_STATUS.NO_SPEND);
check('spend that is entirely at leased locations reads as no owned sites',
  savingsStatusFor({ ...healthy(), leasedSites: 12, savingsEligibleSpend: 0 }),
  SAVINGS_STATUS.NO_OWNED_SITES);
check('a market the reference table carries as TBD names the missing band',
  savingsStatusFor({ ...healthy(), lowPct: null, highPct: null }),
  SAVINGS_STATUS.NO_BAND);
check('a band that resolves to 0 % is no band either',
  savingsStatusFor({ ...healthy(), lowPct: 0, highPct: 0 }),
  SAVINGS_STATUS.NO_BAND);
check('spend and a band but no free month reads as under contract',
  savingsStatusFor({ ...healthy(), year5: { low: 0, mid: 0, high: 0 } }),
  SAVINGS_STATUS.UNDER_CONTRACT);

// The small-market reasons sit BELOW the ones above: a market this size is
// still worth naming as small, but only once nothing more basic is wrong.
check('a small electric market names its size',
  savingsStatusFor(healthy({ spend: 935_000, savingsEligibleSpend: 495_000 }), 'electric'),
  SAVINGS_STATUS.SMALL_ELECTRIC);
check('a small market with no sites names the sites first',
  savingsStatusFor(healthy({ spend: 0, savingsEligibleSpend: 0, deregulatedSites: 0 }), 'electric'),
  SAVINGS_STATUS.NO_DEREG_SITES);
check('electric at exactly $1M is not small',
  savingsStatusFor(healthy({ spend: 1_000_000, savingsEligibleSpend: 1_000_000 }), 'electric'),
  SAVINGS_STATUS.ELIGIBLE);

// ---- the gas threshold is its own number ---------------------------------

check('gas below $30K is too low',
  savingsStatusFor(healthy({ spend: 12_000, savingsEligibleSpend: 12_000 }), 'gas'),
  SAVINGS_STATUS.LOW_GAS);
check('gas at $200K is eligible — the $1M electric bar does not apply',
  savingsStatusFor(healthy({ spend: 200_000, savingsEligibleSpend: 200_000 }), 'gas'),
  SAVINGS_STATUS.ELIGIBLE);
check('the same $200K of ELECTRIC spend is a small market',
  savingsStatusFor(healthy({ spend: 200_000, savingsEligibleSpend: 200_000 }), 'electric'),
  SAVINGS_STATUS.SMALL_ELECTRIC);

// ---- parent aggregate rows -----------------------------------------------

check('the United States / Canada roll-up rows carry no status',
  savingsStatusFor({ ...healthy(), isParent: true }), '');
check('and are not tinted by it',
  isNoSavingsRow({ ...healthy(), isParent: true }), false);
check('a missing row reads as no status rather than throwing',
  savingsStatusFor(null), '');

// ---- tint and status are one decision ------------------------------------

// Each row is internally consistent with what the export can actually build:
// spend only ever accrues on deregulated sites, and eligible spend is a slice
// of spend, so zeroing one zeroes the ones below it.
const tinted = [
  { ...healthy(), status: 'Limited', deregulatedSites: 0, spend: 0, savingsEligibleSpend: 0 },
  { ...healthy(), deregulatedSites: 0, spend: 0, savingsEligibleSpend: 0 },
  { ...healthy(), spend: 0, savingsEligibleSpend: 0 },
  { ...healthy(), savingsEligibleSpend: 0 },
  { ...healthy(), lowPct: null, highPct: null },
  { ...healthy(), year5: { low: 0, mid: 0, high: 0 } },
  healthy({ spend: 935_000, savingsEligibleSpend: 495_000 }),
];
tinted.forEach((row, i) => {
  check(`row ${i + 1} with a reason is tinted`, isNoSavingsRow(row), true);
});

// hasProjectedSavings is the shared test underneath both: it asks only
// whether any dollar shows up anywhere in the 5 years, under any scenario.
check('a high-scenario-only projection still counts as savings',
  hasProjectedSavings({ ...healthy(), year5: { low: 0, mid: 0, high: 1 } }), true);
check('savings that start in year 3 still count (year 5 carries them)',
  hasProjectedSavings({ ...healthy(), year5: { low: 10, mid: 20, high: 30 } }), true);
check('no eligible spend means no projection',
  hasProjectedSavings({ ...healthy(), savingsEligibleSpend: 0 }), false);
check('a missing year-5 triple means no projection',
  hasProjectedSavings({ ...healthy(), year5: null }), false);

console.log(failures === 0 ? '\nAll savings-status tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
