// Assertion tests for isExpiredDeal — which deals the Deals page sinks to
// the bottom and greys out. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/dealExpiry.test.mjs
//
// A deal dies two independent ways and the page has to catch both: the
// contract term runs out (End Date in the past), or somebody kills it early
// and marks the Paperwork column Cancelled / Expired, which leaves a future
// End Date sitting on a dead deal. Neither implies the other, so testing one
// route says nothing about the other.
//
// The boundary that actually bites is today: a contract ending today still
// has the day to run, and treating it as expired drops a live deal off the
// active list early. Dates here are built relative to today rather than
// hard-coded so the suite doesn't rot.
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

// ---- End Date ------------------------------------------------------------
check('End Date yesterday → expired', isExpiredDeal({ 'End Date': dayOffset(-1) }), true);
check('End Date last year → expired', isExpiredDeal({ 'End Date': dayOffset(-400) }), true);
check('End Date TODAY → still live (the day has yet to run)', isExpiredDeal({ 'End Date': dayOffset(0) }), false);
check('End Date tomorrow → live', isExpiredDeal({ 'End Date': dayOffset(1) }), false);

// ---- Missing / unparseable dates -----------------------------------------
// A blank End Date is "we don't know", not "it's over" — greying those out
// would hide deals on the strength of a missing cell.
check('no End Date → live', isExpiredDeal({ 'Client Name': 'Acme' }), false);
check('blank End Date → live', isExpiredDeal({ 'End Date': '' }), false);
check('dash placeholder → live', isExpiredDeal({ 'End Date': '-' }), false);
check('unparseable End Date → live', isExpiredDeal({ 'End Date': 'sometime next year' }), false);
check('null deal → live', isExpiredDeal(null), false);

// ---- Paperwork status ----------------------------------------------------
// The independent route in: killed early, so the End Date is still ahead.
check('Cancelled with a future End Date → expired',
  isExpiredDeal({ 'End Date': dayOffset(200), 'Paperwork completed': 'Cancelled' }), true);
check('American spelling "Canceled" → expired',
  isExpiredDeal({ 'End Date': dayOffset(200), 'Paperwork completed': 'Canceled' }), true);
check('Expired with a future End Date → expired',
  isExpiredDeal({ 'End Date': dayOffset(200), 'Paperwork completed': 'expired' }), true);
check('padded / mixed case status still matches',
  isExpiredDeal({ 'Paperwork completed': '  CANCELLED  ' }), true);
check('an ordinary Paperwork value does not expire a live deal',
  isExpiredDeal({ 'End Date': dayOffset(30), 'Paperwork completed': 'Yes' }), false);
check('…and does not rescue one whose term ran out',
  isExpiredDeal({ 'End Date': dayOffset(-30), 'Paperwork completed': 'Yes' }), true);

// ---- The predicate the Clients tab shares ---------------------------------
// isInactiveAgreement keeps its narrower meaning: paperwork status only. The
// Clients drill-down sorts on it, so widening it here would silently change
// that page too.
check('isInactiveAgreement ignores a passed End Date',
  isInactiveAgreement({ 'End Date': dayOffset(-30) }), false);
check('isInactiveAgreement reads the Paperwork column',
  isInactiveAgreement({ 'Paperwork completed': 'Expired' }), true);

console.log(failures === 0 ? '\nAll deal-expiry tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
