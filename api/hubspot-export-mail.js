// Reads the newest "Dan's Company Export" email from the caller's Outlook
// inbox, downloads the CSV behind its "Download CSV" button, and returns the
// companies in it (see src/utils/hubspotExportMail.js for why).
//
//   GET  X-MS-Token: <Graph access token>
//        X-MS-Refresh-Token: <refresh token>   optional; used when the
//                                              access token is missing or
//                                              expired, and the new pair is
//                                              returned for the page to keep
//
// The download happens here rather than in the browser because HubSpot's
// file host sends no CORS headers. The Graph sign-in already asks for
// Mail.ReadWrite (api/outlook-auth.js), so reading the inbox needs no new
// permission. Reads only: nothing in the mailbox or in HubSpot is changed.

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { withAuth } from './_lib/http.js';
import { compactCompanies } from '../src/utils/seHubspotExisting.js';
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

export async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let token = String(req.headers['x-ms-token'] || '');
  const refreshToken = String(req.headers['x-ms-refresh-token'] || '');
  const subject = String(req.query?.subject || EXPORT_SUBJECT);
  let tokens = null;
  if (!token && !refreshToken) return res.status(401).json({ error: 'Outlook is not connected.' });

  try {
    if (!token) { tokens = await refresh(refreshToken); token = tokens.accessToken; }
    let msg;
    try {
      msg = await findExport(token, subject);
    } catch (err) {
      if (err.status !== 401 || !refreshToken || tokens) throw err;
      tokens = await refresh(refreshToken);
      token = tokens.accessToken;
      msg = await findExport(token, subject);
    }
    if (!msg) return res.status(200).json({ found: false, tokens, lookbackDays: LOOKBACK_DAYS });

    const link = findDownloadLink(msg.body?.content || '');
    if (!link) throw new HttpError(422, `Found "${msg.subject}" but no Download CSV link in it.`);
    const rows = await download(link);
    const companies = compactCompanies(rows);
    if (!companies.length) {
      const headers = Object.keys(rows[0] || {}).join(', ') || 'none';
      throw new HttpError(422, `The emailed CSV has no usable companies. It needs Record ID and Company name columns; it has: ${headers}.`);
    }
    return res.status(200).json({
      found: true,
      tokens,
      messageId: msg.id,
      subject: msg.subject,
      receivedAt: msg.receivedDateTime,
      rowCount: rows.length,
      companies,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      const msg = err.status === 401 ? 'Outlook sign-in expired: connect Outlook again.' : err.message;
      return res.status(err.status).json({ error: msg, tokens });
    }
    throw err;
  }
}

export default withAuth(handler);
