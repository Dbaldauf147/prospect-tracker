// The Fee Builder's per-service checklist and its column picker. Pure, so it
// can be tested without a browser; PricingView persists both with the rest
// of the page and FeeBuilderTab draws them.
//
// Ticks belong to the SIA they were made on: the state carries the workbook
// id, and a different SIA reads as nothing ticked. A service is ticked per
// option, since each option's fees are worked through on their own.

import { serviceKey } from './pricingServices.js';

const doneKey = (optionNumber, name) => `${optionNumber ?? ''}|${serviceKey(name)}`;

export function isServiceDone(state, workbookId, optionNumber, name) {
  if (!state || !workbookId || state.workbookId !== workbookId) return false;
  return !!state.done?.[doneKey(optionNumber, name)];
}

export function setServiceDone(state, workbookId, optionNumber, name, on) {
  const same = state && state.workbookId === workbookId;
  const done = { ...(same ? state.done : {}) };
  const k = doneKey(optionNumber, name);
  if (on) done[k] = true; else delete done[k];
  return { workbookId, done };
}

// The service table's columns. Service is always shown (it names the row);
// the rest can be hidden from the Columns menu.
export const FEE_BUILDER_COLUMNS = [
  { key: 'costLines', label: 'Cost lines' },
  { key: 'cts', label: 'CTS' },
  { key: 'current', label: 'On the schedule now' },
  { key: 'structure', label: 'Fee structure' },
  { key: 'writes', label: 'Fees it writes' },
];

// `hidden` is the array of hidden column keys the page saves.
export function toggleHiddenColumn(hidden, key) {
  const list = Array.isArray(hidden) ? hidden : [];
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
}

// The Fee Builder keeps its picks and typed fees per option:
// { [optionNumber]: { ... } }. Runs `updater` on one option's map and puts
// the result back, dropping the option once its map is empty so a cleared
// option reads the same as one never touched.
export function updateForOption(byOption, optionNumber, updater) {
  const prev = byOption && typeof byOption === 'object' ? byOption : {};
  const next = updater(prev[optionNumber] || {});
  const out = { ...prev };
  if (next && Object.keys(next).length) out[optionNumber] = next; else delete out[optionNumber];
  return out;
}

// One option's Fee Builder picks rebuilt so another option picks the same
// structure for every service. A service with no pick of its own falls back
// on the option's SIA scope (standard when in scope, no fees when not), and
// scope differs between options, so a fallback that would land differently
// on the target is written out as an explicit pick.
//
//   services   [{ key, standardId }] - every service the builder knows
//   fromPicks  the source option's { [key]: structureId | '' }
//   fromScope  Set of keys in SIA scope on the source option
//   toScope    Set of keys in SIA scope on the target option
export function copyPicksBetweenOptions({ services, fromPicks, fromScope, toScope }) {
  const src = fromPicks && typeof fromPicks === 'object' ? fromPicks : {};
  const out = {};
  for (const { key, standardId } of services || []) {
    if (Object.prototype.hasOwnProperty.call(src, key)) { out[key] = src[key]; continue; }
    const wasIn = fromScope.has(key);
    const isIn = toScope.has(key);
    if (wasIn === isIn) continue;
    out[key] = wasIn ? (standardId || '') : '';
  }
  return out;
}
