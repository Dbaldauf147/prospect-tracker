// Year-1 money from an Opp, for the Deal tied to it.
//
// A deal's Setup and Recurring Revenue are the same two numbers the Opps
// page already holds: an opp with a saved Pricing Option carries its Year-1
// Setup + One Time fees and its Year-1 recurring revenue (the "Setup Fees"
// and "Recurring Fees (annual)" rows on the opp popup). Re-typing them onto
// the deal is copying numbers the app already has, from one page to another,
// with a transcription error every time.
//
// The join is the BFO opportunity name, which both sides already record:
// the deal's "BFO - Close after contract execution email has been sent" and
// the opp's "BFO Link" (labelled BFO Opportunity Name on the Opps page) —
// the same pairing the "Sold opp has no matching deal" warning uses.
//
// Nothing here writes: `planOppYear1Fills` says what WOULD be written, so
// the page can show the count, list the deals, and let a human press the
// button. Blank cells only — a figure typed off the signed agreement is the
// contract, and the quote is not allowed to overwrite it.

import { normBfo, DEAL_BFO_KEY } from './dealCommissions.js';
import { pricingSnapshotYear1 } from './pricingOptionCalc.js';

// The opp column holding the BFO opportunity name. Labelled "BFO
// Opportunity Name" on the Opps page; "BFO Link" is the stored key.
export const OPP_BFO_KEY = 'BFO Link';

export const DEAL_SETUP_KEY = 'Setup';
export const DEAL_RECURRING_KEY = 'Recurring Revenue';

// A BFO name that isn't one. '-' is the deliberate "needs a BFO opp" mark
// and '#n/a' comes out of the sheet; neither identifies an opportunity, and
// matching on them would tie every unmarked deal to every unmarked opp.
export function realBfoName(v) {
  const n = normBfo(v);
  return n === '-' || n === '#n/a' ? '' : n;
}

// Is there a value in this cell? Mirrors the Deals grid's own test: a
// stored '' / null / '-' is an empty cell, not a zero.
function hasValue(v) {
  const s = String(v ?? '').trim();
  return s !== '' && s !== '-';
}

/**
 * Opps that carry Year-1 figures, keyed by their BFO opportunity name.
 *
 * Each entry is `{ setup, recurring, optionName, account, oppCount }`.
 * `oppCount` is how many opps share the name — the first one carrying a
 * saved option wins, and the count lets the UI say so rather than quietly
 * picking one of two.
 */
export function indexOppYear1ByBfo(records = []) {
  const map = new Map();
  for (const r of records || []) {
    const bfo = realBfoName(r?.[OPP_BFO_KEY]);
    if (!bfo) continue;
    const year1 = pricingSnapshotYear1(r?._pricingOption);
    const prev = map.get(bfo);
    if (prev) {
      prev.oppCount += 1;
      // First opp with an option keeps the figures; a later one only adds
      // to the count, so the tooltip can flag the ambiguity.
      if (!prev.hasFigures && year1) {
        prev.setup = year1.setupOneTime;
        prev.recurring = year1.recurringAnnual;
        prev.optionName = year1.name;
        prev.account = String(r?.Account || '').trim();
        prev.hasFigures = true;
      }
      continue;
    }
    map.set(bfo, {
      setup: year1 ? year1.setupOneTime : null,
      recurring: year1 ? year1.recurringAnnual : null,
      optionName: year1 ? year1.name : '',
      account: String(r?.Account || '').trim(),
      hasFigures: !!year1,
      oppCount: 1,
    });
  }
  // Entries with no saved option are dropped: they have nothing to offer a
  // deal, and keeping them would make "matched an opp" read as "has figures".
  for (const [k, v] of map) if (!v.hasFigures) map.delete(k);
  return map;
}

// What one deal can take from its opp, or null when it has no BFO name, no
// matching opp, or that opp has no saved option.
export function oppYear1ForDeal(map, deal) {
  const bfo = realBfoName(deal?.[DEAL_BFO_KEY]);
  if (!bfo || !map) return null;
  return map.get(bfo) || null;
}

/**
 * Which deals would take which figures, and what the write would be.
 *
 * Returns `[{ index, client, agreement, bfo, optionName, oppCount, patch }]`
 * — one entry per deal with at least one blank cell an opp can fill. `patch`
 * carries only the blank cells, so importing twice is a no-op rather than a
 * second write, and a Setup typed off the agreement survives an import that
 * fills the recurring beside it.
 *
 * A zero is a figure: an option that genuinely prices no setup writes 0
 * rather than being skipped, so the deal reads "quoted nothing" instead of
 * "nobody has filled this in".
 */
export function planOppYear1Fills(deals = [], map) {
  if (!map || map.size === 0) return [];
  const out = [];
  (deals || []).forEach((deal, index) => {
    const hit = oppYear1ForDeal(map, deal);
    if (!hit) return;
    const patch = {};
    if (!hasValue(deal?.[DEAL_SETUP_KEY]) && Number.isFinite(hit.setup)) {
      patch[DEAL_SETUP_KEY] = Math.round(hit.setup * 100) / 100;
    }
    if (!hasValue(deal?.[DEAL_RECURRING_KEY]) && Number.isFinite(hit.recurring)) {
      patch[DEAL_RECURRING_KEY] = Math.round(hit.recurring * 100) / 100;
    }
    if (Object.keys(patch).length === 0) return;
    out.push({
      index,
      client: String(deal?.['Client Name'] || '').trim(),
      agreement: String(deal?.['Agreement Name'] || '').trim(),
      bfo: String(deal?.[DEAL_BFO_KEY] || '').trim(),
      optionName: hit.optionName,
      oppCount: hit.oppCount,
      patch,
    });
  });
  return out;
}
