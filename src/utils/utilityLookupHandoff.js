// Hand a company's saved Site List from its popup to the Utility Lookup
// page, so the Master Analysis can be downloaded from the Portfolio tab.
//
// The analysis is built out of the Utility Lookup page's own state (the
// resolved utilities, supplier picks, compliance screening), so it can't
// be produced inside the popup. Instead the popup parks the list here and
// fires UTILITY_LOOKUP_HANDOFF_EVENT: App switches to Lists, ListsView to
// its Utility Lookup subtab, and SitesView loads the list and opens the
// Master Analysis tab picker. Kept in memory rather than sessionStorage:
// a site list can run to megabytes, and a reload mid-handoff should just
// drop it rather than replay it later.

export const UTILITY_LOOKUP_HANDOFF_EVENT = 'utility-lookup:handoff';

let pending = null;

// `list` is the companySiteLists entry ({ headers, rows, fileName, ... }).
export function requestMasterAnalysisHandoff({ company, list }) {
  const rows = Array.isArray(list?.rows) ? list.rows : [];
  if (!rows.length) return false;
  pending = {
    company: company || list.company || '',
    fileName: list.fileName || '',
    headers: Array.isArray(list.headers) && list.headers.length
      ? list.headers
      : Object.keys(rows[0] || {}),
    rows,
    requestedAt: Date.now(),
  };
  try { window.dispatchEvent(new CustomEvent(UTILITY_LOOKUP_HANDOFF_EVENT)); } catch { /* no window under Node */ }
  return true;
}

export function hasPendingHandoff() {
  return pending != null;
}

// Returns the pending handoff and clears it, so it is applied once.
export function takePendingHandoff() {
  const p = pending;
  pending = null;
  return p;
}
