// Where Relationship Strength reads its activity from, and where the Log
// activity form writes.
//
// Two records, both under the signed-in user's localStorage prefix:
//
//   relationship:log            what you typed: activities logged by hand,
//                               and edits to the direction / outcome of a
//                               HubSpot activity. Mirrored to Firestore, so
//                               it follows you to another machine.
//                               { activities: { id: entry }, overrides: { touchId: edit },
//                                 dateAdded: { contactId: { date, updatedAt } } }
//
//   the touch index             the HubSpot feed and Granola meetings
//                               boiled down to touches, in IndexedDB (see
//                               below). Rebuilt by the Activity tab, so it
//                               is a cache and is not mirrored.
//
// An entry: { id, contactId, contactEmail, contactName, company, type,
// direction, outcome, medium, date (YYYY-MM-DD), note, createdAt,
// updatedAt, deleted? }. An override: { type?, direction, outcome, medium,
// updatedAt, deleted? }. A removal is a `deleted` flag rather than a
// missing key, so the merge between two machines can't bring it back.
//
// Both writes fire RELATIONSHIP_EVENT, which every score on screen listens
// for: adding or editing an activity re-scores straight away.

import { userLsGet, userLsSet, userLsRemove } from './userLs.js';
import { dbGet, dbPut, getDbUserId } from './db.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import {
  buildTouchIndex, buildMeetingTouchIndex, mergeTouchIndexes, calendarLog, buildCalendarTouchIndex, TOUCH_INDEX_VERSION, HUBSPOT_INDEX_REV, normalizeTouch, logDayMs, localDay,
} from './relationshipStrength.js';

export const RELATIONSHIP_LOG_KEY = 'relationship:log';
// Where the index used to live; read once to carry it over, then removed.
const LEGACY_TOUCH_INDEX_KEY = 'relationship-touch-index';
export const RELATIONSHIP_EVENT = 'relationship-data-updated';
// The HubSpot feed the Activity tab keeps (when it fits in storage).
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

export function parseRelationshipLog(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    return { activities: obj(v?.activities), overrides: obj(v?.overrides), dateAdded: obj(v?.dateAdded) };
  } catch { return { activities: {}, overrides: {}, dateAdded: {} }; }
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
  return {
    activities: pick(l.activities, r.activities),
    overrides: pick(l.overrides, r.overrides),
    dateAdded: pick(l.dateAdded, r.dateAdded),
  };
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

/**
 * Set the Date Added on a contact (YYYY-MM-DD): when the relationship
 * started, for the score's new-or-established read. A blank date clears
 * it, back to HubSpot's created date or the first activity.
 */
export function saveContactDateAdded(contactId, date) {
  const id = String(contactId || '').trim();
  if (!id) return;
  const log = loadRelationshipLog();
  const now = new Date().toISOString();
  log.dateAdded[id] = /^\d{4}-\d{2}-\d{2}$/.test(date || '')
    ? { date, updatedAt: now }
    : { cleared: true, updatedAt: now };
  saveRelationshipLog(log);
}

// --- the touch index --------------------------------------------------------
//
// Two parts, saved separately so either can be rebuilt without the other:
// `hubspot` from the Activity tab's HubSpot feed, `granola` from the
// Granola meetings it shows. Read as one (mergeTouchIndexes).
//
// In IndexedDB, not localStorage. The index started out in localStorage
// next to the feed, and the feed routinely fills that ~5 MB on its own:
// the index write then failed, was only logged, and every contact read as
// having no HubSpot history. IndexedDB has room for it. A copy is kept in
// memory, so the score reads it synchronously once it has loaded.

const TOUCH_STORE = 'relationship-touches';
const parts = { hubspot: null, granola: null, outlook: null };
// The Outlook meetings kept so far (calendarLog's shape). Unlike the other
// two parts it is added to, never rebuilt: the tab only sees a short
// window of the calendar at a time.
let calendarStore = null;
let merged = null;
let hydrated = null; // the uid the in-memory copy was loaded for
let hydrating = null;

function remerge() { merged = mergeTouchIndexes(parts.hubspot, parts.granola, parts.outlook); }

/** The index in memory: null until hydrateTouchIndex has loaded it. */
export function loadTouchIndex() {
  return merged;
}

function feedFromLocalStorage() {
  try {
    const feed = JSON.parse(userLsGet(ACTIVITY_CACHE_KEY) || 'null');
    return feed && (feed.emails || feed.calls || feed.meetings) ? feed : null;
  } catch { return null; }
}

/**
 * Load the index for the signed-in user into memory. Takes over an index
 * an older version left in localStorage (and frees that space), or builds
 * one from the feed the Activity tab kept there, when there is one.
 */
