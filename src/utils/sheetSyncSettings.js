// Where the Google Sheets sync keeps its configuration.
//
// It used to live only in localStorage, which made it per-browser: the
// sheet URL, the polling frequency, the paused flags and the extra sheets
// were all invisible to a second computer. Signing in somewhere new meant
// starting from a clean slate — the sync silently did nothing until it
// was set up again, and setting it up again ran a first import with no
// memory of when the other machine had last run one.
//
// The configuration now lives on the user's settings document, so it
// follows the account. The legacy localStorage blob is still read as a
// fallback until the migration below has carried it up, so nothing is
// lost on the browser that had it.
//
// Pure — the Firestore read/write is the settings document's own, and the
// auto-sync clock (which ticks far too often to belong on that document)
// is handled in hooks/useSheetSync.

import { userLsGet } from './userLs.js';

// Key on the user settings document.
export const SHEET_SYNC_KEY = 'sheetSync';

// The pre-migration localStorage keys. LEGACY_STAMP_KEY is the auto-sync
// clock, kept only as a fallback for when the shared one can't be read.
export const LEGACY_SETTINGS_KEY = 'prospect-sync-settings';
export const LEGACY_STAMP_KEY = 'prospect-last-auto-sync';

// What the browser still has stashed, if anything.
export function readLegacySheetSync() {
  try {
    const parsed = JSON.parse(userLsGet(LEGACY_SETTINGS_KEY));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The live configuration: the settings document when it has one, and the
// browser's leftover copy until then. Always an object, so callers can
// read a key off it without guarding.
export function readSheetSync(settings) {
  const stored = settings?.[SHEET_SYNC_KEY];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored;
  return readLegacySheetSync();
}

// Is the additive auto-import supposed to run at all, and how often?
// `intervalMs` is null when it shouldn't run — no sheet configured, the
// user paused it, or the frequency is set to manual-only (0).
export function autoSyncSchedule(settings) {
  const config = readSheetSync(settings);
  if (!config.sheetsUrl) return { intervalMs: null, reason: 'no sheet configured' };
  if (config.mainPaused) return { intervalMs: null, reason: 'paused' };
  const freqMin = config.mainFreq ?? 5;
  if (!freqMin) return { intervalMs: null, reason: 'manual only' };
  return { intervalMs: freqMin * 60 * 1000, reason: null };
}

// The one-time lift of the browser's copy onto the settings document.
// Returns the patch to save, or null when there is nothing to do — the
// document already has a copy, or this browser never had one.
//
// Deliberately not folded into userSettingsSync's first-login migration:
// that one only fires when the settings document does not exist yet, and
// every user who has this problem already has one.
export function planSheetSyncMigration(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const existing = settings[SHEET_SYNC_KEY];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) return null;
  const legacy = readLegacySheetSync();
  if (!Object.keys(legacy).length) return null;
  return { [SHEET_SYNC_KEY]: legacy };
}
