import { useEffect, useMemo, useState } from 'react';
import { getHubspotCache } from '../utils/hubspotContactsCache';
import { decisionMakerCoverage } from '../utils/decisionMakerCoverage';

// Decision-maker mapping per tier, for the cold-outreach step of the
// Prospecting ladder — see utils/decisionMakerCoverage.js for the rule.
//
// Reads the HubSpot contact cache the way useRosterTagCoverage does, and
// keyed on the uid for the same reason: IndexedDB scopes every key by user,
// so a read before auth resolves comes back empty and would sit that way
// until a sync happened to fire the update event.
//
// Returns null until the contacts answer, so the page renders nothing at
// all rather than a table claiming every account is unmapped.
export function useDecisionMakerCoverage({ prospects, cdmName, settings, userId }) {
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    }
    refresh();
    // Tag a decision maker in HubSpot and the row clears without a reload.
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [userId]);

  const localFields = settings?.contactLocalFields || null;
  return useMemo(
    () => decisionMakerCoverage({ prospects, contacts, cdmName, localFields }),
    [prospects, contacts, cdmName, localFields],
  );
}
