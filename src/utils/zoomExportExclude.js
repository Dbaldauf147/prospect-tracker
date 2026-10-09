// Companies the user has kept out of the ZoomInfo exports. The company
// popup's "Exclude from ZoomInfo" button sets `excludeFromZoomExports` on
// the Table View record; every CSV this app builds for ZoomInfo (the
// Zoom Info page's Export CSV and the My Accounts Zoom CSVs) drops the
// rows that resolve to such a company.
//
// Matching is deliberately tight - the record's id, its Zoom Company ID,
// or the same name once case, punctuation and corporate suffixes are
// set aside - so excluding "Acme" never quietly drops "Acme Industrial".
//
// Pure, so it can be asserted without a browser:
// scripts/zoomExportExclude.test.mjs.

const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;

/** A company name with case, accents, bracketed notes and corporate suffixes set aside. */
export function normZoomCompany(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isZoomExcluded(prospect) {
  return !!prospect?.excludeFromZoomExports;
}

/**
 * (row) => boolean: whether an export row belongs to an excluded company.
 * `row` is { id?, company?, names?: [], zoomId? }; any one of them matching
 * an excluded company is enough.
 */
export function buildZoomExcludedMatcher(prospects) {
  const ids = new Set();
  const names = new Set();
  const zoomIds = new Set();
  for (const p of Array.isArray(prospects) ? prospects : []) {
    if (!isZoomExcluded(p)) continue;
    if (p.id != null) ids.add(String(p.id));
    const n = normZoomCompany(p.company);
    if (n) names.add(n);
    const z = String(p.zoomCompanyId || '').trim();
    if (z) zoomIds.add(z);
  }
  if (!ids.size && !names.size && !zoomIds.size) return () => false;
  return function isExcludedRow(row) {
    if (!row) return false;
    if (row.id != null && ids.has(String(row.id))) return true;
    const z = String(row.zoomId || '').trim();
    if (z && zoomIds.has(z)) return true;
    for (const nm of [row.company, ...(row.names || [])]) {
      const n = normZoomCompany(nm);
      if (n && names.has(n)) return true;
    }
    return false;
  };
}
