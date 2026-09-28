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

// ---------------------------------------------------------------------------
// Standard fee structures.
//
// A service can carry any number of saved fee structures: named sets of fee
// rows that say how the service is normally billed ("Setup + per account",
// "Flat program fee", ...). One of them can be marked the standard. They
// live apart from any one SIA, keyed by the lowercased service name, so
// they carry from deal to deal; applying one writes its rows into the
// loaded option's Alternative Fee schedule.
//
// A row is { feeName, type, fee, unit, unitCount, startMonth, feeGmPct,
// passThrough }. A blank fee, unit count or start month means "derive it",
// the same as a blank cell on the schedule: the fee from the costs carrying
// the fee name, the unit count from the SIA's site / account count, the
// start month from the costs.

export const FEE_STRUCTURE_TYPES = ['Setup', 'One Time', 'Recurring (monthly)'];
export const FEE_STRUCTURE_UNITS = ['Fixed', 'Per Site', 'Per Account', 'Per Meter'];

export function serviceKey(name) {
  return norm(name);
}

let idSeq = 0;
export function newFeeStructureId() {
  idSeq += 1;
  return `fs_${Date.now().toString(36)}_${idSeq}`;
}

export function blankFeeStructureRow() {
  return { feeName: '', type: '', fee: null, unit: '', unitCount: null, startMonth: null, feeGmPct: null, passThrough: false };
}

const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// A saved structure's rows seeded from what the Services tab shows as the
// service's fee structure today (schedule rows and the rows Build would
// add). Values the page derived stay blank, so they keep deriving; only
// what somebody typed on the schedule is carried over as typed.
export function feeStructureRowsFromFees(fees) {
  return (fees || []).filter(f => f && !f.missing).map(f => ({
    feeName: String(f.name || '').trim(),
    type: f.type || '',
    fee: f.feeIsManual && typeof f.feePerUnit === 'number' ? f.feePerUnit : null,
    unit: f.unit || '',
    unitCount: null,
    startMonth: numOrNull(f.manualStartMonth),
    feeGmPct: typeof f.manualGmPct === 'number' ? f.manualGmPct : null,
    passThrough: f.passThrough === true,
  }));
}

// A structure row as an Alternative Fee schedule row for the given option.
export function feeStructureRowToAltRow(row, { siteCount, accountCount } = {}) {
  const unit = row?.unit || '';
  let unitCount = numOrNull(row?.unitCount);
  if (unitCount == null) {
    if (unit === 'Per Site' && typeof siteCount === 'number' && siteCount > 0) unitCount = siteCount;
    else if (unit === 'Per Account' && typeof accountCount === 'number' && accountCount > 0) unitCount = accountCount;
    else unitCount = 1;
  }
  return {
    altItem: String(row?.feeName || '').trim(),
    type: row?.type || '',
    fee: numOrNull(row?.fee),
    unit,
    unitCount,
    startMonth: numOrNull(row?.startMonth),
    feeGmPct: typeof row?.feeGmPct === 'number' ? row.feeGmPct : null,
    passThrough: row?.passThrough === true,
  };
}

// The option's schedule with one structure applied: every row naming one of
// `replaceNames` (the service's current fee names) or one of the
// structure's own fee names comes out, and the structure's rows go in where
// the first of them was, or at the end when none was there. Rows for other
// fees are untouched. Blank structure rows are skipped.
export function applyFeeStructureToSchedule(schedule, structureRows, { replaceNames = [], siteCount, accountCount } = {}) {
  const incoming = (structureRows || [])
    .filter(r => String(r?.feeName || '').trim())
    .map(r => feeStructureRowToAltRow(r, { siteCount, accountCount }));
  const drop = new Set([...replaceNames.map(norm), ...incoming.map(r => norm(r.altItem))].filter(Boolean));
  const out = [];
  let insertAt = -1;
  const removed = [];
  for (const r of schedule || []) {
    if (drop.has(norm(r?.altItem))) {
      if (insertAt < 0) insertAt = out.length;
      removed.push(r);
      continue;
    }
    out.push(r);
  }
  if (insertAt < 0) {
    // Land above any trailing blank starter rows rather than under them.
    insertAt = out.length;
    while (insertAt > 0 && !String(out[insertAt - 1]?.altItem || '').trim() && out[insertAt - 1]?.fee == null) insertAt--;
  }
  out.splice(insertAt, 0, ...incoming);
  return { rows: out, removed, added: incoming };
}
