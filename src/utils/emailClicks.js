// Clicks that a person made, and everything else that looks exactly like one.
//
// Every click on a tracked link is a hit on our redirector, and the raw count
// is not "somebody chose to follow your link". Four different things produce a
// hit, and only one of them is a person:
//
//   1. Pre-send clicks. The links are rewritten inside the Outlook DRAFT (see
//      api/outlook-draft.js), so following one while proof-reading the draft
//      logs a click against the recipient who hasn't been mailed yet. The
//      pixel had this exact problem and countOpens() has gated on the send
//      time since it was written; clicks never got the same gate, so the
//      column this page calls its hard signal was the one with no send gate
//      on it at all.
//   2. Scanners that say who they are. Mimecast, Proofpoint, Microsoft
//      Defender's Safe Links, Barracuda and the rest fetch every URL in an
//      incoming message to check it for malware. They announce themselves in
//      the user-agent, and the pixel has excluded them all along (emailOpens.js,
//      MACHINE_UA) — the same list is applied here.
//   3. Scanners that don't. Plenty of gateways present an ordinary browser
//      user-agent, and no user-agent test will ever catch those. What gives
//      them away is behaviour: a person clicks ONE link and reads the page,
//      while a scanner follows every link in the message within the same
//      second. Several distinct links from one client inside a minute is a
//      sweep, and it is scored as machine however the user-agent reads.
//   4. Real clicks.
//
// The fourth kind is the only one worth acting on, and the honest limit is
// worth stating in the code as well as the UI: a gateway with a browser
// user-agent that follows exactly ONE link is indistinguishable from a person,
// and nothing here will catch it. That is why the expanded row shows the
// device and timing of every click rather than only a total — the number
// cannot carry that judgement, and the reader can.
//
// Surfacing the screening matters as much as excluding it. A machine click is
// close to proof that the recipient's organisation runs a security gateway —
// nothing else follows a tracking redirect for fun — and that tells you
// something practical: their gateway rewrites and pre-fetches links and often
// blocks images, so LOW numbers on that row mean less than they would
// elsewhere. It also means the mail definitely arrived: a scanner can only
// scan what it received.

import { isMachineOpen, trackingMillis, SEND_CLOCK_GRACE_MS } from './emailOpens.js';

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

// How close together clicks have to be to read as one automated sweep rather
// than a person working through an email. Deliberately generous: a gateway
// fires its fetches in the same second, so a minute is far outside the shape
// it produces and comfortably inside the shape a reader does not.
export const CLICK_SWEEP_MS = 60 * 1000;

// Distinct destinations one client has to hit inside that window before it
// counts as a sweep. Two is the floor that means anything — a scanner checks
// every link, a person picks one — and it is why a single-link email can
// never produce this verdict. Said plainly in the UI rather than papered over.
export const SWEEP_MIN_LINKS = 2;

/** The gateway behind a user-agent, or '' when it isn't one we can name. */
export function scannerName(ua) {
  const s = String(ua || '');
  for (const [re, label] of SCANNERS) if (re.test(s)) return label;
  return '';
}

// A click nothing human made, judged on the user-agent alone. Same test as the
// pixel uses — including the no-user-agent case, since a real browser always
// sends one.
export const isMachineClick = isMachineOpen;

// Same client, for the purpose of spotting one machine sweeping a message.
function fingerprint(event) {
  return `${event?.ip || ''}|${event?.ua || ''}`;
}

/**
 * Count the clicks on one tracking doc that a person plausibly made.
 *
 * Deliberately NOT deduped the way image loads are. Two loads from one client
 * inside five minutes are one read re-rendered; two clicks are two decisions,
 * even on the same link, and collapsing them would hide a recipient going back
 * to something. A burst across SEVERAL links is the different case the sweep
 * rule catches, and that isn't deduping — it's a machine.
 *
 * @param row     an emailTracking doc: { clickCount, clicks: [{ at, ua, url }] }
 * @param options.sentAt when the email actually went out. Three meanings, the
 *                same three countOpens() uses, and the difference matters:
 *                  • omitted/undefined — send time unknown, don't apply the
 *                    pre-send rule at all.
 *                  • null/''/0        — known not to have been sent, so every
 *                    hit is a pre-send preview.
 *                  • a timestamp      — gate on it.
 * @returns { count, raw, preSend, machine, sweep, unclassified,
 *            firstClickAt, lastClickAt, events }
 *          where events mirrors the input order with a verdict on each:
 *          'counted' | 'pre-send' | 'machine' | 'sweep'.
 */
