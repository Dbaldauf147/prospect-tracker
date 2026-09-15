// What an SIA actually quotes for each service, against what the rate card
// estimated those same services at.
//
// Two numbers describe the same deal from two directions and, until now,
// never met on one screen:
//
//   the estimate  the Scope services table in the Deal Size popup — every
//                 service in the opp's Scope priced off Dropdowns ›
//                 Services Pricing, a low end and a high end each
//   the actual    the SIA option saved onto the opp from the Pricing tab —
//                 a fee schedule of real rows, each billing real money
//
// Saving the SIA answered "what is the deal worth" and quietly closed the
// more useful question: which service came in over what we said it would,
// and which came in under. That question is per service, so the two sides
// have to be brought to the same shape first.
//
// Both sides are YEAR ONE. On the estimate side that is scopeYear1Lines —
// each service's annual fee plus the setup it bills once, which is the
// figure that foots to the estimate's own Year 1 total. On the SIA side it
// is each fee-schedule row's year-1 revenue (rowYearRevenue), which foots to
// the snapshot's Year 1 total the same way. Comparing an annual against a
// contract value, or a fee against a fee-plus-setup, would print a gap that
// is only the two sides having been measured differently.
//
// Attribution — which fee row pays for which service — is frozen onto the
// snapshot's rows at save time (`row.services`, written by the Pricing tab,
// which is the only place that knows the CTS line items behind each fee
// name). Nothing here reaches into the Pricing cache: a snapshot saved
// before that existed simply carries no attribution, and `mapped` says so,
// so the caller can fall back to comparing the totals rather than showing an
// empty column that reads as "the SIA charges nothing for this".
//
// Pure: a snapshot and an estimate in, a comparison out
// (scripts/siaScopeCompare.test.mjs).

import { rowYearRevenue } from './pricingOptionCalc.js';
import { scopeYear1Lines } from './servicePricing.js';

const key = (s) => String(s ?? '').trim().toLowerCase();

// Service names as they were frozen onto a fee-schedule row: trimmed,
// blanks dropped, deduped case-insensitively with the first casing kept.
function normServices(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const v = String(s ?? '').trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Fee names on a Pricing option mapped to the services they pay for.
 *
 * The chain the Pricing tab already holds, walked once: a CTS line item
 * names the services it delivers (the Line Item › Services mapping), and its
 * Linked To tag names the fee-schedule row that bills it. So a fee row
 * covers every service named by the cost rows linked to it.
 *
 * `items` is [{ description, linkedTo }] — the caller resolves Linked To,
 * because only it knows about per-row overrides. Returns a Map keyed by the
 * lowercased fee name, which is how the fee rows are matched back.
 */
export function servicesByFeeName({ items, lineItemServices }) {
  const out = new Map();
  for (const item of items || []) {
    const tag = String(item?.linkedTo ?? '').trim();
    if (!tag) continue;
    const mapped = lineItemServices?.[key(item?.description)];
    if (!Array.isArray(mapped) || !mapped.length) continue;
    const k = tag.toLowerCase();
    if (!out.has(k)) out.set(k, []);
    const list = out.get(k);
    for (const s of mapped) {
      const v = String(s ?? '').trim();
      if (v && !list.some(x => x.toLowerCase() === v.toLowerCase())) list.push(v);
    }
  }
  return out;
}

/**
 * What a saved SIA snapshot bills in year one, service by service.
 *
 *   { byService, unmapped, unmappedTotal, total, mapped }
 *
 * A fee row that covers two services counts IN FULL towards both: the row
 * bills what it bills, and splitting it down the middle would invent a
 * division nobody made. That is why `byService` does not foot to `total` on
 * a scope with shared rows, and why each bucket says which rows it read and
 * whether they were shared — the caller flags it rather than letting someone
 * add the column up and find it wrong.
 *
 * `total` counts every row once, so it foots to the snapshot's own Year 1
 * total, and `unmapped` holds the rows attribution couldn't place. A row
 * billing nothing in year one (the blank padding rows the fee schedule
 * carries, a fee that starts in year two) is not "unmapped money" and is
 * left out of that list.
 */
export function siaYear1ByService(snapshot) {
  if (!snapshot) return null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const years = Math.max(1, Number(snapshot.years) || 1);
  const esc = Number(snapshot.escPct) || 0;
  const byService = new Map();
  const unmapped = [];
  let total = 0;
  let unmappedTotal = 0;
  let mapped = false;
  for (const row of rows) {
    const year1 = rowYearRevenue(row, 1, years, esc);
    total += year1;
    const services = normServices(row?.services);
    const feeName = String(row?.feeSchedule ?? '').trim();
    if (!services.length) {
      if (year1 > 0) {
        unmapped.push({ name: feeName || '(unnamed fee)', year1 });
        unmappedTotal += year1;
      }
      continue;
    }
    mapped = true;
    for (const s of services) {
      const k = key(s);
      if (!byService.has(k)) byService.set(k, { name: s, year1: 0, lines: [] });
      const bucket = byService.get(k);
      bucket.year1 += year1;
      bucket.lines.push({ name: feeName || '(unnamed fee)', year1, shared: services.length > 1 });
    }
  }
  return { byService, unmapped, unmappedTotal, total, mapped };
}

/**
 * Where an actual lands against an estimated range.
 *
 *   { state: 'over' | 'under' | 'within', amount, ranged }
 *
 * Measured from the END it passed, never from a midpoint: an estimate of
 * "$42,000 to $84,000" does not claim $63,000, and a gap quoted against a
 * number the card never said would be a number nobody can check. Inside the
 * range there is no gap to report at all — the quote is what was estimated.
 *
 * `amount` is always positive; `state` carries the direction.
 */
export function gapAgainstRange(actual, low, high) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return null;
  if (typeof low !== 'number' || !Number.isFinite(low)) return null;
  const top = typeof high === 'number' && Number.isFinite(high) && high > low ? high : low;
  const ranged = top > low;
  if (actual > top) return { state: 'over', amount: actual - top, ranged };
  if (actual < low) return { state: 'under', amount: low - actual, ranged };
  return { state: 'within', amount: 0, ranged };
}

