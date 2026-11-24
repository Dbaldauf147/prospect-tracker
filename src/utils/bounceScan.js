// The browser side of bounce logging: ask /api/bounce-inbox for the
// delivery-failure notices Dan has forwarded to the app's mailbox
// (api/_lib/bounceInbox.js) and fold the failed addresses into
// settings.badEmails (utils/badEmails.js). Only forwarded notices count:
// forwarding one is how Dan says "log this bounce".
//
// Run by BouncedEmailWatcher every couple of hours while the app is open,
// and by the Email Campaigns page when it opens and on refresh.
import { apiFetch } from './apiFetch';
import { userLsGet, userLsSet } from './userLs';
import { badEmailsUpdate } from './badEmails';

const LAST_KEY = 'bounceScanLastAt';
const RESULT_KEY = 'bounceScanResult';
const EVERY_MS = 2 * 60 * 60 * 1000;
export const BOUNCE_SCAN_EVENT = 'bounce-scan-result';

// The Email Campaigns page asks sooner than the background watcher: on
// opening and on every refresh, as long as the last scan is ten minutes old.
export const CAMPAIGN_SCAN_EVERY_MS = 10 * 60 * 1000;

export function bounceScanDue(now = Date.now(), everyMs = EVERY_MS) {
  const last = Number(userLsGet(LAST_KEY));
  return !Number.isFinite(last) || last <= 0 || now - last >= everyMs;
}

/**
 * The last scan's outcome, or null: { at, ok, found, error, forwardTo, label,
 * read, skipped, unread, missing } (the last four as /api/bounce-inbox
 * counts them).
 */
export function lastBounceScan() {
  try { return JSON.parse(userLsGet(RESULT_KEY) || 'null'); } catch { return null; }
}

function remember(result) {
  try { userLsSet(RESULT_KEY, JSON.stringify(result)); } catch { /* a convenience */ }
  try { window.dispatchEvent(new CustomEvent(BOUNCE_SCAN_EVENT)); } catch { /* no window */ }
  return result;
}

/** One scan. Resolves to { ok, found, error, forwardTo, label }; never throws. */
export async function scanForBounces(updateSettings) {
  try {
    // The first scan looks back two months; after that a fortnight covers
    // the gap between scans many times over.
    const days = Number(userLsGet(LAST_KEY)) > 0 ? 14 : 60;
    const r = await apiFetch(`/api/bounce-inbox?days=${days}`);
    const body = await r.json().catch(() => ({}));
    const base = { at: new Date().toISOString(), forwardTo: body.forwardTo || '', label: body.label || '' };
    if (!r.ok) return remember({ ...base, ok: false, found: 0, error: body.error || `HTTP ${r.status}` });
    userLsSet(LAST_KEY, String(Date.now()));
    const bounces = Array.isArray(body.bounces) ? body.bounces : [];
    if (bounces.length && updateSettings) await updateSettings(badEmailsUpdate(bounces));
    return remember({
      ...base, ok: true, found: new Set(bounces.map(b => b.address)).size, error: '',
      read: Number(body.read) || 0,
      skipped: Number(body.skipped) || 0,
      unread: Array.isArray(body.unread) ? body.unread : [],
      missing: Array.isArray(body.missing) ? body.missing : [],
    });
  } catch (err) {
    return remember({ at: new Date().toISOString(), ok: false, found: 0, error: err?.message || String(err), forwardTo: '', label: '' });
  }
}
