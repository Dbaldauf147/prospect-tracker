// BFO Activity > All Team Activity: the stored pulls of the "SB NAM Sales -
// Open Opportunities" report (utils/teamOpps). One record holding the
// current pull and the one before it, so the tab can say what changed.
// Mirrored to Firestore like the main BFO Activity paste: the agent may
// paste on one machine and Dan read it on the other.
import { dbGet } from './db.js';
import { registerMirroredDbKey, mirrorDbPut } from './localMirrorSync.js';
import { BFO_ACTIVITY_STORE } from './bfoActivityStore.js';

export const TEAM_OPPS_KEY = 'team-opps';
export const TEAM_OPPS_EVENT = 'bfo-team-opps-changed';

registerMirroredDbKey(BFO_ACTIVITY_STORE, TEAM_OPPS_KEY, TEAM_OPPS_EVENT);

// A paste this soon after the last one is a redo of the same pull (a fixed
// transcription, a second try), not a new pull: it replaces the current
// rows but keeps the same "before", so the flags survive.
const SAME_PULL_MS = 3 * 86400000;

/** { headers, rows, updatedAt, previous: { rows, updatedAt } | null } or null. */
export async function loadTeamOpps() {
  try { return (await dbGet(BFO_ACTIVITY_STORE, TEAM_OPPS_KEY)) || null; } catch { return null; }
}

/** The record after a new paste lands on `stored`. */
export function withNewTeamOppsPull(stored, { headers, rows }, nowMs = Date.now()) {
  const hadRows = Array.isArray(stored?.rows) && stored.rows.length > 0;
  const redo = hadRows && typeof stored.updatedAt === 'number' && nowMs - stored.updatedAt < SAME_PULL_MS;
  const previous = redo
    ? (stored.previous || null)
    : (hadRows ? { rows: stored.rows, updatedAt: stored.updatedAt || null } : (stored?.previous || null));
  return { headers, rows, updatedAt: nowMs, previous };
}

export async function saveTeamOpps(record) {
  await mirrorDbPut(BFO_ACTIVITY_STORE, TEAM_OPPS_KEY, record);
  try { window.dispatchEvent(new Event(TEAM_OPPS_EVENT)); } catch { /* not in a browser */ }
}
