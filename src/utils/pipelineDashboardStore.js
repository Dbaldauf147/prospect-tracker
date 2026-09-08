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

// ---------------------------------------------------------------------
// When the dashboard may be written, and when a stored copy may replace
// what is on screen.
//
// Both rules exist because of one failure: the Pipeline page loaded, found
// an empty IndexedDB (a cleared browser), and saved its DEFAULT state
// straight back — which the mirror then pushed to Firestore, stamped now,
// on top of the good copy it was in the middle of pulling down. The cloud
// backup was overwritten by defaults seconds after the browser was cleared,
// and the tracked Service Exploration Coverage services went with it.
//
// The mirror already refuses to push a key it holds NOTHING for, so a
// cleared browser can't blank the cloud on its own. What it can't see is a
// view writing a full, plausible, empty-of-content default into that slot.
// These two rules are how the view avoids doing that.

// Is this state worth writing? Only when it differs from what storage last
// gave us — which on a first-ever load is the default state. An untouched
// dashboard is never written, so mounting the page can't create a record,
// and can't overwrite one that a hydration is still fetching.
export function pipelineNeedsSave(stateJson, baselineJson) {
  if (typeof stateJson !== 'string' || !stateJson) return false;
  return stateJson !== baselineJson;
}

// Should a record that just landed in storage replace what is on screen?
//
// It lands when the Firestore mirror pulls a copy this browser didn't have
// — the restore case — and the page is typically sitting on defaults when
// it does. Adopt it then. But not once the user has typed: a hydration that
// arrives mid-edit must not take the edit with it, and the edit is the
// newer answer anyway. `baselineJson` is what storage last gave us, so
// state still equal to it means nothing has been typed yet.
export function pipelineShouldAdopt({ stateJson, baselineJson, incomingJson }) {
  if (typeof incomingJson !== 'string' || !incomingJson) return false;
  if (incomingJson === stateJson) return false;   // already showing it
  return stateJson === baselineJson;              // untouched: safe to replace
}

export function notifyPipelineDashboardChanged() {
  try { window.dispatchEvent(new Event(PIPELINE_DASHBOARD_EVENT)); } catch { /* non-browser */ }
}
