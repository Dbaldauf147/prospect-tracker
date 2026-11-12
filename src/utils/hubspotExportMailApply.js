// What one "Dan's Company Export" email does to the two stores it feeds,
// worked out without touching either: the browser's check
// (hubspotExportMailSync.js) and the server's scheduled one
// (api/hubspot-export-mail.js) both read the stores, call these, and write
// back whatever comes out, so the two can't drift into different rules.
//
// `body` is the route's answer for a found email:
//   { messageId, subject, receivedAt, rows, companies }
//
// Pure: runs under plain Node in scripts/hubspotExportMailApply.test.mjs.

import { mergeCompanies } from './hubspotExportMail.js';
import { compactMappingCompanies } from './hubspotMapping.js';

const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York' });

/**
 * The Hubspot Mapping subtab's half: the emailed file replaces its
 * companies, keeping Dan's links, unless it has read this email already or
 * holds a file dropped by hand after the email came.
 *
 * Returns { ok, message, next } where `next` is the value to save, or null
 * when nothing should change.
 */
export function applyToMapping(data, body) {
  const when = day(body.receivedAt);
  const meta = data?.meta || {};
  if (meta.mailId === body.messageId) return { ok: true, next: null, message: `Up to date with the ${when} email.` };
  if (meta.at && Date.parse(meta.at) >= Date.parse(body.receivedAt)) {
    return { ok: true, next: null, message: `Kept ${meta.file || 'the file'} from ${day(meta.at)}: it is newer than the ${when} email.` };
  }
  const companies = compactMappingCompanies(body.rows || []);
  if (!companies.length) return { ok: false, next: null, message: `The ${when} email's file has no companies with a Company name.` };
  return {
    ok: true,
    next: { ...data, companies, meta: { file: `${body.subject} email`, at: body.receivedAt, mailId: body.messageId } },
    message: `Loaded the ${when} email: ${companies.length} HubSpot companies.`,
  };
}

/**
 * The Account move tab's half: the emailed companies are folded into the
 * "Already in Schneider's HubSpot" list by Record ID (see mergeCompanies
 * for why it merges rather than replaces).
 *
 * Returns { ok, message, next } like applyToMapping.
 */
export function applyToSeHubspot(data, body) {
  const when = day(body.receivedAt);
  if (data?.meta?.companiesMailId === body.messageId) return { ok: true, next: null, message: `Up to date with the ${when} email.` };
  const { companies, added, updated } = mergeCompanies(data?.companies, body.companies);
  return {
    ok: true,
    next: {
      ...data,
      companies,
      meta: { ...(data?.meta || {}), companiesFile: `${body.subject} email`, companiesAt: body.receivedAt, companiesMailId: body.messageId },
    },
    message: `Imported the ${when} email: ${added} new, ${updated} refreshed (${(body.companies || []).length} in the file).`,
  };
}
