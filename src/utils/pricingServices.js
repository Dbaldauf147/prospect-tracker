// The Pricing page's Services subtab: the service catalog from the Dropdowns
// tab, read against the SIA workbook that is loaded.
//
// Nothing here is a new mapping. A service reaches a cost line through the
// Line Item -> Services picks on the Linked To subtab (lineItemServices,
// keyed by the lowercased line item), which is also what feeds the Opps 2
// Scope picker. This file only turns those picks around so a service can
// be looked up from its side: which cost lines it covers, and so which fees
// price it.

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Status labels, in the order the list sorts them within a group.
export const SERVICE_STATUS = {
  ACTIVE: 'Active',
  RETIRED: 'Retired',
  HIDDEN: 'Hidden',
  OFF_LIST: 'Not in Dropdowns',
};
const STATUS_RANK = {
  [SERVICE_STATUS.ACTIVE]: 0,
  [SERVICE_STATUS.OFF_LIST]: 1,
  [SERVICE_STATUS.RETIRED]: 2,
  [SERVICE_STATUS.HIDDEN]: 3,
};

// Services the given cost lines are mapped to, deduped case-insensitively,
// first casing wins.
export function servicesForItems(items, lineItemServices) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const mapped = lineItemServices?.[norm(item?.description)];
    if (!Array.isArray(mapped)) continue;
    for (const s of mapped) {
      const k = norm(s);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(String(s).trim());
    }
  }
  return out;
}

// The rows of the Services list.
//
//   serviceRows      buildServiceRows(settings): { name, bucket, graveyard, meta }
//   hiddenServices   settings.hiddenServices
//   scopeServices    services the loaded SIA option's line items map to
//
// Each row is { name, bucket, status, inScope, meta }. In-scope services
// come first, then everything else; within each group active services
// lead and retired / hidden ones follow, keeping the Dropdowns order
// otherwise. A service the SIA maps to that the Dropdowns list no longer
// carries still shows, marked Not in Dropdowns, since it is in the deal.
export function buildPricingServiceList({ serviceRows = [], hiddenServices = [], scopeServices = [] } = {}) {
  const hidden = new Set((hiddenServices || []).map(norm));
  const scope = new Set((scopeServices || []).map(norm).filter(Boolean));
  const rows = [];
  const seen = new Set();
  (serviceRows || []).forEach((r, order) => {
    const k = norm(r?.name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const status = hidden.has(k)
      ? SERVICE_STATUS.HIDDEN
      : r.graveyard ? SERVICE_STATUS.RETIRED : SERVICE_STATUS.ACTIVE;
    rows.push({ name: r.name, bucket: r.bucket || '', status, inScope: scope.has(k), meta: r.meta || null, order });
  });
  for (const s of scopeServices || []) {
    const k = norm(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rows.push({ name: String(s).trim(), bucket: '', status: SERVICE_STATUS.OFF_LIST, inScope: true, meta: null, order: rows.length + 100000 });
  }
  rows.sort((a, b) => {
    if (a.inScope !== b.inScope) return a.inScope ? -1 : 1;
    const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (sr) return sr;
    return a.order - b.order;
  });
  return rows.map(r => ({ name: r.name, bucket: r.bucket, status: r.status, inScope: r.inScope, meta: r.meta }));
}

// The cost lines of one option that a service covers.
export function costItemsForService(items, lineItemServices, service) {
  const want = norm(service);
  if (!want) return [];
  return (items || []).filter(item => {
    const mapped = lineItemServices?.[norm(item?.description)];
    return Array.isArray(mapped) && mapped.some(s => norm(s) === want);
  });
}
