import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadOpps2Cache, loadOpps2Newest } from '../utils/opps2Store';
import { countOverdueCallIns } from '../utils/oppsCallIn';
import {
  caughtUpSnapshot, isOppsStepClear, readCaughtUpSnapshot, subscribeCaughtUp,
} from '../utils/prospectingStatus';
import { readSteps } from '../utils/prospectingPlaybook';
import { missingTagRosters } from '../utils/contactRosters';
import { useRosterTagCoverage } from './useRosterTagCoverage';

// The number behind the sidebar's Prospecting badge: contact rosters whose
// tags still aren't fully mapped, one apiece.
//
// It is the same figure the Prospecting page prints beside its Tagged row,
// under the same rule and the same gate — `missingTagRosters` decides what
// counts (Active and All excluded, see contactRosters.js) and
// `isOppsStepClear` decides whether it shows at all. A badge that nagged
// while step 1 still had overdue opps would pull the user off the work the
// ladder puts first.
//
// Returns null when there's nothing to show, so the caller renders no badge
// rather than a 0.
export function useProspectingTagDebt({ prospects, cdmName, settings, userId }) {
  // The opps records, for two things at once: the roster gates need them to
  // know which companies have open opps, and the overdue count is the gate.
  // Read the same way the sidebar's Opps badge reads them — newest of the
  // two stores on mount, the local cache on every later refresh, since that
  // is what every Opps 2 edit writes first.
  const [oppsRecords, setOppsRecords] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const apply = (recs) => { if (!cancelled && Array.isArray(recs)) setOppsRecords(recs); };
    loadOpps2Newest(userId).then(d => apply(d?.records)).catch(() => {});
    const readCache = () => { loadOpps2Cache().then(d => apply(d?.records)).catch(() => {}); };
    // Call In is relative to today, so the gate has to roll over on its own
    // rather than waiting for a reload — same reason the Opps badge ticks.
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

  // Straight off localStorage, so marking a step caught up on the Prospecting
  // page moves the badge without a reload — and so does another tab doing it.
  const snapshot = useSyncExternalStore(subscribeCaughtUp, caughtUpSnapshot);
  const { today, map: caughtUpMap } = useMemo(() => readCaughtUpSnapshot(snapshot), [snapshot]);

  const coverage = useRosterTagCoverage({ prospects, cdmName, oppsRecords, settings });
  const steps = useMemo(() => readSteps(settings), [settings]);

  return useMemo(() => {
    // null, not 0: the Opps store hasn't answered yet, so whether step 1 is
    // clear isn't known and the badge stays off rather than guessing.
    const overdue = oppsRecords ? countOverdueCallIns(oppsRecords) : null;
    if (!isOppsStepClear({ steps, overdue, caughtUpMap, today })) return null;
    const n = missingTagRosters(coverage).length;
    return n > 0 ? n : null;
  }, [coverage, oppsRecords, steps, caughtUpMap, today]);
}
