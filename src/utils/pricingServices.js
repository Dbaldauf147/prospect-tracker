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
// A row is { feeName, type, fee, unit, unitCount, startMonth, passThrough }.
// A blank fee, unit count or start month means "derive it", the same as a
// blank cell on the schedule: the fee from the costs carrying the fee name,
// the unit count from the SIA's site / account count, the start month from
// the costs. A structure carries no margin of its own: a derived fee is
// priced at the Pricing page's Global GM%, and the schedule works the fee's
// GM% out from there. (Structures saved while rows could carry their own
// markupPct / feeGmPct still hold them; both are ignored.)

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
  return { feeName: '', type: '', fee: null, unit: '', unitCount: null, startMonth: null, passThrough: false };
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
    feeGmPct: null,
    passThrough: row?.passThrough === true,
    ...(row?.gmLink ? { gmLink: row.gmLink } : {}),
    // The Fee Builder's note of which cost lines the row prices, for its
    // margin column. Stripped before anything is written to the schedule.
    ...(Array.isArray(row?.costIds) ? { costIds: row.costIds } : {}),
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
// is then what recovers the costs pointed at it, at their marked-up price
// (the Pricing page's Global GM%, or a line's own GM% where it has one):
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
//   costs         [{ key, description, type, price, cost, startMonth, feeNames: [..] }]
//                 price is the cost marked up at its GM, cost is what it
//                 costs (CTS plus tech depreciation)
//   allocations   structure.allocations: { [cost key]: { fee, roll } } where
//                 fee is a lowercased fee name, '' for "not covered", or
//                 absent for the default
//   termMonths    the deal term

export const COST_BUCKET_UPFRONT = 'upfront';
export const COST_BUCKET_RECURRING = 'recurring';
export const COST_BUCKET_ROLLED = 'rolled';

// A cost starting after the first year (month 13 on) keeps its start month
// in the key, so a year-2 cost with the same line item and type as a
// year-1 one can be pointed at its own fee. Year-1 keys are unchanged.
export const FIRST_YEAR_MONTHS = 12;
export function costKey(description, type, startMonth) {
  const base = `${norm(description)}::${norm(type)}`;
  const m = Math.round(Number(startMonth) || 0);
  return m > FIRST_YEAR_MONTHS ? `${base}::m${m}` : base;
}

const yearOfMonth = (m) => Math.max(1, Math.ceil((Math.round(Number(m) || 1)) / 12));

export function costBucket(type) {
  const t = norm(type);
  if (/\brolled\b/.test(t)) return COST_BUCKET_ROLLED;
  if (/recurring|monthly/.test(t)) return COST_BUCKET_RECURRING;
  if (/^(setup|one\s*time)/.test(t)) return COST_BUCKET_UPFRONT;
  return '';
}

// A cost line whose type doesn't bill the way the standard fee covering it
// does, and the type that would make it fit. One Time or Setup on a
// monthly fee converts to its Rolled variant (the cost is spread over the
// fee's term); a Rolled cost on an upfront fee converts back to plain. A
// monthly cost on an upfront fee has no conversion that keeps its meaning,
// so it is only flagged. Null when the two agree or either is unknown.
export function costTypeConversion(costType, feeType) {
  const cb = costBucket(costType);
  const fb = feeBucket(feeType);
  if (!cb || !fb) return null;
  const base = /^setup/i.test(String(costType || '').trim()) ? 'Setup' : 'One Time';
  if (cb === COST_BUCKET_UPFRONT && fb === COST_BUCKET_RECURRING) {
    return { convertTo: `${base} Rolled`, feeBucket: fb };
  }
  if (cb === COST_BUCKET_ROLLED && fb === COST_BUCKET_UPFRONT) {
    return { convertTo: base, feeBucket: fb };
  }
  if (cb === COST_BUCKET_RECURRING && fb === COST_BUCKET_UPFRONT) {
    return { convertTo: null, feeBucket: fb };
  }
  return null;
}

