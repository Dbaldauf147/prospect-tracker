// Which link they clicked, not just that they clicked.
//
// Every click event on a tracking doc records the destination it forwarded to
// (api/track-click.js resolves the index back to the original URL before
// logging it), so the data to tell a pricing-page click apart from a footer
// click has always been there — the dashboard only ever counted them.
//
// The difference is the whole signal. Somebody who opened the savings analysis
// is in a different conversation from somebody who clicked the company logo,
// and both currently read as "1".
//
// One destination is different enough from the rest to be named: the
// scheduling link. Most outreach signatures carry one, and a click on it is
// the closest thing to intent an email can record — the reader went to look at
// your calendar. What it is NOT is a booking. The redirector logs the click
// and forwards them on; whether they picked a slot happens on the booking
// provider's site and reaches you as that provider's own notification, not as
// anything we can see. So a click here with no booking in your calendar is not
// a contradiction to explain away — it is a person who opened your availability
// and didn't commit, which is a specific and workable state that the plain
// click count buries among every other link in the message.
//
// Two shapes are built from the same events: a per-row list (what did THIS
// recipient click) and a portfolio roll-up (which link is pulling across the
// campaign). Both count distinct recipients as well as raw clicks, because one
// person clicking the same link five times is not five people interested.
//
// Both read countClicks() rather than the raw event array, so a security
// gateway sweeping every link in the message can't top the chart. A scanner
// clicks EVERY link at once, which is exactly the shape that would otherwise
// make the least interesting link look like the most popular one.

import { countClicks } from './emailClicks.js';

// Booking pages worth recognising. Matched on host (and on the path where the
// host also serves unrelated things), so a link to Outlook's Bookings page is
// picked out while an ordinary outlook.office.com link is not.
const SCHEDULING = [
  /(^|\.)outlook\.office(365)?\.com\/bookwithme/i,
  /(^|\.)outlook\.office(365)?\.com\/book\//i,
  /(^|\.)calendly\.com/i,
  /(^|\.)meetings\.hubspot\.com/i,
  /(^|\.)calendar\.app\.google/i,
  /(^|\.)cal\.com/i,
  /(^|\.)savvycal\.com/i,
  /(^|\.)chilipiper\.com/i,
  /(^|\.)youcanbook\.me/i,
  /(^|\.)acuityscheduling\.com/i,
];

/**
 * Is this URL a booking page?
 *
 * Matched against host + path rather than the whole URL so a query string
 * mentioning "calendly" in a tracking parameter can't promote an unrelated
 * link into the one place on the page that claims intent.
 */
export function isSchedulingLink(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  let subject = raw;
  try {
    const parsed = new URL(raw);
    subject = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    // Not parseable — fall back to the raw string rather than guessing.
  }
  return SCHEDULING.some(re => re.test(subject));
}

// A URL trimmed to something readable in a narrow cell.
//
// Keeps the part a human recognizes — the last meaningful path segment,
// falling back to the host — and drops the scheme, the "www.", the query
// string and any tracking parameters hanging off the end. A bare domain link
// keeps its host, since that IS the label.
export function shortLinkLabel(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // Not a parseable URL (shouldn't reach here — the redirector only ever
    // logs what it resolved) — show it as-is, trimmed.
    return raw.length > 48 ? `${raw.slice(0, 45)}…` : raw;
  }
  const host = parsed.hostname.replace(/^www\./i, '');
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments.length ? segments[segments.length - 1] : '';
  // A file-ish last segment reads better with its extension dropped, and
  // hyphens/underscores read better as spaces.
  const pretty = last
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!pretty) return host;
  return `${host}/${pretty}`;
}

// A booking link reads as its provider, not as whatever opaque segment the
// provider put at the end of the URL — "outlook.office.com/SVRwCe7HMUGxuT6W"
// tells the reader nothing about what the recipient opened.
export function linkLabel(url) {
  return isSchedulingLink(url) ? 'Booking page' : shortLinkLabel(url);
}

