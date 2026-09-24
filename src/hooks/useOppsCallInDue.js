import { useMemo } from 'react';
import { useOpps2Data } from './useOpps2Data';
import { countCallInDue } from '../utils/oppsCallIn';

// Count behind the sidebar's red Opps badge: opps whose Call In has hit
// zero or gone negative and that aren't marked "No Further Action Today".
//
// The Opps 2 records live in IndexedDB (mirrored to Firestore), not in any
// App-level state, so this reads them off the shared reader (useOpps2Data) — the newest of the two
// stores on mount, then the local cache on every later refresh, since the
// cache is written first on every edit.
//
// Refreshes on:
//   • `opps2-cache-updated` — every Opps 2 save fires it, so ticking a
//     "No Further Action Today" box or pushing out a Follow Up date drops
//     the badge without a reload.
//   • window focus — picks up an edit made in another tab, and re-runs the
//     date math after the machine has been left overnight.
//   • a 10-minute timer — Call In is relative to today, so the badge has to
//     roll over on its own at midnight rather than waiting for a reload.
//
// Returns null until the first read lands, so the caller can render no
// badge at all rather than flashing a "0" that only means "not loaded yet".
export function useOppsCallInDue(userId) {
  const data = useOpps2Data(userId);
  return useMemo(
    () => (Array.isArray(data?.records) ? countCallInDue(data.records) : null),
    [data],
  );
}