// Move a cost's per-structure allocation to its new key when its type
// changes, so the fee it was pointed at follows it. The roll flag is
// dropped: a Rolled type rolls on its own.
export function moveCostAllocation(structures, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return structures;
  return (structures || []).map(st => {
    const a = st?.allocations?.[fromKey];
    if (!a) return st;
    const { [fromKey]: _drop, ...rest } = st.allocations;
    const { roll: _roll, ...kept } = a;
    return { ...st, allocations: { ...rest, [toKey]: kept } };
  });
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
    // A cost whose fee name no row carries goes to the first row that can
    // bill it, so a structure named differently from the SIA's fees (one
    // "Program fee" in place of "BBS per site") still prices from the
    // service's costs: a monthly or rolled cost to the first monthly row,
    // an upfront one to the first upfront row, else rolled over the term
    // on the first monthly row. A monthly cost with only upfront rows has
    // nowhere honest to go and stays uncovered.
    let fellBack = false;
    if (defaulted && rowIdx < 0 && bucket) {
      const firstOf = (b) => rows.findIndex(r => feeBucket(r?.type) === b);
      const rec = firstOf(COST_BUCKET_RECURRING);
      rowIdx = bucket === COST_BUCKET_UPFRONT
        ? (firstOf(COST_BUCKET_UPFRONT) >= 0 ? firstOf(COST_BUCKET_UPFRONT) : rec)
        : rec;
      fellBack = rowIdx >= 0;
    }
    const row = rowIdx >= 0 ? rows[rowIdx] : null;
    const fb = row ? (feeBucket(row.type) || (bucket === COST_BUCKET_ROLLED ? COST_BUCKET_RECURRING : bucket)) : '';
    const canRoll = bucket === COST_BUCKET_UPFRONT && fb === COST_BUCKET_RECURRING;
    const rolled = bucket === COST_BUCKET_ROLLED || (canRoll && (a?.roll === true || fellBack));
    let issue = '';
    if (row && typeof c.price === 'number') {
      if (fb === COST_BUCKET_RECURRING && bucket === COST_BUCKET_UPFRONT && !rolled) issue = 'upfrontOnRecurring';
      else if (fb === COST_BUCKET_UPFRONT && (bucket === COST_BUCKET_RECURRING || bucket === COST_BUCKET_ROLLED)) issue = 'recurringOnUpfront';
    }
    // A cost that starts after the first year on a fee that bills from an
    // earlier year is collected before it is spent. Flagged, not dropped:
    // "Add fees for later costs" gives it a fee of its own.
    const costStart = Math.round(Number(c.startMonth) || 1);
    const rowStart = row ? Math.round(Number(row.startMonth) || 1) : 1;
    const later = costStart > FIRST_YEAR_MONTHS;
    const billedEarly = later && !!row && yearOfMonth(rowStart) < yearOfMonth(costStart);
    return { key: c.key, rowIdx, defaulted, fellBack, bucket, feeBucket: fb, canRoll, rolled, issue, price: c.price, startMonth: costStart, later, billedEarly };
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
      const price = co.price;
      if (typeof price !== 'number' || !Number.isFinite(price) || co.issue) return;
      const effBucket = fb || co.feeBucket;
      if (effBucket === COST_BUCKET_RECURRING) {
        if (co.bucket === COST_BUCKET_RECURRING) { agg.monthlyTotal += price; any = true; }
        else if (co.rolled) { agg.monthlyTotal += price / rollMonths; any = true; }
      } else if (effBucket === COST_BUCKET_UPFRONT && co.bucket === COST_BUCKET_UPFRONT) {
        agg.upfrontTotal += price;
        any = true;
      }
    });
    agg.rollMonths = rollMonths;
    if (any) {
      const total = (fb || costOut[agg.costIdx[0]]?.feeBucket) === COST_BUCKET_UPFRONT ? agg.upfrontTotal : agg.monthlyTotal;
      agg.exactFee = total / units;
      agg.standardFee = Math.round(agg.exactFee * 100) / 100;
    }
  });
  return { perRow, costs: costOut };
}

