// What each existing client would be worth if you sold them a set of services.
//
// The rate card already exists — the Services Pricing subtab holds a basis and
// a rate for every service in the vocabulary — and so does an estimator that
// applies it to a scope. What was missing is the other half of the question a
// CDM actually asks, which is not "what would this scope cost someone" but
// "which of MY clients is worth what, and for what". That needs the rate card
// run once per client against that client's own counts.
//
// So this is deliberately thin: it decides what counts a client brings, hands
// them to estimateScope, and adds the results up. Every figure it produces
// comes out of servicePricing.js, so a rate edited on the pricing page moves
// the numbers here and there is no second pricing engine to keep in step.
//
// The one piece of judgement here is where a count comes from, and it is worth
// stating. A per-site service priced against a client needs that client's site
// count, and the company record already carries one (Sites / Accounts on the
// Clients table, typed on the company card or stamped by a Utility Lookup).
// Using it means a client is estimable the moment you tick a service, with no
// data entry at all. But a portfolio count is not always the scope count —
// you rarely sell a service into all 6,176 sites at once — so anything typed
// against the client beats it, and the UI shows which of the two it used.

import {
  PRICING_BASES,
  basisFor,
  estimateScope,
  parseMoney,
  pricingFor,
} from './servicePricing.js';

// Units a client record answers on its own, and the field that answers each.
// Only two: these are the counts the company card actually collects. Every
// other unit a scope needs (meters, invoices, MWh) is asked for per client,
// because nothing in the record knows it.
export const CLIENT_COUNT_FIELDS = [
  { unit: 'sites', field: 'numberOfSites', label: 'Sites' },
  { unit: 'accounts', field: 'numberOfAccounts', label: 'Accounts' },
];

/** An empty scope — the shape every client starts at. */
export function emptyClientScope() {
  return { services: [], counts: {}, serviceUnits: {}, dealSize: '' };
}

/**
 * Clean a stored scope into that shape.
 *
 * Stored records are per-client and long-lived, so this is forgiving on the
 * way in: a record written by an older version, or hand-edited, comes back
 * usable rather than throwing the client's whole scope away.
 */
export function normalizeClientScope(raw) {
  const out = emptyClientScope();
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.services)) {
    // Names, de-duplicated, blanks dropped. Order is the user's.
    const seen = new Set();
    for (const name of raw.services) {
      const s = String(name || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.services.push(s);
    }
  }
  for (const [k, v] of Object.entries(raw.counts || {})) {
    const n = parseMoney(v);
    if (n !== null) out.counts[k] = n;
  }
  for (const [k, v] of Object.entries(raw.serviceUnits || {})) {
    const n = parseMoney(v);
    if (n !== null) out.serviceUnits[k] = n;
  }
  if (raw.dealSize !== undefined && raw.dealSize !== null) out.dealSize = String(raw.dealSize);
  return out;
}

/** Is there anything here worth storing, or is this back to an empty scope? */
export function scopeIsEmpty(scope) {
  const s = normalizeClientScope(scope);
  return s.services.length === 0
    && Object.keys(s.counts).length === 0
    && Object.keys(s.serviceUnits).length === 0
    && !String(s.dealSize).trim();
}

/**
 * The unit counts one client's estimate runs on.
 *
 * @returns { counts, sources } where counts is the map estimateScope takes and
 *          sources says where each came from ('client' | 'typed'), so the UI
 *          can show a portfolio figure differently from one typed for a deal.
 */
export function clientCounts(client, scope) {
  const { counts: typed } = normalizeClientScope(scope);
  const counts = {};
  const sources = {};
  for (const { unit, field } of CLIENT_COUNT_FIELDS) {
    const n = parseMoney(client?.[field]);
    if (n !== null && n > 0) { counts[unit] = n; sources[unit] = 'client'; }
  }
  // Anything typed against this client wins: a portfolio count is what the
  // account has, not what the deal covers.
  for (const [unit, n] of Object.entries(typed)) {
    counts[unit] = n;
    sources[unit] = 'typed';
  }
  return { counts, sources };
}

/**
 * Estimate one client's scope.
 *
 * @returns the estimateScope result, plus `counts`/`countSources` (what it
 *          ran on), `scope` (normalized) and `services` (in-scope names that
 *          the catalog still recognises).
 */
export function estimateClient({ client, scope, serviceRows = [], pricing, bases = PRICING_BASES }) {
  const normalized = normalizeClientScope(scope);
  const { counts, sources } = clientCounts(client, normalized);
  // A service can be renamed or retired on the Services subtab after it was
  // ticked here. Estimating a name the catalog no longer has would silently
  // contribute nothing, so the stale names are reported instead — the row can
  // say so, and the user can re-pick rather than wonder why a scope of four
  // services prices like three.
  const known = new Set(serviceRows.map(r => r.name));
  const services = normalized.services.filter(n => known.has(n));
  const missing = normalized.services.filter(n => !known.has(n));
  const estimate = estimateScope({
    rows: serviceRows,
    services,
    pricing,
    counts,
    dealSize: normalized.dealSize,
    bases,
    serviceUnits: normalized.serviceUnits,
  });
  return { ...estimate, counts, countSources: sources, scope: normalized, services, missing };
}

/**
 * Which units a client's scope needs a number for and hasn't got one.
 *
 * estimateScope reports the units its lines actually consulted (`unitsUsed`),
 * which is what makes the per-client inputs self-assembling: tick a per-meter
 * service and a Meters box appears, because a meter count is now load-bearing.
 * A unit the client record already answers is not asked for again.
 */
export function missingCounts(estimate, bases = PRICING_BASES) {
  const out = [];
  for (const unit of estimate?.unitsUsed || []) {
    const n = parseMoney(estimate?.counts?.[unit]);
    if (n !== null && n > 0) continue;
    const basis = (bases || []).find(b => b.unit === unit);
    out.push({ unit, label: basis?.unitLabel || unit });
  }
  return out;
}

/** Does this scope price anything off the deal size box? */
export function needsDealSize({ services = [], pricing, bases = PRICING_BASES }) {
  for (const name of services) {
    const basis = basisFor(pricingFor(pricing, name, bases)?.basis, bases);
    if (basis?.kind === 'percent') return true;
  }
  return false;
}

/**
 * Add a page of client estimates up.
 *
 * The high totals are run alongside rather than derived, for the same reason
 * estimateScope runs them alongside: a book where three clients carry a range
 * and five don't is not the low total times anything.
 */
export function rollUpDealSizing(estimates) {
  const totals = {
    clients: 0, scoped: 0,
    year1: 0, year1High: 0,
    contractValue: 0, contractValueHigh: 0,
    recurringAnnual: 0, recurringAnnualHigh: 0,
    setup: 0, unpriced: 0,
  };
  for (const est of estimates || []) {
    totals.clients += 1;
    if (!est || !est.services?.length) continue;
    totals.scoped += 1;
    totals.year1 += est.year1Total || 0;
    totals.year1High += est.year1TotalHigh || 0;
    totals.contractValue += est.contractValue || 0;
    totals.contractValueHigh += est.contractValueHigh || 0;
    totals.recurringAnnual += est.recurringAnnual || 0;
    totals.recurringAnnualHigh += est.recurringAnnualHigh || 0;
    totals.setup += est.setup || 0;
    totals.unpriced += est.unpriced?.length || 0;
  }
  totals.ranged = totals.year1High > totals.year1 || totals.contractValueHigh > totals.contractValue;
  return totals;
}
