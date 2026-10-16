// Records the Prospecting History "Contacts with activity" reading once a
// day from App, so a day is logged whenever the app is open rather than
// only when that subtab is (utils/rosterActivityHistory.js). Counted
// exactly as the subtab counts it: the contacts pages' own roster gates and
// client exclusions, the Decision Makers page's "at one of my accounts"
// gate, and the email/call index.
//
// Only once the reading is real: contacts loaded, the email/call index
// present (without it everyone looks colder than they are), the opps in
// hand (they decide who is a Key Prospect) and the prospects loaded.
// Waits a few seconds after the inputs settle so a half-loaded burst at
// startup doesn't write a dip.

import { useEffect, useMemo, useState } from 'react';
import { getHubspotCacheShared } from '../utils/hubspotContactsCache';
import { makeMyCdmContactGate } from '../utils/myCdmContacts';
import { rosterActivityCounts } from '../utils/tieredAccountActivity';
import { recordRosterActivity } from '../utils/rosterActivityHistory';
import { todayISO } from '../utils/prospectingStatus';
import { useRosterGates } from './useRosterTagCoverage';
import { useOutreachIndex } from './useTieredActivity';

export function useRosterActivityRecorder({ prospects, cdmName = '', settings, userId, oppsRecords, prospectsReady }) {
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCacheShared()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [userId]);

  const outreachIndex = useOutreachIndex(userId);
  const gates = useRosterGates({ prospects, cdmName, oppsRecords, userId });
  const localFields = settings?.contactLocalFields || null;
  const myCdmGate = useMemo(
    () => makeMyCdmContactGate({ prospects: prospects || [], cdmName, localFields }),
    [prospects, cdmName, localFields],
  );
  const hasIndex = !!(outreachIndex?.emails || outreachIndex?.phones);
  const counts = useMemo(() => {
    if (!userId || !prospectsReady || oppsRecords == null || !hasIndex || !contacts?.length || !gates) return null;
    return rosterActivityCounts({ contacts, gates, myCdmGate, outreachIndex, localFields });
  }, [userId, prospectsReady, oppsRecords, hasIndex, contacts, gates, myCdmGate, outreachIndex, localFields]);

  useEffect(() => {
    if (!counts) return undefined;
    const t = setTimeout(() => recordRosterActivity(todayISO(), counts), 5000);
    return () => clearTimeout(t);
  }, [counts]);
}
