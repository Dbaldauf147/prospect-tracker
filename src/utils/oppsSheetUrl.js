// Single source of truth for the Opps Google Sheet URL.
//
// Historically this was a literal in OppsView/AgentsView/ProgressView/
// SyncPanel — all pointing at the admin's source-of-truth sheet. Other
// signed-in users would auto-fetch the admin's data from those views,
// which leaks data across accounts.
//
// Now the URL comes from settings.oppsSheetUrl when set; otherwise the
// admin falls back to the legacy literal (unchanged behavior for the
// admin account) and every other user gets null so the auto-fetch is
// skipped. Non-admin users can opt in by setting settings.oppsSheetUrl
// themselves.

// The admin's source-of-truth Opps Google Sheet, as a CSV-export URL.
// Kept as the admin fallback so existing behavior is unchanged.
export const DEFAULT_ADMIN_OPPS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/export?format=csv&gid=0';

// Human-friendly "edit" form of the same sheet — used in the Sync
// Panel display row.
export const DEFAULT_ADMIN_OPPS_SHEET_EDIT_URL =
  'https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/edit?gid=0#gid=0';

// Returns the CSV-export URL to fetch the Opps sheet from, or null when
// no URL is configured for this user. Callers must early-return on
// null instead of fetching (otherwise a non-admin would pull the
// admin's data).
export function getOppsSheetCsvUrl({ isAdmin, settings }) {
  const cfg = String(settings?.oppsSheetUrl || '').trim();
  if (cfg) return cfg;
  return isAdmin ? DEFAULT_ADMIN_OPPS_SHEET_URL : null;
}

// Returns the display URL (edit form). Same fallback shape as the CSV
// getter but uses the edit URL when defaulting for admin.
export function getOppsSheetDisplayUrl({ isAdmin, settings }) {
  const cfg = String(settings?.oppsSheetUrl || '').trim();
  if (cfg) return cfg;
  return isAdmin ? DEFAULT_ADMIN_OPPS_SHEET_EDIT_URL : '';
}
