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

// ---------------------------------------------------------------------------
// The standard fee behind each row of a fee structure.
//
// Each of the service's cost lines is recovered by one fee row of the
// structure (or by none). By default a cost goes to the row carrying its
// fee name; the user can point it at any row instead. A row's standard fee
// is then what recovers the costs pointed at it, at their marked-up price:
//
//   upfront fee (Setup / One Time)   sum of upfront cost prices / units
//   recurring fee (monthly)          sum of monthly cost prices / units,
//                                    plus any upfront cost rolled over the
//                                    term: price / months billed / units
//
// An upfront cost on a monthly fee is billed nowhere until it is rolled
// over the term, so it is flagged rather than silently dropped. A monthly
// cost on an upfront fee is flagged the same way (there is no honest way
// to collect a monthly cost once). Costs whose own type is already rolled
// ("Setup Rolled", "One Time Rolled") roll without being asked.
//
//   rows          structure rows ({ feeName, type, unit, unitCount, startMonth })
//   costs         [{ key, description, type, price, feeNames: [..] }]
//   allocations   structure.allocations: { [cost key]: { fee, roll } } where
//                 fee is a lowercased fee name, '' for "not covered", or
//                 absent for the default
//   termMonths    the deal term

export const COST_BUCKET_UPFRONT = 'upfront';
export const COST_BUCKET_RECURRING = 'recurring';
export const COST_BUCKET_ROLLED = 'rolled';

export function costKey(description, type) {
  return `${norm(description)}::${norm(type)}`;
}

export function costBucket(type) {
  const t = norm(type);
  if (/\brolled\b/.test(t)) return COST_BUCKET_ROLLED;
  if (/recurring|monthly/.test(t)) return COST_BUCKET_RECURRING;
  if (/^(setup|one\s*time)/.test(t)) return COST_BUCKET_UPFRONT;
  return '';
}

export function feeBucket(type) {
  const t = norm(type);
  if (/recurring/.test(t)) return COST_BUCKET_RECURRING;
  if (/^(setup|one\s*time)$/.test(t)) return COST_BUCKET_UPFRONT;
  return '';
}

export function standardFeesForStructure({ rows = [], costs = [], allocations = {}, termMonths = 36, siteCount, accountCount } = {}) {
  const names = rows.map(r => norm(r?.feeName));
  const perRow = rows.map(() => ({ standardFee: null, costIdx: [], monthlyTotal: 0, upfrontTotal: 0 }));
  const costOut = costs.map((c) => {
    const a = allocations?.[c.key];
    let rowIdx = -1;
    let defaulted = false;
    if (a && typeof a.fee === 'string') {
      rowIdx = a.fee ? names.indexOf(norm(a.fee)) : -1;
    } else {
      defaulted = true;
      for (const n of c.feeNames || []) {
        const i = names.indexOf(norm(n));
        if (i >= 0 && norm(n)) { rowIdx = i; break; }
      }
    }
    const bucket = costBucket(c.type);
    const row = rowIdx >= 0 ? rows[rowIdx] : null;
    const fb = row ? (feeBucket(row.type) || (bucket === COST_BUCKET_ROLLED ? COST_BUCKET_RECURRING : bucket)) : '';
    const canRoll = bucket === COST_BUCKET_UPFRONT && fb === COST_BUCKET_RECURRING;
    const rolled = bucket === COST_BUCKET_ROLLED || (canRoll && a?.roll === true);
    let issue = '';
    if (row && typeof c.price === 'number') {
      if (fb === COST_BUCKET_RECURRING && bucket === COST_BUCKET_UPFRONT && !rolled) issue = 'upfrontOnRecurring';
      else if (fb === COST_BUCKET_UPFRONT && (bucket === COST_BUCKET_RECURRING || bucket === COST_BUCKET_ROLLED)) issue = 'recurringOnUpfront';
    }
    return { key: c.key, rowIdx, defaulted, bucket, feeBucket: fb, canRoll, rolled, issue, price: c.price };
  });

  rows.forEach((row, ri) => {
    const alt = feeStructureRowToAltRow(row, { siteCount, accountCount });
    const units = alt.unitCount > 0 ? alt.unitCount : 1;
    const fb = feeBucket(row?.type);
    const start = Math.max(1, Math.round(alt.startMonth || 1));
    const rollMonths = Math.max(1, Math.round(termMonths) - start + 1);
    const agg = perRow[ri];
    let any = false;
    costOut.forEach((co, ci) => {
      if (co.rowIdx !== ri) return;
      agg.costIdx.push(ci);
      if (typeof co.price !== 'number' || !Number.isFinite(co.price) || co.issue) return;
      const effBucket = fb || co.feeBucket;
      if (effBucket === COST_BUCKET_RECURRING) {
        if (co.bucket === COST_BUCKET_RECURRING) { agg.monthlyTotal += co.price; any = true; }
        else if (co.rolled) { agg.monthlyTotal += co.price / rollMonths; any = true; }
      } else if (effBucket === COST_BUCKET_UPFRONT && co.bucket === COST_BUCKET_UPFRONT) {
        agg.upfrontTotal += co.price;
        any = true;
      }
    });
    agg.rollMonths = rollMonths;
    if (any) {
      const total = (fb || costOut[agg.costIdx[0]]?.feeBucket) === COST_BUCKET_UPFRONT ? agg.upfrontTotal : agg.monthlyTotal;
      agg.standardFee = Math.round((total / units) * 100) / 100;
    }
  });
  return { perRow, costs: costOut };
}

// Tagging an unlinked cost line from the Services subtab.
//
// The same Line Item -> Services map the Linked To subtab edits, with one
// service added to one line item (keyed by the lowercased description).
// A service already there, matched case-insensitively, leaves the map as
// it was, so a double click can't duplicate it.
export function addServiceToLineItem(lineItemServices, lineItemKey, service) {
  const key = norm(lineItemKey);
  const name = String(service ?? '').trim();
  const map = lineItemServices || {};
  if (!key || !name) return map;
  const current = Array.isArray(map[key]) ? map[key] : [];
  if (current.some(s => norm(s) === norm(name))) return map;
  return { ...map, [key]: [...current, name] };
}

// Cost figures for the unlinked rows the warning lists: how many cost lines
// on the option carry each description, and their summed CTS.
export function costTotalsByLineItem(items) {
  const out = {};
  for (const item of items || []) {
    const key = norm(item?.description);
    if (!key) continue;
    const t = out[key] || (out[key] = { count: 0, cts: 0 });
    t.count += 1;
    if (typeof item.cts === 'number' && Number.isFinite(item.cts)) t.cts += item.cts;
  }
  return out;
}
