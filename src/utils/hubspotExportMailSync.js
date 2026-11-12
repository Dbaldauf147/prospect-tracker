// Pulls the newest "Dan's Company Export" email through the app's Outlook
// connection (api/hubspot-export-mail.js) and folds its companies into the
// "Already in Schneider's HubSpot" list (seHubspotStore.js). Run once a day
// while the app is open (HubspotExportMailWatcher) and from the Account
// move tab's "Check Outlook now" button.
//
// The same email is the export the Hubspot Mapping subtab reads (it's the
// owned-companies report, dan-s-company-export), so each check also
// replaces that subtab's companies when the email is newer than what it
// has, keeping Dan's links. That result is recorded on its own, for the
// subtab's line under the drop box.

import { apiFetch } from './apiFetch';
import { secureGet, secureSet } from './secureStorage';
import { userLsGet, userLsSet } from './userLs';
import { loadSeHubspot, saveSeHubspot } from './seHubspotStore';
import { applyToMapping, applyToSeHubspot } from './hubspotExportMailApply.js';
import { loadHubspotMapping, saveHubspotMapping } from './hubspotMappingStore';

export const EXPORT_MAIL_EVENT = 'se-hubspot-export-mail';
const STATUS_KEY = 'se-hubspot-export-mail-status';
const EXPIRY_SKEW_MS = 2 * 60 * 1000;
export const MAPPING_MAIL_EVENT = 'hubspot-mapping-export-mail';
const MAPPING_STATUS_KEY = 'hubspot-mapping-export-mail-status';

/** { at, ok, message } of the Hubspot Mapping part of the last check, or null. */
export function lastMappingMailCheck() {
  try { return JSON.parse(userLsGet(MAPPING_STATUS_KEY) || 'null'); } catch { return null; }
}

function recordMapping(ok, message) {
  const status = { at: new Date().toISOString(), ok, message };
  try { userLsSet(MAPPING_STATUS_KEY, JSON.stringify(status)); } catch { /* per-browser note only */ }
  try { window.dispatchEvent(new CustomEvent(MAPPING_MAIL_EVENT, { detail: status })); } catch { /* no window */ }
  return status;
}

/** Keep the tokens the Outlook sign-in popup hands back. */
export async function saveOutlookTokens({ accessToken, refreshToken, expiresIn }) {
  await secureSet('outlook-access-token', accessToken);
  if (refreshToken) await secureSet('outlook-refresh-token', refreshToken);
  await secureSet('outlook-token-expiry', String(Date.now() + (expiresIn || 3600) * 1000));
}

// The Hubspot Mapping subtab's half of a check (rules in
// hubspotExportMailApply.js, shared with the server's scheduled check).
// Never throws.
async function syncMapping(body) {
  try {
    const data = await loadHubspotMapping();
    const { ok, next, message } = applyToMapping(data, body);
    if (next) await saveHubspotMapping(next);
    return recordMapping(ok, message);
  } catch (err) {
    return recordMapping(false, err?.message || String(err));
  }
}

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
    if (!access && !refresh) {
      recordMapping(false, 'Outlook is not connected. Click Connect Outlook.');
      return record(false, 'Outlook is not connected. Click Connect Outlook.');
    }

    const headers = {};
    if (access) headers['X-MS-Token'] = access;
    if (refresh) headers['X-MS-Refresh-Token'] = refresh;
    const r = await apiFetch('/api/hubspot-export-mail?rows=1', { headers });
    const body = await r.json().catch(() => ({}));
    if (body.tokens?.accessToken) {
      try {
        await secureSet('outlook-access-token', body.tokens.accessToken);
        if (body.tokens.refreshToken) await secureSet('outlook-refresh-token', body.tokens.refreshToken);
        await secureSet('outlook-token-expiry', String(Date.now() + (body.tokens.expiresIn || 3600) * 1000));
      } catch { /* the next check refreshes again */ }
    }
    if (!r.ok) {
      recordMapping(false, body.error || `Check failed (HTTP ${r.status}).`);
      return record(false, body.error || `Check failed (HTTP ${r.status}).`);
    }
    if (!body.found) {
      const none = `No "Dan's Company Export" email in the last ${body.lookbackDays || 14} days.`;
      recordMapping(true, none);
      return record(true, none);
    }
    await syncMapping(body);

    const data = await loadSeHubspot();
    const { ok, next, message } = applyToSeHubspot(data, body);
    if (next) await saveSeHubspot(next);
    return record(ok, message);
  } catch (err) {
    recordMapping(false, err?.message || String(err));
    return record(false, err?.message || String(err));
  }
}

/** Whether the daily check is due (more than `hours` since the last one). */
export function exportMailCheckDue(hours = 6) {
  const last = lastExportMailCheck();
  return !last?.at || Date.now() - Date.parse(last.at) > hours * 3600 * 1000;
}

/**
 * The server's scheduled check for this account (api/hubspot-export-mail.js):
 * { scheduled, last: { at, ok, message } | null }, or null when it can't be
 * read. `scheduled` is false until a check from this app has handed the
 * server an Outlook sign-in to use.
 */
export async function scheduledMailCheck() {
  try {
    const r = await apiFetch('/api/hubspot-export-mail?action=status');
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Read the export out of the app's Gmail label now (admin only), the same
 * check the schedule runs. Resolves to the logged { at, ok, message };
 * never throws.
 */
export async function checkGmailNow() {
  try {
    const r = await apiFetch('/api/hubspot-export-mail?action=gmail', { method: 'POST' });
    const body = await r.json().catch(() => ({}));
    if (body?.message) return body;
    return { at: new Date().toISOString(), ok: false, message: body?.error || `Check failed (HTTP ${r.status}).` };
  } catch (err) {
    return { at: new Date().toISOString(), ok: false, message: err?.message || String(err) };
  }
}
