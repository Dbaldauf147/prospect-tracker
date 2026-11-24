// The email schedule (utils/emailSchedule.js buildEmailSchedule) for the
// saved campaigns: who is in each audience, loaded from the HubSpot contacts
// and the roster gates, then the planned sends and each audience's next
// open day. Shared by the Email Schedule tab and the Pause picker's
// calendar, so both show the same dates.
import { useEffect, useMemo, useState } from 'react';
import { buildEmailSchedule, audienceMembers, localDay, DEFAULT_MOST_SHARE } from '../../utils/emailSchedule';
import { makeRosterGates } from '../../utils/contactRosters';
import { useClientFlagMaps } from '../../utils/rosterHooks';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { userLsGet } from '../../utils/userLs';

export const MOST_KEY = 'email-schedule:most';
export const MOST_CHOICES = [0.5, 0.67, 0.75, 0.8, 0.9, 1];

/** The share of an audience "most" means, as last picked on the Email Schedule tab. */
export function savedMostShare() {
  const v = Number(userLsGet(MOST_KEY));
  return MOST_CHOICES.includes(v) ? v : DEFAULT_MOST_SHARE;
}

/** { rows, groups, today, loading }: loading until the contacts have been read. */
export function useEmailSchedule({ campaigns, prospects, cdmName, most }) {
  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();
  const [contacts, setContacts] = useState(null);
  const [oppsRecords, setOppsRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadOppsFromCache().then(o => { if (!cancelled) setOppsRecords(o?.records || []); }).catch(() => {});
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setContacts(c || []); }).catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const gates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  const members = useMemo(() => audienceMembers(contacts || [], gates), [contacts, gates]);
  const today = localDay(new Date());
  const { rows, groups } = useMemo(
    () => buildEmailSchedule({ campaigns, members, today, most }),
    [campaigns, members, today, most],
  );
  return { rows, groups, today, loading: contacts === null };
}
