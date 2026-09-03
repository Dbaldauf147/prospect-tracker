// Assertion tests for the engagement signals on the Email Tracking tab.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/emailSignals.test.mjs
//
// These signals are inferences shown to a seller, so the failure mode that
// matters is the confident wrong one: telling somebody their email was
// forwarded around a company when it was one person on a phone and a laptop,
// or counting a security scanner's fetch as a second reader.
//
// Two rules do most of that work and both are asserted here.
//
//   1. Only opens countOpens() COUNTED contribute. A machine fetch or a
//      pre-send draft preview must not add a day, a place or a device — those
//      are exactly the events that come from somewhere else on some other
//      machine, so letting them through would manufacture the forward signal.
//   2. A proxied fetch contributes no place and no device. The city on a
//      Gmail-proxied open is Google's; treating it as somewhere the reader was
//      would invent a second location for every Gmail recipient alive.
import {
  engagementSignals,
  openShape,
  deviceFamily,
  shortDuration,
} from '../src/utils/emailSignals.js';

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
  proxy: 'Mozilla/5.0 (X11; Linux) GoogleImageProxy',
  scanner: 'Mimecast link scanner',
};

// A countOpens()-shaped summary: what the view actually passes in.
const summary = (events) => ({ events });
const ev = (at, ua, city, extra = {}) => ({
  verdict: 'counted',
  event: { at, ua, city, region: 'MA', country: 'US', ...extra },
});

const DAY = 86400000;
const t0 = new Date('2026-03-02T14:00:00Z').getTime();
const keys = (list) => list.map(s => s.key);
const labels = (list) => list.map(s => s.label);

// ---- deviceFamily --------------------------------------------------------

check('device: a phone and a laptop are different machines',
  [deviceFamily(UA.iphone), deviceFamily(UA.mac)], ['iphone', 'mac']);
check('device: an image proxy is not a machine the reader owns',
  deviceFamily(UA.proxy), 'proxy');
check('device: no user-agent, no family', deviceFamily(''), '');

// ---- the ordinary send says nothing --------------------------------------

check('one open on one day from one place produces no signals',
  engagementSignals(summary([ev(t0, UA.mac, 'Boston')])), []);
check('no opens at all produces no signals', engagementSignals(summary([])), []);
check('a missing summary does not throw', engagementSignals(null), []);

// ---- repeat reads --------------------------------------------------------

check('opens on separate days are called out',
  labels(engagementSignals(summary([
    ev(t0, UA.mac, 'Boston'),
    ev(t0 + DAY, UA.mac, 'Boston'),
    ev(t0 + 2 * DAY, UA.mac, 'Boston'),
  ]))), ['Loaded on 3 days']);
check('several opens inside ONE day are not repeat reads',
  engagementSignals(summary([
    ev(t0, UA.mac, 'Boston'),
    ev(t0 + 3600000, UA.mac, 'Boston'),
  ])), []);

// ---- the forwarding inference --------------------------------------------

check('two places AND two devices reads as maybe forwarded',
  keys(engagementSignals(summary([
    ev(t0, UA.mac, 'Boston'),
    ev(t0 + 3600000, UA.windows, 'Denver'),
  ]))), ['shared']);
check('one person on a laptop and a phone in one city is NOT a forward',
  engagementSignals(summary([
    ev(t0, UA.mac, 'Boston'),
    ev(t0 + 3600000, UA.iphone, 'Boston'),
  ])), []);
check('one device that moves city is NOT a forward',
  engagementSignals(summary([
    ev(t0, UA.iphone, 'Boston'),
    ev(t0 + 3600000, UA.iphone, 'Denver'),
  ])), []);

// Rule 1: only counted events contribute. A scanner fetch from Ashburn on a
// different machine is exactly what would fake a forward.
check('an excluded machine fetch cannot manufacture a forward',
  engagementSignals(summary([
    ev(t0, UA.mac, 'Boston'),
    { verdict: 'machine', event: { at: t0 + 60000, ua: UA.scanner, city: 'Ashburn', country: 'US' } },
  ])), []);
check('an excluded pre-send preview cannot manufacture one either',
  engagementSignals(summary([
    ev(t0, UA.mac, 'Boston'),
    { verdict: 'pre-send', event: { at: t0 - DAY, ua: UA.windows, city: 'Denver', country: 'US' } },
  ])), []);

// Rule 2: a proxied open's city is the proxy's, not the reader's.
check('a proxied open adds neither a place nor a device',
  openShape(summary([
    ev(t0, UA.mac, 'Boston'),
    ev(t0 + 60000, UA.proxy, 'Mountain View', { proxied: true }),
  ])), { days: 1, places: 1, devices: 1, firstOpenAt: t0, msToFirstOpen: null });

// ---- time to first open --------------------------------------------------

check('a first open within the hour is called out',
  labels(engagementSignals(summary([ev(t0 + 12 * 60000, UA.mac, 'Boston')]), { sentAt: t0 })),
  ['Loaded in 12m']);
check('a first open the next day is not',
  engagementSignals(summary([ev(t0 + DAY, UA.mac, 'Boston')]), { sentAt: t0 }), []);
check('no send time means no timing signal — not a fabricated one',
  engagementSignals(summary([ev(t0, UA.mac, 'Boston')]), { sentAt: null }), []);
check('an open BEFORE the send yields no timing signal',
  openShape(summary([ev(t0 - 60000, UA.mac, 'Boston')]), { sentAt: t0 }).msToFirstOpen, null);

// ---- ordering + formatting ----------------------------------------------

check('signals come strongest first',
  keys(engagementSignals(summary([
    ev(t0 + 5 * 60000, UA.mac, 'Boston'),
    ev(t0 + DAY, UA.windows, 'Denver'),
  ]), { sentAt: t0 })), ['shared', 'repeat', 'fast']);

check('duration: minutes', shortDuration(12 * 60000), '12m');
check('duration: hours', shortDuration(3 * 3600000), '3h');
check('duration: days', shortDuration(2 * DAY), '2d');
check('duration: under a minute', shortDuration(20000), '<1m');

console.log(failures === 0 ? '\nAll engagement-signal tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
