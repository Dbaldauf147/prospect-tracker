// The services the Pipeline page's "Service Exploration Coverage" table
// tracks, for anywhere that lists services.
//
// Those are the services being actively pushed across the client book — the
// ones a coverage percentage is being watched on. Every service board in the
// app (the company card's Services Explored, the Opps Scope picker, the Deal
// Sizing picker) listed them as ordinary entries, so the service you are
// measured on looked exactly like the one nobody is chasing.
//
// The list lives on the Pipeline dashboard record, which is IndexedDB and so
// has to be read asynchronously — hence a hook rather than a plain read at
// the point of use. PipelineView announces every save, so a service added to
// the coverage table marks itself on the open board without a reload.

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  loadPipelineDashboard,
  coverageTrackedSet,
  PIPELINE_DASHBOARD_EVENT,
} from '../utils/pipelineDashboardStore';

const EMPTY = new Set();

/**
 * @returns a Set of tracked service names, lowercased — pass it to
 *          isCoverageTracked. Empty until the record loads, and empty
 *          forever when nothing is being tracked, which is the right answer
 *          for a user who hasn't set the coverage table up.
 */
export function useCoverageServices() {
  const { user } = useAuth();
  const [tracked, setTracked] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadPipelineDashboard()
        .then((p) => {
          if (cancelled) return;
          const next = coverageTrackedSet(p);
          // Same contents means the same Set object, so a board that memoizes
          // on this doesn't re-render every time the dashboard is saved for
          // an unrelated reason.
          setTracked(prev => (sameSet(prev, next) ? prev : next));
        })
        .catch(() => { /* no dashboard yet: nothing is tracked */ });
    };
    refresh();
    window.addEventListener(PIPELINE_DASHBOARD_EVENT, refresh);
    // The record is mirrored across devices, and a pull lands as a storage
    // event rather than a save on this tab.
    window.addEventListener('storage', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(PIPELINE_DASHBOARD_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
    // The IndexedDB read is scoped per user, so a sign-in re-reads it.
  }, [user?.uid]);

  return tracked;
}

function sameSet(a, b) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