// Standard fees for the costs that start after the first year.
//
// Every cost starting month 13 or later that isn't already on a fee billing
// from its own year gets one: costs are grouped by start month and by how
// they bill (upfront or monthly), and each group becomes a fee row named
// after the fee it sat on (or its line item) with "(year N)", starting the
// month the costs do, carrying that fee's unit. The costs are pointed at
// the new rows, so each row's standard fee recovers exactly them. Returns
// the structure unchanged when there is nothing to add.
export function addLaterCostFees(structure, costs, opts = {}) {
  const rows = structure?.rows || [];
  const allocations = structure?.allocations || {};
  const { costs: out } = standardFeesForStructure({ ...opts, rows, costs, allocations });
  const groups = new Map();
  out.forEach((co, ci) => {
    if (!co.later || (co.rowIdx >= 0 && !co.billedEarly)) return;
    const monthly = co.bucket === COST_BUCKET_RECURRING || co.bucket === COST_BUCKET_ROLLED;
    const gk = `${co.startMonth}::${monthly ? 'm' : 'u'}`;
    if (!groups.has(gk)) groups.set(gk, { startMonth: co.startMonth, monthly, idx: [] });
    groups.get(gk).idx.push(ci);
  });
  if (groups.size === 0) return structure;

  const taken = new Set(rows.map(r => norm(r?.feeName)).filter(Boolean));
  const newRows = [];
  const nextAlloc = { ...allocations };
  for (const g of groups.values()) {
    const first = out[g.idx[0]];
    // The fee it sits on now, else the one its year-1 counterpart (same
    // line item) is on, so "BPS per site" carries on as "BPS per site
    // (year 2)" with the same unit.
    const twin = out.find((co, ci) => !co.later && co.rowIdx >= 0 && norm(costs[ci]?.description) === norm(costs[g.idx[0]]?.description));
    const fromIdx = first.rowIdx >= 0 ? first.rowIdx : (twin ? twin.rowIdx : -1);
    const from = fromIdx >= 0 ? rows[fromIdx] : null;
    const base = String(from?.feeName || costs[g.idx[0]]?.description || 'Fee').trim()
      .replace(/\s*\((year|y)\s*\d+\)\s*$/i, '');
    let name = `${base} (year ${yearOfMonth(g.startMonth)})`;
    for (let n = 2; taken.has(norm(name)); n++) name = `${base} (year ${yearOfMonth(g.startMonth)}, ${n})`;
    taken.add(norm(name));
    const upfrontType = from && feeBucket(from.type) === COST_BUCKET_UPFRONT ? from.type : 'One Time';
    newRows.push({
      feeName: name,
      type: g.monthly ? 'Recurring (monthly)' : upfrontType,
      fee: null,
      unit: from?.unit || '',
      unitCount: from?.unitCount ?? null,
      startMonth: g.startMonth,
      passThrough: from?.passThrough === true,
    });
    for (const ci of g.idx) {
      const k = costs[ci].key;
      nextAlloc[k] = { ...(nextAlloc[k] || {}), fee: norm(name) };
    }
  }
  return { ...structure, rows: [...rows, ...newRows], allocations: nextAlloc };
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

// ---------------------------------------------------------------------------
// A structure with its blank Fee cells filled by the standard fee: the rows
// Apply writes and the option preview bills. Shared by the Services subtab
// and the Fee Builder subtab so neither can write a different fee from the
// one the other shows.
//
//   costs   the service's cost lines as the Services subtab reads them
//           ({ description, type, price, cost, startMonth, feeName, automatedName })

export function feeStructureCostInputs(costs) {
  return (costs || []).map(c => ({
    key: costKey(c.description, c.type, c.startMonth),
    description: c.description,
    type: c.type,
    price: c.price,
    startMonth: c.startMonth,
    feeNames: [c.feeName, c.automatedName].filter(Boolean),
  }));
}

//
// When the costs also carry priceAtCost (the cost a line is marked up from
// when it follows the page's Global GM%, else 0) and priceFixed (the price
// of a line that doesn't: pass-through or its own GM%), each filled fee
// also gets a gmLink: the standard fee split into the part that moves with
// the Global GM% and the part that doesn't. The schedule re-prices a
// linked fee from it whenever the Global GM% changes (feeAtGm), so a
// built fee keeps following the margin instead of freezing at the one it
// was built at.
export function standardFeeContext(structure, costs, { termMonths = 36, siteCount, accountCount } = {}) {
  const rows = structure?.rows || [];
  const costInputs = feeStructureCostInputs(costs);
  const opts = { rows, allocations: structure?.allocations || {}, termMonths, siteCount, accountCount };
  const std = standardFeesForStructure({ ...opts, costs: costInputs });
  const standardFee = (idx) => std.perRow[idx]?.standardFee ?? null;
  const linkable = (costs || []).some(c => typeof c?.priceAtCost === 'number');
  const split = (field) => standardFeesForStructure({
    ...opts,
    costs: costInputs.map((c, i) => ({
      ...c,
      price: typeof c.price === 'number' ? (Number(costs[i]?.[field]) || 0) : c.price,
    })),
  }).perRow;
  const atCost = linkable ? split('priceAtCost') : null;
  const fixed = linkable ? split('priceFixed') : null;
  const billed = (r, idx) => {
    if (r.fee != null || standardFee(idx) == null) return r;
    const out = { ...r, fee: standardFee(idx) };
    if (linkable) out.gmLink = { atCost: atCost[idx]?.exactFee ?? 0, fixed: fixed[idx]?.exactFee ?? 0 };
    return out;
  };
  return { std, standardFee, billed, filled: structure ? { ...structure, rows: rows.map(billed) } : null };
}

// A linked fee's per-unit price at a Global GM%: the at-cost part marked
// up to it, plus the part priced some other way, rounded to the cent the
// Fee column shows.
export function feeAtGm(gmLink, gm) {
  if (!gmLink || typeof gm !== 'number' || !(gm < 1)) return null;
  const v = (Number(gmLink.atCost) || 0) / (1 - gm) + (Number(gmLink.fixed) || 0);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

// Every option's Alternative Fee schedule with its linked fees re-priced at
// a Global GM%. The same object back when nothing moved.
export function repriceLinkedFees(altFees, gm) {
  let changed = false;
  const next = {};
  for (const [k, rows] of Object.entries(altFees || {})) {
    let rowsChanged = false;
    const out = (rows || []).map(r => {
      if (!r?.gmLink) return r;
      const fee = feeAtGm(r.gmLink, gm);
      if (fee == null || fee === r.fee) return r;
      rowsChanged = true;
      return { ...r, fee };
    });
    next[k] = rowsChanged ? out : rows;
    if (rowsChanged) changed = true;
  }
  return changed ? next : altFees;
}

// ---------------------------------------------------------------------------
// Fee Builder: several services' fee structures written into one option's
// Alternative Fee schedule in one go.
//
//   picks   [{ service, structureName, rows, replaceNames }] in list order,
//           rows being the structure's (already filled) rows and
//           replaceNames the service's current fee names, the same ones
//           Apply on the Services subtab replaces
//
// Each pick is applied in turn with applyFeeStructureToSchedule, with one
// difference: a fee name an earlier pick in this same build wrote is never
// dropped because a later service happens to list it among its current fee
// names. When a later structure writes that same fee name itself, both
// services keep their row: the later one lands right under the earlier
// one, so the schedule carries one row per service under the shared name
// and bills them all. Those are reported in shared.
//
// A row in such a group with no fee of its own (the service's standard fee
// came out blank) would be left to derive its fee from every cost carrying
// the name, the other services' included, and bill them twice. So when a
// sibling has a fee the blank row is dropped, and when none has one only
// the first is kept. The services that lost their row that way are listed
// under unpriced.
export function buildScheduleFromStructures(schedule, picks, { siteCount, accountCount } = {}) {
  let rows = [...(schedule || [])];
  const builtBy = new Map(); // fee name -> services that wrote it in this build
  const addedRows = new Set();
  const perService = [];
  for (const pick of picks || []) {
    const incoming = (pick.rows || []).filter(r => String(r?.feeName || '').trim());
    const own = incoming.filter(r => !builtBy.has(norm(r.feeName)));
    const joins = incoming.filter(r => builtBy.has(norm(r.feeName)));
    const replaceNames = (pick.replaceNames || []).filter(n => !builtBy.has(norm(n)));
    const plan = applyFeeStructureToSchedule(rows, own, { replaceNames, siteCount, accountCount });
    rows = plan.rows;
    const added = [...plan.added];
    for (const jr of joins) {
      const alt = feeStructureRowToAltRow(jr, { siteCount, accountCount });
      const k = norm(alt.altItem);
      let at = -1;
      rows.forEach((r, i) => { if (addedRows.has(r) && norm(r.altItem) === k) at = i; });
      rows = [...rows.slice(0, at + 1), alt, ...rows.slice(at + 1)];
      added.push(alt);
    }
    for (const r of added) {
      const k = norm(r.altItem);
      const list = builtBy.get(k) || [];
      if (!list.includes(pick.service)) list.push(pick.service);
      builtBy.set(k, list);
      addedRows.add(r);
    }
    perService.push({
      service: pick.service,
      structureName: pick.structureName || '',
      added,
      // Only rows that were on the schedule before the build count as
      // replaced.
      removed: plan.removed.filter(r => !addedRows.has(r)),
    });
  }

  const serviceOf = new Map();
  for (const ps of perService) for (const r of ps.added) serviceOf.set(r, ps.service);
  const shared = [];
  for (const [k, services] of builtBy) {
    if (services.length < 2) continue;
    const group = rows.filter(r => addedRows.has(r) && norm(r.altItem) === k);
    const priced = group.filter(r => r.fee != null);
    const keep = new Set(priced.length ? priced : group.slice(0, 1));
    const drop = group.filter(r => !keep.has(r));
    if (drop.length) {
      // The row that stays bills the dropped rows' costs, so it carries
      // them for the margin too.
      const first = [...keep][0];
      const ids = drop.flatMap(r => r.costIds || []);
      if (ids.length) {
        const merged = { ...first, costIds: [...(first.costIds || []), ...ids] };
        serviceOf.set(merged, serviceOf.get(first));
        keep.delete(first);
        keep.add(merged);
        rows = rows.map(r => (r === first ? merged : r));
        for (const ps of perService) ps.added = ps.added.map(r => (r === first ? merged : r));
      }
      rows = rows.filter(r => !drop.includes(r));
    }
    const kept = [...new Set([...keep].map(r => serviceOf.get(r)))];
    shared.push({
      fee: group[0].altItem,
      services: kept,
      unpriced: [...new Set(drop.map(r => serviceOf.get(r)))].filter(x => !kept.includes(x)),
    });
  }
  return { rows, perService, shared };
}

// The as-built rows with every fee name that shows more than once folded
// into a group: one line for the fee (its years and term summed, the
// shared columns carried when every row agrees) over a sub-row per row.
//
//   rows   [{ name, service, type, feePerUnit, unit, unitCount, startMonth,
//             years: [..], term }]
//
// Returns [{ row, subRows }] in first-seen order, subRows empty for a fee
// with one row. Rows carrying cost (the term cost of the lines they price)
// give the group that cost summed and its margin on the summed term. A
// group's fee per unit is the sum of its rows' when they
// all bill the same unit and count, and blank otherwise, since adding
// per-site to per-account says nothing.
export function groupFeeRows(rows) {
  const order = [];
  const byName = new Map();
  for (const r of rows || []) {
    const k = norm(r?.name);
    if (!byName.has(k)) { byName.set(k, []); order.push(k); }
    byName.get(k).push(r);
  }
  const same = (list, f) => list.every(x => (x[f] ?? '') === (list[0][f] ?? ''));
  return order.map(k => {
    const list = byName.get(k);
    if (list.length === 1) return { row: list[0], subRows: [] };
    const n = Math.max(...list.map(x => (x.years || []).length));
    const years = Array.from({ length: n }, (_, i) => list.reduce((s, x) => s + (Number(x.years?.[i]) || 0), 0));
    const fees = list.map(x => x.feePerUnit);
    const sumFee = same(list, 'unit') && same(list, 'unitCount') && fees.every(f => typeof f === 'number')
      ? Math.round(fees.reduce((a, b) => a + b, 0) * 100) / 100
      : null;
    const starts = list.map(x => Number(x.startMonth)).filter(Number.isFinite);
    const services = [...new Set(list.map(x => x.service).filter(Boolean))];
    return {
      row: {
        name: list[0].name,
        service: services.length ? services.join(', ') : null,
        type: same(list, 'type') ? list[0].type : 'Mixed',
        feePerUnit: sumFee,
        unit: same(list, 'unit') ? list[0].unit : 'Mixed',
        unitCount: same(list, 'unitCount') ? list[0].unitCount : null,
        startMonth: starts.length ? Math.min(...starts) : null,
        passThrough: list.every(x => x.passThrough),
        years,
        term: years.reduce((a, b) => a + b, 0),
        ...(() => {
          if (!list.some(x => typeof x.cost === 'number')) return {};
          const cost = list.reduce((a, x) => a + (Number(x.cost) || 0), 0);
          const term = years.reduce((a, b) => a + b, 0);
          return { cost, margin: term > 0 ? (term - cost) / term : null };
        })(),
      },
      subRows: list,
    };
  });
}
