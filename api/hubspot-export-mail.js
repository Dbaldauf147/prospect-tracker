// Reads the newest "Dan's Company Export" email from the caller's Outlook
// inbox, downloads the CSV behind its "Download CSV" button, and returns the
// companies in it (see src/utils/hubspotExportMail.js for why).
//
//   GET  X-MS-Token: <Graph access token>
//        X-MS-Refresh-Token: <refresh token>   optional; used when the
//                                              access token is missing or
//                                              expired, and the new pair is
//                                              returned for the page to keep
//   GET  ?action=status                        the last scheduled check for
//                                              the caller
//   Vercel Cron (vercel.json, every 3 hours)   Authorization: Bearer
//                                              <CRON_SECRET>; the scheduled
//                                              check, below
//
// The scheduled check is what keeps the Hubspot Mapping subtab current
// with no browser open. A browser check that sends a refresh token leaves a
// copy in integrationTokens/{uid}.outlookExport (server-only, see
// firestore.rules); the cron uses it to read the same email and write the
// two stores the browser's check writes (rules shared through
// src/utils/hubspotExportMailApply.js), logging the result at
// hubspotExportMail/{uid} for the subtab to show.
//
// The download happens here rather than in the browser because HubSpot's
// file host sends no CORS headers. The Graph sign-in already asks for
// Mail.ReadWrite (api/outlook-auth.js), so reading the inbox needs no new
// permission. Reads only: nothing in the mailbox or in HubSpot is changed.

import { withAuth, isAdminEmail } from './_lib/http.js';
import { download, unzipIfNeeded, HttpError } from './_lib/hubspotExportFile.js';
import { adminDb, adminAuth } from './_lib/firebaseAdmin.js';
import { fetchExportFromGmail, gmailConfigured, exportLabel } from './_lib/hubspotExportGmail.js';
import { readChunkedValue, writeChunkedValue } from './_lib/firestoreChunks.js';
import { compactCompanies } from '../src/utils/seHubspotExisting.js';
import { applyToMapping, applyToSeHubspot } from '../src/utils/hubspotExportMailApply.js';
import { EXPORT_SUBJECT, EXPORT_SENDER, findDownloadLink, pickExportMessage } from '../src/utils/hubspotExportMail.js';

const SCOPE = 'Mail.ReadWrite Calendars.Read offline_access';
const LOOKBACK_DAYS = 14;
const GRAPH = 'https://graph.microsoft.com/v1.0';

// Kept exported from here for scripts/hubspotExportMailRoute.test.mjs.
export { unzipIfNeeded };

async function refresh(refreshToken) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new HttpError(500, 'Microsoft app credentials are not configured on the server.');
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token', scope: SCOPE,
    }),
  });
  const t = await r.json();
  if (t.error) throw new HttpError(401, 'Outlook sign-in expired: connect Outlook again.');
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || '',
    expiresIn: Number(t.expires_in) > 0 ? Number(t.expires_in) : 3600,
  };
}

