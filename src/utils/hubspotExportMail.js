// "Dan's Company Export": the recurring email the corporate HubSpot portal
// sends (Dashboard sent to you), whose "Download CSV" link downloads the
// companies list without a login. The app reads that email from Outlook
// (api/hubspot-export-mail.js), downloads the file, and folds the companies
// into the "Already in Schneider's HubSpot" list on the Account move tab
// (seHubspotStore.js), so that list stays current without an upload.
//
// Pure: runs under plain Node in scripts/hubspotExportMail.test.mjs and in
// the API route.

export const EXPORT_SUBJECT = "Dan's Company Export";
export const EXPORT_SENDER = 'noreply@notifications.hubspot.com';

const decodeEntities = (s) => String(s || '')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&nbsp;/gi, ' ');

/**
 * Outlook's Safe Links wraps every link as
 * https://<region>.safelinks.protection.outlook.com/?url=<encoded>&...;
 * the real address is the `url` parameter.
 */
export function unwrapSafeLink(href) {
  const raw = decodeEntities(href).trim();
  try {
    const u = new URL(raw);
    if (/safelinks\.protection\.outlook\.com$/i.test(u.hostname) && u.searchParams.get('url')) {
      return u.searchParams.get('url');
    }
  } catch { /* not a URL; returned as is */ }
  return raw;
}

/** The href of the email's "Download CSV" button, unwrapped, or ''. */
export function findDownloadLink(html, label = 'download csv') {
  const re = /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.includes(label)) return unwrapSafeLink(m[2]);
  }
  return '';
}

/** The newest message that is this export, from a Graph message list. */
export function pickExportMessage(messages, subject = EXPORT_SUBJECT) {
  const want = String(subject).trim().toLowerCase();
  return (Array.isArray(messages) ? messages : [])
    .filter(m => String(m?.subject || '').trim().toLowerCase().includes(want))
    .sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')))[0] || null;
}

/**
 * The stored companies with the emailed ones folded in, by Record ID: a
 * company in the email replaces the stored one, the rest are kept. Merged
 * rather than replaced because the email is a report of Dan's companies,
 * and the stored list can also hold colleagues' companies from a full
 * export he uploaded by hand; dropping those would bring back the
 * duplicates the list exists to prevent.
 */
export function mergeCompanies(existing = [], incoming = []) {
  const byId = new Map();
  for (const c of existing || []) if (c?.id) byId.set(String(c.id), c);
  let added = 0;
  let updated = 0;
  for (const c of incoming || []) {
    if (!c?.id) continue;
    const id = String(c.id);
    if (byId.has(id)) updated += 1; else added += 1;
    byId.set(id, c);
  }
  return { companies: [...byId.values()], added, updated };
}
