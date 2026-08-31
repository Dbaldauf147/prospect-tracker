// Merge deal rows pasted from Google Sheets into the roster already on file.
//
// The Deals paste import used to REPLACE the whole roster with whatever was
// pasted, which made it useless for the way the sheet is actually kept: a
// user copies the handful of rows that changed this week and drops them in,
// expecting the other 300 deals — and the columns they've since filled in by
// hand here — to survive. So a paste now merges:
//
//   - a pasted deal that isn't on file yet is APPENDED (new values fill in);
//   - a pasted deal that matches one on file fills only that row's BLANK
//     cells. A cell that already carries a value is left exactly as it is,
//     whether the pasted value repeats it or contradicts it — "duplicate
//     values ignored". The contradictions are counted and shown so they're
//     never silently dropped, and `overwriteConflicts` lets the user hand
//     the pasted value the win when that's what they meant.
//
// New rows are appended rather than prepended because DealsView addresses
// rows by their array index (selection, the history drill-down, per-cell
// saves): appending leaves every existing index pointing at the same deal.

const isBlank = (v) => v == null || String(v).trim() === '';

// Compare-key for both identity and duplicate detection: trimmed, internal
// whitespace collapsed, case-folded. "Acme  Corp " and "acme corp" are the
// same client, and a re-pasted cell that only differs in spacing is a
// duplicate rather than a conflict.
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const DEAL_CLIENT_KEY = 'Client Name';
export const DEAL_AGREEMENT_KEY = 'Agreement Name';

// A deal's identity, matching what applyDealTerms in dealsStore already
// guards a write with: the client plus the agreement it's for, since one
// client can carry several agreements.
export function dealIdentity(row) {
  return {
    client: norm(row?.[DEAL_CLIENT_KEY]),
    agreement: norm(row?.[DEAL_AGREEMENT_KEY]),
  };
}

/**
 * Work out what a pasted batch does to the roster, and produce the merged
 * roster in one pass so the modal's preview and the actual import can never
 * disagree — both call this.
 *
 * `existingRows` is the roster on file, `incomingRows` the mapped records
 * from the paste (canonical column names, in pasted order).
 *
 * Returns { next, results, summary } where `next` is the merged roster,
 * `results` classifies each incoming row (in the order given), and `summary`
 * carries the counts the UI reports.
 */
export function planDealPaste(existingRows, incomingRows, { overwriteConflicts = false } = {}) {
  const next = (existingRows || []).map((r) => ({ ...r }));

  // Client key → indices into `next`. Rebuilt as rows are appended so a
  // deal repeated within one paste merges into the row its first copy
  // created instead of landing twice.
  const byClient = new Map();
  const indexRow = (i) => {
    const { client } = dealIdentity(next[i]);
    if (!client) return;
    if (!byClient.has(client)) byClient.set(client, []);
    byClient.get(client).push(i);
  };
  next.forEach((_row, i) => indexRow(i));

  const results = [];
  const summary = {
    added: 0, merged: 0, skipped: 0,
    filledCells: 0, duplicateCells: 0, conflictCells: 0, overwrittenCells: 0,
  };

  (incomingRows || []).forEach((raw, i) => {
    // Row numbers report against the user's sheet: headers are row 1, so
    // the first data row is row 2.
    const rowNumber = i + 2;
    const record = {};
    for (const [k, v] of Object.entries(raw || {})) if (!isBlank(v)) record[k] = v;

    if (Object.keys(record).length === 0) {
      summary.skipped++;
      results.push({ rowNumber, status: 'skipped', reason: 'Blank row (no mapped cell had a value)' });
      return;
    }
    const { client, agreement } = dealIdentity(record);
    if (!client) {
      summary.skipped++;
      results.push({ rowNumber, status: 'skipped', reason: 'No Client Name — nothing to match the deal on' });
      return;
    }

    const candidates = byClient.get(client) || [];
    let target = -1;
    // Same client and the same agreement is the deal, full stop.
    for (const idx of candidates) {
      if (dealIdentity(next[idx]).agreement === agreement) { target = idx; break; }
    }
    // Failing that: exactly one deal on file for this client, and one of the
    // two sides never named the agreement. That's the common shape — the
    // sheet carries the agreement name and the row here doesn't yet, or the
    // other way round — and matching it lets the paste fill the name in
    // rather than opening a second row for the same deal. A client with
    // several deals on file stays strict: without a matching agreement name
    // there's no way to tell which one was meant, so it becomes a new row.
    if (target < 0 && candidates.length === 1) {
      const existingAgreement = dealIdentity(next[candidates[0]]).agreement;
      if (!agreement || !existingAgreement) target = candidates[0];
    }

    const label = {
      client: String(record[DEAL_CLIENT_KEY] || '').trim(),
      agreement: String(record[DEAL_AGREEMENT_KEY] || '').trim(),
    };

    if (target < 0) {
      next.push({ ...record });
      indexRow(next.length - 1);
      summary.added++;
      results.push({ ...label, rowNumber, status: 'added', index: next.length - 1, filled: 0, duplicates: 0, conflicts: [] });
      return;
    }

    const row = next[target];
    let filled = 0;
    let duplicates = 0;
    const conflicts = [];
    for (const [k, v] of Object.entries(record)) {
      if (isBlank(row[k])) {                       // new value → fill it in
        row[k] = v;
        filled++;
        summary.filledCells++;
      } else if (norm(row[k]) === norm(v)) {       // duplicate value → ignore
        // The two identity columns match by definition on a merge — counting
        // them would pad every "duplicate values ignored" tally with the
        // columns that did the matching.
        if (k !== DEAL_CLIENT_KEY && k !== DEAL_AGREEMENT_KEY) {
          duplicates++;
          summary.duplicateCells++;
        }
      } else {                                     // says something different
        conflicts.push({ field: k, existing: row[k], pasted: v });
        summary.conflictCells++;
        if (overwriteConflicts) { row[k] = v; summary.overwrittenCells++; }
      }
    }
    summary.merged++;
    results.push({ ...label, rowNumber, status: 'merged', index: target, filled, duplicates, conflicts });
  });

  summary.keptCells = summary.conflictCells - summary.overwrittenCells;
  return { next, results, summary };
}

// One-line report of what an import did, for the notice strip on the page.
export function describeDealPaste(summary) {
  if (!summary) return '';
  const bits = [];
  bits.push(`${summary.added} new deal${summary.added === 1 ? '' : 's'} added`);
  if (summary.merged > 0) {
    bits.push(`${summary.merged} existing deal${summary.merged === 1 ? '' : 's'} matched (${summary.filledCells} blank cell${summary.filledCells === 1 ? '' : 's'} filled)`);
  }
  if (summary.duplicateCells > 0) bits.push(`${summary.duplicateCells} duplicate value${summary.duplicateCells === 1 ? '' : 's'} ignored`);
  if (summary.overwrittenCells > 0) bits.push(`${summary.overwrittenCells} differing value${summary.overwrittenCells === 1 ? '' : 's'} overwritten`);
  if (summary.keptCells > 0) bits.push(`${summary.keptCells} differing value${summary.keptCells === 1 ? ' left as it was' : 's left as they were'}`);
  if (summary.skipped > 0) bits.push(`${summary.skipped} row${summary.skipped === 1 ? '' : 's'} skipped`);
  return `Paste imported: ${bits.join(' · ')}.`;
}
