import { useMemo, useState, useEffect } from 'react';
import { loadDealsList } from '../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../utils/dealClientMap';
import { loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT } from '../utils/clientManagerStore';
import { loadIssueSnoozedMap, ISSUE_SNOOZED_EVENT } from '../utils/issueSnoozeStore';
import { computeIssues } from '../utils/clientIssues';

// Single source of truth for the Issues tab, shared by IssuesView (which
// renders the rows) and the Sidebar badge (which counts them). Reads the
// same uploaded deals + client mappings the Clients tab uses, the
// "Don't Track" overrides, and the per-issue snooze overrides — then
// re-reads on the matching cross-tab events so an upload, a tracking
// toggle, or a snooze anywhere refreshes both consumers.
//
// Each returned issue carries a `snoozed` flag. `openCount` is the number
// of issues that are NOT snoozed — that's the number shown on the sidebar.
export function useIssues({ prospects = [], cdmName }) {
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());
  const [snoozedMap, setSnoozedMap] = useState(() => loadIssueSnoozedMap());

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
      if (e.key === 'issues-snoozed-map') setSnoozedMap(loadIssueSnoozedMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onUntracked() { setUntrackedMap(loadClientUntrackedMap()); }
    function onSnoozed() { setSnoozedMap(loadIssueSnoozedMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    window.addEventListener(ISSUE_SNOOZED_EVENT, onSnoozed);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
      window.removeEventListener(ISSUE_SNOOZED_EVENT, onSnoozed);
    };
  }, []);

  const issues = useMemo(() => {
    const rows = computeIssues({ prospects, cdmName, dealsList, clientMap, untrackedMap });
    return rows.map((r) => ({ ...r, snoozed: !!snoozedMap[r.id] }));
  }, [prospects, cdmName, dealsList, clientMap, untrackedMap, snoozedMap]);

  const openCount = useMemo(() => issues.reduce((n, r) => n + (r.snoozed ? 0 : 1), 0), [issues]);

  return { issues, openCount };
}
