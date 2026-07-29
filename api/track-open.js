// Public open-tracking pixel. Loaded by the recipient's mail client, so
// it is intentionally UNAUTHENTICATED and must never fail in a way the
// recipient could notice — it always returns a valid 1x1 GIF, whether or
// not the tracking id is known. GET /api/track-open?id=<trackingId>

import { recordEvent, requestMeta } from './_lib/tracking.js';

// 43-byte transparent 1x1 GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function sendPixel(res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(PIXEL.length));
  // No caching — otherwise a client would serve a repeat open from cache
  // and we'd undercount. These headers force a fresh fetch each time.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(PIXEL);
}

export default async function handler(req, res) {
  const id = req.query?.id;
  try {
    if (id) await recordEvent(String(id), 'open', requestMeta(req));
  } catch (err) {
    // Never let a logging failure break the pixel.
    console.error('track-open: failed to record open:', err?.message || err);
  }
  return sendPixel(res);
}
