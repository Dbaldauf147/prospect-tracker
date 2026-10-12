import { useEffect } from 'react';
import { countsFromCoverage, recordContactCounts } from '../utils/contactCountHistory';
import { weekKeyAt } from '../utils/weeklyReportTrends';

// Writes this week's Key / Client / Key Prospect contact counts into the
// History log (utils/contactCountHistory) while the app is open.
//
// Fed the roster coverage App already computes for the sidebar badge, so
// the counts are the All Contacts Totals pills' own numbers, not a second
// calculation that could drift from them.
//
// Waits until the reading means something: the contacts are in (an empty
// cache would record every roster at 0), the Table View accounts are in
// (the Client and Key Prospect rosters are built from them), and the opps
// are in (until then every Tier 1/2 account looks opp-less and Key
// Prospect is overcounted). Debounced, because those arrive one at a time
// on load and the first complete-looking reading is often a beat early.
export function useContactCountRecorder({ coverage, oppsReady, prospectsReady }) {
  useEffect(() => {
    if (!coverage || !oppsReady || !prospectsReady) return undefined;
    if (!(coverage.all?.contacts > 0)) return undefined;
    const counts = countsFromCoverage(coverage);
    if (!counts) return undefined;
    const t = setTimeout(() => recordContactCounts(weekKeyAt(Date.now()), counts), 5000);
    return () => clearTimeout(t);
  }, [coverage, oppsReady, prospectsReady]);
}
