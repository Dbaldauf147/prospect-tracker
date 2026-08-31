// The two data sources every page that runs the contact rosters needs:
// the Opps 2 records the Active / Key Prospect gates read, and the
// Clients-tab flag maps that take an account's people off every roster.
//
// Both used to live inside the contacts pages — useOppsRecords in
// KeyContactsView, the flag-map subscription hand-written in
// AllContactsView. The Draft Emails page needs the same pair to show a
// recipient's category, and importing KeyContactsView for a 15-line hook
// would pull the whole contacts table into that chunk. So they live here,
// next to contactRosters.js whose gates they feed.

import { useEffect, useState } from 'react';
import { loadOpps2Newest } from './opps2Store';
import {
  loadClientStatusMap, CLIENT_STATUS_EVENT,
  loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT,
} from './clientManagerStore';

export function useOppsRecords(userId) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Read the canonical Opps 2 store the way the rest of the app does:
      // the strictly-newer of the local IndexedDB cache and the Firestore
      // doc, with Firestore's chunked payload reassembled. The inline
      // reader this replaced only read the doc's `json` field and bailed
      // when the doc was chunked (large datasets), and it always preferred
      // local IDB even when Firestore was newer.
      try {
        const data = await loadOpps2Newest(userId);
        const recs = Array.isArray(data?.records) ? data.records : null;
        if (!cancelled && recs && recs.length > 0) setRecords(recs);
      } catch { /* leave records empty on failure */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return records;
}

// The Clients-tab Status / Don't Track maps, re-read on the events that
// tab fires so a company switched to "Cancelling for Sure" or ticked
// "Don't Track" changes what the rosters say without a reload. The
// `storage` event covers the same change made in another tab, which the
// custom events don't reach.
export function useClientFlagMaps() {
  const [clientStatusMap, setClientStatusMap] = useState(() => loadClientStatusMap());
  const [clientUntrackedMap, setClientUntrackedMap] = useState(() => loadClientUntrackedMap());
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'clients-status-map') setClientStatusMap(loadClientStatusMap());
      if (e.key === 'clients-untracked-map') setClientUntrackedMap(loadClientUntrackedMap());
    }
    function onStatus() { setClientStatusMap(loadClientStatusMap()); }
    function onUntracked() { setClientUntrackedMap(loadClientUntrackedMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatus);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatus);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    };
  }, []);
  return { clientStatusMap, clientUntrackedMap };
}
