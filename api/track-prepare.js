// Prepare tracking for a batch of emails that the client assembles
// itself (the .eml download path in DraftEmailView). For each item we
// mint a tracking id, inject the open pixel + rewrite links into the
// HTML, persist the tracking doc (Admin SDK, owner = caller), and return
// the rewritten HTML for the client to drop into its .eml. This mirrors
// the injection the Outlook-draft endpoint does server-side, but hands
// the body back instead of creating a Graph draft.
//
// POST /api/track-prepare
// Body: { items: [{ to, name, subject, html }] }
// Returns: { items: [{ html, trackingId }] }  (same order)

import { withAuth } from './_lib/http.js';
import { injectTracking, createTrackingDoc, newTrackingId, trackingBaseUrl } from './_lib/tracking.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }
  if (items.length > 500) {
    return res.status(400).json({ error: 'Too many items (max 500)' });
  }

  const baseUrl = trackingBaseUrl(req);
  if (!baseUrl) return res.status(500).json({ error: 'Tracking base URL not configured' });

  const out = [];
  for (const item of items) {
    const trackingId = newTrackingId();
    try {
      const { html, links } = injectTracking(item.html || '', { trackingId, baseUrl });
      await createTrackingDoc({
        trackingId,
        uid: auth?.uid,
        ownerEmail: auth?.email,
        to: item.to,
        name: item.name,
        subject: item.subject,
        links,
      });
      out.push({ html, trackingId });
    } catch (err) {
      console.error('track-prepare: failed for one item:', err?.message || err);
      // Fall back to the untouched body so the send still goes out.
      out.push({ html: item.html || '', trackingId: null, error: true });
    }
  }

  return res.status(200).json({ items: out });
}

export default withAuth(handler);
