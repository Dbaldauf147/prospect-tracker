// Other names a company record answers to.
//
// "Merge duplicate…" folds one record into another and deletes it. Before
// this, the deleted record's name was simply forgotten, so the next thing
// that minted accounts by name brought it straight back: the Google Sheets
// auto-sync, on a timer, re-created "WSP Global" every time it was merged
// into "WSP" because the sheet still had a "WSP Global" row and the two
// names do not share a companyDedupeKey ("Global" is not a corporate
// suffix, and should not be: "Apollo Global Management" is a real name).
//
// So a merge now records the name it removed on the survivor, in
// `companyAliases`, and every path that asks "do we already have this
// company?" (sheetSyncDiff, addProspectGuard) matches the aliases as well
// as the name.
import { companyDedupeKey } from './companyKey.js';

export const ALIASES_FIELD = 'companyAliases';

function aliasList(record) {
  const raw = record?.[ALIASES_FIELD];
  return Array.isArray(raw) ? raw.map(s => String(s || '').trim()).filter(Boolean) : [];
}

// Every dedupe key a record matches: its own name first, then each alias.
// Empty keys are dropped, so a record with no usable name returns [].
export function recordCompanyKeys(record) {
  const out = [];
  for (const name of [record?.company, ...aliasList(record)]) {
    const k = companyDedupeKey(name);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

// The aliases the survivor of a merge should carry: what it had, plus the
// absorbed record's name and its own aliases. A name that already reads as
// the survivor's own (same dedupe key) adds nothing, and two spellings of
// one alias are kept once (the first seen).
export function mergedCompanyAliases(survivor, absorbed) {
  const own = companyDedupeKey(survivor?.company);
  const seen = new Set(own ? [own] : []);
  const out = [];
  for (const name of [...aliasList(survivor), String(absorbed?.company || '').trim(), ...aliasList(absorbed)]) {
    const k = companyDedupeKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

/**
 * Whether an opp's Account is this company itself: its own name or one of
 * the names merged into it, compared by dedupe key (case, punctuation and
 * Inc./LLC don't matter; a bracketed division does). The Services board
 * and the Account MRI read a company's services off these opps only, so a
 * related company sharing a word of the name ("Brookfield (Core Retail)",
 * a Brookfield portfolio company) doesn't set this company's statuses.
 */
export function accountIsCompany(account, record) {
  const key = companyDedupeKey(account);
  return !!key && recordCompanyKeys(record).includes(key);
}
