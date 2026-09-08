// Reading more out of the clicks than "how many".
//
// The count is the least of what a click carries. Every click event stores
// when it happened, the device that made it and where that device was, and
// those three turn one number into the difference between a scanner, the
// sender testing their own draft, and a prospect who came back on Thursday.
//
// What each shape is worth:
//
//   • clicks on several distinct days — somebody kept coming back, and nothing
//     automated does that: a gateway scans on arrival and never returns
//   • clicks from several cities on different devices — the message was
//     probably forwarded inside the company, which is a buying-committee tell
//   • a first click within the hour — it went to the top of the inbox and was
//     acted on, the strongest single-event shape there is
//   • a click on the booking page — they went to look at your calendar
//
// None of these is proof. They are labelled as inferences ("Maybe forwarded"),
// and each carries the reasoning in its tooltip, because a seller acting on
// "forwarded to 3 people" that turns out to be a VPN has been misled by us.
//
// The booking chip is the one that needs its limit stated out loud, because it
// is the one a reader will over-read. A click on a scheduling link means the
// recipient opened your availability. It does NOT mean they booked: the
// booking happens on the provider's site and reaches you as that provider's
// notification. The gap between the two is not a measurement error — it is a
// real and specific group of people, the ones who looked and didn't commit,
// and it is worth a follow-up precisely because they are not in your calendar.
//
// Everything here reads the events countClicks() already classified, and only
// the ones it COUNTED: a gateway sweep or a pre-send draft preview must not
// contribute a day, a city or a device.

import { trackingMillis } from './emailOpens.js';
import { screeningEvidence } from './emailClicks.js';
import { isSchedulingLink } from './emailLinks.js';

// A first click this soon after the send is worth calling out — the message
// was acted on off the top of the inbox rather than dug out later.
export const FAST_CLICK_MS = 60 * 60 * 1000;

// Coarse device family from a user-agent, used to decide whether two events
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

// The clicks countClicks() actually counted, in chronological order.
// Everything below reads this and nothing else.
function countedEvents(clickSummary) {
  const events = Array.isArray(clickSummary?.events) ? clickSummary.events : [];
  return events
    .filter(e => e?.verdict === 'counted')
    .map(e => e.event)
    .filter(Boolean)
    .sort((a, b) => trackingMillis(a?.at) - trackingMillis(b?.at));
}

// Local calendar day of a timestamp, as a comparable string. Local rather than
// UTC on purpose: "clicked on two days" should mean what the user would say
// looking at the timeline, not what an offset says at 11pm.
function dayKey(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// A location string for grouping. Empty when the event has no geo at all.
function placeKey(ev) {
  const parts = [ev?.city, ev?.region, ev?.country].filter(Boolean);
  return parts.join(', ').toLowerCase();
}

/**
 * The shape of one send's engagement, derived from its counted clicks.
 *
 * @param clickSummary a countClicks() result (needs its classified `events`)
 * @param options.sentAt when the email went out, if known — enables the
 *                       time-to-first-click signal
 * @returns { days, places, devices, booking, firstClickAt, msToFirstClick }
 */
export function clickShape(clickSummary, { sentAt } = {}) {
  const events = countedEvents(clickSummary);
  const days = new Set();
  const places = new Set();
  const devices = new Set();
  let booking = 0;
  for (const ev of events) {
    const ms = trackingMillis(ev?.at);
    if (ms) days.add(dayKey(ms));
    const place = placeKey(ev);
    if (place) places.add(place);
    const device = deviceFamily(ev?.ua);
    if (device && device !== 'proxy') devices.add(device);
    if (isSchedulingLink(ev?.url)) booking += 1;
  }
  const firstClickAt = events.length ? trackingMillis(events[0]?.at) : 0;
  const sentMs = trackingMillis(sentAt);
  const msToFirstClick = (sentMs && firstClickAt && firstClickAt > sentMs)
    ? firstClickAt - sentMs
    : null;
  return {
    days: days.size,
    places: places.size,
    devices: devices.size,
    booking,
    firstClickAt,
    msToFirstClick,
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
 *          ordinary single-click send has nothing to say and gets an empty
 *          list rather than a chip saying so.
 */
export function clickSignals(clickSummary, { sentAt, openSummary } = {}) {
  const shape = clickShape(clickSummary, { sentAt });
  const out = [];

  // The strongest thing on the row, and the one most likely to be misread —
  // so the label says what happened (they opened it) rather than what the
  // reader hopes happened (they booked).
  if (shape.booking > 0) {
    out.push({
      key: 'booking',
      label: 'Opened booking page',
      title: 'They followed your scheduling link, so they went to look at your availability. This is NOT a booking: whether they picked a slot happens on the booking provider\'s site and reaches you as that provider\'s notification, never as anything recorded here. A click with no booking in your calendar means somebody opened your availability and didn\'t commit — usually the best follow-up on the page.',
    });
  }

  // Several cities AND several devices. Both, because either alone is
  // ordinary: one person on a laptop and a phone at their desk is two
  // devices in one city, and one device that moves is one person commuting.
  // Together they are more likely to be two people.
  if (shape.places > 1 && shape.devices > 1) {
    out.push({
      key: 'shared',
      label: 'Maybe forwarded',
      title: `Links were followed from ${shape.places} locations on ${shape.devices} kinds of device. That usually means the message was passed to someone else — but a VPN, travel, or a corporate proxy can look the same, so treat it as a lead, not a fact.`,
    });
  }

  // Repeat clicks across days. Nothing automated produces this: a gateway
  // scans a message when it arrives and never comes back on Thursday.
  if (shape.days > 1) {
    out.push({
      key: 'repeat',
      label: `Clicked on ${shape.days} days`,
      title: 'Links were followed again on separate days. The hardest shape on the page to explain away as automation — a security gateway scans a message once, when it arrives, and never returns.',
    });
  }

  // Straight to the top of the inbox, and acted on.
  if (shape.msToFirstClick != null && shape.msToFirstClick <= FAST_CLICK_MS) {
    out.push({
      key: 'fast',
      label: `Clicked in ${shortDuration(shape.msToFirstClick)}`,
      title: 'The first click landed within an hour of the send — the message reached the top of the inbox and was acted on. Worth reading alongside the device in the expanded row: a click within seconds of the send is far more likely to be a security gateway than a reader.',
    });
  }

  // Context rather than engagement, so it comes last and is styled apart: this
  // recipient's mail system screens links. Worth saying out loud because it
  // changes how the rest of the row reads — a gateway that pre-fetches links
  // usually blocks images too, and it explains any clicks that were dropped.
  const screening = screeningEvidence(clickSummary, openSummary);
  if (screening.screened) {
    out.push({
      key: 'screened',
      label: screening.scanner ? `Screened (${screening.scanner})` : 'Screened',
      title: `A security gateway${screening.scanner ? ` — ${screening.scanner} —` : ''} followed the links before the recipient saw them, and those hits are excluded from the count. Two things follow: the mail definitely arrived (a scanner can only scan what it received), and a gateway like this rewrites links for the real reader, so a low count on this row says less than it would on another.`,
    });
  }

  return out;
}
