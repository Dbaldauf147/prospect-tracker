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

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { withAuth } from './_lib/http.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { readChunkedValue, writeChunkedValue } from './_lib/firestoreChunks.js';
import { compactCompanies } from '../src/utils/seHubspotExisting.js';
import { applyToMapping, applyToSeHubspot } from '../src/utils/hubspotExportMailApply.js';
import { EXPORT_SUBJECT, EXPORT_SENDER, findDownloadLink, pickExportMessage } from '../src/utils/hubspotExportMail.js';

const SCOPE = 'Mail.ReadWrite Calendars.Read offline_access';
const LOOKBACK_DAYS = 14;
const GRAPH = 'https://graph.microsoft.com/v1.0';

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

// HubSpot hands the export over as a .zip holding the CSV (or .xlsx). An
// .xlsx is itself a zip, so a zip with Excel's own [Content_Types].xml is
// passed through as is; any other zip is opened and its spreadsheet read.
export async function unzipIfNeeded(buf) {
  if (!(buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b)) return buf;
  const zip = await JSZip.loadAsync(buf);
  if (zip.file('[Content_Types].xml')) return buf;
  const files = Object.values(zip.files)
    .filter(f => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name) && /\.(csv|xlsx|xls)$/i.test(f.name));
  if (!files.length) {
    throw new HttpError(422, `The downloaded zip has no CSV or Excel file in it (it has: ${Object.keys(zip.files).join(', ') || 'nothing'}).`);
  }
  // Prefer a CSV; among several, the biggest is the report.
  const sized = await Promise.all(files.map(async f => ({ f, data: await f.async('nodebuffer') })));
  sized.sort((a, b) => (/\.csv$/i.test(b.f.name) - /\.csv$/i.test(a.f.name)) || (b.data.length - a.data.length));
  return sized[0].data;
}

async function download(link) {
  const r = await fetch(link, { redirect: 'follow' });
  if (!r.ok) throw new HttpError(502, `The Download CSV link answered HTTP ${r.status}. It may have expired; the next email brings a new one.`);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = String(r.headers.get('content-type') || '');
  if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(buf.subarray(0, 200).toString('utf8'))) {
    throw new HttpError(502, 'The Download CSV link returned a web page instead of a file (it may now ask for a HubSpot login).');
  }
  const file = await unzipIfNeeded(buf);
  // Reads CSV and Excel alike, as the manual upload does.
  const wb = XLSX.read(file, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
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
export async function runForUser(db, uid, refreshToken, { now = () => new Date() } = {}) {
  const at = now().toISOString();
  const log = db.collection(LOG_COL).doc(uid);
  let entry;
  try {
    const got = await fetchExport({ refreshToken, onAuthorized: (t) => keepRefreshToken(db, uid, t) });
    if (!got.found) {
      entry = { at, ok: true, message: `No "${EXPORT_SUBJECT}" email in the last ${LOOKBACK_DAYS} days.`, mapping: null, seHubspot: null };
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
        at, ok: mapping.ok && se.ok, message: mapping.message,
        mapping: { ok: mapping.ok, message: mapping.message },
        seHubspot: { ok: se.ok, message: se.message },
      };
    }
  } catch (err) {
    const expired = err?.status === 401;
    entry = {
      at, ok: false,
      message: expired
        ? 'The Outlook sign-in the scheduled check uses has expired. Click Connect Outlook (or Check Outlook now) on the Mapping subtab to renew it.'
        : String(err?.message || err).slice(0, 500),
      mapping: null, seHubspot: null,
    };
  }
  await log.set(entry).catch(() => {});
  return entry;
}

/** Every user who has left a refresh token, checked one after another. */
export async function runScheduled(db) {
  const snap = await db.collection(TOKEN_COL).get();
  const results = [];
  for (const d of snap.docs) {
    const refreshToken = d.data()?.[TOKEN_FIELD]?.refreshToken;
    if (refreshToken) results.push({ uid: d.id, ...(await runForUser(db, d.id, refreshToken)) });
  }
  return results;
}

// ---- The route -----------------------------------------------------------

export async function handler(req, res, auth = null, { db = null } = {}) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.query?.action === 'status') {
    if (!auth?.uid) return res.status(401).json({ error: 'Sign in first.' });
    const store = db || adminDb();
    const [log, kept] = await Promise.all([
      store.collection(LOG_COL).doc(auth.uid).get(),
      store.collection(TOKEN_COL).doc(auth.uid).get(),
    ]);
    return res.status(200).json({
      scheduled: !!kept.data()?.[TOKEN_FIELD]?.refreshToken,
      last: log.exists ? log.data() : null,
    });
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
