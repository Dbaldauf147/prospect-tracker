// Where Relationship Strength reads its activity from, and where the Log
// activity form writes.
//
// Two records, both under the signed-in user's localStorage prefix:
//
//   relationship:log            what you typed: activities logged by hand,
//                               and edits to the direction / outcome of a
//                               HubSpot activity. Mirrored to Firestore, so
//                               it follows you to another machine.
//                               { activities: { id: entry }, overrides: { touchId: edit } }
//
//   relationship-touch-index    the HubSpot feed boiled down to touches
//                               (buildTouchIndex). Rebuilt by the Activity
//                               tab every time it pulls the feed, so it is a
//                               cache and is not mirrored.
//
// An entry: { id, contactId, contactEmail, contactName, company, type,
// direction, outcome, medium, date (YYYY-MM-DD), note, createdAt,
// updatedAt, deleted? }. An override: { type?, direction, outcome, medium,
// updatedAt, deleted? }. A removal is a `deleted` flag rather than a
// missing key, so the merge between two machines can't bring it back.
//
// Both writes fire RELATIONSHIP_EVENT, which every score on screen listens
// for: adding or editing an activity re-scores straight away.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { buildTouchIndex, TOUCH_INDEX_VERSION, normalizeTouch, logDayMs, localDay } from './relationshipStrength.js';

export const RELATIONSHIP_LOG_KEY = 'relationship:log';
export const TOUCH_INDEX_KEY = 'relationship-touch-index';
export const RELATIONSHIP_EVENT = 'relationship-data-updated';
// The HubSpot feed the Activity tab keeps (when it fits in storage).
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

export function parseRelationshipLog(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    return { activities: obj(v?.activities), overrides: obj(v?.overrides) };
  } catch { return { activities: {}, overrides: {} }; }
}

// Per entry, the newer edit wins; an entry only one side has is kept.
export function mergeRelationshipLogs(local, remote) {
  const l = parseRelationshipLog(local);
  const r = parseRelationshipLog(remote);
  const pick = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const mine = out[k];
      if (!mine || (Date.parse(v?.updatedAt) || 0) > (Date.parse(mine?.updatedAt) || 0)) out[k] = v;
    }
    return out;
  };
  return { activities: pick(l.activities, r.activities), overrides: pick(l.overrides, r.overrides) };
}

registerMirroredKey(RELATIONSHIP_LOG_KEY, RELATIONSHIP_EVENT, { merge: mergeRelationshipLogs });

export function loadRelationshipLog() {
  return parseRelationshipLog(userLsGet(RELATIONSHIP_LOG_KEY));
}

function saveRelationshipLog(log) {
  userLsSet(RELATIONSHIP_LOG_KEY, JSON.stringify(log));
  queueMirrorPush(RELATIONSHIP_LOG_KEY);
  window.dispatchEvent(new CustomEvent(RELATIONSHIP_EVENT));
}

const newId = () => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// The fields an entry keeps, tidied the way the score will read them, so
// the form shows back exactly what was stored.
export function cleanEntry(entry) {
  const t = normalizeTouch({ ...entry, ms: logDayMs(entry?.date) });
  return {
    contactId: String(entry?.contactId || ''),
    contactEmail: String(entry?.contactEmail || '').trim().toLowerCase(),
    contactName: String(entry?.contactName || '').trim(),
    company: String(entry?.company || '').trim(),
    type: t.type,
    direction: t.direction,
    outcome: t.outcome,
    medium: t.medium,
    date: /^\d{4}-\d{2}-\d{2}$/.test(entry?.date || '') ? entry.date : localDay(Date.now()),
    note: String(entry?.note || '').slice(0, 2000),
  };
}

/** Add a logged activity, or save an edit to one (by `id`). Returns its id. */
export function saveLoggedActivity(entry) {
  const log = loadRelationshipLog();
  const now = new Date().toISOString();
  const id = entry?.id && log.activities[entry.id] ? entry.id : newId();
  const prev = log.activities[id];
  log.activities[id] = { id, ...cleanEntry(entry), createdAt: prev?.createdAt || now, updatedAt: now };
  saveRelationshipLog(log);
  return id;
}

export function deleteLoggedActivity(id) {
  const log = loadRelationshipLog();
  if (!log.activities[id]) return;
  log.activities[id] = { ...log.activities[id], deleted: true, updatedAt: new Date().toISOString() };
  saveRelationshipLog(log);
}

/** Correct a HubSpot activity's direction / outcome / medium. */
export function saveTouchOverride(touchId, fields) {
  if (!touchId) return;
  const log = loadRelationshipLog();
  const keep = {};
  for (const k of ['direction', 'outcome', 'medium']) if (fields?.[k]) keep[k] = fields[k];
  log.overrides[touchId] = { ...keep, updatedAt: new Date().toISOString() };
  saveRelationshipLog(log);
}

export function clearTouchOverride(touchId) {
  const log = loadRelationshipLog();
  if (!log.overrides[touchId]) return;
  log.overrides[touchId] = { updatedAt: new Date().toISOString(), cleared: true };
  saveRelationshipLog(log);
}

// --- the HubSpot touch index ----------------------------------------------

export function loadTouchIndex() {
  try {
    const v = JSON.parse(userLsGet(TOUCH_INDEX_KEY) || 'null');
    if (v?.v === TOUCH_INDEX_VERSION) return v;
  } catch { /* unreadable: rebuilt below or by the next feed pull */ }
  // No index yet (the first visit after this shipped): build one from the
  // feed the Activity tab left behind, when it had room to keep it.
  try {
    const feed = JSON.parse(userLsGet(ACTIVITY_CACHE_KEY) || 'null');
    if (feed && (feed.emails || feed.calls || feed.meetings)) {
      const built = buildTouchIndex(feed, readWorkEmail());
      try { userLsSet(TOUCH_INDEX_KEY, JSON.stringify(built)); } catch { /* quota: used in memory */ }
      return built;
    }
  } catch { /* no feed */ }
  return null;
}

let workEmailHint = '';
function readWorkEmail() { return workEmailHint; }

/** Called by the Activity tab with each fresh feed. */
export function saveTouchIndexFromFeed(feed, workEmail = '') {
  workEmailHint = workEmail || workEmailHint;
  try {
    userLsSet(TOUCH_INDEX_KEY, JSON.stringify(buildTouchIndex(feed, workEmail)));
  } catch (err) {
    console.warn('Relationship touch index write skipped (quota):', err?.message || err);
  }
  window.dispatchEvent(new CustomEvent(RELATIONSHIP_EVENT));
}
