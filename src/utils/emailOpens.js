// Turning raw tracking-pixel hits into an open count that means something.
//
// api/track-open.js logs EVERY fetch of the pixel. That is the right
// behaviour for a log and the wrong number to put on screen, because three
// kinds of hit are not "the recipient read your email":
//
//   1. Pre-send loads. The pixel is baked into the Outlook DRAFT (see
//      api/outlook-draft.js), so it fires while the draft is still sitting
//      in Drafts — the user scrolling past it in the preview pane, opening
//      it to proof-read, or Outlook rendering it on the way to Send. This
//      is why campaign rows still marked "Not Sent" show opens.
//   2. Machine fetches. Link scanners, security gateways and preview bots
//      pull the pixel with no human involved.
//   3. Re-renders of the same view. The pixel is deliberately served
//      no-store (a cached pixel would undercount genuine re-opens), so
//      scrolling back to a message re-fetches it seconds later.
//
// countOpens() replays the `opens[]` events already stored on each tracking
// doc and drops those three, so docs written before this existed get the
// corrected number without a backfill. The raw count is kept alongside so
// the UI can show what was excluded rather than silently shrinking a number
// the user was watching.
//
// Deliberately NOT excluded: mail-client image proxies (Gmail's
// GoogleImageProxy, Yahoo's). Those fetch because a human opened the
// message — the `proxied` flag on an event means "we can't trust the geo",
// not "this wasn't a real open". Apple Mail Privacy Protection genuinely
// does pre-fetch without a human, but it fetches through a relay with an
// ordinary Safari user-agent; there is no honest way to tell it apart from
// a real Mac open, so it stays counted and stays called out in the UI copy.

// Two hits from the same client inside this window count once.
export const OPEN_DEDUPE_MS = 5 * 60 * 1000;

// Tolerance on the send timestamp before an open is called pre-send. The
// send time comes from HubSpot and the open time from our own server, so
// they are minutes-accurate at best; only opens clearly before the send are
// discarded.
export const SEND_CLOCK_GRACE_MS = 2 * 60 * 1000;

// User-agents that fetch a pixel without a human reading anything: security
// scanners, link-preview bots and bare HTTP clients.
const MACHINE_UA = /(bot\b|crawler|spider|curl\/|wget|python-requests|Go-http-client|Java\/|okhttp|libwww|HeadlessChrome|PhantomJS|Microsoft Office Existence Discovery|Microsoft-WebDAV|SkypeUriPreview|BingPreview|Slackbot|Twitterbot|facebookexternalhit|WhatsApp|Barracuda|Proofpoint|Mimecast|MessageLabs|Symantec|Forcepoint|IronPort|Trend ?Micro|FireEye|SafeLinks|ATPImageProxy)/i;

