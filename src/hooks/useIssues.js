import { useMemo, useState, useEffect } from 'react';
import { loadDealsList, DEALS_LIST_EVENT } from '../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../utils/dealClientMap';
import { loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT, loadClientStatusMap, CLIENT_STATUS_EVENT } from '../utils/clientManagerStore';
import { loadIssueSnoozedMap, issueSnoozeState, pruneExpiredSnoozes, ISSUE_SNOOZED_EVENT } from '../utils/issueSnoozeStore';
import { loadMyAccountsFlags, MY_ACCOUNTS_FLAGS_EVENT, MY_ACCOUNTS_FLAGS_KEY } from '../utils/myAccountsFlagsStore';
import { dbGet } from '../utils/db';
import { loadOppsFromCache } from '../utils/oppsCache';
import { computeIssues, computeServiceCoverageGaps } from '../utils/clientIssues';
import { loadPipelineDashboard, coverageServicesOf, PIPELINE_DASHBOARD_EVENT } from '../utils/pipelineDashboardStore';
// BFO Activity rows are pasted on the BFO Activity tab and persisted in that
// store; the Opps cache backs the "not tagged to an opp" check.
import { BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY, BFO_ACTIVITY_EVENT } from '../utils/bfoActivityStore';

// The Pipeline dashboard is re-read on every window focus, and a fresh array
// of the same services would re-run the whole issue computation each time —
// so keep the previous array when nothing actually changed.
function keepIfSame(prev, next) {
  return (prev.length === next.length && prev.every((s, i) => s === next[i])) ? prev : next;
}

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
export function useIssues({ prospects = [], cdmName, user, marketingLeads = [], serviceOverrides = {}, settings = {} }) {
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());
  const [clientStatusMap, setClientStatusMap] = useState(() => loadClientStatusMap());
  const [snoozedMap, setSnoozedMap] = useState(() => loadIssueSnoozedMap());
  const [myAccountsFlags, setMyAccountsFlags] = useState(() => loadMyAccountsFlags());
  // BFO Activity rows + Opps cache (both IndexedDB) drive the "BFO
  // Opportunity Name not tagged to an opp" issue. Loaded async below.
  const [bfoActivity, setBfoActivity] = useState(null);
  const [oppsCache, setOppsCache] = useState(null);
  // Services tracked in the Pipeline page's "Service Exploration Coverage"
  // table (persisted with the rest of the Pipeline dashboard), so a row
  // under 100% can be surfaced here.
  const [coverageServices, setCoverageServices] = useState([]);

  // The Settings fields the service catalogue is built from, held as one
  // memoized object so computeIssues' memo doesn't re-run every render.
  const serviceCatalogSettings = useMemo(() => ({
    hiddenServices: settings?.hiddenServices,
    serviceRenames: settings?.serviceRenames,
    customServiceCategories: settings?.customServiceCategories,
  }), [settings?.hiddenServices, settings?.serviceRenames, settings?.customServiceCategories]);

  // Re-read once the per-user localStorage scope is established (and on any
  // later account switch), since the initial reads above may have run
  // before login under the unscoped/anon prefix.
  useEffect(() => {
    setDealsList(loadDealsList().data);
    setClientMap(loadDealClientMap());
    setUntrackedMap(loadClientUntrackedMap());
    setClientStatusMap(loadClientStatusMap());
    setSnoozedMap(loadIssueSnoozedMap());
    setMyAccountsFlags(loadMyAccountsFlags());
    dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY).then(d => setBfoActivity(d || null)).catch(() => {});
    loadOppsFromCache().then(o => setOppsCache(o)).catch(() => {});
    loadPipelineDashboard().then(p => setCoverageServices(prev => keepIfSame(prev, coverageServicesOf(p)))).catch(() => {});
  }, [user?.uid]);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
      if (e.key === 'clients-status-map') setClientStatusMap(loadClientStatusMap());
      if (e.key === 'issues-snoozed-map') setSnoozedMap(loadIssueSnoozedMap());
      if (e.key === MY_ACCOUNTS_FLAGS_KEY) setMyAccountsFlags(loadMyAccountsFlags());
    }
    function onDealsList() { setDealsList(loadDealsList().data); }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onUntracked() { setUntrackedMap(loadClientUntrackedMap()); }
    function onClientStatus() { setClientStatusMap(loadClientStatusMap()); }
    function onSnoozed() { setSnoozedMap(loadIssueSnoozedMap()); }
    function onMaFlags() { setMyAccountsFlags(loadMyAccountsFlags()); }
    // BFO Activity (IndexedDB) + Opps cache (IndexedDB): refresh on window
    // focus (a fresh paste on either tab), on the BFO Activity store's own
    // change event, and on the opps2 cache-updated event, mirroring how the
    // BFO Activity / Agents pages reload them. The store event covers what
    // focus can't: the mirror landing a cloud copy locally — another
    // device's paste, or first hydration on a browser that didn't hold the
    // record — while this hook is already mounted and the window focused.
    // Until it does, the Close Not Sold detector has no BFO rows to check
    // against and reports nothing.
    function refreshBfo() { dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY).then(d => setBfoActivity(d || null)).catch(() => {}); }
    function refreshOpps() { loadOppsFromCache().then(o => setOppsCache(o)).catch(() => {}); }
    // Pipeline dashboard (IndexedDB): the tracked coverage services. Refreshed
    // on the Pipeline page's own save event and on focus, same as the above.
    function refreshPipeline() { loadPipelineDashboard().then(p => setCoverageServices(prev => keepIfSame(prev, coverageServicesOf(p)))).catch(() => {}); }
    // A timed snooze has to lapse on its own: pruning drops entries whose
    // time is up and fires ISSUE_SNOOZED_EVENT when it actually removed
    // something, which re-reads the map below. Checked on focus and once a
    // minute, so an issue comes back without a reload.
    function pruneSnoozes() { pruneExpiredSnoozes(); }
    refreshBfo();
    refreshOpps();
    refreshPipeline();
    pruneSnoozes();
    const snoozeTimer = setInterval(pruneSnoozes, 60 * 1000);
    window.addEventListener('focus', pruneSnoozes);
    window.addEventListener('focus', refreshBfo);
    window.addEventListener('focus', refreshOpps);
    window.addEventListener('focus', refreshPipeline);
    window.addEventListener(PIPELINE_DASHBOARD_EVENT, refreshPipeline);
    window.addEventListener(BFO_ACTIVITY_EVENT, refreshBfo);
    window.addEventListener('opps2-cache-updated', refreshOpps);
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_LIST_EVENT, onDealsList);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    window.addEventListener(CLIENT_STATUS_EVENT, onClientStatus);
    window.addEventListener(ISSUE_SNOOZED_EVENT, onSnoozed);
    window.addEventListener(MY_ACCOUNTS_FLAGS_EVENT, onMaFlags);
    return () => {
      clearInterval(snoozeTimer);
      window.removeEventListener('focus', pruneSnoozes);
      window.removeEventListener('focus', refreshBfo);
      window.removeEventListener('focus', refreshOpps);
      window.removeEventListener('focus', refreshPipeline);
      window.removeEventListener(PIPELINE_DASHBOARD_EVENT, refreshPipeline);
      window.removeEventListener(BFO_ACTIVITY_EVENT, refreshBfo);
      window.removeEventListener('opps2-cache-updated', refreshOpps);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_LIST_EVENT, onDealsList);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
      window.removeEventListener(CLIENT_STATUS_EVENT, onClientStatus);
      window.removeEventListener(ISSUE_SNOOZED_EVENT, onSnoozed);
      window.removeEventListener(MY_ACCOUNTS_FLAGS_EVENT, onMaFlags);
    };
  }, []);

  const issues = useMemo(() => {
    const rows = computeIssues({ prospects, cdmName, dealsList, clientMap, untrackedMap, clientStatusMap, myAccountsFlags, marketingLeads, bfoActivity, oppsCache, serviceOverrides });
    return rows.map((r) => {
      const { snoozed, until } = issueSnoozeState(snoozedMap, r.id);
      return { ...r, snoozed, snoozeUntil: until };
    });
  }, [prospects, cdmName, dealsList, clientMap, untrackedMap, clientStatusMap, snoozedMap, myAccountsFlags, marketingLeads, bfoActivity, oppsCache, serviceOverrides]);

  // Services the client base hasn't explored yet. Not issues — outreach —
  // so they're returned alongside rather than mixed in, and the snooze map
  // is left out of it: nothing on the Prospecting ladder can be snoozed, so
  // honouring an old Issues-tab snooze would hide a service with no way to
  // bring it back.
  const serviceGaps = useMemo(
    () => computeServiceCoverageGaps({ prospects, cdmName, coverageServices, oppsCache, serviceCatalogSettings, clientStatusMap, untrackedMap }),
    [prospects, cdmName, coverageServices, oppsCache, serviceCatalogSettings, clientStatusMap, untrackedMap],
  );

  const openCount = useMemo(() => issues.reduce((n, r) => n + (r.snoozed ? 0 : 1), 0), [issues]);

  return { issues, openCount, serviceGaps };
}
