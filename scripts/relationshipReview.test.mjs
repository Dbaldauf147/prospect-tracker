// Assertion tests for the relationship review (where each contact stands
// against their own history). Plain Node. Run:
//   node scripts/relationshipReview.test.mjs
//
// What's worth pinning: the peak and its age, the usual two-way rhythm
// and what counts as overdue against it, each status's threshold, the
// priority order between statuses, and the order inside one.
import {
  reviewContact, reviewAccount, twoWayRhythm, reviewCounts, reviewPriority, REVIEW_STATUSES,
} from '../src/utils/relationshipReview.js';
import { DAY_MS, normalizeTouch, scoreAccount } from '../src/utils/relationshipStrength.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const NOW = Date.UTC(2026, 10, 5, 12);
const ago = (d) => NOW - d * DAY_MS;
const call = (d) => normalizeTouch({ id: `c${d}`, ms: ago(d), type: 'call', outcome: 'connected' });
const vm = (d) => normalizeTouch({ id: `v${d}`, ms: ago(d), type: 'call', outcome: 'voicemail' });
const res = (score, extra = {}) => ({ score, trend: 'flat', daysSinceTwoWay: 5, touchCount: 3, components: { reciprocity: 80 }, ...extra });
const flat = (v, n = 27) => Array(n).fill(v);

// --- rhythm -----------------------------------------------------------------
check('median gap between two-way touches', twoWayRhythm([call(100), call(70), call(40), call(10)], NOW), { usualGapDays: 30, gaps: 3 });
check('one-way touches are not part of the rhythm', twoWayRhythm([call(60), vm(45), call(30)], NOW).usualGapDays, 30);
check('two touches on one day count once', twoWayRhythm([call(30), call(30), call(0)], NOW), { usualGapDays: 30, gaps: 1 });
check('a single touch has no rhythm', twoWayRhythm([call(5)], NOW).usualGapDays, null);

// --- peak -------------------------------------------------------------------
{
  const h = [10, 40, 80, 80, 60, 50];
  const r = reviewContact({ result: res(50), history: h, nowMs: NOW, stepDays: 14 });
  check('peak is the year high', r.peak, 80);
  check('...dated at its latest point', r.peakAgoDays, 28);
  check('off peak', r.offPeak, 30);
  check('today can be the peak', reviewContact({ result: res(90), history: [10, 20], nowMs: NOW }).peak, 90);
}

// --- statuses ---------------------------------------------------------------
check('fell 15+ from a Warm peak: slipping',
  reviewContact({ result: res(55), history: [...flat(70, 20), 65, 60, 55], nowMs: NOW }).status, 'slipping');
check('a fall from a low peak is not slipping',
  reviewContact({ result: res(20), history: [...flat(45, 20), 20], nowMs: NOW }).status, 'steady');
check('14 off a Warm peak is not slipping',
  reviewContact({ result: res(56), history: [70, 56], nowMs: NOW }).status, 'steady');

{
  const rhythm = [call(130), call(100), call(70), call(40)]; // every 30 days, last 40 ago
  check('past 1.5x the usual gap: overdue',
    reviewContact({ result: res(40, { daysSinceTwoWay: 46 }), history: flat(40), touches: [...rhythm.slice(0, 3), call(46)].map((t, i) => ({ ...t, ms: ago([130, 100, 76, 46][i]) })), nowMs: NOW }).status, 'overdue');
  check('inside the rhythm: not overdue',
    reviewContact({ result: res(40, { daysSinceTwoWay: 40 }), history: flat(40), touches: rhythm, nowMs: NOW }).status, 'steady');
  const weekly = [call(35), call(28), call(21), call(14)];
  check('a weekly rhythm 14 days quiet is under the 21-day floor',
    reviewContact({ result: res(40, { daysSinceTwoWay: 14 }), history: flat(40), touches: weekly, nowMs: NOW }).status, 'steady');
  check('too few gaps to know a rhythm',
    reviewContact({ result: res(40, { daysSinceTwoWay: 200 }), history: flat(40), touches: [call(260), call(200)], nowMs: NOW }).status, 'steady');
}

check('lots of outreach, never above 25: never developed',
  reviewContact({ result: res(8, { touchCount: 9 }), history: flat(8), nowMs: NOW }).status, 'never-developed');
check('little outreach and low: steady',
  reviewContact({ result: res(8, { touchCount: 2 }), history: flat(8), nowMs: NOW }).status, 'steady');

check('up 10+ in 90 days: rebuilding',
  reviewContact({ result: res(40, { trend: 'up' }), history: [...flat(25, 20), 30, 35, 40], nowMs: NOW }).status, 'rebuilding');
