// Assertion tests for the click signals on the Email Tracking tab.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/emailSignals.test.mjs
//
// These signals are inferences shown to a seller, so the failure mode that
// matters is the confident wrong one: telling somebody their email was
// forwarded around a company when it was one person on a phone and a laptop,
// or counting a security scanner's sweep as a second reader.
//
// They used to be derived from the tracking pixel. They read the clicks now,
// which is a stronger foundation for exactly the reason the pixel was dropped
// from the page: a load fires when Apple pre-fetches a message nobody opened,
// while a click needs somebody to choose to make it. "Clicked on 3 days" is a
// claim that survives scrutiny in a way "loaded on 3 days" never did.
//
// Three rules do most of the work and all three are asserted here.
//
//   1. Only clicks countClicks() COUNTED contribute. A gateway sweep or a
//      pre-send draft preview must not add a day, a place or a device — those
//      are exactly the events that come from somewhere else on some other
//      machine, so letting them through would manufacture the forward signal.
//   2. The forward signal needs BOTH several places and several devices.
//      Either alone is ordinary: a laptop and a phone at one desk, or one
//      machine that commutes.
//   3. The booking chip says "opened", never "booked". A click on a scheduling
//      link means somebody went to look at the calendar; whether they took a
//      slot happens on the provider's site and is not recorded here. Getting
//      this wrong would have the seller believe they have meetings they don't.
import {
  clickSignals,
  clickShape,
  deviceFamily,
  shortDuration,
} from '../src/utils/emailSignals.js';
import { countClicks } from '../src/utils/emailClicks.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  scanner: 'Mimecast link scanner',
};
const BOOKING = 'https://outlook.office.com/bookwithme/user/dan@se.com/meetingtype/XYZ';
const REPORT = 'https://example.com/savings-analysis';

const DAY = 86400000;
const t0 = new Date('2026-03-02T14:00:00Z').getTime();
const keys = (list) => list.map(s => s.key);
const labels = (list) => list.map(s => s.label);

// A tracking doc, built so the tests exercise the real classifier rather than
// a hand-made summary that could drift away from what countClicks() produces.
const doc = (clicks) => ({ clickCount: clicks.length, clicks });
const click = (at, ua, city, url = REPORT, extra = {}) => ({
  at: new Date(at).toISOString(), ua, city, region: 'MA', country: 'US', url, ...extra,
});

// ---- deviceFamily --------------------------------------------------------

check('device: a phone and a laptop are different machines',
  [deviceFamily(UA.iphone), deviceFamily(UA.mac)], ['iphone', 'mac']);
check('device: an image proxy is not a machine the reader owns',
  deviceFamily('Mozilla/5.0 (X11; Linux) GoogleImageProxy'), 'proxy');
check('device: no user-agent, no family', deviceFamily(''), '');

// ---- shortDuration -------------------------------------------------------

check('duration: minutes, hours and days each at one unit',
  [shortDuration(12 * 60000), shortDuration(3 * 3600000), shortDuration(2 * DAY)],
  ['12m', '3h', '2d']);
check('duration: under a minute is not "0m"', shortDuration(20000), '<1m');
check('duration: nothing in, nothing out', shortDuration(null), '');

// ---- clickShape ----------------------------------------------------------

check('shape: one click is one day, one place, one device',
  (() => {
    const s = clickShape(countClicks(doc([click(t0, UA.mac, 'Boston')])));
    return [s.days, s.places, s.devices, s.booking];
  })(), [1, 1, 1, 0]);

check('shape: an excluded click contributes no day, place or device',
  (() => {
    // The scanner clicked from another city on another machine — precisely the
    // event that would manufacture a forward signal if it leaked through.
    const s = clickShape(countClicks(doc([
      click(t0, UA.mac, 'Boston'),
      click(t0 + 60000, UA.scanner, 'Dublin', REPORT, { ip: '9.9.9.9' }),
    ])));
    return [s.days, s.places, s.devices];
  })(), [1, 1, 1]);

check('shape: a booking-link click is counted as one',
  clickShape(countClicks(doc([click(t0, UA.mac, 'Boston', BOOKING)]))).booking, 1);

check('shape: time to the first click is measured from the send',
  clickShape(countClicks(doc([click(t0 + 20 * 60000, UA.mac, 'Boston')])), { sentAt: t0 }).msToFirstClick,
  20 * 60000);
check('shape: with no send time there is no time-to-first-click',
  clickShape(countClicks(doc([click(t0, UA.mac, 'Boston')]))).msToFirstClick, null);

// ---- clickSignals --------------------------------------------------------

check('signals: an ordinary single click says nothing',
  clickSignals(countClicks(doc([click(t0 + 5 * DAY, UA.mac, 'Boston')])), { sentAt: t0 }), []);

