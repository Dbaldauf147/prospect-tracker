import { useEffect, useMemo, useState } from 'react';
import { loadOpps2Cache, loadOpps2Newest } from '../utils/opps2Store';
import { missingTagRosters } from '../utils/contactRosters';
import { useRosterTagCoverage } from './useRosterTagCoverage';

// The number behind the sidebar's Prospecting badge: contact rosters whose
// tags still aren't fully mapped, one apiece.
//
// It is the same figure the Prospecting page prints beside its Tagged row,
// under the same rule — `missingTagRosters` decides what counts, with Active
// and All excluded (see contactRosters.js).
//
// Returns null when there's nothing to show, so the caller renders no badge
// rather than a 0.
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

  const coverage = useRosterTagCoverage({ prospects, cdmName, oppsRecords, settings });

  return useMemo(() => {
    // Shown whatever the rest of the ladder is doing. Tag mapping is the one
    // piece of prospecting debt nothing else surfaces — marking every step
    // caught up turns the page green without touching it — so a badge that
    // waited for the steps above would go quiet exactly when the page stops
    // saying anything else. null, not 0, so a cleared roster leaves no badge.
    const n = missingTagRosters(coverage).length;
    return n > 0 ? n : null;
  }, [coverage]);
}
