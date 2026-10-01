// Fee Builder settings saved per deal, so the same SIA uploaded again comes
// back with the same picks. Pure, so it can be tested without a browser;
// PricingView stores the map and FeeBuilderTab draws the controls.
//
// A deal is told apart by the company on the SIA's header block (see
// siaKeyFacts), or by the file name when the header names no company. Each
// SIA load gets a fresh workbook id and its options may be numbered
// differently, so everything is saved against the option's sheet name and
// mapped back onto the option numbers of the SIA it is loaded into.
//
// Saved map: { [dealKey]: {
//   key, label, fileName, savedAt,
//   options: { [sheetName]: { picks, overrides, done: [doneKey] } },
// } }

import { siaKeyFacts } from './siaHistoryEntry.js';

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function fileBase(name) {
  return String(name || '').replace(/\.[a-z0-9]+$/i, '').trim();
}

// { key, label } naming the deal an SIA is for, or null with nothing to go on.
export function dealFor(workbook) {
  if (!workbook) return null;
  const company = siaKeyFacts(workbook.options || []).company;
  if (company) return { key: `company:${norm(company)}`, label: company };
  const base = fileBase(workbook.fileName);
  if (base) return { key: `file:${norm(base)}`, label: base };
  return null;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The done ticks are keyed `${optionNumber}|${serviceKey}`.
function doneFor(doneState, workbookId, optionNumber) {
  if (!doneState || doneState.workbookId !== workbookId || !isObj(doneState.done)) return [];
  const prefix = `${optionNumber ?? ''}|`;
  return Object.keys(doneState.done)
    .filter(k => k.startsWith(prefix) && doneState.done[k])
    .map(k => k.slice(prefix.length));
}

// The Fee Builder as it stands on `workbook`, ready to save.
export function snapshotFeeBuilder({ workbook, picks, overrides, doneState, now = Date.now() }) {
  const deal = dealFor(workbook);
  if (!deal) return null;
  const options = {};
  for (const o of workbook.options || []) {
    const name = String(o.sheetName || '').trim();
    if (!name) continue;
    const p = isObj(picks?.[o.optionNumber]) ? picks[o.optionNumber] : {};
    const t = isObj(overrides?.[o.optionNumber]) ? overrides[o.optionNumber] : {};
    const done = doneFor(doneState, workbook.id, o.optionNumber);
    if (!Object.keys(p).length && !Object.keys(t).length && !done.length) continue;
    options[name] = { picks: { ...p }, overrides: { ...t }, done };
  }
  return { key: deal.key, label: deal.label, fileName: workbook.fileName || '', savedAt: now, options };
}

// A saved entry laid onto `workbook`: the picks, typed fees and done ticks
// for every option whose sheet name it has. Sheets the SIA no longer has
// are listed in `missing`.
export function restoreFeeBuilder(saved, workbook) {
  const picks = {};
  const overrides = {};
  const done = {};
  const missing = [];
  let matched = 0;
  const byName = new Map((workbook?.options || []).map(o => [norm(o.sheetName), o]));
  for (const [name, s] of Object.entries(saved?.options || {})) {
    const o = byName.get(norm(name));
    if (!o) { missing.push(name); continue; }
    matched += 1;
    if (isObj(s?.picks) && Object.keys(s.picks).length) picks[o.optionNumber] = { ...s.picks };
    if (isObj(s?.overrides) && Object.keys(s.overrides).length) overrides[o.optionNumber] = { ...s.overrides };
    for (const k of Array.isArray(s?.done) ? s.done : []) done[`${o.optionNumber ?? ''}|${k}`] = true;
  }
  return {
    picks,
    overrides,
    doneState: workbook?.id ? { workbookId: workbook.id, done } : null,
    matched,
    missing,
  };
}

// The saved entry for the deal `workbook` is for, if there is one.
export function savedFor(savedMap, workbook) {
  const deal = dealFor(workbook);
  if (!deal || !isObj(savedMap)) return null;
  return savedMap[deal.key] || null;
}

export function putSaved(savedMap, entry) {
  if (!entry?.key) return savedMap;
  return { ...(isObj(savedMap) ? savedMap : {}), [entry.key]: entry };
}

export function removeSaved(savedMap, key) {
  if (!isObj(savedMap) || !(key in savedMap)) return savedMap;
  const next = { ...savedMap };
  delete next[key];
  return next;
}

// Saved deals for a picker, newest first.
export function listSaved(savedMap) {
  return Object.values(isObj(savedMap) ? savedMap : {})
    .filter(e => e?.key)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

// What one saved entry holds, for the Load saved list: its option sheets
// and how many picks, typed fees and done ticks they carry between them.
export function savedSummary(entry) {
  const opts = isObj(entry?.options) ? entry.options : {};
  let picks = 0, typed = 0, done = 0;
  for (const o of Object.values(opts)) {
    picks += Object.keys(isObj(o?.picks) ? o.picks : {}).length;
    // A typed Unit Count is its own key (ending |units), so it counts
    // apart from a fee typed on the same row.
    typed += Object.keys(isObj(o?.overrides) ? o.overrides : {}).length;
    done += Array.isArray(o?.done) ? o.done.length : 0;
  }
  return { sheets: Object.keys(opts), picks, typed, done };
}
