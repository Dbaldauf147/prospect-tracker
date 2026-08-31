// Merge commission rows pasted from Excel / Google Sheets into the roster
// already on file. Lifted out of CommissionsView so the paste preview, the
// import itself and the tests all read the same rules — the preview used to
// describe an outcome the merge produced independently, and the two could
// drift.
//
// Rows are grouped by normalized Project Name. A pasted project that isn't on
// file is APPENDED; one that is merges into that row cell by cell rather than
// replacing it, because a commission's fiscal year straddles two calendar
// years (Griffis runs 7/1/2025 → 6/30/2026) while the columns here are plain
// calendar months: the second half of the year has to fill its own month
// slots without disturbing the first half, or the hand-added Account Name /
// BFO Name / Scope the paste never carries.
//
// What happens to a cell the paste and the row on file BOTH have a value for
// is the `dupeMode`:
//
//   'fill'    (default) — the row on file keeps it. A pasted value only lands
//               where the cell is blank, so re-pasting a snapshot fills the
//               gaps and changes nothing else. A pasted value that merely
//               repeats what's on file is a duplicate and ignored; one that
//               says something different is counted and reported, not applied.
//   'update'  — a non-blank pasted value wins, so a corrected figure updates
//               in place. (This was the only behaviour before 'fill'.)
//   'replace' — the row's month/period cells are cleared first and only this
//               paste's months survive: a clean per-project reset that still
//               keeps the row's identity and lookup columns. Cells outside the
//               months follow the 'update' rule.
//
// Blank pasted cells never clear anything in any mode.

import { COMMISSION_MONTH_NAMES } from './commissionsStore.js';

// Month/period cells a "replace months" import clears before overlaying the
// paste — the 12 revenue columns, the 12 commission columns, and the stored
// FY Revenue (recomputed from the months at render time anyway). Identity and
// user-mapped columns (Comm dates, %, Account/BFO/Scope, Name) are not period
// cells, so they survive a replace.
export const PERIOD_KEYS = new Set(['FY Revenue']);
for (const m of COMMISSION_MONTH_NAMES) { PERIOD_KEYS.add(`${m} Revenue`); PERIOD_KEYS.add(m); }

export const PROJECT_NAME_KEY = 'Project Name';

