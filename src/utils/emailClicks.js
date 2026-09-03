// Clicks that a person made, and the screening that produced the rest.
//
// Every click on a tracked link is a hit on our redirector, and not all of
// them are people. Enterprise mail systems — Mimecast, Proofpoint, Microsoft
// Defender's Safe Links, Barracuda — fetch every URL in an incoming message to
// check it for malware before the recipient ever sees it. Each of those fetches
// looks exactly like a click.
//
// The tracking pixel already had this problem and already solved it: the same
// scanner user-agents are excluded from the image-load count (emailOpens.js,
// MACHINE_UA). Clicks were never put through it, so the count that the page
// called its "hard signal" was the one metric with no filtering on it at all.
// Same evidence, same list, applied here.
//
// The screening is also worth surfacing rather than silently dropping. A
// machine click is close to proof that the recipient's organisation runs a
// security gateway — nothing else follows a tracking redirect for fun — and
// that tells you something practical: their gateway rewrites and pre-fetches
// links and often blocks images, so LOW numbers on that row mean less than they
// would elsewhere. It also means the mail definitely arrived: a scanner can
// only scan what it received.

import { isMachineOpen, trackingMillis } from './emailOpens.js';

// The gateways worth naming when we can. Matched against the user-agent of an
// excluded event, so the row can say "Screened (Mimecast)" rather than leaving
// the reader to wonder what dropped their click.
const SCANNERS = [
  [/Mimecast/i, 'Mimecast'],
  [/Proofpoint/i, 'Proofpoint'],
  [/SafeLinks|ATPImageProxy/i, 'Microsoft Defender'],
  [/Barracuda/i, 'Barracuda'],
  [/IronPort/i, 'Cisco IronPort'],
  [/MessageLabs|Symantec/i, 'Symantec'],
  [/Forcepoint/i, 'Forcepoint'],
  [/FireEye/i, 'FireEye'],
  [/Trend ?Micro/i, 'Trend Micro'],
];

/** The gateway behind a user-agent, or '' when it isn't one we can name. */
export function scannerName(ua) {
  const s = String(ua || '');
  for (const [re, label] of SCANNERS) if (re.test(s)) return label;
  return '';
}

// A click nothing human made. Same test as the pixel uses — including the
// no-user-agent case, since a real browser always sends one.
export const isMachineClick = isMachineOpen;

/**
 * Count the clicks on one tracking doc that a person plausibly made.
 *
 * Deliberately NOT deduped the way image loads are. Two loads from one client
 * inside five minutes are one read re-rendered; two clicks are two decisions,
 * even on the same link, and collapsing them would hide a recipient going back
 * to something.
 *
 * @param row an emailTracking doc: { clickCount, clicks: [{ at, ua, url }] }
 * @returns { count, raw, machine, unclassified, firstClickAt, lastClickAt,
 *            events: [{ event, verdict: 'counted' | 'machine' }] }
 */
export function countClicks(row) {
  const raw = Number(row?.clickCount) || 0;
  const events = Array.isArray(row?.clicks) ? row.clicks : [];

  // No event detail to work from (a doc predating stored events, or a counter
  // that ran ahead). Report the raw count rather than inventing a smaller one.
  if (!events.length) {
    return {
      count: raw, raw, machine: 0, unclassified: raw,
      firstClickAt: 0, lastClickAt: trackingMillis(row?.lastClickAt), events: [],
    };
  }

  // The stored event array is capped (tracking.js MAX_EVENTS) while the counter
  // stays exact, so a heavily-clicked send has hits we can no longer inspect.
  // Carry them as real rather than pretending they didn't happen.
  const unclassified = Math.max(0, raw - events.length);

  let count = 0;
  let machine = 0;
  let firstClickAt = 0;
  let lastClickAt = 0;
  const classified = events.map((event) => {
    if (isMachineClick(event)) {
      machine += 1;
      return { event, verdict: 'machine' };
    }
    count += 1;
    const at = trackingMillis(event?.at);
    if (at && (!firstClickAt || at < firstClickAt)) firstClickAt = at;
    if (at > lastClickAt) lastClickAt = at;
    return { event, verdict: 'counted' };
  });

  return {
    count: count + unclassified,
    raw,
    machine,
    unclassified,
    firstClickAt,
    lastClickAt,
    events: classified,
  };
}

/**
 * One-line explanation of what countClicks() dropped, for a tooltip.
 * `scanner` is the gateway name when screeningEvidence could identify one.
 */
export function describeExcludedClicks(summary, scanner = '') {
  if (!summary?.machine) return '';
  const n = summary.machine;
  const vendor = scanner ? ` (${scanner})` : '';
  return `${n} of ${summary.raw} click${summary.raw === 1 ? '' : 's'} not counted: a security scanner${vendor} followed the links before the recipient saw them.`;
}

/**
 * Is this recipient's mail being screened, and by whom?
 *
 * A machine CLICK is the strong evidence: a gateway following a tracking
 * redirect is the only ordinary reason for one. A machine open is weaker — a
 * generic crawler can trip the same filter — so it only counts here when the
 * user-agent names a gateway we recognise.
 *
 * @param clickSummary a countClicks() result
 * @param openSummary  a countOpens() result (its events carry verdicts)
 * @returns { screened, scanner } — scanner is '' when we can't name it
 */
export function screeningEvidence(clickSummary, openSummary) {
  let scanner = '';
  let screened = false;

  for (const { event, verdict } of clickSummary?.events || []) {
    if (verdict !== 'machine') continue;
    screened = true;
    scanner = scanner || scannerName(event?.ua);
  }
  for (const { event, verdict } of openSummary?.events || []) {
    if (verdict !== 'machine') continue;
    const named = scannerName(event?.ua);
    if (!named) continue;
    screened = true;
    scanner = scanner || named;
  }
  return { screened, scanner };
}
