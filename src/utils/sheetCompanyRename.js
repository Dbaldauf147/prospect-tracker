// Writing a company rename through to the Google Sheet row it came from.
//
// Renaming a company in the app repointed every name-keyed reference in
// the app (see companyRenameCascade) but never the sheet, and the sheet
// is where the importer decides what exists. So the old name survived
// there, the additive import read it as a company the site didn't have,
// and the rename came back as a second account on the next pass — which
// is how "April Housing (a Blackstone co.)" reappeared beside the "April
// Housing" it had been renamed to.
//
// The two-way sync doesn't fix that either: it matches the sheet on the
// exact name too, so a renamed record is APPENDED as a new sheet row
// rather than updating the old one, leaving both spellings in the sheet.
//
// The match is planned here rather than in api/sheets-sync so it uses the
// same companyDedupeKey as everything else — nothing under api/ imports
// from src/, and a second copy of the rule over there is exactly how the
// importers drifted apart in the first place. The server is handed a row
// number and re-checks the cell before writing.

import { companyDedupeKey } from './companyKey.js';

const clean = (s) => String(s || '').trim();
const lower = (s) => clean(s).toLowerCase();

// Which sheet row (if any) should take the new name.
//
// `names` is [{ row, company }] straight from the sheet, row being the
// 1-based spreadsheet row number.
//
// Returns { row, reason, from }. `row` is null when nothing should be
// written, and `reason` says why so the caller can be honest about it
// rather than silently doing nothing.
//
// `from` is the sheet cell's CURRENT text, not the app's old name — the
// server re-checks the cell before writing, and on a key match the two
// differ by definition ("HIG Capital, LLC" in the sheet against
// "H.I.G. Capital" in the app), so sending the app's name would make
// every key match fail that check.
//
// Reasons:
//
//   'no-change'   the name didn't actually change
//   'not-found'   the sheet has no row under the old name
//   'ambiguous'   more than one row could be the old name — renaming a
//                 guess is worse than leaving it
//   'already-set' a row already carries the new name; renaming another
//                 row onto it would put the same company in the sheet
//                 twice, which is the problem this exists to avoid
export function planSheetCompanyRename(names, oldName, newName) {
  const from = clean(oldName);
  const to = clean(newName);
  const none = (reason) => ({ row: null, reason, from: null });
  if (!from || !to || from === to) return none('no-change');

  const rows = (names || []).filter(n => n && n.row != null && clean(n.company));

  // A row already under the new name — including the row we would be
  // renaming, when the change is capitalisation only.
  const already = rows.find(n => lower(n.company) === lower(to));

  // Exact match on the old name is the ordinary case: the app record and
  // the sheet row agreed until the moment of the rename.
  const exact = rows.filter(n => lower(n.company) === lower(from));
  if (exact.length === 1) {
    if (already && already.row !== exact[0].row) return none('already-set');
    return { row: exact[0].row, reason: 'exact', from: clean(exact[0].company) };
  }
  if (exact.length > 1) return none('ambiguous');

  // The sheet spells it differently. Fall back to the key every other
  // comparison in the app uses — but only when it points at exactly one
  // row, since renaming the wrong company is worse than renaming none.
  const key = companyDedupeKey(from);
  if (!key) return none('not-found');
  const keyed = rows.filter(n => companyDedupeKey(n.company) === key);
  if (keyed.length !== 1) return none(keyed.length ? 'ambiguous' : 'not-found');
  if (already && already.row !== keyed[0].row) return none('already-set');
  return { row: keyed[0].row, reason: 'key', from: clean(keyed[0].company) };
}

// The spreadsheet id inside a Google Sheets URL, or null.
export function spreadsheetIdFromUrl(url) {
  const match = String(url || '').match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