check('signals: the booking page is called out, and named for what it is',
  labels(clickSignals(countClicks(doc([click(t0 + 5 * DAY, UA.mac, 'Boston', BOOKING)])), { sentAt: t0 })),
  ['Opened booking page']);

// The wording is the test. "Opened" and "not a booking" both have to survive
// any future edit, because a seller who reads this chip as a booking will
// stop following up on the one group most worth following up.
check('signals: the booking chip never claims a booking was made',
  (() => {
    const chip = clickSignals(countClicks(doc([click(t0 + DAY, UA.mac, 'Boston', BOOKING)])), { sentAt: t0 })[0];
    return [/not a booking/i.test(chip.title), /\bbooked\b/i.test(chip.label)];
  })(), [true, false]);

check('signals: clicks on separate days are the repeat signal',
  labels(clickSignals(countClicks(doc([
    click(t0 + 2 * DAY, UA.mac, 'Boston'),
    click(t0 + 4 * DAY, UA.mac, 'Boston'),
  ])), { sentAt: t0 })), ['Clicked on 2 days']);

check('signals: a first click within the hour is called out',
  labels(clickSignals(countClicks(doc([click(t0 + 20 * 60000, UA.mac, 'Boston')])), { sentAt: t0 })),
  ['Clicked in 20m']);

// Two places on two devices — the forward tell.
check('signals: several places on several devices reads as a forward',
  keys(clickSignals(countClicks(doc([
    click(t0 + 2 * DAY, UA.mac, 'Boston'),
    click(t0 + 3 * DAY, UA.windows, 'Chicago'),
  ])), { sentAt: t0 })), ['shared', 'repeat']);

check('signals: one person on two devices in one city is not a forward',
  keys(clickSignals(countClicks(doc([
    click(t0 + 2 * DAY, UA.mac, 'Boston'),
    click(t0 + 3 * DAY, UA.iphone, 'Boston'),
  ])), { sentAt: t0 })), ['repeat']);

check('signals: one device that travels is not a forward either',
  keys(clickSignals(countClicks(doc([
    click(t0 + 2 * DAY, UA.mac, 'Boston'),
    click(t0 + 3 * DAY, UA.mac, 'Chicago'),
  ])), { sentAt: t0 })), ['repeat']);

// A gateway sweeping the message is context, not engagement — and it has to
// come last, after anything the recipient actually did.
check('signals: screening is reported, and reported last',
  keys(clickSignals(countClicks(doc([
    click(t0 + 2 * DAY, UA.mac, 'Boston', BOOKING),
    click(t0 + 3 * DAY, UA.mac, 'Boston'),
    click(t0 + 3 * DAY + 1000, UA.scanner, 'Dublin'),
  ])), { sentAt: t0 })), ['booking', 'repeat', 'screened']);

// Excluded clicks must not be able to raise a signal on their own: a send
// where the ONLY activity was a scanner has nothing to say about the reader.
check('signals: a scanner alone raises screening and nothing else',
  keys(clickSignals(countClicks(doc([
    click(t0 + 1000, UA.scanner, 'Dublin', BOOKING),
  ])), { sentAt: t0 })), ['screened']);

// ---- nothing to say, said as nothing -------------------------------------
//
// A send with no clicks gets an empty list, not a chip announcing the absence.

check('signals: no clicks at all produces no signals',
  clickSignals(countClicks(doc([])), { sentAt: t0 }), []);
check('signals: a missing summary does not throw', clickSignals(null), []);
check('signals: several clicks inside ONE day are not a repeat signal',
  keys(clickSignals(countClicks(doc([
    click(t0 + 2 * DAY, UA.mac, 'Boston'),
    click(t0 + 2 * DAY + 3600000, UA.mac, 'Boston'),
  ])), { sentAt: t0 })), []);

// ---- timing signals are never fabricated ---------------------------------

check('signals: a first click the next day is not a fast click',
  clickSignals(countClicks(doc([click(t0 + DAY, UA.mac, 'Boston')])), { sentAt: t0 }), []);
check('signals: no send time means no timing signal, not a made-up one',
  clickSignals(countClicks(doc([click(t0, UA.mac, 'Boston')])), { sentAt: null }), []);
check('shape: a click BEFORE the send yields no timing signal',
  clickShape(countClicks(doc([click(t0 - 60000, UA.mac, 'Boston')])), { sentAt: t0 }).msToFirstClick, null);

// An excluded pre-send preview is the sender, on the sender's own machine in
// the sender's own city — exactly the event that would fake a forward if the
// gate ever stopped holding.
check('signals: an excluded draft preview cannot manufacture a signal',
  keys(clickSignals(countClicks(doc([
    click(t0 - DAY, UA.windows, 'Chicago'),
    click(t0 + 3 * DAY, UA.mac, 'Boston'),
  ]), { sentAt: t0 }), { sentAt: t0 })), []);

console.log(failures === 0 ? '\nAll click-signal tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
