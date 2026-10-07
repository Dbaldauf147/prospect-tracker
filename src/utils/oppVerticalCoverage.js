// Which vertical an opp is in, and which salesperson covers that vertical.
//
// Drives the Vertical and Salesperson columns on Opps > New Opps and in
// the New Opps email (the downloaded draft and the scheduled send alike, so
// the two read the same). Pure and dependency-light on purpose: the
// scheduled email builds on the server (api/_lib/newOpps.js) and imports
// this file as it is.
//
// The vertical is the opp's own Vertical cell when it has one, else the
// Vertical on its company's card (matched by account name). The
// salesperson is whoever Opps > Coverage lists against that vertical: the
// saved copy of that tab when there is one, else the shipped default. A
// vertical sitting under two teams lists everyone on either.
import { coverageFromSettings } from './salesCoverage.js';

// The record keys the enriched rows carry. Not 'Vertical' itself: that is
// the opp's own editable cell, and a value filled in from the company card
// must never be mistaken for one typed on the opp.
export const OPP_VERTICAL_KEY = 'Coverage Vertical';
export const OPP_SALESPERSON_KEY = 'Coverage Salesperson';

const text = (v) => String(v ?? '').trim();
const isBlankish = (v) => {
  const s = text(v).toLowerCase();
  return !s || s === '-' || s === '#n/a' || s === 'n/a';
};
// Case, punctuation and spacing don't make two verticals different.
export const verticalKey = (v) => text(v).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
// Company names: the same, plus the corporate suffixes.
const companyKey = (v) => text(v).toLowerCase()
  .replace(/\b(inc|llc|ltd|corp|corporation|co|lp|plc|company)\b\.?/g, '')
  .replace(/[^a-z0-9]+/g, '');

/** settings -> Map(verticalKey -> [salesperson, ...]) from the Coverage tab. */
export function coverageIndex(settings) {
  const map = new Map();
  for (const group of coverageFromSettings(settings) || []) {
    for (const row of group?.rows || []) {
      const key = verticalKey(row?.vertical);
      if (!key) continue;
      const list = map.get(key) || [];
      for (const name of row?.salespeople || []) {
        const n = text(name);
        if (n && !list.includes(n)) list.push(n);
      }
      map.set(key, list);
    }
  }
  return map;
}

/** prospects -> Map(companyKey -> vertical) for the companies that carry one. */
export function companyVerticalIndex(prospects) {
  const map = new Map();
  for (const p of prospects || []) {
    const key = companyKey(p?.company);
    const v = text(p?.vertical);
    if (key && v && !map.has(key)) map.set(key, v);
  }
  return map;
}

/** One opp's { vertical, salesperson, fromCompany }. */
export function oppVerticalCoverage(row, { coverage, companies } = {}) {
  const own = isBlankish(row?.['Vertical']) ? '' : text(row?.['Vertical']);
  const fromCard = own ? '' : (companies?.get(companyKey(row?.['Account'])) || '');
  const vertical = own || fromCard;
  const people = vertical ? (coverage?.get(verticalKey(vertical)) || []) : [];
  return { vertical, salesperson: people.join(', '), fromCompany: !own && !!fromCard };
}

/**
 * Copies of the rows with the two keys filled in. The rows themselves are
 * never touched. `settings` supplies the Coverage tab, `prospects` the
 * company verticals.
 */
export function withVerticalCoverage(records, { settings = null, prospects = [] } = {}) {
  const ctx = { coverage: coverageIndex(settings), companies: companyVerticalIndex(prospects) };
  return (Array.isArray(records) ? records : []).map((r) => {
    const { vertical, salesperson } = oppVerticalCoverage(r, ctx);
    return { ...r, [OPP_VERTICAL_KEY]: vertical, [OPP_SALESPERSON_KEY]: salesperson };
  });
}