// Normalize a Project Name for duplicate matching — strips surrounding
// whitespace, collapses internal whitespace, and lowercases so trivial typing
// differences ("Acme — Phase 1" vs "ACME — Phase 1 ") count as the same
// project. The single source of truth for the dedup key: the paste preview,
// this merge and the table's duplicate flag all call it.
export function normProjectName(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const isBlank = (v) => v == null || String(v).trim() === '';
// Cell-level "same value?" — trimmed, internal whitespace collapsed, case
// folded, so a re-paste that only differs in spacing is a duplicate rather
// than a contradiction.
const sameValue = (a, b) => normProjectName(a) === normProjectName(b);

/**
 * Work out what a pasted batch does to the roster and build the merged roster
 * in one pass, so the modal's preview and the import can't disagree.
 *
 * Returns { next, results, summary, touched } where `next` is the merged
 * roster, `results` classifies each incoming row in the order given, `touched`
 * lists the indices in `next` this paste added to or changed (the caller
 * stamps those rows as freshly updated), and `summary` carries the counts.
 */
export function planCommissionsPaste(existing, incoming, { dupeMode = 'fill' } = {}) {
  const out = [];
  const order = [];                 // keyed projects, in first-seen order
  const existingByKey = new Map();
  const incomingByKey = new Map();
  const noteKey = (key) => { if (!existingByKey.has(key) && !incomingByKey.has(key)) order.push(key); };

  const results = [];
  const summary = {
    added: 0, merged: 0, pasteDuplicates: 0, skipped: 0,
    filledCells: 0, duplicateCells: 0, conflictCells: 0, overwrittenCells: 0, clearedCells: 0,
  };

  // Rows that repeat a Project Name *within this single paste*. The first copy
  // of a project merges into the row on file as usual; a genuine second copy
  // in the same paste is two distinct deals that happen to share a name, so
  // it's kept as its own row (appended below) instead of being unioned away.
  // The table flags these live — see duplicateIdsFrom in CommissionsView.
  const pasteDuplicateRows = [];

  // Existing rows seed the base and lead the output order. Rows with no
  // Project Name have no key to group by, so they pass through untouched.
  for (const row of (existing || [])) {
    const key = normProjectName(row?.[PROJECT_NAME_KEY]);
    if (!key) { out.push({ ...row }); continue; }
    noteKey(key);
    // A roster that already contains two rows for one project collapses onto
    // the first — the pre-existing behaviour, and the reason a second copy is
    // flagged in the table.
    const base = existingByKey.get(key);
    existingByKey.set(key, base ? overlay(base, row, 'update').row : { ...row });
  }

  (incoming || []).forEach((raw, i) => {
    // Row numbers report against the user's pasted spreadsheet — headers are
    // row 1, so the first data row is row 2.
    const rowNumber = i + 2;
    const record = {};
    for (const [k, v] of Object.entries(raw || {})) if (!isBlank(v)) record[k] = v;
    if (Object.keys(record).length === 0) {
      summary.skipped++;
      results.push({ rowNumber, status: 'skipped', reason: 'Blank row (no mapped cell had a value)' });
      return;
    }
    const projectName = String(record[PROJECT_NAME_KEY] || '').trim();
    const key = normProjectName(projectName);
    if (!key) {
      summary.skipped++;
      results.push({ rowNumber, status: 'skipped', reason: 'Missing Project Name' });
      return;
    }
    if (incomingByKey.has(key)) {
      summary.pasteDuplicates++;
      pasteDuplicateRows.push({ ...record });
      results.push({ rowNumber, projectName, status: 'pasteDuplicate' });
      return;
    }
    noteKey(key);
    incomingByKey.set(key, record);
    if (existingByKey.has(key)) {
      summary.merged++;
      results.push({ rowNumber, projectName, status: 'merged', filled: 0, duplicates: 0, conflicts: [] });
    } else {
      summary.added++;
      results.push({ rowNumber, projectName, status: 'added' });
    }
  });

  // Merged-row detail is filled in as the overlays run below, keyed by
  // project so each pasted row can carry its own cell counts.
  const mergedResultByKey = new Map();
  for (const r of results) {
    if (r.status === 'merged') mergedResultByKey.set(normProjectName(r.projectName), r);
  }

  const touched = [];
  for (const key of order) {
    const base = existingByKey.get(key);
    const add = incomingByKey.get(key);
    if (!add) { out.push(base); continue; }           // project not in this paste → untouched
    if (!base) {                                       // brand-new project
      out.push({ ...add });
      touched.push(out.length - 1);
      continue;
    }
    let seed = base;
    if (dupeMode === 'replace') {
      seed = {};
      for (const [k, v] of Object.entries(base)) {
        if (PERIOD_KEYS.has(k)) { summary.clearedCells++; continue; }  // paste repopulates the months
        seed[k] = v;
      }
    }
    const { row, filled, duplicates, conflicts, overwritten } = overlay(seed, add, dupeMode);
    summary.filledCells += filled;
    summary.duplicateCells += duplicates;
    summary.conflictCells += conflicts.length;
    summary.overwrittenCells += overwritten;
    const detail = mergedResultByKey.get(key);
    if (detail) { detail.filled = filled; detail.duplicates = duplicates; detail.conflicts = conflicts; }
    out.push(row);
    touched.push(out.length - 1);
  }
  // Append the genuine within-paste duplicates last, so they land right after
  // the roster they duplicate.
  for (const row of pasteDuplicateRows) {
    out.push(row);
    touched.push(out.length - 1);
  }

  summary.keptCells = summary.conflictCells - summary.overwrittenCells;
  return { next: out, results, summary, touched };
}

// Overlay `addition`'s non-blank cells onto `base` under one dupe mode,
// returning the new row and what happened cell by cell.
function overlay(base, addition, dupeMode) {
  const row = { ...base };
  let filled = 0;
  let duplicates = 0;
  let overwritten = 0;
  const conflicts = [];
  for (const [k, v] of Object.entries(addition)) {
    if (isBlank(v)) continue;                        // a blank paste never clears
    if (isBlank(row[k])) { row[k] = v; filled++; continue; }
    if (sameValue(row[k], v)) {
      // The column that did the matching repeats by definition — counting it
      // would pad every "duplicates ignored" tally with the project name.
      if (k !== PROJECT_NAME_KEY) duplicates++;
      continue;
    }
    conflicts.push({ field: k, existing: row[k], pasted: v });
    if (dupeMode !== 'fill') { row[k] = v; overwritten++; }
  }
  return { row, filled, duplicates, conflicts, overwritten };
}

// One-line report of what an import did, for the notice on the page.
export function describeCommissionsPaste(summary) {
  if (!summary) return '';
  const bits = [];
  bits.push(`${summary.added} new row${summary.added === 1 ? '' : 's'} added`);
  if (summary.merged > 0) {
    bits.push(`${summary.merged} project${summary.merged === 1 ? '' : 's'} already on file matched (${summary.filledCells} blank cell${summary.filledCells === 1 ? '' : 's'} filled)`);
  }
  if (summary.pasteDuplicates > 0) {
    bits.push(`${summary.pasteDuplicates} repeated project name${summary.pasteDuplicates === 1 ? '' : 's'} kept as ${summary.pasteDuplicates === 1 ? 'its own flagged row' : 'their own flagged rows'}`);
  }
  if (summary.duplicateCells > 0) bits.push(`${summary.duplicateCells} duplicate value${summary.duplicateCells === 1 ? '' : 's'} ignored`);
  if (summary.clearedCells > 0) bits.push(`${summary.clearedCells} month cell${summary.clearedCells === 1 ? '' : 's'} cleared for the replace`);
  if (summary.overwrittenCells > 0) bits.push(`${summary.overwrittenCells} differing value${summary.overwrittenCells === 1 ? '' : 's'} overwritten`);
  if (summary.keptCells > 0) bits.push(`${summary.keptCells} differing value${summary.keptCells === 1 ? ' left as it was' : 's left as they were'}`);
  if (summary.skipped > 0) bits.push(`${summary.skipped} row${summary.skipped === 1 ? '' : 's'} skipped`);
  return `Paste imported: ${bits.join(' · ')}.`;
}
