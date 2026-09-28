// A service rename, planned against the stores that keep service names
// outside settings and the prospect records (those are planServiceMerge's,
// in serviceNameMerges.js). Pure: each function takes what a store holds and
// returns what it should hold instead, or null when the store never named
// the old service, so a clean account plans to nothing and writes nothing.
// serviceRenameRunner.js does the reading and writing.

import {
  renameInNameString, renameInNameList, renameInNameMap, renameInLowerKeyMap, renameInLowerList,
} from './serviceNameMerges.js';

const norm = s => String(s ?? '').trim().toLowerCase();

/**
 * The Opps 2 records naming the old service, as bulkSetOppFields patches:
 * `{ [oppId]: { field: value } }`. Every record, open or closed, so the
 * closed deals the history tabs read are renamed with the rest.
 *
 *   Scope, and any other column linked to the Solutions list
 *                     comma-separated names (a single-pick column holds one)
 *   _unpricedServices JSON array of Scope names marked as not charged
 *   _pricingOption    the frozen Pricing option: services, rows[].services
 */
export function planOppsRename(records, from, to, columnLinks = {}) {
  const fields = new Set(['Scope']);
  const single = new Set();
  for (const [col, link] of Object.entries(columnLinks || {})) {
    if (link?.listKey !== 'solutions') continue;
    if (link.mode === 'single') single.add(col);
    else fields.add(col);
  }
  const patches = {};
  for (const r of records || []) {
    if (!r || r._id == null) continue;
    const patch = {};
    for (const f of fields) {
      const next = renameInNameString(r[f], from, to);
      if (next !== null) patch[f] = next;
    }
    for (const f of single) {
      if (typeof r[f] === 'string' && norm(r[f]) === norm(from)) patch[f] = to;
    }
    const unpriced = parseList(r._unpricedServices);
    if (unpriced) {
      const next = renameInNameList(unpriced, from, to);
      if (next) patch._unpricedServices = JSON.stringify(next);
    }
    const snap = r._pricingOption;
    if (snap && typeof snap === 'object') {
      let changed = false;
      const services = renameInNameList(snap.services, from, to);
      if (services) changed = true;
      const rows = Array.isArray(snap.rows)
        ? snap.rows.map(row => {
          const s = renameInNameList(row?.services, from, to);
          if (!s) return row;
          changed = true;
          return { ...row, services: s };
        })
        : snap.rows;
      if (changed) patch._pricingOption = { ...snap, ...(services ? { services } : {}), rows };
    }
    if (Object.keys(patch).length) patches[r._id] = patch;
  }
  return patches;
}

function parseList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}

// Pricing page, IndexedDB 'pricing-cache'.

// { [line item]: [service, …] }: the Line Item → Services mapping.
export function renameLineItemServices(map, from, to) {
  if (!map || typeof map !== 'object') return null;
  let out = null;
  for (const [k, list] of Object.entries(map)) {
    const next = renameInNameList(list, from, to);
    if (next) { out = out || { ...map }; out[k] = next; }
  }
  return out;
}

// { [option sheet]: [service, …] }: the per-option bundle Opps 2 offers.
export const renamePricingOptionServices = renameLineItemServices;

// { [lowercased service]: { structures, standardId } }
export const renameFeeStructures = renameInLowerKeyMap;

// The saved workbook's per-option service marks: servicesCompleted (a list
// of lowercased names) and priceCheckIgnored (keyed by lowercased name).
export function renameWorkbookServices(workbook, from, to) {
  if (!workbook || !Array.isArray(workbook.options)) return null;
  let changed = false;
  const options = workbook.options.map(o => {
    const done = renameInLowerList(o?.servicesCompleted, from, to);
    const ignored = renameInLowerKeyMap(o?.priceCheckIgnored, from, to);
    if (!done && !ignored) return o;
    changed = true;
    return { ...o, ...(done ? { servicesCompleted: done } : {}), ...(ignored ? { priceCheckIgnored: ignored } : {}) };
  });
  return changed ? { ...workbook, options } : null;
}

// Clients › Deal Sizing: { [company]: { services, serviceUnits, … } }, and
// the Account Potential estimate's { scenario: { services, serviceUnits } }.
function renameScope(scope, from, to) {
  if (!scope || typeof scope !== 'object') return null;
  const services = renameInNameList(scope.services, from, to);
  const units = renameInNameMap(scope.serviceUnits, from, to);
  if (!services && !units) return null;
  return { ...scope, ...(services ? { services } : {}), ...(units ? { serviceUnits: units } : {}) };
}

export function renameClientScopeMap(map, from, to) {
  if (!map || typeof map !== 'object') return null;
  let out = null;
  for (const [k, scope] of Object.entries(map)) {
    const next = renameScope(scope, from, to);
    if (next) { out = out || { ...map }; out[k] = next; }
  }
  return out;
}

export function renameEstimate(estimate, from, to) {
  const scenario = renameScope(estimate?.scenario, from, to);
  return scenario ? { ...estimate, scenario } : null;
}

// Pipeline dashboard: coverageServices, canonical names.
export function renamePipeline(pipeline, from, to) {
  const list = renameInNameList(pipeline?.coverageServices, from, to);
  return list ? { ...pipeline, coverageServices: list } : null;
}

// Deal timeline bands hidden per deal: { [deal]: [lowercased name] }.
export function renameHiddenBands(map, from, to) {
  if (!map || typeof map !== 'object') return null;
  let out = null;
  for (const [k, list] of Object.entries(map)) {
    const next = renameInLowerList(list, from, to);
    if (next) { out = out || { ...map }; out[k] = next; }
  }
  return out;
}
