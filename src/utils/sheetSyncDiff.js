// The diff behind the Google Sheets auto-sync (hooks/useSheetSync).
//
// Its own module because it is the part worth testing on its own: it runs
// on a timer, and both directions are expensive to get wrong: miss a
// match and every tick re-adds the whole sheet as duplicates; match too
// eagerly and a genuinely new account never arrives.
import { companyDedupeKey } from './companyKey.js';

// Which sheet rows the website doesn't have yet.
//
// Import mode is ADDITIVE-ONLY: a company already on the site is never
// overwritten from the sheet, so Google Sheets can't clobber website
// data.
//
// Matching is on companyDedupeKey, the same key the duplicate collapse
// uses — NOT the plain lowercased name it used to compare. An exact-name
// comparison read every spelling variant of a company as a company the
// site was missing, and this runs on a timer with write access: "H.I.G
// Capital" against a roster holding "HIG Capital, LLC" minted a second
// account, with its own document id and therefore none of the Target
// Account / divisions / HQ mappings keyed to the first. Across the real
// sheet that was 47 companies filed twice. Anything the key still reads
// as distinct — "Brookfield (Dubai)" vs "Brookfield (Self Storage)" —
// still imports separately, which is the point of the qualifier.
//
// Two sheet rows naming the same company now yield one row, not two: the
// pass tracks what it has already accepted. It used to return both and
// leave the duplicate collapse to clean up, which only worked when the
// collapse agreed the two were the same company — exactly the case that
// was failing.
export function newSheetRows(sheetProspects, prospects) {
  const seen = new Set(
    (prospects || []).map((p) => rowKey(p)),
  );
  const fresh = [];
  for (const p of sheetProspects || []) {
    const key = rowKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(p);
  }
  return fresh;
}

// A row's identity. Rows with no usable company name fall back to the
// lowercased raw value so they still collapse against each other rather
// than every blank row counting as a new account.
function rowKey(p) {
  const name = String(p?.company || '');
  return companyDedupeKey(name) || name.toLowerCase().trim();
}
