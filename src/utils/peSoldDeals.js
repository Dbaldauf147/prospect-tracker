// The roll-up behind PE Portfolio > PE Sold.
//
// "PE deals" here are opps whose Source is "PE partner": the deals the PE
// channel actually brought in. That is narrower than the PE Opps tab, which
// also takes Type = Private Equity; Dan asked for this view by source.
//
// Two lists: every PE-sourced deal that is Sold (all time, filterable by the
// year it closed) and every one sitting at Agreement Sent right now, which is
// the next batch of sales if they sign. Unlike PE Opps, nothing closed is
// dropped for age: a sales record that only showed last month would not be
// one.
//
// Pure, so scripts/peSoldDeals.test.mjs can run it without React.

import { parseMoney, parseYear } from './oppsMetrics.js';

export const PE_SOURCE = 'pe partner';
const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Is this opp sourced from the PE channel? Case and space insensitive. */
export function isPeSourced(r) {
  return norm(r?.['Source']) === PE_SOURCE;
}

/** The deal's dollar figure, or null when it carries none. */
export function dealAmount(r) {
  const n = parseMoney(r?.['Quoted Amount']);
  return n != null && n > 0 ? n : null;
}

// Year off the digits, so 2026-01-01 can't read as 2025 west of Greenwich.
export function closeYear(r) {
  return parseYear(r?.['Close Date']);
}

function ts(v) {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
}

function total(rows) {
  let sum = 0;
  let priced = 0;
  for (const r of rows) {
    const a = dealAmount(r);
    if (a != null) { sum += a; priced += 1; }
  }
  return { count: rows.length, amount: sum, priced };
}

/**
 *   {
 *     sold:          [opp],   // newest close first; no Close Date sinks to the end
 *     agreementSent: [opp],   // newest Start Date first
 *     soldTotals, agreementTotals: { count, amount, priced },
 *     years:         [2026, 2025, ...],  // close years among PE sales, for the chips
 *     undatedSold,   // sales with no Close Date, left out once a year is picked
 *   }
 *
 * `years` narrows the Sold list only: Agreement Sent is a live stage, so
 * "agreements out in 2024" isn't a question it answers.
 *
 * `priced` says how many of the deals carry an amount, so the total is never
 * read as covering deals that were never priced.
 */
export function peSoldBreakdown(records, { years = [] } = {}) {
  const yearSet = years && years.length ? new Set(years.map(Number)) : null;
  const sold = [];
  const agreementSent = [];
  const yearsSeen = new Set();
  let undatedSold = 0;
  for (const r of records || []) {
    if (!isPeSourced(r)) continue;
    const stage = norm(r['Stage']);
    if (stage === 'agreement sent') { agreementSent.push(r); continue; }
    if (stage !== 'sold') continue;
    const y = closeYear(r);
    if (y != null) yearsSeen.add(y);
    if (yearSet) {
      if (y == null) { undatedSold += 1; continue; }
      if (!yearSet.has(y)) continue;
    }
    sold.push(r);
  }
  const byDateDesc = (field) => (a, b) => {
    const ta = ts(a[field]);
    const tb = ts(b[field]);
    if (isNaN(ta) && isNaN(tb)) return String(a['Account'] || '').localeCompare(String(b['Account'] || ''));
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  };
  sold.sort(byDateDesc('Close Date'));
  agreementSent.sort(byDateDesc('Start Date'));
  return {
    sold,
    agreementSent,
    soldTotals: total(sold),
    agreementTotals: total(agreementSent),
    years: [...yearsSeen].sort((a, b) => b - a),
    undatedSold,
  };
}
