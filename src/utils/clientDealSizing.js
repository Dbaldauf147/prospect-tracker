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
  pricingLines,
} from './servicePricing.js';
import { serviceStatusBucket } from './serviceStatusColors.js';

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
 *
 * Each entry names the in-scope services waiting on that unit. "No meters
 * count" says a number is missing; "No meters count — SE metering" says which
 * service is being priced at nothing because of it, which is the difference
 * between a warning you can act on and one you have to go and investigate.
 */
export function missingCounts(estimate, bases = PRICING_BASES) {
  const out = [];
  for (const unit of estimate?.unitsUsed || []) {
    const n = parseMoney(estimate?.counts?.[unit]);
    if (n !== null && n > 0) continue;
    const basis = (bases || []).find(b => b.unit === unit);
    // The lines that consulted the shared count for this unit — the same test
    // estimateScope used to decide the unit was load-bearing at all, so the
    // services listed are exactly the ones the missing number is starving.
    const services = (estimate?.lines || [])
      .filter(l => l?.unit === unit && !l?.unitsTyped && !l?.typed)
      .map(l => l.name);
    out.push({ unit, label: basis?.unitLabel || unit, services });
  }
  return out;
}

/**
 * Does this scope price anything off the deal size box?
 *
 * Every line a service is charged on, not just its headline one: a service
 * whose second line is a cut of the deal needs the box as much as one whose
 * first line is, and without it the box never appears and that line prices
 * to nothing.
 */
export function needsDealSize({ services = [], pricing, bases = PRICING_BASES }) {
  for (const name of services) {
    for (const line of pricingLines(pricingFor(pricing, name, bases))) {
      if (basisFor(line.basis, bases)?.kind === 'percent') return true;
    }
  }
  return false;
}

/** The in-scope services priced as a percentage of the deal size box. */
export function dealSizeServices({ services = [], pricing, bases = PRICING_BASES }) {
  return services.filter(name => (
    basisFor(pricingFor(pricing, name, bases)?.basis, bases)?.kind === 'percent'
  ));
}

/**
 * Everything about one client's row that makes its figures understate the
 * deal — as a list the UI can print anywhere.
 *
 * There are two places this has to show: a badge beside the company name,
 * where it is seen without scrolling, and the Needs column, where it is
 * filtered and exported. Building it twice is how the two would come to
 * disagree, so both read this.
 *
 * Each entry is { key, chip, detail }: `chip` is the short form for a pill,
 * `detail` the sentence naming the services behind it for a tooltip.
 */
export function dealSizingWarnings({ estimate, pricing, bases = PRICING_BASES }) {
  const out = [];
  const list = (names) => names.join(', ');
  for (const m of missingCounts(estimate, bases)) {
    const unit = m.label.toLowerCase();
    out.push({
      key: `count:${m.unit}`,
      chip: `No ${unit} count`,
      detail: m.services.length
        ? `No ${unit} count for this client, so ${list(m.services)} ${m.services.length === 1 ? 'prices' : 'price'} at nothing.`
        : `No ${unit} count for this client.`,
    });
  }
  const pct = dealSizeServices({ services: estimate?.services || [], pricing, bases });
  if (pct.length && !String(estimate?.scope?.dealSize ?? '').trim()) {
    out.push({
      key: 'dealSize',
      chip: 'No deal size',
      detail: `No deal size entered, so ${list(pct)} ${pct.length === 1 ? 'prices' : 'price'} at nothing.`,
    });
  }
  if (estimate?.unpriced?.length) {
    out.push({
      key: 'unpriced',
      chip: `${estimate.unpriced.length} unpriced`,
      detail: `No rate set on ${list(estimate.unpriced)} — price ${estimate.unpriced.length === 1 ? 'it' : 'them'} on Dropdowns › Services Pricing.`,
    });
  }
  if (estimate?.missing?.length) {
    out.push({
      key: 'catalog',
      chip: `${estimate.missing.length} not in catalog`,
      detail: `${list(estimate.missing)} ${estimate.missing.length === 1 ? 'is' : 'are'} no longer in the service catalog — renamed or retired since this scope was set.`,
    });
  }
  return out;
}

