// Assertion tests for the delivery status on the Email Tracking tab.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/deliveryStatus.test.mjs
//
// The whole point of this module is the state that is NOT a claim. "Did it
// arrive" is the question an open count looks like it answers and doesn't: a
// pixel load proves arrival, but a missing load proves nothing at all, because
// Outlook blocks images by default. So delivery is read off bounces — and a
// send no campaign is watching has no bounce evidence either way.
//
// Calling that "delivered" would repeat the exact mistake the rename was
// undoing: turning silence into a fact. It is UNKNOWN, it is excluded from
// both halves of the delivery rate, and both of those are asserted here.
import {
  deliveryStatus,
  DELIVERY,
  isDelivered,
  isDeliveryKnown,
} from '../src/utils/deliveryStatus.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const SENT = '2026-03-02T14:00:00Z';
const watched = (over = {}) => ({ bounced: false, replied: false, ...over });

// ---- the three real states ----------------------------------------------

check('a bounce is a delivery failure',
  deliveryStatus(watched({ bounced: true }), { sentAt: SENT }), DELIVERY.FAILED);
check('an image load or a click confirms arrival — both happen after delivery',
  deliveryStatus(watched(), { hasActivity: true, sentAt: SENT }), DELIVERY.CONFIRMED);
check('sent, watched, nothing bounced, nothing loaded — delivered',
  deliveryStatus(watched(), { sentAt: SENT }), DELIVERY.DELIVERED);

// A bounce outranks activity. The pre-send draft previews are already excluded
// upstream, but a stray load must never override a hard delivery failure.
check('a bounce beats recorded activity',
  deliveryStatus(watched({ bounced: true }), { hasActivity: true, sentAt: SENT }),
  DELIVERY.FAILED);

// ---- the honest non-answers ---------------------------------------------

check('no campaign watching means UNKNOWN, not delivered',
  deliveryStatus(null, { sentAt: SENT }), DELIVERY.UNKNOWN);
check('...even with no send date to go on',
  deliveryStatus(null, {}), DELIVERY.UNKNOWN);
check('watched but never sent is NOT SENT, not delivered',
  deliveryStatus(watched(), { sentAt: null }), DELIVERY.NOT_SENT);

// An unwatched send that demonstrably loaded IS confirmed: the evidence is the
// load itself, and it doesn't need a campaign to be trustworthy.
check('an unwatched send that loaded is still confirmed',
  deliveryStatus(null, { hasActivity: true }), DELIVERY.CONFIRMED);

// ---- what the rate is measured over --------------------------------------

check('confirmed and delivered both count as arrived',
  [isDelivered(DELIVERY.CONFIRMED), isDelivered(DELIVERY.DELIVERED)], [true, true]);
check('failed did not arrive', isDelivered(DELIVERY.FAILED), false);
check('unknown is not counted as arrived', isDelivered(DELIVERY.UNKNOWN), false);
check('not-sent is not counted as arrived', isDelivered(DELIVERY.NOT_SENT), false);

check('the rate is measured over the three states we have evidence for',
  [DELIVERY.CONFIRMED, DELIVERY.DELIVERED, DELIVERY.FAILED].map(isDeliveryKnown),
  [true, true, true]);
check('and excludes the two we do not — neither numerator nor denominator',
  [DELIVERY.UNKNOWN, DELIVERY.NOT_SENT].map(isDeliveryKnown), [false, false]);

console.log(failures === 0 ? '\nAll delivery-status tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
