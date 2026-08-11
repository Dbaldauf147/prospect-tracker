import { useEffect, useState } from 'react';
import { loadOpps2Cache, loadOpps2Newest } from '../utils/opps2Store';
import { countCallInDue } from '../utils/oppsCallIn';

// Count behind the sidebar's red Opps badge: opps whose Call In has hit
// zero or gone negative and that aren't marked "No Further Action Today".
//
// The Opps 2 records live in IndexedDB (mirrored to Firestore), not in any
// App-level state, so this reads them directly — the newest of the two
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
  const [count, setCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Held across refreshes so a focus/timer tick that finds nothing new
    // can still re-run the day-relative math on the rows we already have.
    let records = null;

    const apply = (recs) => {
      if (cancelled) return;
      if (Array.isArray(recs)) records = recs;
      if (records) setCount(countCallInDue(records));
    };

    const readNewest = () => {
      loadOpps2Newest(userId)
        .then(d => apply(Array.isArray(d?.records) ? d.records : null))
        .catch(() => { /* leave the badge as-is rather than showing a wrong count */ });
    };
    const readCache = () => {
      loadOpps2Cache()
        .then(d => apply(Array.isArray(d?.records) ? d.records : null))
        .catch(() => {});
    };

    readNewest();
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

  return count;
}