/**
 * Add a page of client estimates up.
 *
 * The high totals are run alongside rather than derived, for the same reason
 * estimateScope runs them alongside: a book where three clients carry a range
 * and five don't is not the low total times anything.
 *
 * An estimate flagged `onCard` is counted as a scoped client but contributes
 * no money: the company card already has a status against its services, so
 * this is not new business to be sized. It is counted separately rather than
 * dropped so the tiles can say how many clients were set aside — a total
 * that quietly shrank would be indistinguishable from a total that was
 * always that size. See onCardScope.
 */
export function rollUpDealSizing(estimates) {
  const totals = {
    clients: 0, scoped: 0, onCard: 0,
    year1: 0, year1High: 0,
    contractValue: 0, contractValueHigh: 0,
    recurringAnnual: 0, recurringAnnualHigh: 0,
    setup: 0, unpriced: 0,
  };
  for (const est of estimates || []) {
    totals.clients += 1;
    if (!est || !est.services?.length) continue;
    totals.scoped += 1;
    // Its unpriced services aren't counted either: that tile is a prompt to
    // go and price them so these figures go up, and for this client they
    // never will.
    if (est.onCard) { totals.onCard += 1; continue; }
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

// ---------------------------------------------------------------------------
// What the company already knows about a service
// ---------------------------------------------------------------------------
//
// A scope is a what-if. The company card's Services Explored grid is history:
// what has actually been sold, quoted, or ruled out for that account. Sizing a
// deal without that in view is how you end up presenting a client a number
// that is mostly work they already buy from you.
//
// The two are kept apart in storage — a Deal Sizing pick never writes a status
// — but they belong together on screen, so these read the card and report what
// it says about the services in a scope.

/**
 * The company card's status for one service, or '' when it says nothing.
 *
 * '-' is the card's own way of writing "no status", so it reads as unexplored
 * rather than as a status called "-".
 */
export function exploredStatus(client, name) {
  const raw = String((client?.servicesExplored || {})[name] ?? '').trim();
  return raw && raw !== '-' ? raw : '';
}

/**
 * Every service in a client's scope with what the card says about it.
 *
 * @returns [{ name, status, bucket }] in scope order — bucket is the coarse
 *          outcome ('sold' | 'inProgress' | 'notSold' | 'na' | 'none') the
 *          rest of the app already groups statuses into.
 */
export function scopeStatuses(client, scope) {
  return normalizeClientScope(scope).services.map(name => {
    const status = exploredStatus(client, name);
    return { name, status, bucket: serviceStatusBucket(status) };
  });
}

/**
 * The scope's statuses counted by bucket, for a cell that has to say
 * "2 sold, 1 in flight" without the reader opening the row.
 */
export function scopeStatusCounts(client, scope) {
  const counts = { sold: 0, inProgress: 0, notSold: 0, na: 0, none: 0 };
  for (const { bucket } of scopeStatuses(client, scope)) counts[bucket] += 1;
  return counts;
}

/**
 * Does the company card already have something to say about this scope?
 *
 * True when ANY service in it carries a status — Sold, Not sold, anything in
 * flight, or a deliberate N/A. Only a scope where the card is silent on
 * every service is new business, and only new business is worth sizing:
 * this page answers "what would these clients be worth if we sold them
 * this", and a service the card has already ruled on is not part of that
 * answer. A client this is true of keeps its row and its scope but shows no
 * money, and its money stays out of the totals.
 *
 * Takes the counts rather than the client so the row that already has them
 * doesn't work them out twice.
 */
export function onCardScope(counts) {
  if (!counts) return false;
  return (counts.sold + counts.inProgress + counts.notSold + counts.na) > 0;
}

// ---------------------------------------------------------------------------
// Putting one service in front of the whole book
// ---------------------------------------------------------------------------

/**
 * What adding one service to every client would actually do.
 *
 * Worked out and shown BEFORE anything is written, because this is the one
 * action on the page that touches every client at once and there is no way to
 * eyeball 44 rows to see what it did. The three groups are the three answers
 * that matter:
 *
 *   add     — nothing on the card, not in scope. The real target.
 *   scoped  — already in this client's scope. Adding again is a no-op, and
 *             counting them in "added 44" would overstate what happened.
 *   sold    — the card says the client already buys it. Reported either way,
 *             because "31 of your 44 already buy this" is the most useful
 *             thing a bulk add can tell you. INCLUDED by default: the card
 *             having ruled on a scope is what stops it being sized (see
 *             onCardScope), so a buyer added here contributes a status to
 *             the page and nothing to the totals — and a client who is
 *             simply absent from the book tells you nothing at all. Skipping
 *             them is still one tick away.
 *
 * @param clients   the client records
 * @param service   the service name to add
 * @param scopeOf   (client) => that client's stored scope
 * @param skipSold  leave the clients who already buy it out of the add
 * @returns { add, scoped, sold } — arrays of clients, in the order given
 */
export function planBulkAdd({ clients = [], service, scopeOf, skipSold = false }) {
  const name = String(service || '').trim();
  const plan = { add: [], scoped: [], sold: [] };
  if (!name) return plan;
  for (const client of clients) {
    const scope = normalizeClientScope(scopeOf?.(client));
    if (scope.services.includes(name)) { plan.scoped.push(client); continue; }
    if (serviceStatusBucket(exploredStatus(client, name)) === 'sold') {
      plan.sold.push(client);
      // A target unless the user has asked for them to be left out. They are
      // reported as buyers either way, so the bar can say what including them
      // means: a row that carries the status and no money.
      if (!skipSold) plan.add.push(client);
      continue;
    }
    plan.add.push(client);
  }
  return plan;
}

/**
 * Which clients currently carry a service, for the matching bulk remove.
 *
 * A bulk add with no way back is a trap on a book this size, so removing is
 * the same shape: worked out first, reported as a count, and applied to
 * exactly the clients that have it.
 */
export function planBulkRemove({ clients = [], service, scopeOf }) {
  const name = String(service || '').trim();
  if (!name) return [];
  return clients.filter(c => normalizeClientScope(scopeOf?.(c)).services.includes(name));
}

/**
 * Which clients have any services picked at all, for "clear all services".
 *
 * The same shape as the two plans above and for the same reason: the button
 * says how many rows it is about to empty before it empties them, and a
 * client with nothing picked isn't counted as something being cleared.
 */
export function planClearServices({ clients = [], scopeOf }) {
  return clients.filter(c => normalizeClientScope(scopeOf?.(c)).services.length > 0);
}

/** A scope with one service added, keeping everything else as it was. */
export function withService(scope, name) {
  const next = normalizeClientScope(scope);
  if (!next.services.includes(name)) next.services = [...next.services, name];
  return next;
}

/**
 * A scope with one service removed — its per-service unit count going with it,
 * so re-adding the service later doesn't silently inherit a count typed for a
 * rollout that was abandoned.
 */
export function withoutService(scope, name) {
  const next = normalizeClientScope(scope);
  next.services = next.services.filter(s => s !== name);
  const units = { ...next.serviceUnits };
  delete units[name];
  next.serviceUnits = units;
  return next;
}

/**
 * A scope with every service selection taken off — the per-service unit
 * counts going with them, exactly as withoutService takes one service's
 * count with it.
 *
 * What stays is what wasn't a service pick: the client-level counts (sites,
 * meters, invoices) and any typed deal size. Those were answered about the
 * client rather than about a service, so re-picking services shouldn't mean
 * typing them again — and a scope left holding only those is still "nobody
 * has sized this client", which scopeIsEmpty already reports.
 */
export function clearServices(scope) {
  const next = normalizeClientScope(scope);
  next.services = [];
  next.serviceUnits = {};
  return next;
}
