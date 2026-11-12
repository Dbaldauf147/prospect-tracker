// "Dan's Company Export" read out of the app's own Gmail mailbox, for when
// Outlook can't be connected (no Azure app registration). Dan forwards the
// HubSpot email to the mailbox the app already sends from (GMAIL_USER), a
// Gmail filter files it under HUBSPOT_EXPORT_LABEL, and the scheduled check
// reads it from there over IMAP with the GMAIL_APP_PASSWORD already set.
//
// The same two gates the newsletter reader keeps (newsletterInbox.js): only
// the one label is opened, never INBOX, and inside it only mail from an
// allowed sender whose subject is the export's is read.
//
// The file comes from an attachment when the email carries one (a zip or
// CSV forwarded by hand works), else from the "Download CSV" link.

import { openGmailLabel } from './newsletterInbox.js';
import { download, rowsFromFile, HttpError } from './hubspotExportFile.js';
import { compactCompanies } from '../../src/utils/seHubspotExisting.js';
import { EXPORT_SUBJECT, findDownloadLink } from '../../src/utils/hubspotExportMail.js';

export const DEFAULT_EXPORT_LABEL = 'hubspot-export';
// HubSpot itself (an email sent or redirected straight to Gmail), and Dan's
// work address (one he forwards). Addresses match exactly, bare domains on
// the right-hand side.
export const DEFAULT_EXPORT_SENDERS = ['notifications.hubspot.com', 'daniel.baldauf@se.com'];
const LOOKBACK_DAYS = 14;

export function exportLabel(env = process.env) {
  return String(env.HUBSPOT_EXPORT_LABEL || '').trim() || DEFAULT_EXPORT_LABEL;
}

export function exportSenders(env = process.env) {
  const raw = String(env.HUBSPOT_EXPORT_SENDERS || '').trim();
  if (!raw) return DEFAULT_EXPORT_SENDERS;
  return raw.split(/[,\s]+/).map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

export function gmailConfigured(env = process.env) {
  return !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

export function isExportSender(address, allowed = exportSenders()) {
  const a = String(address || '').trim().toLowerCase();
  const at = a.lastIndexOf('@');
  if (at < 0) return false;
  const domain = a.slice(at + 1);
  return allowed.some(s => (s.includes('@') ? a === s : domain === s || domain.endsWith(`.${s}`)));
}

// "FW: Dan's Company Export" reads as the export's own name in the app.
const cleanSubject = (s) => String(s || '').replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, '').trim();

const FILE_RE = /\.(zip|csv|xlsx|xls)$/i;

/**
 * The newest export email in the label, read into rows.
 *
 * Resolves to { found: false } or
 * { found: true, msg: { id, subject, receivedDateTime }, rows, companies };
 * throws HttpError when the mailbox, the label or the file can't be read.
 */
export async function fetchExportFromGmail({
  user = process.env.GMAIL_USER,
  pass = process.env.GMAIL_APP_PASSWORD,
  label = exportLabel(),
  allowed = exportSenders(),
  subject = EXPORT_SUBJECT,
  connect = openGmailLabel,
  now = () => Date.now(),
} = {}) {
  if (!user || !pass) throw new HttpError(500, 'Gmail is not configured on the server (GMAIL_USER and GMAIL_APP_PASSWORD).');
  let session;
  try {
    session = await connect({ user, pass, label });
  } catch (err) {
    const why = String(err?.message || err).slice(0, 160);
    throw new HttpError(502, /not found/i.test(why)
      ? `The Gmail label "${label}" doesn't exist yet in ${user}. Create it and a filter that puts the forwarded "${subject}" email under it.`
      : `Couldn't open the Gmail mailbox: ${why}`);
  }

  const want = String(subject).trim().toLowerCase();
  let newest = null;
  try {
    for await (const m of session.messages(new Date(now() - LOOKBACK_DAYS * 864e5))) {
      if (!isExportSender(m.from, allowed)) continue;
      if (!String(m.subject || '').toLowerCase().includes(want)) continue;
      if (!newest || Number(m.date) > Number(newest.date)) newest = m;
    }
  } finally {
    try { await session.close(); } catch { /* closing a dead session is not an error */ }
  }
  if (!newest) return { found: false, lookbackDays: LOOKBACK_DAYS };

  const msg = {
    id: `gmail:${newest.messageId}`,
    subject: cleanSubject(newest.subject),
    receivedDateTime: new Date(Number(newest.date)).toISOString(),
  };
  const file = (newest.attachments || []).find(a => FILE_RE.test(a.filename || '') && a.content?.length);
  let rows;
  if (file) {
    rows = await rowsFromFile(Buffer.from(file.content));
  } else {
    const link = findDownloadLink(newest.html || '');
    if (!link) throw new HttpError(422, `Found "${newest.subject}" in Gmail but no Download CSV link or attached file in it.`);
    rows = await download(link);
  }
  const companies = compactCompanies(rows);
  if (!companies.length) {
    const headers = Object.keys(rows[0] || {}).join(', ') || 'none';
    throw new HttpError(422, `The emailed file has no usable companies. It needs Record ID and Company name columns; it has: ${headers}.`);
  }
  return { found: true, msg, rows, companies };
}
