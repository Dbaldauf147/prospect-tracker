import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadOpps2Cache, loadOpps2Newest } from '../utils/opps2Store';
import { countCallInDue } from '../utils/oppsCallIn';
import { campaignsAllSent, unfinishedCampaigns } from '../utils/campaignOutreach';
import { useSavedCampaigns } from './useSavedCampaigns';
import { collectTopPcIntros } from '../utils/topPcOutreach';
import { readSteps } from '../utils/prospectingPlaybook';
import {
  caughtUpSnapshot,
  countDueSteps,
  countRenewalWork,
  countServiceGaps,
  ladderStates,
  readCaughtUpSnapshot,
  statesByKey,
  subscribeCaughtUp,
} from '../utils/prospectingStatus';

// The Prospecting ladder's status, worked out once for everyone who shows
// it: the page's Status column and the sidebar's Prospecting dot.
//
// It has to be one computation rather than two runs of the same rule. The
// dot says a step is outstanding, the page says which one — if the two
// read their counts a beat apart (the opps store answering later here than
// there, say) the sidebar can dot a step the page shows as caught up, and
// the user has no way to tell which is lying. Same reasoning as
// useProspectingTagDebt, which feeds the other two readouts on that page.
//
// Returns { steps, counts, autoClear, topPcIntros, campaignsToFinish,
// states, stateByKey, today, caughtUpMap, dueCount }.
export function useProspectingLadder({ issues = null, serviceGaps = null, prospects = null, settings = null, userId = null } = {}) {
  // The Opps 2 records, read the way every other consumer of that store
  // reads them: newest of the local cache and Firestore on mount, then the
  // cache on focus / after any Opps 2 save / on a timer, since Call In is
  // relative to today and this hook lives in App, mounted all day.
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

  // The hand-marked steps, straight off localStorage: another tab's mark,
  // the user id landing after login, and the date rolling over past
  // midnight all reach here this way rather than through mirrored state.
  const snapshot = useSyncExternalStore(subscribeCaughtUp, caughtUpSnapshot);
  const { today, map: caughtUpMap } = useMemo(() => readCaughtUpSnapshot(snapshot), [snapshot]);

  // The ladder itself — the defaults until the user edits it, their stored
  // order and text after that. Order matters here and not only on the
  // page: which step the ladder has reached depends on what sits above it.
  const steps = useMemo(() => readSteps(settings), [settings]);

  // Every PE firm's Top PC that isn't at Qualifying yet. Kept whole rather
  // than counted, since the page lists these rows under the step.
  const topPcIntros = useMemo(() => collectTopPcIntros(prospects), [prospects]);

  // The saved email campaigns, read here rather than on the Prospecting
  // page so the page's market-updates row, the rows it prints under it and
  // the sidebar's dot are one answer — the same reason the counts above
  // are computed here. `loading` is what keeps an empty list from reading
  // as "everything has been sent" before the read has landed; a failed
  // read ends as [], which is a book with no campaigns in it and so leaves
  // the step to be marked by hand.
  const { campaigns: savedCampaigns, loading: campaignsLoading } = useSavedCampaigns();
  const campaigns = campaignsLoading ? null : savedCampaigns;
  const campaignsToFinish = useMemo(
    () => (campaigns ? unfinishedCampaigns(campaigns) : null),
    [campaigns],
  );

  // null (not 0) anywhere the answer hasn't landed: a step with a count
  // still in flight is "unknown", which shows nothing, rather than an
  // unearned "all caught up" that would also let the step below it go red.
  const counts = useMemo(() => ({
    opps: oppsRecords ? countCallInDue(oppsRecords) : null,
    renewals: countRenewalWork(issues),
    'targeted-services': countServiceGaps(serviceGaps),
    'pe-intros': topPcIntros ? topPcIntros.length : null,
  }), [oppsRecords, issues, serviceGaps, topPcIntros]);

  // The steps nothing counts, but that something in the app can still
  // answer for. "Reach out to contacts with market updates" is the batch a
  // saved campaign sends, so once every campaign that isn't paused has
  // finished going out, the step is done without the user confirming what
  // the data already says. null while the campaigns are still loading.
  const autoClear = useMemo(() => ({
    'market-updates': campaignsAllSent(campaigns),
  }), [campaigns]);

  const states = useMemo(
    () => ladderStates({ steps, counts, autoClear, caughtUpMap, today }),
    [steps, counts, autoClear, caughtUpMap, today],
  );

  return useMemo(() => ({
    steps,
    counts,
    autoClear,
    topPcIntros,
    campaignsToFinish,
    states,
    stateByKey: statesByKey(states),
    today,
    caughtUpMap,
    dueCount: countDueSteps(states),
  }), [steps, counts, autoClear, topPcIntros, campaignsToFinish, states, today, caughtUpMap]);
}
