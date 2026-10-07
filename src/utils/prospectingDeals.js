// The Biggest Deal column on the Prospecting page's Prospects and PCs lists:
// the single biggest service still open on a company, priced off the
// company's own Scale figures through the Services Pricing rate card.
//
// This is the company card's own Biggest Deal reading (ProspectModal's
// accountPotentialReading), run once per row: same counts off the record,
// same rate card, same Auto-add bundling, same rule for what is still open.
// So the figure on this list is the figure on the card.
//
// Imported with extensions so this loads under plain Node for the tests.
import { accountPotential, serviceDecision } from './accountPotential.js';
import { clientCounts } from './clientDealSizing.js';

/**
 * { name, fee, feeHigh, adds, status, fromOpp } for the biggest open service on this company,
 * or null when nothing open can be priced. `ctx` carries what every row
 * shares: { serviceRows, pricing, bases, overrides } and, per company,
 * `oppStages` (what its opportunities say about each service).
 */
export function biggestDealFor(prospect, { serviceRows, pricing, bases, overrides = null, oppStages = null } = {}) {
  if (!prospect || !Array.isArray(serviceRows) || serviceRows.length === 0) return null;
  // The same seven fields the card watches, and nothing else, so the two
  // read the same record the same way.
  const client = {
    servicesExplored: prospect.servicesExplored,
    numberOfSites: prospect.numberOfSites,
    sitesWithMandate: prospect.sitesWithMandate,
    numberOfAccounts: prospect.numberOfAccounts,
    numberOfMeters: prospect.numberOfMeters,
    equipmentCount: prospect.equipmentCount,
    annualMwh: prospect.annualMwh,
  };
  const reading = accountPotential({
    client,
    serviceRows,
    pricing,
    bases,
    counts: clientCounts(client, null).counts,
    oppStages,
    overrides,
  });
  const top = reading?.top;
  if (!top) return null;
  // Where that service stands today, so the list can show it and set it.
  // Always an open status (never Sold, Not Sold or N/A): those are answers,
  // and an answered service is never the biggest deal.
  const { status, fromOpp } = serviceDecision(client, top.name, oppStages);
  return {
    name: top.name,
    fee: Number(top.fee) || 0,
    feeHigh: Number.isFinite(Number(top.feeHigh)) ? Number(top.feeHigh) : Number(top.fee) || 0,
    adds: (top.bundle?.adds || []).filter(a => a.open).map(a => a.name),
    status,
    fromOpp,
  };
}

// The middle of a deal's range, which is what the list sorts on: the same
// reading the account potential ranking uses to pick the biggest deal.
export function dealMid(deal) {
  if (!deal) return -1;
  return (deal.fee + deal.feeHigh) / 2;
}