async function graph(token, path) {
  const r = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new HttpError(401, 'expired');
  if (!r.ok) throw new HttpError(502, `Microsoft Graph error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function findExport(token, subject) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  // Graph wants the $orderby property in the $filter, first.
  const filter = `receivedDateTime ge ${since} and from/emailAddress/address eq '${EXPORT_SENDER}'`;
  const list = await graph(token, `/me/messages?$select=id,subject,receivedDateTime`
    + `&$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent('receivedDateTime desc')}&$top=50`);
  const msg = pickExportMessage(list.value, subject);
  if (!msg) return null;
  const full = await graph(token, `/me/messages/${encodeURIComponent(msg.id)}?$select=id,subject,receivedDateTime,body`);
  return full;
}

/**
 * Find and read the newest export email. `onAuthorized(refreshToken)` is
 * called once Graph has accepted the sign-in, with the newest refresh
 * token there is, so a caller can keep it even if the download then fails.
 *
 * Resolves to { found: false, tokens } or
 * { found: true, tokens, msg, rows, companies }; throws HttpError.
 */
export async function fetchExport({ token = '', refreshToken = '', subject = EXPORT_SUBJECT, onAuthorized = null }) {
  let tokens = null;
  if (!token && !refreshToken) throw new HttpError(401, 'Outlook is not connected.');
  if (!token) { tokens = await refresh(refreshToken); token = tokens.accessToken; }
  let msg;
  try {
    msg = await findExport(token, subject);
  } catch (err) {
    if (err.status !== 401 || !refreshToken || tokens) throw Object.assign(err, { tokens });
    tokens = await refresh(refreshToken);
    token = tokens.accessToken;
    msg = await findExport(token, subject);
  }
  const newest = tokens?.refreshToken || refreshToken;
  if (onAuthorized && newest) await onAuthorized(newest);
  if (!msg) return { found: false, tokens };

  const link = findDownloadLink(msg.body?.content || '');
  if (!link) throw Object.assign(new HttpError(422, `Found "${msg.subject}" but no Download CSV link in it.`), { tokens });
  const rows = await download(link).catch(err => { throw Object.assign(err, { tokens }); });
  const companies = compactCompanies(rows);
  if (!companies.length) {
    const headers = Object.keys(rows[0] || {}).join(', ') || 'none';
    throw Object.assign(new HttpError(422, `The emailed CSV has no usable companies. It needs Record ID and Company name columns; it has: ${headers}.`), { tokens });
  }
  return { found: true, tokens, msg, rows, companies };
}

// ---- The scheduled check -------------------------------------------------

const ADMIN_EMAIL = 'baldaufdan@gmail.com';
const TOKEN_COL = 'integrationTokens';
const TOKEN_FIELD = 'outlookExport';
const LOG_COL = 'hubspotExportMail';
const items = (db, uid) => db.collection('lookupTables').doc(uid).collection('items');

async function keepRefreshToken(db, uid, refreshToken) {
  await db.collection(TOKEN_COL).doc(uid).set(
    { [TOKEN_FIELD]: { refreshToken, updatedAt: Date.now() } },
    { merge: true },
  );
}

/**
 * One user's scheduled check: read the email with the kept refresh token
 * and update the Hubspot Mapping and "Already in Schneider's HubSpot"
 * stores the way a browser check would. Logs and returns { at, ok,
 * message, mapping, seHubspot }; never throws.
 */
export async function runForUser(db, uid, refreshToken, opts = {}) {
  return runCheck(db, uid, () => fetchExport({ refreshToken, onAuthorized: (t) => keepRefreshToken(db, uid, t) }), opts);
}

/** The same, reading the email out of the app's Gmail label instead. */
export async function runGmailForUser(db, uid, { gmail = {}, ...opts } = {}) {
  return runCheck(db, uid, () => fetchExportFromGmail(gmail), { ...opts, source: 'Gmail' });
}

async function runCheck(db, uid, fetchFn, { now = () => new Date(), source = 'Outlook' } = {}) {
  const at = now().toISOString();
  const log = db.collection(LOG_COL).doc(uid);
  let entry;
  try {
    const got = await fetchFn();
    if (!got.found) {
      entry = { at, ok: true, source, message: `No "${EXPORT_SUBJECT}" email in ${source} in the last ${LOOKBACK_DAYS} days.`, mapping: null, seHubspot: null };
    } else {
      const body = { messageId: got.msg.id, subject: got.msg.subject, receivedAt: got.msg.receivedDateTime, rows: got.rows, companies: got.companies };
      const mapRef = items(db, uid).doc('hubspot-mapping');
      const mapData = { companies: [], links: {}, meta: {}, ...(await readChunkedValue(mapRef, { field: 's' }) || {}) };
      const mapping = applyToMapping(mapData, body);
      if (mapping.next) await writeChunkedValue(db, mapRef, mapping.next, { meta: { companies: mapping.next.companies.length } });

      const seRef = items(db, uid).doc('se-hubspot');
      const seData = { companies: [], contacts: [], overrides: {}, meta: {}, ...(await readChunkedValue(seRef, { field: 's' }) || {}) };
      const se = applyToSeHubspot(seData, body);
      if (se.next) {
        await writeChunkedValue(db, seRef, se.next, {
          meta: { companies: se.next.companies.length, contacts: se.next.contacts?.length || 0 },
        });
      }
      entry = {
        at, ok: mapping.ok && se.ok, source, message: `${mapping.message} (from ${source})`,
        mapping: { ok: mapping.ok, message: mapping.message },
        seHubspot: { ok: se.ok, message: se.message },
      };
    }
  } catch (err) {
    const expired = source === 'Outlook' && err?.status === 401;
    entry = {
      at, ok: false, source,
      message: expired
        ? 'The Outlook sign-in the scheduled check uses has expired. Click Connect Outlook (or Check Outlook now) on the Mapping subtab to renew it.'
        : String(err?.message || err).slice(0, 500),
      mapping: null, seHubspot: null,
    };
  }
  await log.set(entry).catch(() => {});
  return entry;
}

// The account the app's Gmail mailbox feeds: the mailbox is the app's,
// not any one user's, so its export goes to the admin, as the weekly
// HubSpot files are built from the admin's data.
async function adminUid() {
  return (await adminAuth().getUserByEmail(ADMIN_EMAIL)).uid;
}

/**
 * The Gmail label first (for the admin), then every user who has left an
 * Outlook refresh token, one after another. An account that Gmail just
 * loaded an email for isn't checked again through Outlook.
 */
export async function runScheduled(db, { env = process.env, resolveAdminUid = adminUid, gmail = {} } = {}) {
  const results = [];
  let gmailUid = null;
  if (gmailConfigured(env)) {
    try {
      gmailUid = await resolveAdminUid();
      const r = await runGmailForUser(db, gmailUid, { gmail });
      results.push({ uid: gmailUid, ...r });
      if (!r.mapping) gmailUid = null;
    } catch (err) {
      results.push({ uid: null, ok: false, message: `Gmail check skipped: ${String(err?.message || err).slice(0, 200)}` });
      gmailUid = null;
    }
  }
  const snap = await db.collection(TOKEN_COL).get();
  for (const d of snap.docs) {
    if (d.id === gmailUid) continue;
    const refreshToken = d.data()?.[TOKEN_FIELD]?.refreshToken;
    if (refreshToken) results.push({ uid: d.id, ...(await runForUser(db, d.id, refreshToken)) });
  }
  return results;
}

// ---- The route -----------------------------------------------------------

export async function handler(req, res, auth = null, { db = null, gmail: gmailOpts = {} } = {}) {
  if (req.method !== 'GET' && !(req.method === 'POST' && req.query?.action === 'gmail')) return res.status(405).json({ error: 'Method not allowed' });
  if (req.query?.action === 'status') {
    if (!auth?.uid) return res.status(401).json({ error: 'Sign in first.' });
    const store = db || adminDb();
    const [log, kept] = await Promise.all([
      store.collection(LOG_COL).doc(auth.uid).get(),
      store.collection(TOKEN_COL).doc(auth.uid).get(),
    ]);
    // The Gmail route is the admin's (see adminUid), so only the admin is
    // told where to forward to.
    const gmail = isAdminEmail(auth.email) && gmailConfigured()
      ? { address: process.env.GMAIL_USER, label: exportLabel() }
      : null;
    return res.status(200).json({
      scheduled: !!kept.data()?.[TOKEN_FIELD]?.refreshToken || !!gmail,
      gmail,
      last: log.exists ? log.data() : null,
    });
  }
  if (req.query?.action === 'gmail') {
    if (!auth?.uid || !isAdminEmail(auth.email)) return res.status(403).json({ error: 'Only the admin account reads the app\'s Gmail mailbox.' });
    if (!gmailConfigured()) return res.status(500).json({ error: 'Gmail is not configured on the server (GMAIL_USER and GMAIL_APP_PASSWORD).' });
    const entry = await runGmailForUser(db || adminDb(), auth.uid, { gmail: gmailOpts });
    return res.status(entry.ok ? 200 : 502).json(entry);
  }
  const token = String(req.headers['x-ms-token'] || '');
  const refreshToken = String(req.headers['x-ms-refresh-token'] || '');
  const subject = String(req.query?.subject || EXPORT_SUBJECT);
  if (!token && !refreshToken) return res.status(401).json({ error: 'Outlook is not connected.' });
  // Signed-in callers leave their refresh token for the scheduled check.
  const onAuthorized = auth?.uid && refreshToken
    ? (t) => keepRefreshToken(db || adminDb(), auth.uid, t).catch(() => {})
    : null;
  try {
    const got = await fetchExport({ token, refreshToken, subject, onAuthorized });
    if (!got.found) return res.status(200).json({ found: false, tokens: got.tokens, lookbackDays: LOOKBACK_DAYS });
    const { msg, rows, companies, tokens } = got;
    return res.status(200).json({
      found: true,
      tokens,
      messageId: msg.id,
      subject: msg.subject,
      receivedAt: msg.receivedDateTime,
      rowCount: rows.length,
      companies,
      // ?rows=1: the file's rows as read, for the Hubspot Mapping subtab,
      // which keeps more of each company (lifecycle, activity dates).
      ...(String(req.query?.rows || '') === '1' ? { rows } : {}),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      const msg = err.status === 401 ? 'Outlook sign-in expired: connect Outlook again.' : err.message;
      return res.status(err.status).json({ error: msg, tokens: err.tokens || null });
    }
    throw err;
  }
}

const authed = withAuth((req, res, auth) => handler(req, res, auth));

export default async function route(req, res) {
  // The cron's own call carries the cron secret; everything else is a
  // signed-in user and goes through the usual auth.
  const secret = process.env.CRON_SECRET;
  const header = String(req.headers?.authorization || '');
  if (secret && header === `Bearer ${secret}`) {
    const results = await runScheduled(adminDb());
    return res.status(results.every(r => r.ok) ? 200 : 500).json({ results: results.map(({ uid, ok, message }) => ({ uid, ok, message })) });
  }
  return authed(req, res);
}
