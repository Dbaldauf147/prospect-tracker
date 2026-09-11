// What one service is worth across the whole book of clients.
//
// Deal Sizing answers the question client-first: pick a scope for Prologis,
// see what Prologis is worth. The question underneath it is the transpose —
// which SERVICE is the book worth most on — and it is the one that decides
// where a quarter goes. Working it out on the sizing page means bulk-adding a
// service to every client, reading the tile, clearing it, and doing that a
// hundred and fifty times, which is why nobody has ever done it.
//
// So this runs it: every service in the catalog, priced against every client,
// each as a one-service scope. The arithmetic is Deal Sizing's own —
// estimateScope via the same counts clientDealSizing hands it — so a rate
// edited on Services Pricing moves these numbers and there is no second
// engine to keep in step.
//
// Two things are worth stating, because both decide what the headline number
// means:
//
// 1. The headline counts OPEN clients only. Deal Sizing declines to size a
//    scope the company card has already ruled on (see onCardScope): a client
//    who has bought the service, turned it down, or has it in flight is not
//    new business. Per service that rule is sharper than it is per scope —
//    it is exactly "the card says nothing about this service for this
//    client" — and it is what "as if I ran this on the Deal Sizing page"
//    produces. The money already-ruled clients would represent is not
//    dropped, it is reported separately as `bookValue`, so a service whose
//    upside is small because the book already buys it looks different from
//    one whose upside is small because it prices to nothing.
//
// 2. A client prices on the counts Deal Sizing would use for them: the
//    company record's Sites / Accounts / Sites w/ Mandate, overridden by
//    anything typed against that client on the sizing page, plus their typed
//    deal size and per-service unit counts. Nothing here asks for a number
//    that page doesn't already hold.
//
// It does not claim to be a forecast, for the same reason Deal Sizing
// doesn't: nothing here knows whether a single client wants the service.

import {
  PRICING_BASES,
  basisFor,
  estimateScope,
  pricingFor,
} from './servicePricing.js';
import { serviceStatusBucket } from './serviceStatusColors.js';
import {
  clientCounts,
  exploredStatus,
  normalizeClientScope,
} from './clientDealSizing.js';

/** The status buckets a client can be in for one service, open last. */
export const OPPORTUNITY_BUCKETS = ['sold', 'inProgress', 'notSold', 'na', 'none'];

const emptyBuckets = () => ({ sold: 0, inProgress: 0, notSold: 0, na: 0, none: 0 });

/**
 * One service priced against one client, as a single-service scope.
 *
 * Takes the client's resolved counts rather than the client, so a caller
 * pricing 150 services against the same client resolves them once instead of
 * once per service — the difference between a page that renders and one that
 * recomputes the whole book on every keystroke.
 */
function priceOne({ row, counts, scope, pricing, bases }) {
  return estimateScope({
    rows: [row],
    services: [row.name],
    pricing,
    counts,
    dealSize: scope.dealSize,
    bases,
    serviceUnits: scope.serviceUnits,
  });
}

/**
 * Every service in the catalog, with what the book is worth on it.
 *
 * @param clients            the client records to price against
 * @param serviceRows        the catalog, as { name, meta, bucket }
 * @param pricing            the rate card
 * @param bases              the pricing bases
 * @param scopeOf            (client) => that client's stored Deal Sizing scope
 * @param oppStagesByClient  Map<client, Map<service, stage>>, so a service
 *                           sold through an opportunity's Scope counts as
 *                           explored and not as open upside. Omit and only
 *                           the hand-set servicesExplored map is read.
 *
 * @returns one row per service:
 *   { name, bucket, basis, basisLabel, rate, rateHigh,
 *     contractValue/High, year1/High, recurringAnnual/High,   // open clients
 *     bookValue/High,                                          // every client
 *     statuses,        // { sold, inProgress, notSold, na, none }
 *     openClients,     // clients with no status on this service
 *     pricedClients,   // of those, the ones that priced above zero
 *     priced,          // is there a rate on the card at all
 *     clients }        // per-client detail, biggest first
 */
