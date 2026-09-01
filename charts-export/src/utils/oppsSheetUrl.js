// STUB for the standalone export.
//
// In the full app this returned an "Opps" Google Sheet CSV-export URL that
// the Progress subtab auto-fetches. The export ships with no sheet
// configured (and deliberately does NOT embed anyone's private sheet), so
// every getter returns empty and the Progress view skips the fetch and
// renders from its local/sample data. Point it at your own sheet by
// setting `settings.oppsSheetUrl` if you want that auto-pull back.

export const DEFAULT_ADMIN_OPPS_SHEET_URL = '';
export const DEFAULT_ADMIN_OPPS_SHEET_EDIT_URL = '';

export function getOppsSheetCsvUrl({ settings } = {}) {
  const cfg = String(settings?.oppsSheetUrl || '').trim();
  return cfg || null;
}

export function getOppsSheetDisplayUrl({ settings } = {}) {
  const cfg = String(settings?.oppsSheetUrl || '').trim();
  return cfg || '';
}
