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

// Distinct links one tracking doc's recipient clicked, most-clicked first.
// Returns [{ url, label, clicks }].
export function linksForRow(row) {
  const byUrl = new Map();
  for (const { event: ev, verdict } of countClicks(row).events) {
    if (verdict !== 'counted') continue;
    const url = String(ev?.url || '').trim();
    if (!url) continue;
    byUrl.set(url, (byUrl.get(url) || 0) + 1);
  }
  return [...byUrl.entries()]
    .map(([url, clicks]) => ({ url, label: shortLinkLabel(url), clicks }))
    .sort((a, b) => b.clicks - a.clicks || a.url.localeCompare(b.url));
}

/**
 * Roll every click across a set of tracking docs up by destination.
 *
 * @param rows tracking docs ({ clickCount, clicks: [{ url }], to })
 * @returns {{ links, totalClicks, unattributed }}
 *   links        [{ url, label, clicks, recipients }] most-clicked first,
 *                ties broken by recipient count then URL so the order is
 *                stable between renders
 *   totalClicks  clicks a person plausibly made, across the set
 *   unattributed clicks the counters know about but no event survives for —
 *                the per-doc event array is capped (tracking.js MAX_EVENTS),
 *                so a heavily-clicked send can have hits we can't attribute
 *                to a link. Reported rather than quietly dropped, since the
 *                per-link numbers would otherwise not add up to the total.
 */
export function clicksByLink(rows) {
  const byUrl = new Map();
  let totalClicks = 0;
  let attributed = 0;
  for (const row of rows || []) {
    const summary = countClicks(row);
    totalClicks += summary.count;
    const recipient = String(row?.to || row?.id || '').toLowerCase().trim();
    for (const { event: ev, verdict } of summary.events) {
      if (verdict !== 'counted') continue;
      const url = String(ev?.url || '').trim();
      if (!url) continue;
      attributed += 1;
      let entry = byUrl.get(url);
      if (!entry) {
        entry = { url, label: shortLinkLabel(url), clicks: 0, recipients: new Set() };
        byUrl.set(url, entry);
      }
      entry.clicks += 1;
      if (recipient) entry.recipients.add(recipient);
    }
  }
  const links = [...byUrl.values()]
    .map(e => ({ url: e.url, label: e.label, clicks: e.clicks, recipients: e.recipients.size }))
    .sort((a, b) => b.clicks - a.clicks || b.recipients - a.recipients || a.url.localeCompare(b.url));
  return { links, totalClicks, unattributed: Math.max(0, totalClicks - attributed) };
}