export function rollUpServiceOpportunity({
  clients = [],
  serviceRows = [],
  pricing,
  bases = PRICING_BASES,
  scopeOf,
  oppStagesByClient = null,
}) {
  // Resolve each client once: their counts, their typed deal size, and their
  // per-service unit overrides are the same whichever service is being priced
  // against them.
  const priced = clients.map((client) => {
    const scope = normalizeClientScope(scopeOf?.(client));
    const { counts } = clientCounts(client, scope);
    return { client, scope, counts, stages: oppStagesByClient?.get(client) || null };
  });

  return serviceRows.map((row) => {
    const card = pricingFor(pricing, row.name, bases);
    const basis = basisFor(card?.basis, bases);
    const out = {
      name: row.name,
      bucket: row.bucket,
      basis: card?.basis || '',
      basisLabel: basis?.label || '',
      rate: card?.rate ?? null,
      rateHigh: card?.rateHigh ?? null,
      contractValue: 0, contractValueHigh: 0,
      year1: 0, year1High: 0,
      recurringAnnual: 0, recurringAnnualHigh: 0,
      bookValue: 0, bookValueHigh: 0,
      statuses: emptyBuckets(),
      openClients: 0,
      pricedClients: 0,
      priced: false,
      clients: [],
    };

    for (const { client, scope, counts, stages } of priced) {
      const status = exploredStatus(client, row.name, stages);
      const statusBucket = serviceStatusBucket(status);
      out.statuses[statusBucket] += 1;
      const est = priceOne({ row, counts, scope, pricing, bases });
      // Unpriced means no rate on the card — the same test Deal Sizing's
      // "unpriced picks" tile uses. One client is enough to establish it:
      // the rate card is per service, not per client.
      if (!est.unpriced.length) out.priced = true;
      // The whole book, whatever the card says about each client. This is
      // what the service would be worth if nothing had been ruled on yet.
      out.bookValue += est.contractValue;
      out.bookValueHigh += est.contractValueHigh;
      const open = statusBucket === 'none';
      if (open) {
        out.openClients += 1;
        out.contractValue += est.contractValue;
        out.contractValueHigh += est.contractValueHigh;
        out.year1 += est.year1Total;
        out.year1High += est.year1TotalHigh;
        out.recurringAnnual += est.recurringAnnual;
        out.recurringAnnualHigh += est.recurringAnnualHigh;
        if (est.contractValue > 0 || est.contractValueHigh > 0) out.pricedClients += 1;
      }
      out.clients.push({
        client,
        company: client?.company || '',
        status,
        statusBucket,
        open,
        contractValue: est.contractValue,
        contractValueHigh: est.contractValueHigh,
        year1: est.year1Total,
        year1High: est.year1TotalHigh,
        recurringAnnual: est.recurringAnnual,
        recurringAnnualHigh: est.recurringAnnualHigh,
        // Which units this client's line actually consulted and hasn't got,
        // so the row can say why a client priced at nothing rather than
        // leaving a zero to be investigated.
        missingUnits: [...(est.unitsUsed || [])].filter(u => !(counts[u] > 0)),
      });
    }

    // Biggest first, then the open clients ahead of the ruled-on ones at the
    // same money — a row is opened to find who to call, and a client who
    // already bought it is not that.
    out.clients.sort((a, b) => (b.contractValue - a.contractValue)
      || (Number(b.open) - Number(a.open))
      || a.company.localeCompare(b.company));
    out.ranged = out.contractValueHigh > out.contractValue;
    return out;
  });
}

/**
 * The page's headline figures, over whatever rows are on screen.
 *
 * Money is summed across services, which is the right arithmetic here and
 * would not be on the sizing page: there a client appears once and its
 * services are one scope, here a service appears once and the totals answer
 * "what is the whole catalog worth against this book". `services` counts the
 * rows carrying any open upside, because a catalog of 150 of which 9 are
 * worth something is the number that means anything.
 */
export function rollUpOpportunityTotals(rows) {
  const totals = {
    services: 0, withValue: 0, unpriced: 0,
    contractValue: 0, contractValueHigh: 0,
    year1: 0, year1High: 0,
    recurringAnnual: 0, recurringAnnualHigh: 0,
    bookValue: 0, bookValueHigh: 0,
  };
  for (const row of rows || []) {
    totals.services += 1;
    if (!row.priced) totals.unpriced += 1;
    if (row.contractValue > 0 || row.contractValueHigh > 0) totals.withValue += 1;
    totals.contractValue += row.contractValue || 0;
    totals.contractValueHigh += row.contractValueHigh || 0;
    totals.year1 += row.year1 || 0;
    totals.year1High += row.year1High || 0;
    totals.recurringAnnual += row.recurringAnnual || 0;
    totals.recurringAnnualHigh += row.recurringAnnualHigh || 0;
    totals.bookValue += row.bookValue || 0;
    totals.bookValueHigh += row.bookValueHigh || 0;
  }
  return totals;
}

/** "31 sold · 4 in flight" — the explored half of a service's row, in words. */
export function exploredSummary(statuses) {
  const parts = [];
  if (statuses?.sold) parts.push(`${statuses.sold} sold`);
  if (statuses?.inProgress) parts.push(`${statuses.inProgress} in flight`);
  if (statuses?.notSold) parts.push(`${statuses.notSold} not sold`);
  if (statuses?.na) parts.push(`${statuses.na} N/A`);
  return parts.join(' · ');
}