// Normalize any of the timestamp shapes that reach the client: a Firestore
// Timestamp from the realtime listener, the { _seconds } form api/track-list
// serializes to, or a plain date/ISO string.
export function trackingMillis(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// A fetch with no user-agent at all is not a mail client either.
export function isMachineOpen(event) {
  const ua = String(event?.ua || '').trim();
  if (!ua) return true;
  return MACHINE_UA.test(ua);
}

// Same client, for the purpose of collapsing a burst of re-renders.
function fingerprint(event) {
  return `${event?.ip || ''}|${event?.ua || ''}`;
}

/**
 * Count the opens on one tracking doc that plausibly represent a human
 * reading the email.
 *
 * @param row      an emailTracking doc: { openCount, opens: [{ at, ip, ua }] }
 * @param sentAt   when the email actually went out. Three meanings, and the
 *                 difference matters:
 *                   • omitted/undefined — send time unknown, don't apply the
 *                     pre-send rule at all (the tracking dashboard: a doc
 *                     only knows when its DRAFT was made).
 *                   • null/'' /0        — known not to have been sent, so
 *                     every hit is a pre-send preview.
 *                   • a timestamp       — gate on it.
 *
 * @returns { count, raw, preSend, machine, repeat, unclassified,
 *            firstOpenAt, lastOpenAt, events }
 *          where events mirrors the input order with a verdict on each:
 *          'counted' | 'pre-send' | 'machine' | 'repeat'.
 */
export function countOpens(row, options = {}) {
  const raw = Number(row?.openCount) || 0;
  const events = Array.isArray(row?.opens) ? row.opens : [];
  const gated = Object.prototype.hasOwnProperty.call(options, 'sentAt');
  const sentAtMs = gated ? trackingMillis(options.sentAt) : 0;
  const cutoff = sentAtMs ? sentAtMs - SEND_CLOCK_GRACE_MS : 0;

  // No event detail to work from (a doc from before events were stored, or
  // one whose openCount somehow ran ahead). Report the raw count rather than
  // inventing a smaller one, and say it wasn't classified.
  if (!events.length) {
    return {
      count: raw, raw, preSend: 0, machine: 0, repeat: 0, unclassified: raw,
      firstOpenAt: trackingMillis(row?.firstOpenAt),
      lastOpenAt: trackingMillis(row?.lastOpenAt),
      events: [],
    };
  }

  // The event array is capped (tracking.js MAX_EVENTS), so a doc hammered
  // past the cap has hits we can no longer inspect. Carry them as
  // unclassified instead of pretending they didn't happen.
  const unclassified = Math.max(0, raw - events.length);

  const order = events.map((ev, i) => ({ ev, i, at: trackingMillis(ev?.at) }));
  const chronological = [...order].sort((a, b) => a.at - b.at || a.i - b.i);

  const verdicts = new Array(events.length).fill('counted');
  const lastSeen = new Map();
  let count = 0, preSend = 0, machine = 0, repeat = 0;
  let firstOpenAt = 0, lastOpenAt = 0;

  for (const { ev, i, at } of chronological) {
    if (gated && (!sentAtMs || (at && at < cutoff))) {
      verdicts[i] = 'pre-send';
      preSend += 1;
      continue;
    }
    if (isMachineOpen(ev)) {
      verdicts[i] = 'machine';
      machine += 1;
      continue;
    }
    const key = fingerprint(ev);
    const previous = lastSeen.get(key);
    // The window slides off the last hit from this client, counted or not,
    // so a client re-fetching every few minutes collapses to one open rather
    // than one per window.
    lastSeen.set(key, at);
    if (previous != null && at && at - previous < OPEN_DEDUPE_MS) {
      verdicts[i] = 'repeat';
      repeat += 1;
      continue;
    }
    count += 1;
    if (!firstOpenAt || (at && at < firstOpenAt)) firstOpenAt = at;
    if (at > lastOpenAt) lastOpenAt = at;
  }

  return {
    count: count + unclassified,
    raw,
    preSend,
    machine,
    repeat,
    unclassified,
    firstOpenAt,
    lastOpenAt,
    events: order.map(({ ev, i }) => ({ event: ev, verdict: verdicts[i] })),
  };
}

/**
 * One-line explanation of what countOpens() threw away, for a tooltip.
 * Returns '' when nothing was excluded. Takes either a countOpens() summary
 * or the per-recipient roll-up trackingByRecipient() builds from several of
 * them — it reads only the fields those two shapes share.
 */
export function describeExcludedOpens(summary) {
  if (!summary) return '';
  const parts = [];
  if (summary.preSend) parts.push(`${summary.preSend} before the send (draft preview)`);
  if (summary.machine) parts.push(`${summary.machine} automated fetch${summary.machine === 1 ? '' : 'es'}`);
  if (summary.repeat) parts.push(`${summary.repeat} repeat load${summary.repeat === 1 ? '' : 's'} within 5 minutes`);
  if (!parts.length) return '';
  const total = summary.preSend + summary.machine + summary.repeat;
  return `${total} of ${summary.raw} pixel hit${summary.raw === 1 ? '' : 's'} not counted: ${parts.join(', ')}.`;
}
