// The Pricing page's Services subtab: the service catalog from the Dropdowns
// tab, read against the SIA workbook that is loaded.
//
// Nothing here is a new mapping. A service reaches a cost line through the
// Line Item -> Services picks on the Linked To subtab (lineItemServices,
// keyed by the lowercased line item), which is also what feeds the Opps 2
// Scope picker. This file only turns those picks around so a service can
// be looked up from its side: which cost lines it covers, and so which fees
// price it.

import { altFeeUnitCount, siaUnitCount } from './altFeeAutoBuild.js';
import { isUsageUnit } from './siaUsageCounts.js';

// A fee per unit rounded to the cent the Fee column shows, or to five
// decimal places for a fee Per kWh / Per Dth, which is a fraction of a cent.
export function roundFee(v, unit) {
  const f = isUsageUnit(unit) ? 1e5 : 100;
  return Math.round(v * f) / f;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

// One cost line's own pick, set by Move to on the Services subtab.
//
// The map is keyed by the lowercased line item, so every cost line
// carrying that description shares one list of services. Moving a single
// cost line (the Setup half of a line item, say, while its Recurring half
// stays put) writes a list of its own under the line item plus the type
// the SIA gives it, which wins over the line item's list for that line
// alone. The SIA's type rather than a converted one, so converting the
// line later doesn't lose the pick. A key with "::" in it is always one of
// these; the Linked To subtab lists only the plain line item keys.
export const LINE_KEY_SEP = '::';
export function costLineServiceKey(description, siaType) {
  const d = norm(description);
  return d ? `${d}${LINE_KEY_SEP}${norm(siaType)}` : '';
}
export function isCostLineServiceKey(key) {
  return String(key ?? '').includes(LINE_KEY_SEP);
}
// One single row of the SIA, picked in the Services subtab's Pick services
// popup. Several rows can share a description AND a type (three One Time
// rows of Communication Support), so the only thing telling them apart is
// the row itself: keyed by the workbook item's id. These only ever live in
// an option's own picks (option.costLineServices), since an item id belongs
// to one option of one SIA.
export const ITEM_PICK_PREFIX = '#item:';
export function costLineItemKey(itemId) {
  return itemId == null || itemId === '' ? '' : `${ITEM_PICK_PREFIX}${itemId}`;
}

// The services one cost line (a workbook item: { id, description, type })
// is tied to: that row's own pick, else its line item + type pick, else its
// line item's.
export function servicesForCostLine(lineItemServices, item) {
  const row = item?.id != null ? lineItemServices?.[costLineItemKey(item.id)] : undefined;
  if (Array.isArray(row)) return row;
  const own = lineItemServices?.[costLineServiceKey(item?.description, item?.type)];
  if (Array.isArray(own)) return own;
  return lineItemServices?.[norm(item?.description)];
}

// Picks made for ONE option (the Services subtab's shared-line prompt).
//
// Splitting a shared line item there answers "which service is this cost
// line on this deal", which can differ from option to option, so the
// answer is saved on the option (option.costLineServices, keyed like the
// per-line picks above) rather than in the Linked To mapping every option
// reads. Reading an option lays its own picks over the mapping; the Linked
// To subtab and every other option never see them.
export function lineItemServicesOnOption(option, lineItemServices) {
  const shared = sharedLineItemServices(lineItemServices);
  const own = option?.costLineServices;
  if (!own || typeof own !== 'object' || Object.keys(own).length === 0) return shared;
  return { ...shared, ...own };
}

// The Linked To mapping with only its line item keys.
//
// Move to (and the shared-line prompt, before it went per option) used to
// write a cost line's own pick into the mapping itself, so a one-off move
// on one option of one SIA quietly followed that line item into every
// other option and every later SIA. Those picks now live on the option
// (option.costLineServices). Any still sitting in the mapping are dropped
// here, on load and on every read, so they stop steering anything; the
// Linked To subtab never listed them.
export function sharedLineItemServices(lineItemServices) {
  const map = lineItemServices && typeof lineItemServices === 'object' ? lineItemServices : {};
  const keys = Object.keys(map);
  if (!keys.some(k => isCostLineServiceKey(k) || k.startsWith(ITEM_PICK_PREFIX))) return map;
  const out = {};
  for (const k of keys) if (!isCostLineServiceKey(k) && !k.startsWith(ITEM_PICK_PREFIX)) out[k] = map[k];
  return out;
}

// The option's own pick for one cost line. A service points the line at
// it on this option only. A blank one puts the line back to shared on this
// option: its own pick is dropped, unless the mapping carries a per-line
// pick of its own (an older split made before picks were per option), in
// which case the line item's shared list is written instead so "Shared by
// all" still means that here.
export function setOptionCostLineService(optionPicks, lineItemServices, item, service) {
  const key = costLineServiceKey(item?.description, item?.type);
  const own = { ...(optionPicks && typeof optionPicks === 'object' ? optionPicks : {}) };
  if (!key) return own;
  const name = String(service ?? '').trim();
  if (name) {
    own[key] = [name];
    return own;
  }
  delete own[key];
  const map = lineItemServices || {};
  if (Array.isArray(map[key])) {
    const shared = Array.isArray(map[norm(item?.description)]) ? map[norm(item.description)] : [];
    own[key] = [...shared];
  }
  return own;
}

// One row's pick on the option (the Pick services popup). A service points
// that row alone at it. A blank one puts the row back to shared: its own
// pick is dropped, and if the row would still read as something other
// than the line item's shared list (a pick for its whole type, made in the
// prompt's menu), the shared list is written for the row instead.
export function setOptionItemService(optionPicks, lineItemServices, item, service) {
  const key = costLineItemKey(item?.id);
  const own = { ...(optionPicks && typeof optionPicks === 'object' ? optionPicks : {}) };
  if (!key) return own;
  const name = String(service ?? '').trim();
  if (name) {
    own[key] = [name];
    return own;
  }
  delete own[key];
  const shared = Array.isArray(lineItemServices?.[norm(item?.description)]) ? lineItemServices[norm(item.description)] : [];
  const now = servicesForCostLine({ ...(lineItemServices || {}), ...own }, item) || [];
  if (sharedSignature(now) !== sharedSignature(shared)) own[key] = [...shared];
  return own;
}

// Dropping every row pick of the given items, so a pick for their whole
// type (the prompt's menu) applies to all of them again.
export function clearOptionItemPicks(optionPicks, items) {
  const own = { ...(optionPicks && typeof optionPicks === 'object' ? optionPicks : {}) };
  for (const item of items || []) delete own[costLineItemKey(item?.id)];
  return own;
}

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

// Line items tagged "first in scope only" (lineItemPriority, keyed like the
// mapping) list their services in priority order, and the cost goes to one
// of them, not all: the first one some other line item on the option ties
// to, else the first one. So Direct Bill Payment - Partner A/C Setup SE,
// tagged Bill payment then Invoice collection, is Bill payment's cost when
// Bill payment is in the deal through its other lines, and Invoice
// collection's when it isn't.
//
// Only the other, ordinary line items say what is in scope: a priority
// line can't vouch for a service itself, or its first pick would always
// win. Returns the mapping with each priority line narrowed to its one
// service, for the cost lines of one option; every other entry is as it
// was.
export function effectiveLineItemServices(items, lineItemServices, lineItemPriority) {
  const map = lineItemServices || {};
  const prio = lineItemPriority || {};
  if (!Object.keys(prio).some(k => prio[k] && Array.isArray(map[k]) && map[k].length > 1)) return map;
  const anchored = new Set();
  for (const item of items || []) {
    const k = norm(item?.description);
    if (!k || prio[k]) continue;
    const mapped = servicesForCostLine(map, item);
    for (const s of Array.isArray(mapped) ? mapped : []) if (norm(s)) anchored.add(norm(s));
  }
  const out = { ...map };
  for (const k of Object.keys(prio)) {
    const list = Array.isArray(map[k]) ? map[k].filter(s => norm(s)) : [];
    if (!prio[k] || list.length < 2) continue;
    out[k] = [list.find(s => anchored.has(norm(s))) || list[0]];
  }
  return out;
}

// Services the given cost lines are mapped to, deduped case-insensitively,
// first casing wins.
export function servicesForItems(items, lineItemServices) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const mapped = servicesForCostLine(lineItemServices, item);
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
    const mapped = servicesForCostLine(lineItemServices, item);
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
export const FEE_STRUCTURE_UNITS = ['Fixed', 'Per Site', 'Per Account', 'Per Meter', 'Per kWh', 'Per Dth'];

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
export function feeStructureRowToAltRow(row, counts = {}) {
  const unit = row?.unit || '';
  let unitCount = numOrNull(row?.unitCount);
  if (unitCount == null) unitCount = altFeeUnitCount(unit, counts);
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
export function applyFeeStructureToSchedule(schedule, structureRows, { replaceNames = [], ...counts } = {}) {
  const incoming = (structureRows || [])
    .filter(r => String(r?.feeName || '').trim())
    .map(r => feeStructureRowToAltRow(r, counts));
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
//   startMonthFor (altRow) => the month a row with no Start Month of its own
//                 bills from on the schedule (its fee's saved default, or its
//                 costs' earliest), so the standard fee is priced over the
//                 months the fee actually bills. Rows fall back to month 1.
//
// A fee that starts after a monthly cost it covers misses the cost's first
// months. The standard fee catches them up: the cost's months over the
// term, spread over the fee's months (a $100 cost from month 1 on a fee
// from month 4 of 36 bills $100 x 36 / 33), so the term still recovers it.

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

// Each cost line's key within one list of lines. Two lines with the same
// line item, type and start month (two "Communication Support" monthly
// lines) would share a key and so a fee pick; the second and later ones
// get "::n2", "::n3", ... so each can be pointed at its own fee.
export function costKeysFor(costs) {
  const seen = new Map();
  return (costs || []).map(c => {
    const k = costKey(c?.description, c?.type, c?.startMonth);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}::n${n}` : k;
  });
}

// A line's allocation: its own, else the one saved under the shared key
// before lines were told apart, so an older pick still applies to all.
export function allocationFor(allocations, key) {
  if (!allocations || !key) return null;
  if (allocations[key]) return allocations[key];
  const base = String(key).replace(/::n\d+$/, '');
  return base !== key ? (allocations[base] || null) : null;
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

export function standardFeesForStructure({ rows = [], costs = [], allocations = {}, termMonths = 36, siteCount, accountCount, kwhCount, dthCount, startMonthFor, feeEscalator = 0, costEscalator = 0 } = {}) {
  const names = rows.map(r => norm(r?.feeName));
  const alts = rows.map(r => feeStructureRowToAltRow(r, { siteCount, accountCount, kwhCount, dthCount }));
  const rowStartOf = (ri) => {
    const own = Number(alts[ri]?.startMonth);
    const auto = own > 0 ? own : Number(startMonthFor?.(alts[ri]));
    return Math.max(1, Math.round(auto > 0 ? auto : 1));
  };
  const perRow = rows.map(() => ({ standardFee: null, costIdx: [], monthlyTotal: 0, upfrontTotal: 0 }));
  const costOut = costs.map((c) => {
    const a = allocationFor(allocations, c.key);
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
    const rowStart = row ? rowStartOf(rowIdx) : 1;
    const later = costStart > FIRST_YEAR_MONTHS;
    const billedEarly = later && !!row && yearOfMonth(rowStart) < yearOfMonth(costStart);
    // When the cost itself starts running, which is what the margin charges
    // from. startMonth can carry a Linked To start month that only moves
    // the fee; a cost from month 1 with a default of 4 still costs months
    // 1 to 3, and the fee has to catch them up.
    const billStart = Math.max(1, Math.round(Number(c.billStartMonth ?? c.startMonth) || 1));
    // The line's own count for the fee's unit (accounts for a Per Account
    // fee), when one was typed on the line. Not for a row with a Unit
    // Count typed on the structure itself: that one is the count it bills.
    const ownUnits = row && numOrNull(row.unitCount) == null ? siaUnitCount(alts[rowIdx].unit, c.unitCounts || {}) : null;
    return { key: c.key, rowIdx, ownUnits, defaulted, fellBack, bucket, feeBucket: fb, canRoll, rolled, issue, price: c.price, startMonth: costStart, billStartMonth: billStart, later, billedEarly, catchUpMonths: 0 };
  });

  const term = Math.max(1, Math.round(termMonths));
  const fe = Number(feeEscalator) || 0;
  const ce = Number(costEscalator) || 0;
  const weightedMonths = (from, esc) => escalatedMonths(from, esc, term);
  rows.forEach((row, ri) => {
    const alt = alts[ri];
    const units = alt.unitCount > 0 ? alt.unitCount : 1;
    // Each cost line is priced on its own count: its cost over its own
    // units, the shares added up to the fee per unit. A line with no count
    // of its own is on the row's. The fee bills on the largest of them
    // (unitCount), and mixedUnits lists them when they differ.
    const lineUnits = new Set();
    const fb = feeBucket(row?.type);
    const start = rowStartOf(ri);
    const rollMonths = Math.max(1, term - start + 1);
    // What one dollar of monthly fee bills over the term, escalating with
    // the fee escalator. A monthly fee is priced so its term revenue is the
    // term price of the costs on it, each escalating with the cost
    // escalator: at the target GM in every year when the two escalators
    // match, and over the term when they don't.
    const feeWeight = Math.max(1e-9, weightedMonths(start, fe));
    const agg = perRow[ri];
    agg.startMonth = start;
    // What the monthly fee is made of, before the escalators weigh it:
    // [kind, from, amount] with kind 'm' for a monthly cost from month
    // `from` and 'l' for a lump spread over the fee's months. Kept on an
    // applied fee's gmLink so it re-prices when the escalators move.
    const escTerms = new Map();
    const addTerm = (kind, from, amount) => {
      const k = `${kind}:${from}`;
      escTerms.set(k, [kind, from, (escTerms.get(k)?.[2] || 0) + amount]);
    };
    let any = false;
    costOut.forEach((co, ci) => {
      if (co.rowIdx !== ri) return;
      agg.costIdx.push(ci);
      if (typeof co.price !== 'number' || !Number.isFinite(co.price) || co.issue) return;
      const per = co.ownUnits > 0 ? co.ownUnits : units;
      lineUnits.add(per);
      // Per unit of the fee: a share over the line's own units.
      const price = co.price / per;
      const effBucket = fb || co.feeBucket;
      if (effBucket === COST_BUCKET_RECURRING) {
        if (co.bucket === COST_BUCKET_RECURRING) {
          // Months the cost runs before the fee starts are caught up over
          // the months the fee bills. A cost starting after the fee is
          // priced as if from the fee's start, so it isn't billed below
          // its monthly price.
          const costMonths = Math.max(0, term - co.billStartMonth + 1);
          const catchUp = co.billStartMonth < start && costMonths > rollMonths;
          co.catchUpMonths = catchUp ? start - co.billStartMonth : 0;
          const costWeight = weightedMonths(Math.min(co.billStartMonth, start), ce);
          agg.monthlyTotal += price * costWeight / feeWeight;
          addTerm('m', Math.min(co.billStartMonth, start), price);
          any = true;
        }
        else if (co.rolled) { agg.monthlyTotal += price / feeWeight; addTerm('l', 0, price); any = true; }
      } else if (effBucket === COST_BUCKET_UPFRONT && co.bucket === COST_BUCKET_UPFRONT) {
        agg.upfrontTotal += price;
        any = true;
      }
    });
    agg.rollMonths = rollMonths;
    agg.escalated = fe !== ce;
    agg.unitCount = lineUnits.size ? Math.max(...lineUnits) : units;
    agg.mixedUnits = lineUnits.size > 1 ? [...lineUnits].sort((a, b) => a - b) : null;
    if (any) {
      const upfront = (fb || costOut[agg.costIdx[0]]?.feeBucket) === COST_BUCKET_UPFRONT;
      // The totals are per unit already (each line over its own units).
      agg.exactFee = upfront ? agg.upfrontTotal : agg.monthlyTotal;
      if (!upfront && escTerms.size) {
        agg.escTerms = [...escTerms.values()];
      }
      agg.standardFee = roundFee(agg.exactFee, alt.unit);
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
      nextAlloc[k] = { ...(allocationFor(nextAlloc, k) || {}), fee: norm(name) };
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

// Moving a cost line from one service to another on the Services subtab.
//
// The same map again: the line item's pick of the one service is swapped
// for the other, in place, so a "first in scope only" line keeps its
// priority order. When the line item already names the service it is
// moving to, the old pick is simply dropped. A line item that doesn't name
// the service it is moving from is left as it was.
export function moveLineItemService(lineItemServices, lineItemKey, fromService, toService) {
  const key = norm(lineItemKey);
  const from = norm(fromService);
  const name = String(toService ?? '').trim();
  const map = lineItemServices || {};
  if (!key || !from || !name || from === norm(name)) return map;
  const current = Array.isArray(map[key]) ? map[key] : [];
  if (!current.some(s => norm(s) === from)) return map;
  const has = current.some(s => norm(s) === norm(name));
  const next = has
    ? current.filter(s => norm(s) !== from)
    : current.map(s => (norm(s) === from ? name : s));
  return { ...map, [key]: next };
}

// Moving ONE cost line from one service to another on the Services subtab.
//
// Only the line picked moves: its services (its own pick, else its line
// item's) with the one swapped for the other, the same way as above, are
// written as the line's own pick (see costLineServiceKey). Every other cost
// line carrying the same description keeps the line item's list. A move
// that lands the line back on exactly the line item's list drops its own
// pick again rather than keeping a copy. A line that isn't tied to the
// service it is moving from is left as it was.
//
//   item   the cost line: { description, type } with type as the SIA has it
export function moveCostLineService(lineItemServices, item, fromService, toService) {
  const map = lineItemServices || {};
  const key = costLineServiceKey(item?.description, item?.type);
  const from = norm(fromService);
  const name = String(toService ?? '').trim();
  if (!key || !from || !name || from === norm(name)) return map;
  const current = servicesForCostLine(map, item);
  const list = Array.isArray(current) ? current : [];
  if (!list.some(s => norm(s) === from)) return map;
  const has = list.some(s => norm(s) === norm(name));
  const next = has
    ? list.filter(s => norm(s) !== from)
    : list.map(s => (norm(s) === from ? name : s));
  const shared = map[norm(item?.description)];
  const same = Array.isArray(shared) && shared.length === next.length
    && shared.every((s, i) => norm(s) === norm(next[i]));
  const out = { ...map };
  if (same) delete out[key];
  else out[key] = next;
  return out;
}

// Move to on the Services subtab, for ONE option.
//
// Moving a cost line answers "which service is this line on this deal",
// so it is saved on the option (option.costLineServices, keyed by line
// item + SIA type like the shared-line prompt's picks) and never reaches
// the Linked To mapping, other options or later SIAs. The line's services
// as the option reads them now (its row's own pick, else its line + type
// pick, else the line item's) have the one swapped for the other, the same
// way as moveCostLineService. Row picks on the identical lines (`rows`)
// give way, since they all move together. A move that lands the line back
// on the line item's own list drops the pick rather than keeping a copy.
// A line not tied to the service it is moving from is left as it was.
//
//   item   the cost line: { id, description, type } with type as the SIA has it
//   rows   the option's workbook items alike in description and SIA type
export function moveOptionCostLineService(optionPicks, lineItemServices, item, fromService, toService, rows = []) {
  const map = sharedLineItemServices(lineItemServices);
  const own = optionPicks && typeof optionPicks === 'object' ? optionPicks : {};
  const key = costLineServiceKey(item?.description, item?.type);
  const from = norm(fromService);
  const name = String(toService ?? '').trim();
  if (!key || !from || !name || from === norm(name)) return own;
  const current = servicesForCostLine({ ...map, ...own }, item);
  const list = Array.isArray(current) ? current : [];
  if (!list.some(s => norm(s) === from)) return own;
  const has = list.some(s => norm(s) === norm(name));
  const next = has
    ? list.filter(s => norm(s) !== from)
    : list.map(s => (norm(s) === from ? name : s));
  const out = clearOptionItemPicks(own, [item, ...(rows || [])]);
  const shared = map[norm(item?.description)];
  const same = Array.isArray(shared) && shared.length === next.length
    && shared.every((s, i) => norm(s) === norm(next[i]));
  if (same) delete out[key];
  else out[key] = next;
  return out;
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

// Splitting a shared line item on the Services subtab.
//
// A line item tied to several services with no priority order counts its
// cost under every one of them. The Services subtab asks which of those
// services each of its cost lines really belongs to. A cost line here is a
// line item plus the type the SIA gives it (the same granularity Move to
// works at, see costLineServiceKey), so the Setup half can go to one
// service and the Recurring half to another.
//
// Returns the line items on the option still waiting on that answer, in
// the order the SIA lists them:
//   { key, name, services, lines: [{ description, type, count, cts, choices, pick }] }
// `choices` are the services that line is tied to now (its own pick, else
// the line item's), `pick` the one service it is split to (null while it
// is still shared). A line item drops out once every one of its cost lines
// is down to a single service, or when it is Ignored, marked "first in
// scope only" (that already picks one service), or kept shared on purpose:
// `sharedOk[key]` holds sharedSignature() of the list that was accepted, so
// adding or removing a service asks again.
export function sharedSignature(services) {
  return [...new Set((services || []).map(norm).filter(Boolean))].sort().join('|');
}
export function sharedLineItemsToSplit(items, lineItemServices, { priority = {}, ignored = {}, sharedOk = {} } = {}) {
  const map = lineItemServices || {};
  const groups = new Map();
  for (const item of items || []) {
    const key = norm(item?.description);
    if (!key || priority?.[key] || ignored?.[key]) continue;
    const shared = (Array.isArray(map[key]) ? map[key] : []).filter(s => norm(s));
    if (shared.length < 2) continue;
    if (sharedOk?.[key] && sharedOk[key] === sharedSignature(shared)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: String(item.description).trim(), services: shared, lines: [], byType: new Map() };
      groups.set(key, g);
    }
    const typeKey = norm(item.type);
    let line = g.byType.get(typeKey);
    if (!line) {
      line = { description: item.description, type: item.type || '', count: 0, cts: 0, choices: [], pick: null, mixed: false, items: [] };
      g.byType.set(typeKey, line);
      g.lines.push(line);
    }
    const current = servicesForCostLine(map, item);
    const choices = (Array.isArray(current) ? current : []).filter(s => norm(s));
    line.items.push({ item, choices, pick: choices.length === 1 ? choices[0] : null });
    line.count += 1;
    if (typeof item.cts === 'number' && Number.isFinite(item.cts)) line.cts += item.cts;
  }
  const out = [];
  for (const g of groups.values()) {
    // A type's rows read as one line while they agree; picked one by one
    // (Pick services) to different services, the line is mixed.
    for (const line of g.lines) {
      const sigs = new Set(line.items.map(r => sharedSignature(r.choices)));
      line.mixed = sigs.size > 1;
      line.choices = line.mixed ? [...new Set(line.items.flatMap(r => r.choices))] : line.items[0].choices;
      line.pick = !line.mixed && line.choices.length === 1 ? line.choices[0] : null;
    }
    if (!g.lines.some(l => l.items.some(r => r.choices.length > 1))) continue;
    out.push({ key: g.key, name: g.name, services: g.services, lines: g.lines });
  }
  return out;
}

// Pointing one cost line (a line item + SIA type) at one service, or with a
// blank service back at its line item's shared list. Writes the line's own
// pick (see costLineServiceKey); every other cost line carrying the same
// description keeps what it had.
export function setCostLineService(lineItemServices, item, service) {
  const map = lineItemServices || {};
  const key = costLineServiceKey(item?.description, item?.type);
  if (!key) return map;
  const name = String(service ?? '').trim();
  const out = { ...map };
  if (!name) delete out[key];
  else out[key] = [name];
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

// The service's pass-through cost lines that no fee row covers yet, each
// as the fee row that would bill it: named after the line, typed the way
// it bills (Setup / One Time up front, Recurring (monthly) for a monthly
// or rolled cost), ticked Pass so it bills at cost, starting when the
// cost does. `unitOf(item)` says 'Per Account' or 'Fixed' (the model
// picked for the line in the price check). Lines left out of the check,
// with no CTS, or already named by a row are skipped.
export function passThroughFeeRows(structure, costs, { unitOf = () => 'Fixed' } = {}) {
  const have = new Set((structure?.rows || []).map(r => norm(r?.feeName)).filter(Boolean));
  const out = [];
  for (const c of costs || []) {
    if (!c?.passThrough || c.ignored || typeof c.cts !== 'number') continue;
    const feeName = String(c.description || '').trim();
    if (!feeName || have.has(norm(feeName))) continue;
    have.add(norm(feeName));
    const bucket = costBucket(c.type);
    const type = bucket === COST_BUCKET_UPFRONT
      ? (/^setup/i.test(String(c.type || '').trim()) ? 'Setup' : 'One Time')
      : 'Recurring (monthly)';
    const start = Math.round(Number(c.startMonth) || 1);
    out.push({
      row: { ...blankFeeStructureRow(), feeName, type, unit: unitOf(c) === 'Per Account' ? 'Per Account' : 'Fixed', startMonth: start > 1 ? start : null, passThrough: true },
      key: costKey(c.description, c.type, c.startMonth),
    });
  }
  return out;
}

// Add those rows to the structure, each cost pointed at its own row so it
// stops falling to whichever row it defaulted to before.
export function addPassThroughFees(structure, costs, opts) {
  const add = passThroughFeeRows(structure, costs, opts);
  if (add.length === 0) return structure;
  const allocations = { ...(structure?.allocations || {}) };
  for (const a of add) allocations[a.key] = { ...(allocations[a.key] || {}), fee: norm(a.row.feeName) };
  return { ...structure, rows: [...(structure?.rows || []), ...add.map(a => a.row)], allocations };
}

export function feeStructureCostInputs(costs) {
  const keys = costKeysFor(costs);
  return (costs || []).map((c, i) => ({
    key: keys[i],
    description: c.description,
    type: c.type,
    price: c.price,
    startMonth: c.startMonth,
    billStartMonth: c.billStartMonth ?? c.startMonth,
    feeNames: [c.feeName, c.automatedName].filter(Boolean),
    ...(c.unitCounts ? { unitCounts: c.unitCounts } : {}),
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
export function standardFeeContext(structure, costs, { termMonths = 36, siteCount, accountCount, kwhCount, dthCount, startMonthFor, feeEscalator = 0, costEscalator = 0 } = {}) {
  const rows = structure?.rows || [];
  const costInputs = feeStructureCostInputs(costs);
  const opts = { rows, allocations: structure?.allocations || {}, termMonths, siteCount, accountCount, kwhCount, dthCount, startMonthFor, feeEscalator, costEscalator };
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
  // A blank Unit Count takes the one the fee's lines priced it on (the
  // largest of their own counts), so the fee bills on it.
  const counted = (r, idx) => {
    const n = std.perRow[idx]?.unitCount;
    if (numOrNull(r?.unitCount) != null || !(n > 0) || !std.perRow[idx]?.costIdx?.some(ci => std.costs[ci]?.ownUnits > 0)) return r;
    return { ...r, unitCount: n };
  };
  const billed = (r0, idx) => {
    const r = counted(r0, idx);
    if (r.fee != null || standardFee(idx) == null) return r;
    const out = { ...r, fee: standardFee(idx) };
    if (linkable) {
      out.gmLink = { atCost: atCost[idx]?.exactFee ?? 0, fixed: fixed[idx]?.exactFee ?? 0 };
      // A monthly fee also keeps what it is made of, per unit, so it
      // re-prices when the Escalator, Cost Esc. or term moves.
      if (atCost[idx]?.escTerms || fixed[idx]?.escTerms) {
        out.gmLink.esc = {
          feeFrom: std.perRow[idx].startMonth,
          atCost: atCost[idx]?.escTerms || [],
          fixed: fixed[idx]?.escTerms || [],
        };
      }
    }
    return out;
  };
  return { std, standardFee, billed, filled: structure ? { ...structure, rows: rows.map(billed) } : null };
}

// A linked fee's per-unit price at a Global GM%: the at-cost part marked
// up to it, plus the part priced some other way, rounded to the cent the
// Fee column shows (see roundFee).
//
// With `esc` ({ feeEscalator, costEscalator, termMonths, startMonth }) a
// monthly fee that kept its make-up (gmLink.esc) is also re-priced for
// the escalators, the term and its start month (the row's own, else the
// one it was built from), the same way standardFeesForStructure prices it.
export function feeAtGm(gmLink, gm, esc = null, unit = '') {
  if (!gmLink || typeof gm !== 'number' || !(gm < 1)) return null;
  let atCost = Number(gmLink.atCost) || 0;
  let fixed = Number(gmLink.fixed) || 0;
  if (esc && gmLink.esc) {
    const term = Math.max(1, Math.round(Number(esc.termMonths) || 36));
    const own = Math.round(Number(esc.startMonth));
    const feeFrom = own > 0 ? own : (Number(gmLink.esc.feeFrom) || 1);
    const feeWeight = Math.max(1e-9, escalatedMonths(feeFrom, Number(esc.feeEscalator) || 0, term));
    const partOf = (terms) => (terms || []).reduce((t, [kind, from, amount]) => t + (kind === 'm'
      ? amount * escalatedMonths(Math.min(from, feeFrom), Number(esc.costEscalator) || 0, term)
      : amount), 0) / feeWeight;
    atCost = partOf(gmLink.esc.atCost);
    fixed = partOf(gmLink.esc.fixed);
  }
  const v = atCost / (1 - gm) + fixed;
  return Number.isFinite(v) ? roundFee(v, unit) : null;
}

// Months from `from` to the end of a `term`-month deal, each weighted by
// the escalator of the year it falls in (1 in year 1, 1 + esc in year 2,
// ...). With no escalator it is the month count.
export function escalatedMonths(from, esc, term) {
  let w = 0;
  for (let m = Math.max(1, Math.round(from) || 1); m <= term; m++) w += Math.pow(1 + esc, Math.ceil(m / 12) - 1);
  return w;
}

// Every option's Alternative Fee schedule with its linked fees re-priced at
// a Global GM% (and, given `esc` { feeEscalator, costEscalator,
// termMonths }, for the escalators too). The same object back when
// nothing moved.
export function repriceLinkedFees(altFees, gm, esc = null) {
  let changed = false;
  const next = {};
  for (const [k, rows] of Object.entries(altFees || {})) {
    let rowsChanged = false;
    const out = (rows || []).map(r => {
      if (!r?.gmLink) return r;
      const fee = feeAtGm(r.gmLink, gm, esc ? { ...esc, startMonth: r.startMonth } : null, r.unit);
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
export function buildScheduleFromStructures(schedule, picks, { siteCount, accountCount, kwhCount, dthCount, structuresOnly = false } = {}) {
  let rows = [...(schedule || [])];
  const builtBy = new Map(); // fee name -> services that wrote it in this build
  const addedRows = new Set();
  const perService = [];
  for (const pick of picks || []) {
    const incoming = (pick.rows || []).filter(r => String(r?.feeName || '').trim());
    const own = incoming.filter(r => !builtBy.has(norm(r.feeName)));
    const joins = incoming.filter(r => builtBy.has(norm(r.feeName)));
    const replaceNames = (pick.replaceNames || []).filter(n => !builtBy.has(norm(n)));
    // A pick can carry its service's own counts (one typed on the Services
    // subtab), which win over the option's.
    const counts = { siteCount: pick.siteCount ?? siteCount, accountCount: pick.accountCount ?? accountCount, kwhCount: pick.kwhCount ?? kwhCount, dthCount: pick.dthCount ?? dthCount };
    const plan = applyFeeStructureToSchedule(rows, own, { replaceNames, ...counts });
    rows = plan.rows;
    const added = [...plan.added];
    for (const jr of joins) {
      const alt = feeStructureRowToAltRow(jr, counts);
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
  // `structuresOnly`: the schedule is the picked structures' fees and
  // nothing else. Every named row no structure wrote comes off (`dropped`),
  // the ones a structure replaced included; blank starter rows stay.
  let dropped = [];
  if (structuresOnly) {
    const replaced = new Set(perService.flatMap(ps => ps.removed));
    dropped = rows.filter(r => !serviceOf.has(r) && String(r?.altItem || '').trim() && !replaced.has(r));
    rows = rows.filter(r => serviceOf.has(r) || !String(r?.altItem || '').trim());
  }
  return { rows, perService, shared, dropped };
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
      ? roundFee(fees.reduce((a, b) => a + b, 0), list[0].unit)
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

// ---------------------------------------------------------------------------
// The option's cost by year, split by the kind of cost line: One Time,
// Setup and Recurring (a Rolled line stays with the kind it rolls). Only
// lines the side counts are summed (`counted(line)`), so the Total row
// matches the Term cost the Fee Builder's totals show. `Other` holds any
// type that is none of the three and is left out when empty.
//
//   costLines  feeBuilderPlan's costLines ({ type, byYear: [..] })
export const COST_KINDS = ['One Time', 'Setup', 'Recurring'];
export function costKindOf(type) {
  const t = norm(type);
  if (/^setup/.test(t)) return 'Setup';
  if (/^one\s*-?\s*time/.test(t)) return 'One Time';
  if (/recurring|monthly|annual/.test(t)) return 'Recurring';
  return 'Other';
}
export function costsByKind(costLines, numYears, counted = () => true) {
  const zeros = () => Array.from({ length: Math.max(1, numYears) }, () => 0);
  const out = Object.fromEntries([...COST_KINDS, 'Other'].map(k => [k, zeros()]));
  const total = zeros();
  for (const c of costLines || []) {
    if (!counted(c)) continue;
    const row = out[costKindOf(c.type)];
    total.forEach((_, i) => {
      const v = Number(c.byYear?.[i]) || 0;
      row[i] += v;
      total[i] += v;
    });
  }
  const rows = [...COST_KINDS, 'Other']
    .filter(k => k !== 'Other' || out.Other.some(v => Math.abs(v) > 0.005))
    .map(kind => ({ kind, byYear: out[kind] }));
  return { rows, total };
}

// A service's costs spread over the SIA's monthly kWh or Dth as a single
// rate: what one Recurring (monthly) fee Per kWh (or Per Dth) would have to
// be to recover every cost line at its marked-up price, setup and one-time
// costs rolled over the term. The same sum the ★ standard fee does for a
// structure with that one row (every cost falls back onto it). null where
// the SIA has no volume or there is nothing to recover.
export function usageRatesFor(costs, { kwhCount, dthCount, ...opts } = {}) {
  const rateOn = (unit, count) => {
    if (!(typeof count === 'number' && count > 0) || !(costs || []).length) return null;
    const structure = { rows: [{ feeName: '\u0001usage', type: 'Recurring (monthly)', unit, unitCount: count }] };
    const fee = standardFeeContext(structure, costs, opts).standardFee(0);
    return typeof fee === 'number' && fee > 0 ? fee : null;
  };
  return { perKwh: rateOn('Per kWh', kwhCount), perDth: rateOn('Per Dth', dthCount) };
}
