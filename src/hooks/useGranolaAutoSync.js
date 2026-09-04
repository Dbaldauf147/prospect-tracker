import { useEffect, useRef } from 'react';
import { probeGranola } from '../utils/granolaCalls';
import { loadCallRecords, saveCallRecord } from '../utils/callRecordingsStore';
import { normalizeRules } from '../utils/callNaRules';
import { runGranolaSync } from '../utils/runGranolaSync';
import { runCallSummary } from '../utils/runCallSummary';
import { callsDueForAutoSummary, autoSummaryFailurePatch } from '../utils/autoSummarize';

// How stale the stored calls are allowed to get before this pulls again.
export const AUTO_SYNC_MS = 60 * 60 * 1000;
// The ticker checks the clock rather than being the hour itself. A browser
// tab in the background has its timers throttled hard (and a sleeping
// laptop stops them altogether), so an interval set to an hour can land
// well past one; checking every minute means the first tick after the tab
// wakes up finds the sync overdue and runs it straight away.
const CHECK_MS = 60 * 1000;

/**
 * Keep Granola calls flowing in wherever the user is in the app.
 *
 * This lives at the app level rather than on the Call Recordings page
 * because the page is lazy-mounted: a sync that only ticks while that tab
 * is open never runs for someone working on Opps all morning, which is
 * exactly when new calls are landing in Granola.
 *
 * The page still has its own Sync button and shows progress; both go
 * through runGranolaSync, so they agree on the watermark. Nothing here
 * renders — a background sync is silent, and the calls simply appear on
 * the page next time it is opened.
 *
 * Each run also summarises what's due. A Granola call arrives already
 * transcribed, and until this existed the summary — the only part anyone
 * reads — waited on the user opening the Call Recordings page and
 * clicking Summarize, per call. Same reasoning as the sync: the page is
 * lazy-mounted, and the person who wants the summary is on Opps.
 * `callRecordingsAutoSummarize: false` in settings turns it off.
 */
export function useGranolaAutoSync(user, settings, updateSettings, prospects, enabled = true) {
  const uid = user?.uid || null;
  const lastSyncedAt = useRef(0);
  const running = useRef(false);

  // Everything the sync reads, kept in a ref so the ticker below can hold
  // no dependencies at all and arm its interval exactly once. Reading
  // through the ref also means each hourly run picks up the settings and
  // prospects as they are at that moment, not as they were on mount.
  const latest = useRef({ settings, updateSettings, prospects });
  latest.current = { settings, updateSettings, prospects };

  // A different account syncs on its own clock rather than inheriting the
  // previous one's place in the hour.
  useEffect(() => { lastSyncedAt.current = 0; }, [uid]);

  useEffect(() => {
    if (!enabled || !uid) return undefined;
    let cancelled = false;

    // A snapshot of the stored records for one run, plus the writer that
    // keeps it current — so a call touched twice in the same run (the sync
    // storing it, then the summary pass reading it) sees what was written.
    const openSnapshot = async () => {
      const stored = await loadCallRecords(uid);
      return {
        stored,
        getStored: (id) => stored[id] || null,
        persist: async (id, patch) => {
          const base = stored[id] || null;
          const saved = await saveCallRecord(uid, id, patch, base);
          if (saved) stored[id] = saved;
          return saved;
        },
      };
    };

    const syncGranola = async (snap) => {
      // Only sync when Granola is actually reachable. Without the probe
      // every tick would walk the pagination just to fail on the key.
      const status = await probeGranola();
      if (cancelled || !status?.ok) return;
      const { settings: s, updateSettings: update, prospects: p } = latest.current;
      await runGranolaSync({
        uid,
        prospects: p || [],
        settings: s || {},
        updateSettings: update,
        naRules: normalizeRules(s?.callRecordingsNaRules || []),
        getStored: snap.getStored,
        persist: snap.persist,
      });
    };

    // Summarise what's due, over the same snapshot the sync just updated —
    // so a call that arrived in this run is summarised in it rather than an
    // hour later. Runs whatever the sync did, and whether Granola is
    // configured at all: a OneDrive recording transcribed on the page is
    // just as due as a Granola one.
    const summarizeDue = async (snap) => {
      const { settings: s } = latest.current;
      if (s?.callRecordingsAutoSummarize === false) return;
      for (const record of callsDueForAutoSummary(snap.stored)) {
        if (cancelled) return;
        try {
          const { ok, error } = await runCallSummary({
            uid,
            recordingId: record.id,
            record,
            transcript: record.transcript,
            autoPush: s?.callRecordingsAutoPush === true,
            persist: snap.persist,
          });
          // A failure is banked on the record, not just dropped: it is
          // what stops a transcript the summariser can't read from being
          // paid for again every hour.
          if (!ok) await snap.persist(record.id, autoSummaryFailurePatch(record, error));
        } catch (err) {
          await snap.persist(record.id, autoSummaryFailurePatch(record, err?.message || err));
        }
      }
    };

    const run = async () => {
      // `running` is the real guard: the ticker fires every minute and a
      // sync over a long back-fill window can take longer than that.
      if (running.current) return;
      if (Date.now() - lastSyncedAt.current < AUTO_SYNC_MS) return;
      running.current = true;
      // Stamped up front, not on success. A source that is failing should
      // be retried next hour, not every minute for the rest of the day.
      lastSyncedAt.current = Date.now();
      try {
        // Reading the snapshot here rather than holding it means this hook
        // keeps nothing in memory between runs.
        const snap = await openSnapshot();
        if (cancelled) return;
        // A broken Granola key must not cost the summaries: they are
        // separate jobs over the same records, and one failing says
        // nothing about the other.
        try {
          await syncGranola(snap);
        } catch {
          // A background sync has nowhere to report to. The page's own
          // Sync button is where a broken key or a lapsed plan gets
          // explained.
        }
        if (cancelled) return;
        await summarizeDue(snap);
      } catch {
        // Same as above: nowhere to report to. The page's Summarize
        // button is where a failure gets explained, and the attempt
        // counter on the record is what stops this retrying forever.
      } finally {
        running.current = false;
      }
    };

    run();
    const timer = setInterval(run, CHECK_MS);
    // Coming back to a tab that has been in the background is when the
    // throttled ticker is most likely to be behind.
    document.addEventListener('visibilitychange', run);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled, uid]);
}
