// Where each relationship stands against its own history.
//
// The score says how strong a relationship is today. This says what that
// number means for this person: a 45 is a problem for somebody who sat at
// 80 in the spring, and good news for somebody who has never been above
// 20. So every contact is read against two things from their own record:
//
//   their peak       the highest their score has been over the last year
//                    (scoreHistory's fortnightly points)
//   their rhythm     the usual gap between two-way touches with them (the
//                    median, over everything on record), against how long
//                    it has been since the last one
//
// and lands in one status, the first that fits, in priority order:
//
//   slipping        was Warm or better and has fallen well off that peak
//   overdue         a regular rhythm, and the current silence is well past it
//   never-developed plenty of outreach in the year, and it has never landed
//   at-best         Warm or better and at (or near) their peak
//   rebuilding      climbing back: up clearly over 90 days, not there yet
//   steady          none of the above
//
// Pure, like utils/relationshipStrength, so
// scripts/relationshipReview.test.mjs pins the rules. Every threshold is
// in REVIEW_CONFIG.

import { DAY_MS, isTwoWay, scoreAccount, contactName, RELATIONSHIP_CONFIG } from './relationshipStrength.js';

export const REVIEW_CONFIG = Object.freeze({
  // Slipping: points off the peak, and how high the peak had to be.
  slipDrop: 15,
  slipPeakMin: 50,
  // Overdue: silence over the usual gap, needing this many gaps to know
  // what usual is, and at least this many days of silence (a weekly
  // rhythm a week and a half late is not news).
  overdueRatio: 1.5,
  overdueMinGaps: 3,
  overdueMinDays: 21,
  // Never developed: touches in the last 12 months, and a peak under this.
  neverMinTouches: 5,
  neverPeakMax: 25,
  // Rebuilding: points gained over 90 days.
  rebuildGain: 10,
  // At their best: within this many points of the peak, and Warm or better.
  atBestWithin: 5,
  atBestMin: 50,
});

export const REVIEW_STATUSES = [
  { key: 'slipping', label: 'Slipping', order: 0, color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74',
    tip: 'Was Warm or better in the last year and has fallen well off that peak' },
  { key: 'overdue', label: 'Overdue', order: 1, color: '#92400E', bg: '#FEF3C7', border: '#FCD34D',
    tip: 'Usually hear from them on a regular rhythm, and this silence is well past it' },
  { key: 'never-developed', label: 'Never developed', order: 2, color: '#475569', bg: '#F1F5F9', border: '#CBD5E1',
    tip: 'Plenty of outreach in the last year, and it has never turned two-way' },
  { key: 'rebuilding', label: 'Rebuilding', order: 3, color: '#1E40AF', bg: '#DBEAFE', border: '#93C5FD',
    tip: 'Climbing back: up clearly over the last 90 days' },
  { key: 'at-best', label: 'At their best', order: 4, color: '#166534', bg: '#DCFCE7', border: '#86EFAC',
    tip: 'Warm or better and at or near the highest it has been this year' },
  { key: 'steady', label: 'Steady', order: 5, color: '#475569', bg: '#FFFFFF', border: '#E2E8F0',
    tip: 'No sharp change against their own history' },
];
const STATUS_BY_KEY = Object.fromEntries(REVIEW_STATUSES.map(s => [s.key, s]));
export const reviewStatus = (key) => STATUS_BY_KEY[key] || STATUS_BY_KEY.steady;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The usual gap, in days, between two-way touches with someone, from
 * everything on record up to nowMs. Touches on the same day count once.
 * Returns { usualGapDays, gaps } (usualGapDays null with fewer than 2).
 */
export function twoWayRhythm(touches, nowMs) {
  const days = [...new Set((touches || [])
    .filter(t => t.ms <= nowMs && isTwoWay(t, nowMs))
    .map(t => Math.floor(t.ms / DAY_MS)))].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < days.length; i += 1) gaps.push(days[i] - days[i - 1]);
  return { usualGapDays: gaps.length ? Math.round(median(gaps)) : null, gaps: gaps.length };
}

/**
 * One contact's review.
 *
 *   result   scoreContact's result for today
 *   history  [score, ...] oldest first, ending today (scoreHistory's scores)
 *   touches  the contact's touches (for the rhythm)
 *   stepDays the spacing of the history points
 *
 * Returns { status, peak, peakAgoDays, offPeak, change90, usualGapDays,
 * overdueRatio, nextStep }.
 */
export function reviewContact({ result, history = [], touches = [], nowMs, stepDays = 14, config = REVIEW_CONFIG }) {
  const now = result?.score ?? 0;
  const peak = Math.max(now, ...history);
  // The most recent point at the peak, so a score that sat flat at its
  // high reads as peaking lately, not months ago.
  const peakIdx = history.lastIndexOf(peak);
  const peakAgoDays = peakIdx >= 0 ? (history.length - 1 - peakIdx) * stepDays : 0;
  const offPeak = peak - now;
  const back90 = history.length ? history[Math.max(0, history.length - 1 - Math.round(90 / stepDays))] : now;
  const change90 = now - back90;

  const { usualGapDays, gaps } = twoWayRhythm(touches, nowMs);
  const since = result?.daysSinceTwoWay;
  const overdueRatio = usualGapDays && since != null ? since / Math.max(1, usualGapDays) : null;

  let status = 'steady';
  if (peak >= config.slipPeakMin && offPeak >= config.slipDrop) status = 'slipping';
  else if (gaps >= config.overdueMinGaps && overdueRatio != null && overdueRatio >= config.overdueRatio && since >= config.overdueMinDays) status = 'overdue';
  else if ((result?.touchCount || 0) >= config.neverMinTouches && peak < config.neverPeakMax) status = 'never-developed';
  // At-best before rebuilding: a climb that has reached the peak is there.
  else if (now >= config.atBestMin && offPeak <= config.atBestWithin) status = 'at-best';
  else if (change90 >= config.rebuildGain && result?.trend !== 'down') status = 'rebuilding';

  return {
    status, peak, peakAgoDays, offPeak, change90, usualGapDays, overdueRatio,
    nextStep: nextStepFor(status, { result, usualGapDays, since }),
  };
}

