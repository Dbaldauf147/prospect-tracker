// The Scope of the opp a deal came from, for the Deals roster.
//
// A deal is the paperwork end of an opportunity, and what was actually
// sold — the services in the opp's Scope cell — never made the trip
// across. Reading it meant leaving the Deals page, finding the opp on
// Opps 2 by its BFO opportunity name, and reading the cell there.
//
// The join is the same one the Year-1 money import and the "Sold opp has
// no matching deal" warning already use: the BFO opportunity identifier
// both sides record — the deal's "BFO - Close after contract execution
// email has been sent" against the opp's "BFO Link" (labelled BFO
// Opportunity Name on the Opps page). The '-' / '#N/A' placeholders are
// not identifiers, so they match nothing rather than matching each other.
//
// Read-only: Scope is owned by the opp and edited on Opps 2. The Deals
// column shows what is there, so there is one place the scope is set and
// no second copy to drift.

import { DEAL_BFO_KEY } from './dealCommissions.js';
import { realBfoName, OPP_BFO_KEY } from './dealOppYear1.js';
import { scopeTokens } from './scopeMatch.js';

/**
 * Scope items by BFO opportunity name.
 *
 * Each entry is `{ items, oppCount, accounts }`:
 *   items    - the scope items, in the order the opps list them, with
 *              duplicates folded case-insensitively (the first spelling
 *              wins, since that is the one somebody typed).
 *   oppCount - how many opps carry this BFO name. Usually one; when it
 *              is more, their scopes are pooled and the count lets the
 *              cell say where the list came from.
 *   accounts - the account names behind those opps, deduped.
 *
 * An opp with an empty Scope still makes an entry, so a deal can tell
 * "its opp has no scope yet" apart from "no opp is tied to this deal".
 */
export function indexOppScopeByBfo(records = []) {
  const map = new Map();
  for (const r of records || []) {
    const bfo = realBfoName(r?.[OPP_BFO_KEY]);
    if (!bfo) continue;
    let entry = map.get(bfo);
    if (!entry) {
      entry = { items: [], oppCount: 0, accounts: [], _seen: new Set() };
      map.set(bfo, entry);
    }
    entry.oppCount += 1;
    const account = String(r?.Account || '').trim();
    if (account && !entry.accounts.includes(account)) entry.accounts.push(account);
    for (const token of scopeTokens(r?.Scope)) {
      const key = token.toLowerCase();
      if (entry._seen.has(key)) continue;
      entry._seen.add(key);
      entry.items.push(token);
    }
  }
  for (const entry of map.values()) delete entry._seen;
  return map;
}

/**
 * The scope items for one deal, or null when its BFO opportunity name is
 * missing / a placeholder, or no opp carries that name.
 */
export function oppScopeForDeal(map, deal) {
  const bfo = realBfoName(deal?.[DEAL_BFO_KEY]);
  if (!bfo || !map) return null;
  return map.get(bfo) || null;
}

/** The scope items as one line, for the grid cell, export and search. */
export function oppScopeText(entry) {
  return (entry?.items || []).join(', ');
}

export { OPP_BFO_KEY };