/**
 * The comparison the Deal Size popup draws: one row per service, the
 * estimate's two ends against what the SIA actually bills in year one.
 *
 * Null without a snapshot — there is no actual to compare and the estimate
 * already stands on its own.
 *
 * The rows are the UNION of both sides, because each side alone hides a real
 * mistake. A service in the Scope with no SIA fee behind it is scope being
 * delivered for nothing; a service the SIA bills that the Scope never listed
 * is a Scope cell somebody forgot to update. Both are worth seeing, and both
 * disappear from an inner join.
 *
 *   { rows, totals, mapped, unpriced }
 *
 * `totals` compares the whole quote against the whole scope estimate: the
 * SIA's Year 1 total (every row, mapped or not) against the estimate's two
 * ends. It is the one line that stays honest when attribution is partial,
 * which is why it is computed from the totals rather than by adding the
 * column above it.
 */
export function compareSiaToEstimate({ snapshot, estimate }) {
  const sia = siaYear1ByService(snapshot);
  if (!sia) return null;
  const estLines = scopeYear1Lines(estimate);
  // The estimator's own lines, for the basis label each one carries: the
  // table this replaces prints it under the service name, and a fee worth
  // arguing with is one you can see the working for.
  const rawByName = new Map();
  for (const l of (estimate?.lines || [])) rawByName.set(key(l?.name), l);
  const rows = [];
  const seen = new Set();
  let estLow = 0;
  let estHigh = 0;
  let pricedCount = 0;
  for (const line of estLines) {
    const k = key(line.name);
    seen.add(k);
    const low = line.priced ? (Number(line.year1) || 0) : null;
    const high = line.priced ? (Number(line.year1High ?? line.year1) || 0) : null;
    if (low != null) { estLow += low; estHigh += (high ?? low); pricedCount += 1; }
    const hit = sia.byService.get(k) || null;
    const actual = hit ? hit.year1 : null;
    rows.push({
      name: line.name,
      inScope: true,
      priced: !!line.priced,
      estimated: low,
      estimatedHigh: high,
      note: line.note || '',
      how: String(rawByName.get(k)?.how || ''),
      setupNote: line.setupNote || '',
      actual,
      feeNames: hit ? hit.lines.filter(l => l.year1 > 0).map(l => l.name) : [],
      shared: hit ? hit.lines.some(l => l.shared) : false,
      gap: gapAgainstRange(actual, low, high),
    });
  }
  // Billed by the SIA, never listed in the Scope. Alphabetical: there is no
  // estimate to rank them by, and the order they happen to sit in the fee
  // schedule is not an order anybody reads.
  const extras = [];
  for (const [k, bucket] of sia.byService) {
    if (seen.has(k)) continue;
    extras.push({
      name: bucket.name,
      inScope: false,
      priced: false,
      estimated: null,
      estimatedHigh: null,
      note: '',
      how: '',
      setupNote: '',
      actual: bucket.year1,
      feeNames: bucket.lines.filter(l => l.year1 > 0).map(l => l.name),
      shared: bucket.lines.some(l => l.shared),
      gap: null,
    });
  }
  extras.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  rows.push(...extras);
  // A scope the rate card could price nothing in has no estimate, and a
  // total of zero is not one: measured against it every quote reads as
  // wildly over. The totals say so by carrying null rather than 0.
  const haveEst = pricedCount > 0;
  return {
    rows,
    mapped: sia.mapped,
    unpriced: Array.isArray(estimate?.unpriced) ? estimate.unpriced : [],
    totals: {
      estimated: haveEst ? estLow : null,
      estimatedHigh: haveEst ? estHigh : null,
      actual: sia.total,
      gap: haveEst ? gapAgainstRange(sia.total, estLow, estHigh) : null,
      unmapped: sia.unmapped,
      unmappedTotal: sia.unmappedTotal,
    },
  };
}
