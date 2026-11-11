// Pulls the newest "Dan's Company Export" email through the app's Outlook
// connection (api/hubspot-export-mail.js) and folds its companies into the
// "Already in Schneider's HubSpot" list (seHubspotStore.js). Run once a day
// while the app is open (HubspotExportMailWatcher) and from the Account
// move tab's "Check Outlook now" button.

import { apiFetch } from './apiFetch';
import { secureGet, secureSet } from './secureStorage';
import { userLsGet, userLsSet } from './userLs';
import { loadSeHubspot, saveSeHubspot } from './seHubspotStore';
import { mergeCompanies } from './hubspotExportMail.js';

export const EXPORT_MAIL_EVENT = 'se-hubspot-export-mail';
const STATUS_KEY = 'se-hubspot-export-mail-status';
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

/** { at, ok, message } of the last check in this browser, or null. */
export function lastExportMailCheck() {
  try { return JSON.parse(userLsGet(STATUS_KEY) || 'null'); } catch { return null; }
}

function record(ok, message) {
  const status = { at: new Date().toISOString(), ok, message };
  try { userLsSet(STATUS_KEY, JSON.stringify(status)); } catch { /* per-browser note only */ }
  try { window.dispatchEvent(new CustomEvent(EXPORT_MAIL_EVENT, { detail: status })); } catch { /* no window */ }
  return status;
}

/** Whether Outlook has ever been connected in this browser. */
export async function hasOutlookConnection() {
  try { return !!(await secureGet('outlook-access-token')) || !!(await secureGet('outlook-refresh-token')); }
  catch { return false; }
}

/**
 * Check the inbox and import the export if it's newer than what's stored.
 * Resolves to the recorded status; never throws.
 */
export async function syncHubspotExportMail() {
  try {
    let access = '';
    let refresh = '';
    try {
      access = (await secureGet('outlook-access-token')) || '';
      refresh = (await secureGet('outlook-refresh-token')) || '';
      const expiry = Number(await secureGet('outlook-token-expiry'));
      if (Number.isFinite(expiry) && expiry > 0 && Date.now() > expiry - EXPIRY_SKEW_MS) access = '';
    } catch { /* fall through to "not connected" */ }
    if (!access && !refresh) return record(false, 'Outlook is not connected. Click Connect Outlook.');

    const headers = {};
    if (access) headers['X-MS-Token'] = access;
    if (refresh) headers['X-MS-Refresh-Token'] = refresh;
    const r = await apiFetch('/api/hubspot-export-mail', { headers });
    const body = await r.json().catch(() => ({}));
    if (body.tokens?.accessToken) {
      try {
        await secureSet('outlook-access-token', body.tokens.accessToken);
        if (body.tokens.refreshToken) await secureSet('outlook-refresh-token', body.tokens.refreshToken);
        await secureSet('outlook-token-expiry', String(Date.now() + (body.tokens.expiresIn || 3600) * 1000));
      } catch { /* the next check refreshes again */ }
    }
    if (!r.ok) return record(false, body.error || `Check failed (HTTP ${r.status}).`);
    if (!body.found) return record(true, `No "Dan's Company Export" email in the last ${body.lookbackDays || 14} days.`);

    const data = await loadSeHubspot();
    if (data.meta?.companiesMailId === body.messageId) {
      return record(true, `Up to date with the ${new Date(body.receivedAt).toLocaleDateString()} email.`);
    }
    const { companies, added, updated } = mergeCompanies(data.companies, body.companies);
    await saveSeHubspot({
      ...data,
      companies,
      meta: {
        ...data.meta,
        companiesFile: `${body.subject} email`,
        companiesAt: body.receivedAt,
        companiesMailId: body.messageId,
      },
    });
    return record(true, `Imported the ${new Date(body.receivedAt).toLocaleDateString()} email: ${added} new, ${updated} refreshed (${body.companies.length} in the file).`);
  } catch (err) {
    return record(false, err?.message || String(err));
  }
}

/** Whether the daily check is due (more than `hours` since the last one). */
export function exportMailCheckDue(hours = 6) {
  const last = lastExportMailCheck();
  return !last?.at || Date.now() - Date.parse(last.at) > hours * 3600 * 1000;
}
