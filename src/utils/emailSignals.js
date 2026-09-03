// Reading more out of the image-load events than "how many".
//
// A single load is the weakest thing on the tracking page: Apple Mail Privacy
// Protection fetches the pixel when the message is DELIVERED, before anybody
// has seen it, and it does so through a relay carrying an ordinary Safari
// user-agent — there is no honest way to tell that apart from a real Mac read.
// So one load, shortly after the send, may be nothing at all. It is why the
// metric is called an image load and not an open.
//
// What a privacy pre-fetch does NOT do is come back three days later, from a
// second device, in a different city. The shape of the loads carries signal the
// count throws away:
//
//   • loads on several distinct days — somebody kept coming back
//   • loads from several cities on different devices — the message was
//     probably forwarded inside the company, which is a buying-committee tell
//   • a first load minutes after the send — it went to the top of the inbox
//
// None of these is proof. They are labelled as inferences ("Maybe forwarded"),
// and each carries the reasoning in its tooltip, because a seller acting on
// "forwarded to 3 people" that turns out to be a VPN has been misled by us.
//
// Everything here reads the events countOpens() already classified, and only
// the ones it COUNTED: a machine fetch or a pre-send draft preview must not
// contribute a day, a city or a device.

import { trackingMillis } from './emailOpens.js';
import { screeningEvidence } from './emailClicks.js';

// A first load this soon after the send is worth calling out — the message was
// most likely opened off the top of the inbox rather than dug out later.
export const FAST_OPEN_MS = 60 * 60 * 1000;

// Coarse device family from a user-agent, used to decide whether two opens
// came from different machines. Deliberately coarser than the display label:
// what matters is "phone AND laptop", not which model.
export function deviceFamily(ua) {
  const s = String(ua || '');
  if (!s) return '';
  if (/GoogleImageProxy|YahooMailProxy|via ggpht/i.test(s)) return 'proxy';
  if (/iPhone|iPod/i.test(s)) return 'iphone';
  if (/iPad/i.test(s)) return 'ipad';
  if (/Android/i.test(s)) return 'android';
  if (/Macintosh|Mac OS/i.test(s)) return 'mac';
  if (/Windows/i.test(s)) return 'windows';
  if (/Linux/i.test(s)) return 'linux';
  return 'other';
}

// The opens countOpens() actually counted, in chronological order. Everything
// below reads this and nothing else.
function countedEvents(openSummary) {
  const events = Array.isArray(openSummary?.events) ? openSummary.events : [];
  return events
    .filter(e => e?.verdict === 'counted')
    .map(e => e.event)
    .filter(Boolean)
    .sort((a, b) => trackingMillis(a?.at) - trackingMillis(b?.at));
}

// Local calendar day of a timestamp, as a comparable string. Local rather than
// UTC on purpose: "opened on two days" should mean what the user would say
// looking at the timeline, not what an offset says at 11pm.
function dayKey(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// A location string for grouping. Empty when the event has no geo at all, and
// deliberately empty for proxied fetches: the city on a Gmail-proxied open is
// Google's, so treating it as a place the reader was would invent a second
// location for every Gmail recipient.
function placeKey(ev) {
  if (!ev || ev.proxied) return '';
  const parts = [ev.city, ev.region, ev.country].filter(Boolean);
  return parts.join(', ').toLowerCase();
}

/**
 * The shape of one send's engagement, derived from its counted opens.
 *
 * @param openSummary a countOpens() result (needs its classified `events`)
 * @param options.sentAt when the email went out, if known — enables the
 *                       time-to-first-open signal
 * @returns { days, places, devices, firstOpenAt, msToFirstOpen }
 */
export function openShape(openSummary, { sentAt } = {}) {
  const events = countedEvents(openSummary);
  const days = new Set();
  const places = new Set();
  const devices = new Set();
  for (const ev of events) {
    const ms = trackingMillis(ev?.at);
    if (ms) days.add(dayKey(ms));
    const place = placeKey(ev);
    if (place) places.add(place);
    const device = deviceFamily(ev?.ua);
    // A proxy fetch tells us nothing about the reader's machine.
    if (device && device !== 'proxy') devices.add(device);
  }
  const firstOpenAt = events.length ? trackingMillis(events[0]?.at) : 0;
  const sentMs = trackingMillis(sentAt);
  const msToFirstOpen = (sentMs && firstOpenAt && firstOpenAt > sentMs)
    ? firstOpenAt - sentMs
    : null;
  return {
    days: days.size,
    places: places.size,
    devices: devices.size,
    firstOpenAt,
    msToFirstOpen,
  };
}

// "12m", "3h", "2d" — a duration at one significant unit, for a chip.
export function shortDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

/**
 * Short labelled signals for one send, strongest first.
 *
 * @returns [{ key, label, title }] — at most a handful, often none. An
 *          ordinary single-open send has nothing to say and gets an empty
 *          list rather than a chip saying so.
 */
export function engagementSignals(openSummary, { sentAt, clickSummary } = {}) {
  const shape = openShape(openSummary, { sentAt });
  const out = [];

  // Several cities AND several devices. Both, because either alone is
  // ordinary: one person on a laptop and a phone at their desk is two
  // devices in one city, and one device that moves is one person commuting.
  // Together they are more likely to be two people.
  if (shape.places > 1 && shape.devices > 1) {
    out.push({
      key: 'shared',
      label: 'Maybe forwarded',
      title: `The pixel loaded from ${shape.places} locations on ${shape.devices} kinds of device. That usually means the message was passed to someone else — but a VPN, travel, or a mail proxy can look the same, so treat it as a lead, not a fact.`,
    });
  }

  // Repeat reads across days. The most trustworthy thing an open count can
  // tell you: a privacy pre-fetch fires around delivery, not again on
  // Thursday.
  if (shape.days > 1) {
    out.push({
      key: 'repeat',
      label: `Loaded on ${shape.days} days`,
      title: 'The pixel loaded again on separate days. Harder to explain away as an automated pre-fetch than a single load is, since those fire around delivery rather than days later.',
    });
  }

  // Straight to the top of the inbox.
  if (shape.msToFirstOpen != null && shape.msToFirstOpen <= FAST_OPEN_MS) {
    out.push({
      key: 'fast',
      label: `Loaded in ${shortDuration(shape.msToFirstOpen)}`,
      title: 'The pixel first loaded within an hour of the send. Worth noting on its own, though an Apple Mail privacy pre-fetch also lands quickly — a fast load plus a click is the combination that means something.',
    });
  }

  // Context rather than engagement, so it comes last and is styled apart: this
  // recipient's mail system screens links. Worth saying out loud because it
  // changes how the rest of the row reads — a gateway that pre-fetches links
  // usually blocks images too, so low numbers here mean less than they would
  // elsewhere, and it explains any clicks that were dropped from the count.
  const screening = screeningEvidence(clickSummary, openSummary);
  if (screening.screened) {
    out.push({
      key: 'screened',
      label: screening.scanner ? `Screened (${screening.scanner})` : 'Screened',
      title: `A security gateway${screening.scanner ? ` — ${screening.scanner} —` : ''} fetched the links or the pixel before the recipient saw them, and those hits are excluded from the counts. Two things follow: the mail definitely arrived (a scanner can only scan what it received), and a gateway like this usually rewrites links and blocks images, so low numbers on this row say less than they would on another.`,
    });
  }

  return out;
}
