// Creates draft emails in the user's Outlook via Microsoft Graph API.
//
// Optional folderName: when provided, the batch is placed in a
// subfolder of the well-known "Drafts" folder (created on first use,
// reused on subsequent runs with the same name). The Draft Emails UI
// passes this for any batch that produces more than 3 drafts so the
// user's main Drafts folder doesn't get flooded.

import { withAuth } from './_lib/http.js';
import { injectTracking, createTrackingDoc, newTrackingId, trackingBaseUrl } from './_lib/tracking.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, drafts, folderName, track } = req.body;
  if (!accessToken || !drafts || !Array.isArray(drafts)) {
    return res.status(400).json({ error: 'Missing accessToken or drafts array' });
  }

  // Open/click tracking is opt-in per batch. When on, inject a unique
  // pixel + rewrite links into each draft's body before it's created,
  // and remember the trackingId/links so we can persist the tracking doc
  // once Outlook confirms the draft was created.
  const trackingEnabled = track === true;
  const baseUrl = trackingEnabled ? trackingBaseUrl(req) : '';
  const trackingByIndex = [];
  if (trackingEnabled) {
    drafts.forEach((draft, i) => {
      try {
        const trackingId = newTrackingId();
        const { html, links } = injectTracking(draft.body || '', { trackingId, baseUrl });
        draft.body = html;
        trackingByIndex[i] = { trackingId, links };
      } catch (err) {
        // Tracking must never block a send — leave the body untouched.
        console.error('outlook-draft: tracking injection failed:', err?.message || err);
        trackingByIndex[i] = null;
      }
    });
  }

  // Resolve the target folder id once. When no folderName is passed
  // (or folder creation fails), fall back to the standard endpoint
  // which writes to the default Drafts folder — same as before.
  let folderId = null;
  let folderError = null;
  if (folderName && typeof folderName === 'string' && folderName.trim()) {
    try {
      folderId = await ensureSubfolder(accessToken, 'drafts', folderName.trim());
    } catch (err) {
      folderError = err.message || 'folder creation failed';
      // Don't fail the whole batch — fall through to default Drafts.
    }
  }

  const messagesPath = folderId
    ? `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`
    : 'https://graph.microsoft.com/v1.0/me/messages';

  const results = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    try {
      const response = await fetch(messagesPath, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: draft.subject,
          body: {
            contentType: 'HTML',
            content: draft.body,
          },
          toRecipients: (draft.to || '').split(';').filter(Boolean).map((addr, i) => ({
            emailAddress: {
              address: addr.trim(),
              name: i === 0 ? (draft.name || '') : '',
            },
          })),
          ccRecipients: (draft.cc || []).map(addr => ({
            emailAddress: { address: addr.trim() },
          })),
          isDraft: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const tracking = trackingEnabled ? trackingByIndex[i] : null;
        if (tracking) {
          try {
            await createTrackingDoc({
              trackingId: tracking.trackingId,
              uid: auth?.uid,
              ownerEmail: auth?.email,
              // draft.to can carry the contact's folded-in "To Also"
              // extras as "a@x;b@y" — Graph needs all of them, but the
              // tracking doc records the primary recipient only. The
              // Email Campaign report keys its join on this exact value
              // (trackingByRecipient -> normalizeTrackedEmail), so a
              // joined string would never match a contact and the row
              // would silently show no opens. The .eml path already
              // stores the single address; match it.
              to: String(draft.to || '').split(';')[0].trim() || draft.to,
              name: draft.name,
              subject: draft.subject,
              links: tracking.links,
            });
          } catch (err) {
            // Draft was created; just couldn't persist tracking. Don't fail the send.
            console.error('outlook-draft: failed to save tracking doc:', err?.message || err);
          }
        }
        results.push({ to: draft.to, success: true, id: data.id, tracked: !!tracking });
      } else {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
          return res.status(200).json({ success: false, needsAuth: true, error: 'Token expired. Please reconnect Outlook.' });
        }
        results.push({ to: draft.to, success: false, error: err.error?.message || `HTTP ${response.status}` });
      }
    } catch (err) {
      results.push({ to: draft.to, success: false, error: err.message });
    }
  }

  const created = results.filter(r => r.success).length;
  return res.status(200).json({
    success: created > 0,
    created,
    total: drafts.length,
    results,
    folder: folderId ? folderName : null,
    folderError,
  });
}

export default withAuth(handler);

// Look up or create a subfolder of the named parent (e.g. "drafts")
// by displayName. Returns the folder id.
//
// Implementation note: an earlier version used $filter to short-circuit
// the lookup, but Graph's quoting rules for single-quotes-inside-the-
// filter-value are inconsistent across tenants and the URL-encoded
// form occasionally 400s. Listing all childFolders + matching in
// JS is plenty fast (Drafts rarely has more than a handful of
// subfolders) and avoids the encoding minefield. Same reason for
// using /me/mailFolders/drafts/... (the well-known name as a URL
// segment) instead of /me/mailFolders('drafts')/... — both are
// documented but the segment form is what every Graph SDK ships.
async function ensureSubfolder(accessToken, parentWellKnown, displayName) {
  const safeName = displayName.replace(/[\\/:*?"<>|\x00-\x1F]/g, '').slice(0, 240).trim();
  if (!safeName) throw new Error('folderName resolved to empty after sanitisation');

  // List existing children, paging until we either find a match or
  // exhaust the list. $top=200 fits the vast majority of users in one
  // page; the @odata.nextLink loop covers the long tail.
  let nextUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(parentWellKnown)}/childFolders?$select=id,displayName&$top=200`;
  while (nextUrl) {
    const listRes = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({}));
      throw new Error('Failed to list child folders: ' + (err.error?.message || `HTTP ${listRes.status}`));
    }
    const list = await listRes.json();
    const target = (list.value || []).find(f => f && typeof f.displayName === 'string' && f.displayName === safeName);
    if (target?.id) return target.id;
    nextUrl = list['@odata.nextLink'] || null;
  }

  // Not found → create.
  const createUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(parentWellKnown)}/childFolders`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName: safeName }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error('Failed to create folder: ' + (err.error?.message || `HTTP ${createRes.status}`));
  }
  const data = await createRes.json();
  if (!data.id) throw new Error('Folder create returned no id');
  return data.id;
}
