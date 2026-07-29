// Snoozed-issue overrides for the Issues tab. Snoozing an issue keeps it
// visible on the tab (so it can be un-snoozed) but takes it out of the
// open-issue count shown on the sidebar badge. Stored in its own
// localStorage key, scoped per user, keyed by the stable issue id that
// each detector in utils/clientIssues.js assigns (e.g. `neg-days:<id>`),
// so a snooze survives reloads and follows the issue as data refreshes.

import { userLsGet, userLsSet } from './userLs';

const SNOOZED_KEY = 'issues-snoozed-map';
export const ISSUE_SNOOZED_EVENT = 'issue-snoozed-changed';

export function loadIssueSnoozedMap() {
  try {
    const raw = userLsGet(SNOOZED_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function persist(map) {
  try {
    userLsSet(SNOOZED_KEY, JSON.stringify(map || {}));
    window.dispatchEvent(new Event(ISSUE_SNOOZED_EVENT));
  } catch (err) {
    console.warn('Failed to persist issue snooze map', err);
  }
}

export function setIssueSnoozed(id, snoozed) {
  const key = String(id || '').trim();
  if (!key) return;
  const map = loadIssueSnoozedMap();
  if (snoozed) map[key] = true;
  else delete map[key];
  persist(map);
}
