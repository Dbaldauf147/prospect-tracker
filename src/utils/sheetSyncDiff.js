// The diff behind the Google Sheets auto-sync (hooks/useSheetSync).
//
// Its own module because it is the part worth testing on its own: it runs
// on a timer, and both directions are expensive to get wrong — miss a
// match and every tick re-adds the whole sheet as duplicates; match too
// eagerly and a genuinely new account never arrives.

// Which sheet rows the website doesn't have yet.
//
// Import mode is ADDITIVE-ONLY: a company already on the site is never
// overwritten from the sheet, so Google Sheets can't clobber website
// data. Matching is on the plain lowercased company name.
//
// Two sheet rows naming the same company both come back — the roster is
// what's compared against, not the rows already accepted from this pass.
// That's the long-standing behaviour, and the app's own duplicate
// collapse (groupDuplicateProspects) cleans up after it.
export function newSheetRows(sheetProspects, prospects) {
  const existing = new Set(
    (prospects || []).map((p) => String(p?.company || '').toLowerCase()),
  );
  return (sheetProspects || []).filter(
    (p) => !existing.has(String(p?.company || '').toLowerCase()),
  );
}
