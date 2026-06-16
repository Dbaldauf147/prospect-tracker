import { useMemo, useState, useEffect } from 'react';
import { loadDealsList } from '../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../utils/dealClientMap';
import { loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT } from '../utils/clientManagerStore';
import { computeIssues } from '../utils/clientIssues';

// Number of open issues, for the sidebar alert badge. Reads the same
// uploaded deals, client-name mappings, and "Don't Track" overrides the
// Issues tab uses so the badge and the tab always agree. Re-reads the
// localStorage-backed maps on their change events; prospect / CDM
// changes flow in through the args and recompute automatically.
export function useIssueCount(prospects, cdmName) {
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onUntracked() { setUntrackedMap(loadClientUntrackedMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    };
  }, []);

  return useMemo(
    () => computeIssues({ prospects, cdmName, dealsList, clientMap, untrackedMap }).length,
    [prospects, cdmName, dealsList, clientMap, untrackedMap]
  );
}
