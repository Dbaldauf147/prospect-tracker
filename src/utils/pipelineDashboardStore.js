// Read helper + change event for the Pipeline dashboard record (the same
// IndexedDB row PipelineView saves its whole state to). Other tabs read
// pieces of it — the Issues tab needs the tracked "Service Exploration
// Coverage" services so it can warn about the rows sitting under 100%.
// PipelineView announces every save with PIPELINE_DASHBOARD_EVENT so those
// readers refresh as soon as the user adds or removes a service.
import { dbGet } from './db.js';
import { registerMirroredDbKey } from './localMirrorSync.js';

export const PIPELINE_STORE = 'pipeline-dashboard';
export const PIPELINE_KEY = 'current';
export const PIPELINE_DASHBOARD_EVENT = 'pipeline-dashboard-changed';

// Mirrored to Firestore. The dashboard is typed state, not derived data —
// nothing rebuilds it — so a cleared browser used to lose it outright, and
// with it the tracked coverage services the Issues tab reads.
registerMirroredDbKey(PIPELINE_STORE, PIPELINE_KEY, PIPELINE_DASHBOARD_EVENT);

export async function loadPipelineDashboard() {
  try {
    return (await dbGet(PIPELINE_STORE, PIPELINE_KEY)) || null;
  } catch { return null; }
}

// The tracked coverage services, defensively normalized the same way
// PipelineView normalizes them on hydrate (array of non-empty strings).
export function coverageServicesOf(pipeline) {
  const list = pipeline?.coverageServices;
  return Array.isArray(list) ? list.filter(s => typeof s === 'string' && s) : [];
}

// The tracked services as a lookup, keyed the way every other service
// comparison in the app is keyed — trimmed and lowercased. The coverage table
// stores canonical service names (the same strings the service boards list),
// so a name match is the right join; matching on anything looser would mark a
// service tracked because it shares a word with one that is.
export function coverageTrackedSet(pipelineOrList) {
  const list = Array.isArray(pipelineOrList)
    ? pipelineOrList
    : coverageServicesOf(pipelineOrList);
  return new Set(list.map(s => String(s).trim().toLowerCase()).filter(Boolean));
}

/** Is this service one of the tracked coverage services? */
export function isCoverageTracked(trackedSet, name) {
  const key = String(name ?? '').trim().toLowerCase();
  return !!key && !!trackedSet?.has?.(key);
}

export function notifyPipelineDashboardChanged() {
  try { window.dispatchEvent(new Event(PIPELINE_DASHBOARD_EVENT)); } catch { /* non-browser */ }
}
