// The PE Overview services report: for a chosen set of services, where
// each of a PE firm's companies stands on each one.
//
// The question it answers is "we're pushing these three services into this
// firm's portfolio — who has what?", which neither existing surface gives.
// The PE Overview table's Services Sold / Not Sold / In Progress columns
// list whatever a company happens to have explored, so comparing three
// named services across twenty companies means reading twenty cells and
// holding the answer in your head. Pipeline's coverage table does one
// service at a time, across clients rather than a firm's portfolio.
//
// Pure — no React, no Firestore — so the bucketing and the roll-ups can be
// tested directly. Status resolution is delegated to serviceCoverage's
// effectiveServiceStatus, which is what every company page uses (a manual
// servicesExplored value wins, otherwise the stage of an opp whose Scope
// names the service), so this report can't disagree with the company page
// a user opens to check it.

import { effectiveServiceStatus } from './serviceCoverage.js';
import { serviceStatusBucket } from './serviceStatusColors.js';

/** A status counts toward coverage when it says anything at all. */
function isExplored(bucket) {
  return bucket !== 'none';
}

/**
 * Build the report.
 *
 *   companies         the prospects to report on, in display order
 *   serviceKeys       canonical service names, in the order picked
 *   oppStagesByClient Map<prospect, Map<serviceKey, stage>> from
 *                     buildOppStagesByClient; omit to use only the manual
 *                     statuses saved on each company
 *   labelOf           canonical key -> display label (honours renames)
 *
 * Returns:
 *   rows      one per company: the status and bucket for each service,
 *             plus that company's own explored / sold counts
 *   services  one per service: the bucket counts across every company,
 *             and the share of companies that have explored it
 *   totals    the report-wide roll-up, for the header line
 */
export function buildPeServicesReport({
  companies = [],
  serviceKeys = [],
  oppStagesByClient = null,
  labelOf = null,
} = {}) {
  const keys = serviceKeys.filter(Boolean);
  const label = (k) => (labelOf && labelOf.get ? labelOf.get(k) : null) || k;

  const services = keys.map(key => ({
    key,
    label: label(key),
    sold: 0, inProgress: 0, notSold: 0, na: 0, none: 0,
    explored: 0,
    total: companies.length,
    pct: 0,
  }));
  const byKey = new Map(services.map(s => [s.key, s]));

  const rows = companies.map(p => {
    const statuses = {};
    const buckets = {};
    let explored = 0;
    let sold = 0;
    for (const key of keys) {
      const status = effectiveServiceStatus(p, key, oppStagesByClient);
      const bucket = serviceStatusBucket(status);
      statuses[key] = status;
      buckets[key] = bucket;
      const svc = byKey.get(key);
      svc[bucket] += 1;
      if (isExplored(bucket)) {
        svc.explored += 1;
        explored += 1;
      }
      if (bucket === 'sold') sold += 1;
    }
    return {
      id: p.id,
      company: p.company || '',
      _prospect: p,
      statuses,
      buckets,
      explored,
      sold,
      // Every picked service has an answer on this company — the row is
      // done, and a report filtered to gaps can drop it.
      complete: keys.length > 0 && explored === keys.length,
    };
  });

  for (const s of services) {
    s.pct = s.total ? Math.round((s.explored / s.total) * 100) : 0;
  }

  const cells = companies.length * keys.length;
  const exploredCells = services.reduce((n, s) => n + s.explored, 0);
  const soldCells = services.reduce((n, s) => n + s.sold, 0);

  return {
    rows,
    services,
    totals: {
      companies: companies.length,
      services: keys.length,
      cells,
      explored: exploredCells,
      sold: soldCells,
      pct: cells ? Math.round((exploredCells / cells) * 100) : 0,
      // Companies with nothing at all on any picked service — the list to
      // work, and the number worth saying out loud.
      untouched: rows.filter(r => r.explored === 0).length,
    },
  };
}

// Sort orders offered on the report. Company name is the default because
// a report is read against a list you already know; the other two put the
// gaps (or the wins) at the top.
export const PE_SERVICES_SORTS = [
  { key: 'company', label: 'Company (A–Z)' },
  { key: 'leastExplored', label: 'Biggest gaps first' },
  { key: 'mostExplored', label: 'Most explored first' },
  { key: 'mostSold', label: 'Most sold first' },
];

/** Sorted copy of the report rows. Ties always fall back to company name. */
export function sortReportRows(rows, sortKey) {
  const byName = (a, b) => String(a.company).localeCompare(String(b.company));
  const out = [...rows];
  switch (sortKey) {
    case 'leastExplored': return out.sort((a, b) => a.explored - b.explored || byName(a, b));
    case 'mostExplored': return out.sort((a, b) => b.explored - a.explored || byName(a, b));
    case 'mostSold': return out.sort((a, b) => b.sold - a.sold || byName(a, b));
    default: return out.sort(byName);
  }
}
