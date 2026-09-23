import { useEffect, useMemo, useState } from 'react';
import { loadDealsList, DEALS_LIST_EVENT } from '../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../utils/dealClientMap';
import { dealsForCompany } from '../utils/clientContracts';

/**
 * This company's agreements, kept current while the card is open: a paste
 * on the Deals subtab or a new source-name mapping lands without a reload.
 * Used by the card itself too, for the count on the tab.
 */
export function useCompanyContracts(company, aliases) {
  const [dealsList, setDealsList] = useState(() => loadDealsList().data || []);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  useEffect(() => {
    const onDeals = () => setDealsList(loadDealsList().data || []);
    const onMap = () => setClientMap(loadDealClientMap());
    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key.includes('deals-client-map')) onMap();
      else if (e.key.includes('deals')) onDeals();
    };
    window.addEventListener(DEALS_LIST_EVENT, onDeals);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onMap);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DEALS_LIST_EVENT, onDeals);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onMap);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return useMemo(
    () => dealsForCompany(dealsList, clientMap, company, aliases),
    [dealsList, clientMap, company, aliases],
  );
}