export function hydrateTouchIndex() {
  const uid = getDbUserId();
  if (!uid) return Promise.resolve(merged);
  if (hydrated === uid) return Promise.resolve(merged);
  if (hydrating?.uid === uid) return hydrating.promise;
  const promise = (async () => {
    parts.hubspot = null;
    parts.granola = null;
    parts.outlook = null;
    calendarStore = null;
    try {
      const [hs, gr, cal] = await Promise.all([
        dbGet(TOUCH_STORE, 'hubspot'), dbGet(TOUCH_STORE, 'granola'), dbGet(TOUCH_STORE, CALENDAR_KEY),
      ]);
      if (hs?.v === TOUCH_INDEX_VERSION) parts.hubspot = hs;
      // Built by older code: rebuilt from the saved feed when there is one
      // (below), else kept until the Activity tab next rebuilds it, so the
      // panel is not left blank meanwhile.
      if (parts.hubspot && parts.hubspot.hv !== HUBSPOT_INDEX_REV) {
        const feed = feedFromLocalStorage();
        if (feed) {
          parts.hubspot = buildTouchIndex(feed, workEmailHint);
          dbPut(TOUCH_STORE, parts.hubspot, 'hubspot').catch(() => {});
        }
      }
      if (gr?.v === TOUCH_INDEX_VERSION) parts.granola = gr;
      if (cal?.v === TOUCH_INDEX_VERSION) {
        calendarStore = cal;
        parts.outlook = buildCalendarTouchIndex(cal);
      }
    } catch { /* unreadable: rebuilt by the next Activity tab visit */ }
    if (!parts.hubspot) {
      let legacy = null;
      try { legacy = JSON.parse(userLsGet(LEGACY_TOUCH_INDEX_KEY) || 'null'); } catch { /* none */ }
      const feed = legacy?.v === TOUCH_INDEX_VERSION ? null : feedFromLocalStorage();
      parts.hubspot = legacy?.v === TOUCH_INDEX_VERSION ? legacy : feed ? buildTouchIndex(feed, workEmailHint) : null;
      if (parts.hubspot) dbPut(TOUCH_STORE, parts.hubspot, 'hubspot').catch(() => {});
    }
    try { userLsRemove(LEGACY_TOUCH_INDEX_KEY); } catch { /* nothing to free */ }
    remerge();
    hydrated = uid;
    return merged;
  })();
  hydrating = { uid, promise };
  promise.finally(() => { if (hydrating?.promise === promise) hydrating = null; });
  return promise;
}

let workEmailHint = '';

async function savePart(name, index) {
  // Load what is stored first. A save that ran before the load would mark
  // this user loaded with only its own part in memory, and the parts it
  // didn't write would never be read back (or, for the calendar, be
  // overwritten by a log that had forgotten them).
  await hydrateTouchIndex();
  parts[name] = index;
  remerge();
  window.dispatchEvent(new CustomEvent(RELATIONSHIP_EVENT));
  try {
    await dbPut(TOUCH_STORE, index, name);
  } catch (err) {
    // Still scored from memory for this visit; the next visit rebuilds it.
    console.warn('Relationship touch index write failed:', err?.message || err);
  }
}

/** The Activity tab, with each HubSpot feed it has in hand. */
export function saveTouchIndexFromFeed(feed, workEmail = '') {
  if (!feed || !(feed.emails || feed.calls || feed.meetings)) return Promise.resolve();
  workEmailHint = workEmail || workEmailHint;
  return savePart('hubspot', buildTouchIndex(feed, workEmail));
}

const CALENDAR_KEY = 'outlook-meetings';

/** The Activity tab, with the Outlook calendar meetings it has in hand. */
export async function saveCalendarMeetings(meetings, { backfilled = false } = {}) {
  if (!meetings?.length && !backfilled) return;
  await hydrateTouchIndex();
  const next = calendarLog(calendarStore, meetings);
  if (backfilled) next.backfilledAt = new Date().toISOString();
  calendarStore = next;
  try { await dbPut(TOUCH_STORE, next, CALENDAR_KEY); } catch (err) {
    console.warn('Relationship calendar write failed:', err?.message || err);
  }
  await savePart('outlook', buildCalendarTouchIndex(next));
}

/** Whether the one-time year of Outlook history has been read in. */
export async function calendarBackfilled() {
  await hydrateTouchIndex();
  return !!calendarStore?.backfilledAt;
}

/** The Activity tab, with the Granola meetings it shows. */
export function saveMeetingTouches(meetings) {
  if (!meetings?.length) return Promise.resolve();
  return savePart('granola', buildMeetingTouchIndex(meetings));
}
