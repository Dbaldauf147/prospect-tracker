// Restoring the Utility Lookup page's column mapping on load. Kept out of
// SitesView.jsx so the precedence can be asserted directly; see
// scripts/sitesMapping.test.mjs.

// The mapping to restore on load: the saved one field by field, header
// detection for any field it doesn't mention. A saved field naming a column
// that is no longer in the rows falls back to detection too. A saved blank
// (the user mapped that field to nothing) stays blank rather than letting
// detection re-guess it.
export function mergeSavedSitesMapping(detected, saved, headers) {
  if (!saved || typeof saved !== 'object') return detected;
  const headerSet = new Set(headers || []);
  const out = { ...detected };
  for (const [k, v] of Object.entries(saved)) {
    if (v === '' || v == null) out[k] = '';
    else if (headerSet.has(v)) out[k] = v;
  }
  return out;
}