export function countClicks(row, options = {}) {
  const raw = Number(row?.clickCount) || 0;
  const events = Array.isArray(row?.clicks) ? row.clicks : [];
  const gated = Object.prototype.hasOwnProperty.call(options, 'sentAt');
  const sentAtMs = gated ? trackingMillis(options.sentAt) : 0;
  const cutoff = sentAtMs ? sentAtMs - SEND_CLOCK_GRACE_MS : 0;

  // No event detail to work from (a doc predating stored events, or a counter
  // that ran ahead). Report the raw count rather than inventing a smaller one.
  if (!events.length) {
    return {
      count: raw, raw, preSend: 0, machine: 0, sweep: 0, unclassified: raw,
      firstClickAt: 0, lastClickAt: trackingMillis(row?.lastClickAt), events: [],
    };
  }

  // The stored event array is capped (tracking.js MAX_EVENTS) while the counter
  // stays exact, so a heavily-clicked send has hits we can no longer inspect.
  // Carry them as real rather than pretending they didn't happen.
  const unclassified = Math.max(0, raw - events.length);

  const order = events.map((ev, i) => ({ ev, i, at: trackingMillis(ev?.at) }));
  const chronological = [...order].sort((a, b) => a.at - b.at || a.i - b.i);
  const verdicts = new Array(events.length).fill('counted');

  // Pass one: the two verdicts that can be read off a single event.
  for (const { ev, i, at } of chronological) {
    if (gated && (!sentAtMs || (at && at < cutoff))) {
      verdicts[i] = 'pre-send';
      continue;
    }
    if (isMachineClick(ev)) verdicts[i] = 'machine';
  }

  // Pass two: the verdict that only exists in the relationship between events.
  // Group what survived by client, walk each client's clicks in order, and cut
  // a new cluster whenever the gap from the cluster's first click exceeds the
  // window. A cluster covering several distinct URLs is a gateway working
  // through the message, not a person choosing between links.
  // Events with no usable timestamp are left out of this entirely: proximity
  // is the only evidence a sweep has, and two clicks we can't place in time
  // are not close together — they're unknown.
  const byClient = new Map();
  for (const { ev, i, at } of chronological) {
    if (verdicts[i] !== 'counted' || !at) continue;
    const key = fingerprint(ev);
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push({ ev, i, at });
  }
  for (const hits of byClient.values()) {
    let cluster = [];
    const flush = () => {
      const urls = new Set(cluster.map(h => String(h.ev?.url || '')));
      if (cluster.length >= SWEEP_MIN_LINKS && urls.size >= SWEEP_MIN_LINKS) {
        for (const h of cluster) verdicts[h.i] = 'sweep';
      }
      cluster = [];
    };
    for (const hit of hits) {
      if (cluster.length && hit.at - cluster[0].at > CLICK_SWEEP_MS) flush();
      cluster.push(hit);
    }
    flush();
  }

  let count = 0, preSend = 0, machine = 0, sweep = 0;
  let firstClickAt = 0, lastClickAt = 0;
  for (const { i, at } of chronological) {
    const verdict = verdicts[i];
    if (verdict === 'pre-send') { preSend += 1; continue; }
    if (verdict === 'machine') { machine += 1; continue; }
    if (verdict === 'sweep') { sweep += 1; continue; }
    count += 1;
    if (at && (!firstClickAt || at < firstClickAt)) firstClickAt = at;
    if (at > lastClickAt) lastClickAt = at;
  }

  return {
    count: count + unclassified,
    raw,
    preSend,
    machine,
    sweep,
    unclassified,
    firstClickAt,
    lastClickAt,
    events: order.map(({ ev, i }) => ({ event: ev, verdict: verdicts[i] })),
  };
}

/**
 * One-line explanation of what countClicks() dropped, for a tooltip.
 * `scanner` is the gateway name when screeningEvidence could identify one.
 * Returns '' when nothing was excluded.
 */
export function describeExcludedClicks(summary, scanner = '') {
  if (!summary) return '';
  const vendor = scanner ? ` (${scanner})` : '';
  const parts = [];
  if (summary.preSend) parts.push(`${summary.preSend} before the send (you following the link while proof-reading the draft)`);
  if (summary.machine) parts.push(`${summary.machine} followed by a security scanner${vendor}`);
  if (summary.sweep) parts.push(`${summary.sweep} in an automated sweep — one client following several links at once`);
  if (!parts.length) return '';
  const total = summary.preSend + summary.machine + summary.sweep;
  return `${total} of ${summary.raw} click${summary.raw === 1 ? '' : 's'} not counted: ${parts.join(', ')}.`;
}

/**
 * Is this recipient's mail being screened, and by whom?
 *
 * A machine CLICK is the strong evidence: a gateway following a tracking
 * redirect is the only ordinary reason for one. A sweep counts the same way —
 * it is the same behaviour caught by shape instead of by name, which is the
 * whole point of having it. A machine open is weaker — a generic crawler can
 * trip the same filter — so it only counts here when the user-agent names a
 * gateway we recognise.
 *
 * @param clickSummary a countClicks() result
 * @param openSummary  a countOpens() result (its events carry verdicts)
 * @returns { screened, scanner } — scanner is '' when we can't name it
 */
export function screeningEvidence(clickSummary, openSummary) {
  let scanner = '';
  let screened = false;

  for (const { event, verdict } of clickSummary?.events || []) {
    if (verdict !== 'machine' && verdict !== 'sweep') continue;
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
