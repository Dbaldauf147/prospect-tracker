import { useMemo, useState, useEffect } from 'react';
import { loadDealsList, DEALS_LIST_EVENT } from '../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../utils/dealClientMap';
import { loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT } from '../utils/clientManagerStore';
import { loadIssueSnoozedMap, ISSUE_SNOOZED_EVENT } from '../utils/issueSnoozeStore';
import { loadMyAccountsFlags, MY_ACCOUNTS_FLAGS_EVENT, MY_ACCOUNTS_FLAGS_KEY } from '../utils/myAccountsFlagsStore';
import { computeIssues } from '../utils/clientIssues';

// Single source of truth for the Issues tab, shared by IssuesView (which
// renders the rows) and the Sidebar badge (which counts them). Reads the
// same uploaded deals + client mappings the Clients tab uses, the
// "Don't Track" overrides, and the per-issue snooze overrides — then
// re-reads on the matching cross-tab events so an upload, a tracking
// toggle, or a snooze anywhere refreshes both consumers.
//
// `user` matters for the sidebar badge: App mounts (and runs the useState
// initializers below) before auth resolves, so the first read happens
// while localStorage is still unscoped and returns nothing. Once the user
// id is known the per-user store is scoped, so we re-read everything when
// the uid changes — otherwise the badge would stay stuck at the empty
// pre-login snapshot. (IssuesView mounts after login, so it reads correct
// data straight away; the re-read is a harmless no-op there.)
//
// Each returned issue carries a `snoozed` flag. `openCount` is the number
// of issues that are NOT snoozed — that's the number shown on the sidebar.
export function useIssues({ prospects = [], cdmName, user }) {
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());
  const [snoozedMap, setSnoozedMap] = useState(() => loadIssueSnoozedMap());
  const [myAccountsFlags, setMyAccountsFlags] = useState(() => loadMyAccountsFlags());

  // Re-read once the per-user localStorage scope is established (and on any
  // later account switch), since the initial reads above may have run
  // before login under the unscoped/anon prefix.
  useEffect(() => {
    setDealsList(loadDealsList().data);
    setClientMap(loadDealClientMap());
    setUntrackedMap(loadClientUntrackedMap());
    setSnoozedMap(loadIssueSnoozedMap());
    setMyAccountsFlags(loadMyAccountsFlags());
  }, [user?.uid]);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
      if (e.key === 'issues-snoozed-map') setSnoozedMap(loadIssueSnoozedMap());
      if (e.key === MY_ACCOUNTS_FLAGS_KEY) setMyAccountsFlags(loadMyAccountsFlags());
    }
    function onDealsList() { setDealsList(loadDealsList().data); }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onUntracked() { setUntrackedMap(loadClientUntrackedMap()); }
    function onSnoozed() { setSnoozedMap(loadIssueSnoozedMap()); }
    function onMaFlags() { setMyAccountsFlags(loadMyAccountsFlags()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_LIST_EVENT, onDealsList);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    window.addEventListener(ISSUE_SNOOZED_EVENT, onSnoozed);
    window.addEventListener(MY_ACCOUNTS_FLAGS_EVENT, onMaFlags);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_LIST_EVENT, onDealsList);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
      window.removeEventListener(ISSUE_SNOOZED_EVENT, onSnoozed);
      window.removeEventListener(MY_ACCOUNTS_FLAGS_EVENT, onMaFlags);
    };
  }, []);

  const issues = useMemo(() => {
    const rows = computeIssues({ prospects, cdmName, dealsList, clientMap, untrackedMap, myAccountsFlags });
    return rows.map((r) => ({ ...r, snoozed: !!snoozedMap[r.id] }));
  }, [prospects, cdmName, dealsList, clientMap, untrackedMap, snoozedMap, myAccountsFlags]);

  const openCount = useMemo(() => issues.reduce((n, r) => n + (r.snoozed ? 0 : 1), 0), [issues]);

  return { issues, openCount };
}
