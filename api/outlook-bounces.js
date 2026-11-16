// Delivery-failure notices in the user's Outlook inbox, read for the
// address each one failed for, so the app can flag that address as bad on
// the contact popup and the email campaigns (src/utils/badEmails.js).
//
// GET /api/outlook-bounces?days=30
//   X-MS-Token:          the user's Graph access token (may be stale)
//   X-MS-Refresh-Token:  optional; used when there is no live access token
//
// Same sign-in and consent as /api/outlook-sent (Mail.ReadWrite already
// covers the inbox). Returns { bounces: [{ address, at, subject, reason,
// messageId }], scanned, days, tokens? } - `tokens` when it had to refresh,
// for the browser to keep.
import { withAuth } from './_lib/http.js';
import { isBounceNotice, bouncedAddresses, bounceReason } from './_lib/bounceAddress.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Mail.ReadWrite Calendars.Read offline_access';
const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
// Notices whose preview doesn't name the address get their full text
// fetched, one call each; capped so a flood can't run the request out.
const MAX_BODY_READS = 60;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function refresh(refreshToken) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new HttpError(500, 'Microsoft app credentials are not configured on the server.');
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: SCOPE }),
  });
  const t = await r.json();
  if (t.error) throw new HttpError(401, 'Outlook sign-in expired: connect Outlook again.');
  return { accessToken: t.access_token, refreshToken: t.refresh_token || '', expiresIn: Number(t.expires_in) > 0 ? Number(t.expires_in) : 3600 };
}

async function graphGet(token, url) {
  const r = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (r.status === 401) throw new HttpError(401, 'Token expired or invalid: re-authenticate with Outlook.');
  if (r.status === 403) throw new HttpError(403, 'Microsoft refused access to the inbox (a tenant policy).');
  if (!r.ok) throw new HttpError(r.status, `Microsoft Graph error: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

/** The scan itself, given a live token. Exported for the tests. */
export async function scanBounces(token, { days = DEFAULT_DAYS, get = graphGet } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const me = await get(token, '/me?$select=mail,userPrincipalName').catch(() => ({}));
  const exclude = [me?.mail, me?.userPrincipalName].filter(Boolean);
  let next = `/me/mailFolders/inbox/messages?$select=id,subject,from,receivedDateTime,bodyPreview`
    + `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`
    + `&$orderby=${encodeURIComponent('receivedDateTime desc')}&$top=${PAGE_SIZE}`;
  const notices = [];
  let scanned = 0;
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const data = await get(token, next);
    for (const m of data.value || []) {
      scanned += 1;
      const from = m?.from?.emailAddress?.address || '';
      if (isBounceNotice({ subject: m.subject || '', from })) notices.push(m);
    }
    pages += 1;
    next = data['@odata.nextLink'] || '';
  }
  const bounces = [];
  let reads = 0;
  for (const m of notices) {
    let text = m.bodyPreview || '';
    let addrs = bouncedAddresses(text, { exclude });
    if (!addrs.length && reads < MAX_BODY_READS) {
      reads += 1;
      const full = await get(token, `/me/messages/${encodeURIComponent(m.id)}?$select=body`).catch(() => null);
      text = full?.body?.content || text;
      addrs = bouncedAddresses(text, { exclude });
    }
    const reason = bounceReason(text);
    for (const address of addrs) {
      bounces.push({ address, at: m.receivedDateTime || null, subject: m.subject || '', reason, messageId: m.id });
    }
  }
  return { bounces, scanned, notices: notices.length };
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let token = req.headers['x-ms-token'] || '';
  const refreshToken = req.headers['x-ms-refresh-token'] || '';
  if (!token && !refreshToken) return res.status(401).json({ error: 'Outlook is not connected.' });
  const asked = Number(req.query?.days);
  const days = Math.min(Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : DEFAULT_DAYS, MAX_DAYS);
  let tokens = null;
  try {
    if (!token) { tokens = await refresh(refreshToken); token = tokens.accessToken; }
    let out;
    try {
      out = await scanBounces(token, { days });
    } catch (err) {
      if (err.status !== 401 || !refreshToken || tokens) throw err;
      tokens = await refresh(refreshToken);
      out = await scanBounces(tokens.accessToken, { days });
    }
    return res.status(200).json({ ...out, days, ...(tokens ? { tokens } : {}) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Unknown error' });
  }
}

export default withAuth(handler);
