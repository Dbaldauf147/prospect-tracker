// Public click-tracking redirector. Unauthenticated (the recipient
// clicks the link from their mail client). Logs the click, then
// 302-redirects to the original URL. The destination is looked up from
// the tracking doc by index (&l=), never taken from the query string, so
// this endpoint can only ever send the recipient to a URL that was in
// the email we sent — it is not an open redirect.
// GET /api/track-click?id=<trackingId>&l=<index>

import { recordEvent, requestMeta, resolveClickUrl, trackingBaseUrl } from './_lib/tracking.js';

export default async function handler(req, res) {
  const id = req.query?.id ? String(req.query.id) : '';
  const index = req.query?.l;

  let target = null;
  try {
    target = await resolveClickUrl(id, index);
  } catch (err) {
    console.error('track-click: failed to resolve url:', err?.message || err);
  }

  // Fall back to the app's own origin if we can't resolve the link, so a
  // stale/garbled link never dead-ends the recipient on an error page.
  const fallback = trackingBaseUrl(req) || 'https://google.com';
  const destination = target || fallback;

  try {
    if (id && target) {
      await recordEvent(id, 'click', requestMeta(req), { url: target });
    }
  } catch (err) {
    console.error('track-click: failed to record click:', err?.message || err);
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.setHeader('Location', destination);
  return res.status(302).end();
}