check('a rise with a falling arrow is not rebuilding',
  reviewContact({ result: res(40, { trend: 'down' }), history: [...flat(25, 20), 40], nowMs: NOW }).status, 'steady');

check('Warm and at the peak: at their best',
  reviewContact({ result: res(78), history: [...flat(60, 20), 80, 78], nowMs: NOW }).status, 'at-best');
check('at the peak but Developing is steady',
  reviewContact({ result: res(40), history: flat(40), nowMs: NOW }).status, 'steady');

check('a new relationship is New, not never-developed',
  reviewContact({ result: res(8, { touchCount: 9, isNew: true }), history: flat(8), nowMs: NOW }).status, 'new');
check('...but a new one that crashed still reads slipping',
  reviewContact({ result: res(40, { isNew: true }), history: [80, 40], nowMs: NOW }).status, 'slipping');

// --- next step --------------------------------------------------------------
check('a one-way slide asks for a call',
  /call or meeting rather than/.test(reviewContact({ result: res(50, { components: { reciprocity: 20 } }), history: [80, 50], nowMs: NOW }).nextStep), true);
check('overdue names the rhythm',
  reviewContact({ result: res(40, { daysSinceTwoWay: 50 }), history: flat(40), touches: [call(140), call(110), call(80), call(50)], nowMs: NOW }).nextStep,
  'Usually every 30 days; it has been 50. Check in now.');
check('steady has no next step', reviewContact({ result: res(30), history: flat(30), nowMs: NOW }).nextStep, '');

// --- counts and priority ----------------------------------------------------
check('counts in status order', reviewCounts([{ status: 'steady' }, { status: 'slipping' }, { status: 'slipping' }]).map(s => [s.key, s.count]),
  REVIEW_STATUSES.map(s => [s.key, s.key === 'slipping' ? 2 : s.key === 'steady' ? 1 : 0]));
{
  const slipBig = { status: 'slipping', offPeak: 40, peak: 85 };
  const slipSmall = { status: 'slipping', offPeak: 16, peak: 60 };
  const over = { status: 'overdue', overdueRatio: 5 };
  check('slipping outranks overdue', reviewPriority(slipSmall, res(44)) < reviewPriority(over, res(90)), true);
  check('the bigger fall comes first', reviewPriority(slipBig, res(45)) < reviewPriority(slipSmall, res(44)), true);
}

// --- accounts ---------------------------------------------------------------
{
  const pat = { id: '1', firstname: 'Pat', lastname: 'Lee', dans_tags: 'Decision Maker' };
  const sam = { id: '2', firstname: 'Sam', lastname: 'Roe', dans_tags: 'Procurement' };
  const member = (contact, history, touches, extra = {}) => {
    const result = res(history[history.length - 1], extra);
    return { contact, result, history, touches, review: reviewContact({ result, history, touches, nowMs: NOW }) };
  };
  // Pat fell from 85 to 50; Sam steady at 30.
  const m1 = member(pat, [...flat(85, 20), 70, 60, 50], [call(200), call(100)]);
  const m2 = member(sam, flat(30, 23), [call(100), call(30)]);
  const account = scoreAccount([m1, m2]);
  const r = reviewAccount({ account, members: [m1, m2], nowMs: NOW });
  check('account history is the account score on each date', r.peak, scoreAccount([{ contact: pat, result: { score: 85 } }, { contact: sam, result: { score: 30 } }]).score);
  check('an account that fell off its peak is slipping', r.status, 'slipping');
  check('the driver is the contact who fell', r.driver, pat);
  check('the next step names them', /^Pat Lee has dropped 35 points/.test(r.nextStep), true);
  check('touches are shared across the account once each', twoWayRhythm([call(200), call(100), call(30)], NOW).usualGapDays, reviewAccount({ account, members: [m1, m2], nowMs: NOW }).usualGapDays);

  const solo = member(pat, [...flat(85, 20), 50], [call(10)]);
  check('a one-contact slide asks for a second contact', /only contact/.test(reviewAccount({ account: scoreAccount([solo]), members: [solo], nowMs: NOW }).nextStep), true);

  const strong = member(pat, flat(80, 23), [call(20), call(5)]);
  const narrow = reviewAccount({ account: scoreAccount([strong]), members: [strong], nowMs: NOW });
  check('strong but narrow: at their best, asks to widen', [narrow.status, /buying roles/.test(narrow.nextStep)], ['at-best', true]);
  check('no members, no review', reviewAccount({ account: null, members: [] }), null);
}

console.log(`${failed ? 'FAIL' : 'PASS'} relationshipReview: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
