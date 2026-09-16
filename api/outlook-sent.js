// Fetches the user's Sent Items from Microsoft Graph, so the app can log
// the email that goes out by hand rather than only the email it sent
// itself.
//
// ---- Why this exists instead of a BCC -----------------------------------
// The mail this logs used to be tracked by HubSpot, through an Outlook
// add-in that dropped a hidden BCC on every send. That is the only route
// a third party has into somebody's sent mail, and it costs an add-in,
// a tenant that permits it, and a habit that silently stops working the
// day the add-in is disabled.
//
// This app is not a third party to the mailbox. It already signs the user
// in to Microsoft Graph for the Draft Emails page and the opportunity
// meeting picker, and that sign-in already asks for Mail.ReadWrite (see
// api/outlook-auth.js) because it has to create drafts. Reading the Sent
// Items folder is inside that same consent, so the whole feature costs no
// new permission, no BCC, and nothing for the user to remember.
//
// The caller's Firebase ID token goes in Authorization (verified by
// withAuth); the user's own Graph token goes in X-MS-Token. Same split as
// api/outlook-calendar.js, which this otherwise mirrors.

import { withAuth } from './_lib/http.js';

// Pages of 100 messages. Ten pages is a thousand sent emails, which is
// more than the widest window this is asked for can plausibly hold; past
// that the window is the problem, not the paging.
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

// How far back to read when the caller doesn't say. A month is the
// window the log opens on.
const DEFAULT_DAYS = 30;

// Reading further back than this in one request is not refused, it is
// clamped: an unbounded window is a request that times out rather than a
// request that answers with more.
const MAX_DAYS = 365;

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accessToken = req.headers['x-ms-token'];
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing X-MS-Token (Outlook access token)' });
  }

  const askedDays = Number(req.query?.days);
  const days = Math.min(
    Number.isFinite(askedDays) && askedDays > 0 ? Math.floor(askedDays) : DEFAULT_DAYS,
    MAX_DAYS,
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceISO = since.toISOString();

  // $select rather than the whole message: a sent folder read that pulls
  // every body is megabytes of HTML for a list that shows a subject line.
  // bodyPreview is the first ~255 characters Graph already keeps, which
  // is what the row needs to be recognisable.
  const graphUrl =
    `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages`
    + `?$select=id,subject,sentDateTime,toRecipients,ccRecipients,bccRecipients,`
    + `bodyPreview,hasAttachments,conversationId,internetMessageId,isDraft`
    + `&$filter=${encodeURIComponent(`sentDateTime ge ${sinceISO}`)}`
    + `&$orderby=${encodeURIComponent('sentDateTime desc')}`
    + `&$top=${PAGE_SIZE}`;

  try {
    const raw = [];
    let next = graphUrl;
    let pages = 0;
    let truncated = false;
    while (next && pages < MAX_PAGES) {
      const resp = await fetch(next, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Graph returns BCC on a sent message only to the mailbox
          // owner, which is who is asking. Without this preference the
          // recipient collections come back with display names missing
          // on some tenants.
          Prefer: 'outlook.body-content-type="text"',
        },
      });

      if (resp.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid: re-authenticate with Outlook.' });
      }
      if (resp.status === 403) {
        // The scope is Mail.ReadWrite, which covers this folder. A 403
        // here is the tenant declining, and reads as a bug in this route
        // unless it says otherwise.
        return res.status(403).json({
          error: 'Microsoft refused access to Sent Items. The sign-in scope covers it, so this is a tenant policy rather than a missing permission.',
        });
      }
      if (!resp.ok) {
        const errBody = await resp.text();
        return res.status(resp.status).json({ error: `Microsoft Graph error: ${errBody}` });
      }

      const data = await resp.json();
      raw.push(...(data.value || []));
      pages += 1;
      next = data['@odata.nextLink'] || '';
      if (next && pages >= MAX_PAGES) truncated = true;
    }

    const people = (list) => (Array.isArray(list) ? list : [])
      .map(r => ({
        name: r?.emailAddress?.name || '',
        email: r?.emailAddress?.address || '',
      }))
      .filter(p => p.name || p.email);

    const messages = raw
      // A message still being composed sits in Drafts, not here, but a
      // tenant that files them together would otherwise log unsent mail
      // as sent.
      .filter(m => !m.isDraft)
      .map(m => ({
        id: m.id,
        subject: m.subject || '',
        sentAt: m.sentDateTime || null,
        to: people(m.toRecipients),
        cc: people(m.ccRecipients),
        bcc: people(m.bccRecipients),
        preview: m.bodyPreview || '',
        hasAttachments: !!m.hasAttachments,
        conversationId: m.conversationId || '',
        internetMessageId: m.internetMessageId || '',
      }));

    return res.status(200).json({
      messages,
      count: messages.length,
      rangeStart: sinceISO,
      rangeEnd: new Date().toISOString(),
      days,
      // Set when Sent Items had more than MAX_PAGES pages in this window,
      // so the caller can say the far end is missing rather than present
      // a short list as the whole story.
      truncated,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

export default withAuth(handler);
