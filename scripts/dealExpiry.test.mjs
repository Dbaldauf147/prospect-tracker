// Assertion tests for isExpiredDeal — which deals the Deals page sinks to
// the bottom and greys out. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/dealExpiry.test.mjs
//
// Expiry here is a hand-set flag, not a derived one: the Paperwork column
// reads "Expired" and nothing else counts. The rule that matters most is the
// one that ISN'T here — a past End Date. Agreements outlive the date on them
// routinely (auto-renewal, amendments, or just a stale sheet while the money
// still comes in), so deriving expiry from the date greys out live contracts.
// Most of these cases exist to pin that down, because it's the mistake the
// page made before and would silently make again.
//
// isExpiredDeal is deliberately NARROWER than isInactiveAgreement, which also
// counts Cancelled and drives the Clients tab's contract drill-down. Cancelled
// and expired are different events; the last block guards the gap so widening
// one doesn't quietly widen the other.
import { isExpiredDeal, isInactiveAgreement } from '../src/utils/dealsFormat.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

// A date `offset` days from today, as the M/D/YYYY string the tracker holds.
function dayOffset(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ---- The one thing that expires a deal -----------------------------------
check('Paperwork "Expired" → expired', isExpiredDeal({ 'Paperwork completed': 'Expired' }), true);
check('lower case → expired', isExpiredDeal({ 'Paperwork completed': 'expired' }), true);
check('padded and shouted → expired', isExpiredDeal({ 'Paperwork completed': '  EXPIRED  ' }), true);

// ---- A past End Date does NOT expire a deal -------------------------------
// The Prologis case: "1st Amendment to Statement of Work No. 7", fully
// executed, End Date long past, still a live agreement.
check('past End Date alone → live',
  isExpiredDeal({ 'End Date': dayOffset(-30) }), false);
check('years-old End Date alone → live',
  isExpiredDeal({ 'End Date': dayOffset(-900) }), false);
check('fully executed agreement with a past End Date → live',
  isExpiredDeal({ 'End Date': dayOffset(-400), 'Paperwork completed': 'Fully Executed Agreement' }), false);
check('auto-renewing contract past its End Date → live',
  isExpiredDeal({ 'End Date': dayOffset(-60), 'Auto renewal?': 'Yes' }), false);
check('still being paid past its End Date → live',
  isExpiredDeal({ 'End Date': dayOffset(-60), 'Currently being paid': 'Yes' }), false);
check('…and a past End Date does not rescue a row marked Expired',
  isExpiredDeal({ 'End Date': dayOffset(-60), 'Paperwork completed': 'Expired' }), true);
check('a future End Date does not rescue one either',
  isExpiredDeal({ 'End Date': dayOffset(365), 'Paperwork completed': 'Expired' }), true);

// ---- Everything else stays live -------------------------------------------
check('Cancelled is NOT expired on this page',
  isExpiredDeal({ 'Paperwork completed': 'Cancelled' }), false);
check('an ordinary completed value → live', isExpiredDeal({ 'Paperwork completed': 'Yes' }), false);
check('blank Paperwork → live', isExpiredDeal({ 'Paperwork completed': '' }), false);
check('no Paperwork key at all → live', isExpiredDeal({ 'Client Name': 'Prologis' }), false);
check('null deal → live', isExpiredDeal(null), false);
// "Expired" has to be the whole value, not a word inside a sentence.
check('a note mentioning expiry does not count',
  isExpiredDeal({ 'Paperwork completed': 'Renewed before it expired' }), false);

// ---- The Clients-tab predicate keeps its wider meaning ---------------------
check('isInactiveAgreement still counts Cancelled',
  isInactiveAgreement({ 'Paperwork completed': 'Cancelled' }), true);
check('isInactiveAgreement still counts the American spelling',
  isInactiveAgreement({ 'Paperwork completed': 'Canceled' }), true);
check('isInactiveAgreement still counts Expired',
  isInactiveAgreement({ 'Paperwork completed': 'Expired' }), true);
check('isInactiveAgreement ignores a past End Date too',
  isInactiveAgreement({ 'End Date': dayOffset(-30) }), false);

console.log(failures === 0 ? '\nAll deal-expiry tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
