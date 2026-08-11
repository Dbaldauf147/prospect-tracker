import { useEffect, useMemo, useState } from 'react';
import { loadOpps2Cache, loadOpps2Newest } from '../utils/opps2Store';
import { missingTagRosters } from '../utils/contactRosters';
import { useRosterTagCoverage } from './useRosterTagCoverage';

// Tag-mapping debt, for the sidebar's Prospecting badge and for the
// Prospecting page's own Tagged row.
//
// Returns { coverage, missing, count } — the whole coverage object, the
// rosters still short of fully mapped tags (`missingTagRosters`, with Active
// and All excluded — see contactRosters.js), and the badge number, which is
// null rather than 0 so a caller renders nothing at all when there's no debt.
//
// One hook, called once in App, feeding both readouts. They used to compute
// it separately from the same rule, which is not the same thing as computing
// it once: the roster gates take the opps records, and whichever of the two
// had them a beat later put a different set of contacts on the Key Prospect
// roster and reported a different number. The only way two figures can't
// disagree is for there to be one figure.
export function useProspectingTagDebt({ prospects, cdmName, settings, userId }) {
  // The opps records: the roster gates need them to know which companies
  // have open opps, which decides who is on the Active roster and who counts
  // as a Key Prospect. Read the way the sidebar's Opps badge reads them —
  // newest of the two stores on mount, the local cache on every later
  // refresh, since that is what every Opps 2 edit writes first.
  const [oppsRecords, setOppsRecords] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const apply = (recs) => { if (!cancelled && Array.isArray(recs)) setOppsRecords(recs); };
    loadOpps2Newest(userId).then(d => apply(d?.records)).catch(() => {});
    const readCache = () => { loadOpps2Cache().then(d => apply(d?.records)).catch(() => {}); };
    const timer = setInterval(readCache, 10 * 60 * 1000);
    window.addEventListener('focus', readCache);
    window.addEventListener('opps2-cache-updated', readCache);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', readCache);
      window.removeEventListener('opps2-cache-updated', readCache);
    };
  }, [userId]);

  const coverage = useRosterTagCoverage({ prospects, cdmName, oppsRecords, settings, userId });

  return useMemo(() => {
    // Shown whatever the rest of the ladder is doing. Tag mapping is the one
    // piece of prospecting debt nothing else surfaces — marking every step
    // caught up turns the page green without touching it — so a count that
    // waited for the steps above would go quiet exactly when the page stops
    // saying anything else.
    const missing = missingTagRosters(coverage);
    return { coverage, missing, count: missing.length > 0 ? missing.length : null };
  }, [coverage]);
}
