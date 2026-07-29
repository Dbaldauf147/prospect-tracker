// Email open/click tracking — shared helpers.
//
// The tool creates prospect emails as Outlook drafts (see
// api/outlook-draft.js) which the user then sends by hand. Tracking is
// injected into the draft HTML *before* the draft is created, so it
// rides along when the user hits Send:
//
//   • Open tracking — an invisible 1x1 image whose src points at
//     /api/track-open?id=<trackingId>. When the recipient's mail client
//     loads the image we log an "open" event.
//   • Click tracking — every http(s) link in the body is rewritten to
//     /api/track-click?id=<trackingId>&l=<index>. The endpoint logs the
//     click and 302-redirects to the real URL. We store the original
//     URLs on the tracking doc and reference them by index rather than
//     passing the target in the query string, which keeps the redirector
//     from becoming an open-redirect that phishers could abuse.
//
// Honest caveats (same physics that limit HubSpot): Apple Mail Privacy
// Protection pre-fetches the pixel (inflated/false opens, masked geo),
// Gmail proxies images (open registers but "where" is Google), and
// Outlook blocks images by default (real opens can go unrecorded). Treat
// opens as directional and clicks as hard signal.

import { adminDb } from './firebaseAdmin.js';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';

export const TRACKING_COLLECTION = 'emailTracking';

// Keep per-doc event arrays bounded so a pixel that gets hammered
// (e.g. a proxy re-fetching on a loop) can't grow the document without
// limit. The counters (openCount/clickCount) stay exact regardless.
const MAX_EVENTS = 100;

export function newTrackingId() {
  return randomUUID().replace(/-/g, '');
}

// Resolve the origin that serves the pixel/redirect. The user asked to
// use the app's own domain, so prefer the explicit TRACKING_BASE_URL,
// then the app origin, then reconstruct from the request headers.
export function trackingBaseUrl(req) {
  const configured = String(process.env.TRACKING_BASE_URL || process.env.APP_ORIGIN || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  return host ? `${proto}://${host}` : '';
}

// Decode the handful of HTML entities that legitimately show up inside
// an href so the stored URL is the real destination we redirect to.
function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * Inject open + click tracking into an HTML email body.
 * Returns { html, links } where links is the ordered list of original
 * URLs referenced by the rewritten anchors (index === &l= value).
 */
export function injectTracking(html, { trackingId, baseUrl }) {
  const body = String(html || '');
  const links = [];

  // Rewrite http(s) anchor hrefs. mailto:/tel:/#anchor/{{merge}} links
  // and anything already pointing at our own tracker are left alone.
  const rewritten = body.replace(
    /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi,
    (match, pre, quote, rawUrl) => {
      const url = decodeHtmlEntities(rawUrl).trim();
      if (!/^https?:\/\//i.test(url)) return match;
      if (url.includes('/api/track-click')) return match;
      const index = links.length;
      links.push(url);
      const tracked = `${baseUrl}/api/track-click?id=${encodeURIComponent(trackingId)}&l=${index}`;
      return `${pre}${quote}${tracked}${quote}`;
    }
  );

  // Invisible open pixel. Not display:none — several clients skip loading
  // hidden images; a 1x1 with tiny dimensions loads far more reliably.
  const pixel =
    `<img src="${baseUrl}/api/track-open?id=${encodeURIComponent(trackingId)}" ` +
    `alt="" width="1" height="1" ` +
    `style="width:1px;height:1px;border:0;margin:0;padding:0;overflow:hidden;" />`;

  const withPixel = /<\/body\s*>/i.test(rewritten)
    ? rewritten.replace(/<\/body\s*>/i, `${pixel}</body>`)
    : rewritten + pixel;

  return { html: withPixel, links };
}

/**
 * Create the tracking document for a single send. Written with the
 * Admin SDK, so it bypasses Firestore rules; the client only ever reads
 * these (see firestore.rules -> emailTracking).
 */
export async function createTrackingDoc({ trackingId, uid, ownerEmail, to, name, subject, links }) {
  const db = adminDb();
  await db.collection(TRACKING_COLLECTION).doc(trackingId).set({
    uid: uid || null,
    ownerEmail: ownerEmail || null,
    to: to || null,
    recipientName: name || null,
    subject: subject || null,
    createdAt: Timestamp.now(),
    links: Array.isArray(links) ? links : [],
    openCount: 0,
    clickCount: 0,
    firstOpenAt: null,
    lastOpenAt: null,
    lastClickAt: null,
    opens: [],
    clicks: [],
  });
}

// Pull requester metadata off the (Vercel-provided) headers. Geo headers
// are best-effort and often reflect a mail proxy rather than the human.
export function requestMeta(req) {
  const h = req.headers || {};
  const ua = h['user-agent'] || '';
  const city = h['x-vercel-ip-city'];
  return {
    ip: String(h['x-forwarded-for'] || '').split(',')[0].trim() || null,
    country: h['x-vercel-ip-country'] || null,
    region: h['x-vercel-ip-country-region'] || null,
    city: city ? decodeURIComponent(city) : null,
    ua: ua || null,
    // Flag the obvious automated fetchers so the UI can down-weight them.
    proxied: /GoogleImageProxy|YahooMailProxy|via ggpht\.com/i.test(ua),
  };
}

/**
 * Record an open or click against a tracking doc. Uses a transaction so
 * concurrent hits keep the counters exact; the event arrays are capped.
 * Missing / unknown ids are a no-op — the caller still returns a valid
 * pixel/redirect so the recipient's experience is never affected.
 */
export async function recordEvent(trackingId, type, meta, extra = {}) {
  if (!trackingId) return;
  const db = adminDb();
  const ref = db.collection(TRACKING_COLLECTION).doc(String(trackingId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data() || {};
    const now = Timestamp.now();
    const event = { at: now, ...meta, ...extra };

    if (type === 'open') {
      const opens = Array.isArray(d.opens) ? d.opens.slice() : [];
      opens.push(event);
      tx.update(ref, {
        openCount: (d.openCount || 0) + 1,
        firstOpenAt: d.firstOpenAt || now,
        lastOpenAt: now,
        opens: opens.slice(-MAX_EVENTS),
      });
    } else if (type === 'click') {
      const clicks = Array.isArray(d.clicks) ? d.clicks.slice() : [];
      clicks.push(event);
      tx.update(ref, {
        clickCount: (d.clickCount || 0) + 1,
        lastClickAt: now,
        clicks: clicks.slice(-MAX_EVENTS),
      });
    }
  });
}

/** Look up the original URL for a rewritten click, by index. */
export async function resolveClickUrl(trackingId, index) {
  if (!trackingId) return null;
  const db = adminDb();
  const snap = await db.collection(TRACKING_COLLECTION).doc(String(trackingId)).get();
  if (!snap.exists) return null;
  const links = snap.data()?.links || [];
  const i = Number(index);
  return Number.isInteger(i) && i >= 0 && i < links.length ? links[i] : null;
}
