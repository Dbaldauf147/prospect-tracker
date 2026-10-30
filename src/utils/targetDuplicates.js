// Duplicate rows on the Target Accounts list.
//
// A row flagged as a duplicate stays in the saved workbook (so it can be
// unflagged, and the Excel round-trip keeps it), but nothing else in the
// app sees it: App's targetAccountsData, the Lists matching, the company
// popup's tier / CDM lookups and the server-built emails all read the
// list through withoutDuplicateRows. The flag lives on the record itself
// (DUPLICATE_FLAG), next to its _id, so it follows the row through edits,
// deletes and company renames.

import { normalizeCompany } from './companyNorm.js';

export const DUPLICATE_FLAG = '_duplicate';

export function isDuplicateRow(record) {
  return !!record?.[DUPLICATE_FLAG];
}

// The workbook minus every flagged row. Returns the same object when no
// row is flagged, so memoised consumers don't recompute for nothing.
export function withoutDuplicateRows(data) {
  if (!data?.sheets) return data;
  let changed = false;
  const sheets = {};
  for (const [name, sheet] of Object.entries(data.sheets)) {
    const records = Array.isArray(sheet?.records) ? sheet.records : null;
    if (!records || !records.some(isDuplicateRow)) { sheets[name] = sheet; continue; }
    changed = true;
    sheets[name] = { ...sheet, records: records.filter(r => !isDuplicateRow(r)) };
  }
  return changed ? { ...data, sheets } : data;
}

export function countDuplicateRows(data) {
  let n = 0;
  for (const sheet of Object.values(data?.sheets || {})) {
    for (const r of sheet?.records || []) if (isDuplicateRow(r)) n++;
  }
  return n;
}

// Every cell the sheet's headers name, ignoring the row's own _id and the
// flag, so the same row in a re-uploaded file can be recognised.
function rowSignature(record, headers) {
  return JSON.stringify((headers || []).filter(Boolean).map(h => String(record?.[h] ?? '').trim().toLowerCase()));
}

// A fresh upload replaces the workbook, which would bring every flagged
// duplicate straight back. Re-flag the rows of `next` that are cell for
// cell the same as a row flagged in `prev` on the sheet of the same name.
// Returns { data, count }.
export function carryDuplicateFlags(prev, next) {
  if (!prev?.sheets || !next?.sheets) return { data: next, count: 0 };
  let count = 0;
  const sheets = {};
  for (const [name, sheet] of Object.entries(next.sheets)) {
    const old = prev.sheets[name];
    const flagged = (old?.records || []).filter(isDuplicateRow);
    if (!flagged.length || !Array.isArray(sheet?.records)) { sheets[name] = sheet; continue; }
    // A multiset: two identical flagged rows re-flag two identical new rows.
    const pending = new Map();
    for (const r of flagged) {
      const sig = rowSignature(r, old.headers);
      pending.set(sig, (pending.get(sig) || 0) + 1);
    }
    sheets[name] = {
      ...sheet,
      records: sheet.records.map(r => {
        const sig = rowSignature(r, sheet.headers);
        const left = pending.get(sig) || 0;
        if (!left) return r;
        pending.set(sig, left - 1);
        count++;
        return { ...r, [DUPLICATE_FLAG]: true };
      }),
    };
  }
  return count ? { data: { ...next, sheets }, count } : { data: next, count: 0 };
}

// Normalised names that more than one unflagged row on the sheet shares,
// so the list can point at the likely duplicates still to be flagged.
export function possibleDuplicateNames(records, nameKey) {
  const counts = new Map();
  for (const r of records || []) {
    if (isDuplicateRow(r)) continue;
    const key = normalizeCompany(nameKey ? r?.[nameKey] : '');
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = new Set();
  for (const [k, n] of counts) if (n > 1) out.add(k);
  return out;
}
