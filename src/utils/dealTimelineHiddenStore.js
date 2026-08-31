// Which services the user has clicked off a deal's rollout timeline.
//
// The rollout popup lets you hide a service's band so the chart shows the
// workstreams under discussion rather than the whole delivery plan. That was
// lost the moment the popup closed, which made it a thing you redid every
// time you opened the deal — so it's kept here, per deal and per user.
//
// Scoped per plan (an opp id, or the account name when there's no id): hiding
// a service on one deal's chart says nothing about any other deal, which
// carries its own scope and its own conversation.
//
// The map surgery is split out as pure functions so scripts/…test.mjs can
// exercise it under plain Node, where there is no localStorage.

// Extension spelled out so this module loads under plain Node for the tests
// in scripts/, which Vite's resolver isn't there to help with.
import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

const KEY = 'deal-timeline-hidden';

// Fired when the hidden set changes, and the event the Firestore mirror
// dispatches after hydration pulls a newer copy down.
export const DEAL_TIMELINE_HIDDEN_EVENT = 'deal-timeline-hidden-changed';

// Mirrored: which bands you hid on a deal's rollout chart is a choice you
// made about that deal, and it used to live in one browser only.
registerMirroredKey(KEY, DEAL_TIMELINE_HIDDEN_EVENT);

// Names are compared the way the composer compares them — lowercased and
// trimmed — so a Scope that changed capitalisation between visits doesn't
// resurrect a band the user hid.
export function normHiddenName(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** The stored names for one plan, as a Set. Unknown plan → empty. */
export function readHiddenFrom(map, planKey) {
  const key = String(planKey || '');
  const list = key && map && typeof map === 'object' ? map[key] : null;
  return new Set((Array.isArray(list) ? list : []).map(normHiddenName).filter(Boolean));
}

/**
 * `map` with this plan's hidden services replaced. Returns a new object.
 *
 * An empty selection deletes the entry rather than storing []: unhiding
 * everything should leave no trace, or the store accumulates one dead key per
 * deal anybody ever experimented on.
 *
 * A blank planKey is a no-op — the popup can be opened on something with no
 * stable identity, and a shared "" bucket would leak one deal's hidden
 * services onto the next.
 */
export function writeHiddenTo(map, planKey, names) {
  const base = (map && typeof map === 'object') ? map : {};
  const key = String(planKey || '');
  if (!key) return base;
  const cleaned = [...new Set([...(names || [])].map(normHiddenName).filter(Boolean))].sort();
  const next = { ...base };
  if (cleaned.length) next[key] = cleaned;
  else delete next[key];
  return next;
}

function loadMap() {
  try {
    const raw = userLsGet(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** The services hidden on this deal's timeline, as a Set of lowercased names. */
export function loadHiddenServices(planKey) {
  return readHiddenFrom(loadMap(), planKey);
}

/** Remember (or clear) the services hidden on this deal's timeline. */
export function saveHiddenServices(planKey, names) {
  if (!String(planKey || '')) return;
  try {
    userLsSet(KEY, JSON.stringify(writeHiddenTo(loadMap(), planKey, names)));
    queueMirrorPush(KEY);
  } catch (err) {
    // A view preference is not worth breaking the popup over.
    console.warn('Failed to persist hidden timeline services', err);
  }
}