function nextStepFor(status, { result, usualGapDays, since }) {
  switch (status) {
    case 'slipping':
      return result?.components?.reciprocity < 40
        ? 'Outreach is going one way. Ask for a call or meeting rather than another email.'
        : 'Book a call or meeting to get back to where it was.';
    case 'overdue':
      return `Usually every ${usualGapDays} days; it has been ${since}. Check in now.`;
    case 'never-developed':
      return 'Outreach has not landed. Try a different channel, a warm intro, or another contact at the account.';
    case 'rebuilding':
      return 'Momentum is back. Keep the cadence and look for a next step.';
    case 'at-best':
      return 'Strong right now. Use it: ask for an intro or move an opportunity forward.';
    default:
      return '';
  }
}

// --- accounts --------------------------------------------------------------
//
// The same review, one level up. An account's history is its account score
// (best contact plus breadth, scoreAccount) on each of the same dates, and
// its rhythm is the two-way touches with anyone there. The statuses and
// their thresholds are the contacts' ones; only the next step changes, to
// name who it hangs on.

/**
 *   account  scoreAccount's result for today
 *   members  [{ contact, result, history, touches, review }] - the
 *            account's contacts, each with their own contact review
 *
 * Returns reviewContact's shape plus `driver`, the contact the status
 * hangs on (the one who fell furthest when slipping, else the best).
 */
export function reviewAccount({ account, members = [], nowMs, stepDays = 14, config = REVIEW_CONFIG }) {
  if (!account || !members.length) return null;
  const points = Math.max(0, ...members.map(m => m.history?.length || 0));
  const history = [];
  for (let i = 0; i < points; i += 1) {
    const at = members
      .filter(m => m.history?.length === points)
      .map(m => ({ contact: m.contact, result: { score: m.history[i] } }));
    history.push(scoreAccount(at)?.score ?? 0);
  }
  const seen = new Set();
  const touches = [];
  for (const m of members) {
    for (const t of (m.touches || [])) {
      if (t.id && seen.has(t.id)) continue;
      if (t.id) seen.add(t.id);
      touches.push(t);
    }
  }
  touches.sort((a, b) => a.ms - b.ms);
  const best = members.find(m => m.contact === account.best) || members[0];
  const result = {
    ...account,
    touchCount: members.reduce((n, m) => n + (m.result?.touchCount || 0), 0),
    components: { reciprocity: best.result?.components?.reciprocity ?? 0 },
  };
  const review = reviewContact({ result, history, touches, nowMs, stepDays, config });
  const fell = [...members].sort((a, b) => (b.review?.offPeak || 0) - (a.review?.offPeak || 0))[0];
  const driver = review.status === 'slipping' && fell?.review?.offPeak > 0 ? fell : best;
  return { ...review, driver: driver.contact, nextStep: accountNextStep(review, { account, driver, members, since: account.daysSinceTwoWay }) };
}

function accountNextStep(review, { account, driver, members, since }) {
  const who = contactName(driver.contact) || driver.contact?.email || 'your best contact';
  const roleCount = RELATIONSHIP_CONFIG.breadth.roles.length;
  switch (review.status) {
    case 'slipping':
      return members.length > 1
        ? `${who} has dropped ${driver.review?.offPeak ?? review.offPeak} points. Get back in touch, or go through someone else engaged there.`
        : `${who} has dropped ${review.offPeak} points and is the only contact. Re-engage them and add a second contact.`;
    case 'overdue':
      return `Usually every ${review.usualGapDays} days with someone there; it has been ${since}. Check in with ${who}.`;
    case 'never-developed':
      return `Outreach to ${members.length} contact${members.length === 1 ? '' : 's'} has not landed. Try a warm intro or a different buyer.`;
    case 'rebuilding':
      return `Momentum is back through ${who}. Keep the cadence and bring in another contact.`;
    case 'at-best':
      return account.rolesCovered.length < 3
        ? `Strong through ${who}, but only ${account.rolesCovered.length} of ${roleCount} buying roles. Ask for an intro while it is warm.`
        : 'Strong and broad. Move an opportunity forward.';
    default:
      return '';
  }
}

/** Counts per status, in REVIEW_STATUSES order: [{ ...status, count }]. */
export function reviewCounts(reviews) {
  const counts = Object.fromEntries(REVIEW_STATUSES.map(s => [s.key, 0]));
  for (const r of reviews || []) counts[r.status] = (counts[r.status] || 0) + 1;
  return REVIEW_STATUSES.map(s => ({ ...s, count: counts[s.key] }));
}

/**
 * Sort key for the review list: status order first, then within it the
 * ones most worth attention (the furthest fallen, the most overdue, the
 * most outreach, the biggest climb, the strongest).
 */
export function reviewPriority(review, result) {
  const s = reviewStatus(review.status);
  const within = {
    slipping: review.offPeak * 2 + review.peak,
    overdue: (review.overdueRatio || 0) * 10 + (result?.score || 0),
    'never-developed': result?.touchCount || 0,
    rebuilding: review.change90,
    'at-best': result?.score || 0,
    steady: result?.score || 0,
  }[review.status] || 0;
  return s.order * 1e6 - within;
}