// Both entry points accept a click summary the caller has already computed,
// because the summary depends on the send time (countClicks gates pre-send
// clicks on it) and only the caller knows it. Computing one here without that
// gate would quietly disagree with the counts beside it.
function summaryFor(row, summary) {
  return summary || countClicks(row);
}

/**
 * Distinct links one tracking doc's recipient clicked, most-clicked first.
 *
 * @param row     an emailTracking doc
 * @param summary an already-computed countClicks(row, { sentAt }) result
 * @returns [{ url, label, clicks, scheduling }]
 */
export function linksForRow(row, summary) {
  const byUrl = new Map();
  for (const { event: ev, verdict } of summaryFor(row, summary).events) {
    if (verdict !== 'counted') continue;
    const url = String(ev?.url || '').trim();
    if (!url) continue;
    byUrl.set(url, (byUrl.get(url) || 0) + 1);
  }
  return [...byUrl.entries()]
    .map(([url, clicks]) => ({ url, label: linkLabel(url), clicks, scheduling: isSchedulingLink(url) }))
    .sort((a, b) => b.clicks - a.clicks || a.url.localeCompare(b.url));
}

/**
 * Roll every click across a set of tracking docs up by destination.
 *
 * @param entries either plain tracking docs, or { row, summary } pairs where
 *                summary is the caller's countClicks result for that row. The
 *                pair form is what the dashboard passes, so the breakdown
 *                agrees with the tiles about which clicks were real. The key
 *                is `summary` and not `clicks` on purpose — a tracking doc
 *                has its own `clicks` array, and a pair form named after it
 *                could not be told apart from the doc itself.
 * @returns {{ links, totalClicks, unattributed, schedulingClicks,
 *             schedulingRecipients }}
 *   links        [{ url, label, clicks, recipients, scheduling }] most-clicked
 *                first, ties broken by recipient count then URL so the order
 *                is stable between renders
 *   totalClicks  clicks a person plausibly made, across the set
 *   unattributed clicks the counters know about but no event survives for —
 *                the per-doc event array is capped (tracking.js MAX_EVENTS),
 *                so a heavily-clicked send can have hits we can't attribute
 *                to a link. Reported rather than quietly dropped, since the
 *                per-link numbers would otherwise not add up to the total.
 *   schedulingClicks / schedulingRecipients
 *                the booking-page subtotal, called out separately because it
 *                is the one destination that means something on its own.
 */
export function clicksByLink(entries) {
  const byUrl = new Map();
  let totalClicks = 0;
  let attributed = 0;
  for (const entry of entries || []) {
    const row = entry?.row || entry;
    const summary = summaryFor(row, entry?.summary);
    totalClicks += summary.count;
    const recipient = String(row?.to || row?.id || '').toLowerCase().trim();
    for (const { event: ev, verdict } of summary.events) {
      if (verdict !== 'counted') continue;
      const url = String(ev?.url || '').trim();
      if (!url) continue;
      attributed += 1;
      let record = byUrl.get(url);
      if (!record) {
        record = { url, label: linkLabel(url), clicks: 0, recipients: new Set(), scheduling: isSchedulingLink(url) };
        byUrl.set(url, record);
      }
      record.clicks += 1;
      if (recipient) record.recipients.add(recipient);
    }
  }
  const links = [...byUrl.values()]
    .map(e => ({ url: e.url, label: e.label, clicks: e.clicks, recipients: e.recipients.size, scheduling: e.scheduling }))
    .sort((a, b) => b.clicks - a.clicks || b.recipients - a.recipients || a.url.localeCompare(b.url));
  const booking = [...byUrl.values()].filter(e => e.scheduling);
  const schedulingRecipients = new Set();
  for (const e of booking) for (const r of e.recipients) schedulingRecipients.add(r);
  return {
    links,
    totalClicks,
    unattributed: Math.max(0, totalClicks - attributed),
    schedulingClicks: booking.reduce((a, e) => a + e.clicks, 0),
    schedulingRecipients: schedulingRecipients.size,
  };
}
