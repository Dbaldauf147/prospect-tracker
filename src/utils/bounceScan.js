// The browser side of the bounce scan: ask /api/outlook-bounces for the
// delivery-failure notices in the Outlook inbox and fold the failed
// addresses into settings.badEmails (utils/badEmails.js). Run by
// BouncedEmailWatcher every few hours while the app is open.
import { apiFetch } from './apiFetch';
import { secureGet, secureSet } from './secureStorage';
import { userLsGet, userLsSet } from './userLs';
import { badEmailsUpdate } from './badEmails';

const LAST_KEY = 'bounceScanLastAt';
const EVERY_MS = 2 * 60 * 60 * 1000;
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

export function bounceScanDue(now = Date.now()) {
  const last = Number(userLsGet(LAST_KEY));
  return !Number.isFinite(last) || last <= 0 || now - last >= EVERY_MS;
}

/** One scan. Resolves to { ok, found, error }; never throws. */
export async function scanForBounces(updateSettings) {
  try {
    let access = '';
    let refresh = '';
    try {
      access = (await secureGet('outlook-access-token')) || '';
      refresh = (await secureGet('outlook-refresh-token')) || '';
      const expiry = Number(await secureGet('outlook-token-expiry'));
      if (Number.isFinite(expiry) && expiry > 0 && Date.now() > expiry - EXPIRY_SKEW_MS) access = '';
    } catch { /* not connected */ }
    if (!access && !refresh) return { ok: false, found: 0, error: 'Outlook is not connected.' };
    // The first scan looks back two months; after that a fortnight covers
    // the gap between scans many times over.
    const days = Number(userLsGet(LAST_KEY)) > 0 ? 14 : 60;
    const headers = {};
    if (access) headers['X-MS-Token'] = access;
    if (refresh) headers['X-MS-Refresh-Token'] = refresh;
    const r = await apiFetch(`/api/outlook-bounces?days=${days}`, { headers });
    const body = await r.json().catch(() => ({}));
    if (body.tokens?.accessToken) {
      try {
        await secureSet('outlook-access-token', body.tokens.accessToken);
        if (body.tokens.refreshToken) await secureSet('outlook-refresh-token', body.tokens.refreshToken);
        await secureSet('outlook-token-expiry', String(Date.now() + (body.tokens.expiresIn || 3600) * 1000));
      } catch { /* refreshed again next time */ }
    }
    if (!r.ok) return { ok: false, found: 0, error: body.error || `HTTP ${r.status}` };
    userLsSet(LAST_KEY, String(Date.now()));
    const bounces = Array.isArray(body.bounces) ? body.bounces : [];
    if (bounces.length && updateSettings) await updateSettings(badEmailsUpdate(bounces));
    return { ok: true, found: bounces.length, error: '' };
  } catch (err) {
    return { ok: false, found: 0, error: err?.message || String(err) };
  }
}
