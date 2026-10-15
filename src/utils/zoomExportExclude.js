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

// A Client is never left out of a ZoomInfo export: the flag is for keeping
// prospects out of a pull, and a client's decision makers are exactly the
// cross-sell names the pulls are for. Read ignoring spacing and case, as
// the status arrives from a sheet.
export function isClientStatus(status) {
  return String(status || '').trim().toLowerCase() === 'client';
}

export function isZoomExcluded(prospect) {
  return !!prospect?.excludeFromZoomExports && !isClientStatus(prospect?.status);
}

/**
 * (row) => boolean: whether an export row belongs to an excluded company.
 * `row` is { id?, company?, names?: [], zoomId? }; any one of them matching
 * an excluded company is enough.
 */
export function buildZoomExcludedMatcher(prospects) {
  const explain = buildZoomExclusionExplainer(prospects);
  return function isExcludedRow(row) {
    return explain(row) !== null;
  };
}

/**
 * (row) => null | string: the same test as buildZoomExcludedMatcher, but
 * saying WHY a row is dropped, so an export can tell the user which
 * companies it left out. A row can be caught by a different company than
 * itself (a shared Zoom Company ID, or a name that reads the same once
 * suffixes and brackets are set aside), and a silent drop of that kind
 * looks like a bug in the export.
 */
export function buildZoomExclusionExplainer(prospects) {
  const ids = new Map();
  const names = new Map();
  const zoomIds = new Map();
  // Clients, so a row that IS a client stays in even when another
  // (excluded) company shares its Zoom Company ID or reads the same by name.
  const clientIds = new Set();
  const clientNames = new Set();
  const clientZoomIds = new Set();
  for (const p of Array.isArray(prospects) ? prospects : []) {
    if (isClientStatus(p?.status)) {
      if (p.id != null) clientIds.add(String(p.id));
      const cn = normZoomCompany(p.company);
      if (cn) clientNames.add(cn);
      const cz = String(p.zoomCompanyId || '').trim();
      if (cz) clientZoomIds.add(cz);
      continue;
    }
    if (!isZoomExcluded(p)) continue;
    const label = String(p.company || '').trim() || 'a company';
    if (p.id != null && !ids.has(String(p.id))) ids.set(String(p.id), label);
    const n = normZoomCompany(p.company);
    if (n && !names.has(n)) names.set(n, label);
    const z = String(p.zoomCompanyId || '').trim();
    if (z && !zoomIds.has(z)) zoomIds.set(z, label);
  }
  if (!ids.size && !names.size && !zoomIds.size) return () => null;
  const isClientRow = (row) => isClientStatus(row.status)
    || (row.id != null && clientIds.has(String(row.id)))
    || [row.company, ...(row.names || [])].some(nm => { const n = normZoomCompany(nm); return n && clientNames.has(n); })
    || (String(row.zoomId || '').trim() !== '' && clientZoomIds.has(String(row.zoomId).trim()));
  return function whyExcluded(row) {
    if (!row) return null;
    if (isClientRow(row)) return null;
    if (row.id != null && ids.has(String(row.id))) return 'set to Exclude from ZoomInfo';
    const z = String(row.zoomId || '').trim();
    if (z && zoomIds.has(z)) {
      const by = zoomIds.get(z);
      return normZoomCompany(by) === normZoomCompany(row.company)
        ? 'set to Exclude from ZoomInfo'
        : `shares Zoom Company ID ${z} with ${by}, which is set to Exclude from ZoomInfo`;
    }
    for (const nm of [row.company, ...(row.names || [])]) {
      const n = normZoomCompany(nm);
      if (n && names.has(n)) {
        const by = names.get(n);
        return String(by).trim().toLowerCase() === String(row.company || '').trim().toLowerCase()
          ? 'set to Exclude from ZoomInfo'
          : `matches ${by} by name, which is set to Exclude from ZoomInfo`;
      }
    }
    return null;
  };
}
