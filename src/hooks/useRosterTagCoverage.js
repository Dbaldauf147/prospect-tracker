import { useEffect, useMemo, useState } from 'react';
import { getHubspotCache } from '../utils/hubspotContactsCache';
import {
  loadClientStatusMap, CLIENT_STATUS_EVENT,
  loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT,
} from '../utils/clientManagerStore';
import { makeRosterGates, rosterTagCoverage } from '../utils/contactRosters';

// Tag-review coverage per contact roster — how far through the tag
// vocabulary each of Key / Active / Client / Key Prospect has been worked.
//
// Everything it needs is already cached locally — the HubSpot contacts, the
// Clients tab's maps, the opps records and the Table View prospects — so a
// readout paints with its page rather than after a round trip.
//
// Lives in hooks/ rather than inside the Prospecting page because two
// callers need the same number: that page's Tagged row, and the sidebar
// badge, which has to work from whichever view the user is on. Returns null
// until the contact cache answers, so a caller renders nothing rather than a
// 0% that only means "not loaded yet".
export function useRosterTagCoverage({ prospects, cdmName, oppsRecords, settings, userId }) {
  const [contacts, setContacts] = useState(null);
  // Keyed on the user's uid, for the same reason App.jsx keys its own
  // contact read on it: IndexedDB scopes every key by uid and returns
  // nothing until AuthContext has called setDbUserId. On a fresh load this
  // effect first runs before auth resolves, reads an empty cache, and would
  // otherwise sit on that empty list until a HubSpot sync happened to fire
  // the update event — which for a page-level caller meant no rosters, no
  // percentages, and a badge that never appeared.
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [userId]);

  // Same stores and the same events the contacts pages listen to, so a
  // company switched to "Cancelling for Sure" or ticked "Don't Track" drops
  // out of these numbers without a reload — and drops out here exactly as it
  // does on All Contacts, which is the point of sharing the gates.
  //
  // Re-read when the uid lands, for the same reason the contact cache above
  // is: these live in localStorage under a `u:<uid>:` prefix, so a read
  // before auth resolves returns an empty map. An empty one doesn't fail
  // loudly — it just stops excluding anybody, so every cancelling and Don't
  // Track client's contacts stay on the rosters and drag the percentages
  // down. That is exactly how this surfaced: a page that mounts after auth
  // (All Contacts) and this hook, mounted at app start, reporting different
  // percentages for the same rosters.
  const [clientStatusMap, setClientStatusMap] = useState(() => loadClientStatusMap());
  const [clientUntrackedMap, setClientUntrackedMap] = useState(() => loadClientUntrackedMap());
  useEffect(() => {
    function onStatus() { setClientStatusMap(loadClientStatusMap()); }
    function onUntracked() { setClientUntrackedMap(loadClientUntrackedMap()); }
    function onStorage(e) {
      if (e.key === 'clients-status-map') onStatus();
      if (e.key === 'clients-untracked-map') onUntracked();
    }
    onStatus();
    onUntracked();
    window.addEventListener('storage', onStorage);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatus);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatus);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    };
  }, [userId]);

  // Visible mode, matching the Totals pills on All Contacts: the figure
  // should describe the rosters as they're worked, not the hidden-review view.
  const gates = useMemo(
    () => makeRosterGates({ prospects: prospects || [], cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden: false }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  return useMemo(() => {
    if (contacts == null) return null;
    return rosterTagCoverage({
      contacts,
      gates,
      tagReviewMap: settings?.contactTagReview || {},
      localFields: settings?.contactLocalFields || null,
    });
  }, [contacts, gates, settings?.contactTagReview, settings?.contactLocalFields]);
}
