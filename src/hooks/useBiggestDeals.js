// Each tracker record's Biggest Deal - the company card's own reading (see
// utils/prospectingDeals.js) - for a list of records, keyed by record id.
//
// Priced against the whole rate card: unlike the Prospecting lists, which
// can leave services out of their analysis, this answers exactly what each
// company card says. The user's opportunities are read once so a service an
// opp's Scope names counts as explored, as it does on the card; until they
// arrive the deals are priced off the service statuses alone.

import { useEffect, useMemo, useState } from 'react';
import { biggestDealFor } from '../utils/prospectingDeals.js';
import { pricedServiceRows } from '../utils/serviceRows';
import { getServicePricing, resolvePricingBases } from '../utils/servicePricing';
import { buildOppStagesByClient } from '../utils/serviceCoverage';
import { loadOpps2Newest } from '../utils/opps2Store';
import { useAuth } from '../contexts/AuthContext';

// Remembered per record object against the rate card and opps it was priced
// with, so an edit to one company re-prices that company only.
const DEAL_CACHE = new WeakMap();
function cachedDeal(prospect, ctx, oppRecords) {
  const hit = DEAL_CACHE.get(prospect);
  if (hit && hit.ctx === ctx && hit.opps === oppRecords) return hit.deal;
  const oppStages = Array.isArray(oppRecords) && oppRecords.length
    ? (buildOppStagesByClient([prospect], oppRecords, ctx.serviceRows.map(r => r.name)).get(prospect) || null)
    : null;
  const deal = biggestDealFor(prospect, { ...ctx, oppStages });
  DEAL_CACHE.set(prospect, { ctx, opps: oppRecords, deal });
  return deal;
}

export function useBiggestDeals(records, settings) {
  const uid = useAuth()?.user?.uid;
  const [oppRecords, setOppRecords] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadOpps2Newest(uid)
      .then(data => { if (!cancelled) setOppRecords(Array.isArray(data?.records) ? data.records : []); })
      .catch(() => { if (!cancelled) setOppRecords([]); });
    return () => { cancelled = true; };
  }, [uid]);

  // Keyed on the settings that feed the rate card, so an unrelated save
  // doesn't re-price every row.
  const pricingSettings = useMemo(() => ({
    servicePricing: settings?.servicePricing,
    pricingBases: settings?.pricingBases,
    serviceOverrides: settings?.serviceOverrides,
    hiddenServices: settings?.hiddenServices,
    customServiceCategories: settings?.customServiceCategories,
    dropdownCustomLists: settings?.dropdownCustomLists,
    dropdownListLabels: settings?.dropdownListLabels,
    dropdownLists: settings?.dropdownLists,
    dropdownListsHidden: settings?.dropdownListsHidden,
  }), [settings?.servicePricing, settings?.pricingBases, settings?.serviceOverrides,
    settings?.hiddenServices, settings?.customServiceCategories, settings?.dropdownCustomLists,
    settings?.dropdownListLabels, settings?.dropdownLists, settings?.dropdownListsHidden]);
  const ctx = useMemo(() => ({
    serviceRows: pricedServiceRows(pricingSettings),
    pricing: getServicePricing(pricingSettings),
    bases: resolvePricingBases(pricingSettings),
    overrides: pricingSettings.serviceOverrides || null,
  }), [pricingSettings]);

  return useMemo(() => {
    const m = new Map();
    for (const p of records || []) if (p?.id) m.set(p.id, cachedDeal(p, ctx, oppRecords));
    return m;
  }, [records, ctx, oppRecords]);
}
