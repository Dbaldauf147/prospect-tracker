// The event a campaign is inviting people to, as a link.
//
// A campaign's contacts already carry an RSVP (the Event Status column:
// going / not going / maybe), which only makes sense because the campaign is
// about an event — but the event itself lived nowhere. The registration page,
// the Eventbrite listing, the calendar invite, the internal page with the
// agenda on it: all of that was in somebody's inbox, and answering "what are
// we actually inviting them to?" meant going and finding it.
//
// So a campaign carries `eventUrl`, one link, stored as the user typed it.
// Rendering it is two steps on purpose: `eventLinkHref` decides whether it is
// safe to hand to the browser, and `eventLinkLabel` decides what it reads as.
// A link we refuse to make clickable is still shown as text — visible and
// editable rather than silently dropped.
//
// Pure: no React, no Firestore (scripts/campaignEventLink.test.mjs).
import { linkHref } from './oppLinks.js';
import { shortLinkLabel } from './emailLinks.js';

/** The link stored on a campaign, trimmed. '' when it has none. */
export function campaignEventUrl(c) {
  return typeof c?.eventUrl === 'string' ? c.eventUrl.trim() : '';
}

/**
 * The href for a campaign's event link, or '' when there isn't a safe one.
 *
 * Same rules as an opp's links (src/utils/oppLinks.js): http(s) goes through,
 * a bare host gets https:// put in front of it because that is how addresses
 * arrive when they are pasted out of a browser bar, and any other scheme —
 * `javascript:` above all — comes back empty so it can never be clicked.
 *
 * Takes a campaign or a bare string.
 */
export function eventLinkHref(campaignOrUrl) {
  const raw = typeof campaignOrUrl === 'string' ? campaignOrUrl.trim() : campaignEventUrl(campaignOrUrl);
  return linkHref(raw);
}

/**
 * What the link reads as on screen: host plus the recognizable tail of the
 * path, without the scheme, the "www." or the query string. An address we
 * won't link falls back to the raw text, so the user can see what they typed.
 */
export function eventLinkLabel(campaignOrUrl) {
  const raw = typeof campaignOrUrl === 'string' ? campaignOrUrl.trim() : campaignEventUrl(campaignOrUrl);
  if (!raw) return '';
  const href = linkHref(raw);
  return href ? (shortLinkLabel(href) || raw) : raw;
}

/**
 * A campaign with its event link set to `url` — the one place the field is
 * written, so clearing it can't leave a stray empty string behind. Blank
 * removes the key rather than storing '': Firestore keeps whatever it is
 * given, and a campaign that never had an event link shouldn't grow one.
 */
export function withEventUrl(c, url) {
  const next = { ...(c || {}) };
  const trimmed = String(url ?? '').trim();
  if (trimmed) next.eventUrl = trimmed;
  else delete next.eventUrl;
  return next;
}

/** Whether an edit actually changed the link — used to skip a pointless save. */
export function sameEventUrl(a, b) {
  const x = typeof a === 'string' ? a.trim() : campaignEventUrl(a);
  const y = typeof b === 'string' ? b.trim() : campaignEventUrl(b);
  return x === y;
}
