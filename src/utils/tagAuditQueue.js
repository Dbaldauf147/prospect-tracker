// Contacts queued for the tag history audit, pushed from one page and read
// on another.
//
// The Prospecting ladder's "Map and tag your contacts" step already names
// the contacts a roster's percentage is waiting on — that list IS the set
// worth auditing when tags have gone missing, and re-finding those names by
// hand on the HubSpot page is the sort of work that stops an audit being
// run at all. Same shape as draftCampaignQueue: localStorage, per user, with
// a change event so a queue filled on one page shows up on the other
// instantly and across tabs.
//
// Ids are what the audit reads by (HubSpot's batch history read takes ids),
// but the name and email ride along so the receiving page can say who is
// queued before it calls anything.

import { useEffect, useState } from 'react';
// Imported with the extension so the pure rules at the foot of this file also
// load under plain Node (scripts/tagAuditQueue.test.mjs).
import { userLsGet, userLsSet } from './userLs.js';

const STORAGE_KEY = 'tag-audit:queued-contacts';
const EVENT = 'tag-audit-queue-changed';

// A locally-created contact has no HubSpot record behind it, so there is no
// history to read and queueing it would spend a call on nothing.
export function isAuditableId(id) {
  const s = String(id || '').trim();
  return !!s && !s.startsWith('local-');
}

function readFromStorage() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(c => c && isAuditableId(c.id)) : [];
  } catch {
    return [];
  }
}

function writeToStorage(list) {
  try {
    userLsSet(STORAGE_KEY, JSON.stringify(list));
  } catch (e) { void e; }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch (e) { void e; }
}

export function getQueuedAuditContacts() {
  return readFromStorage();
}

/**
 * Put `contacts` — { id, name, email } — in the queue, replacing whatever
 * was there.
 *
 * Replacing rather than merging: this queue answers "audit these", and a
 * second click on another roster means the user is now asking about that
 * roster. A queue that accumulated would quietly audit yesterday's list too
 * and report casualties nobody asked about.
 *
 * Returns how many were queued, so the page that filled it can say so.
 */
export function setQueuedAuditContacts(contacts) {
  const byId = new Map();
  for (const c of (contacts || [])) {
    if (!c || !isAuditableId(c.id)) continue;
    const id = String(c.id);
    if (byId.has(id)) continue;
    byId.set(id, { id, name: c.name || '', email: c.email || '' });
  }
  const list = [...byId.values()];
  writeToStorage(list);
  return list.length;
}

export function clearQueuedAuditContacts() {
  writeToStorage([]);
}

export function useTagAuditQueue() {
  const [list, setList] = useState(readFromStorage);
  useEffect(() => {
    const onChange = () => setList(readFromStorage());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return list;
}

/**
 * The contacts of a Tagged-row list worth auditing, as queue records.
 *
 * `people` are the rows rosterTagCoverage builds — each carrying the HubSpot
 * record it was scored from. Only contacts still short of a full set of
 * answers are taken: those are the ones the step flags, and the ones whose
 * tags are in question. A contact with no HubSpot record behind them (an
 * imported row) is dropped — there is no history to read.
 */
export function auditablePeople(people) {
  const out = [];
  for (const p of (people || [])) {
    if (p?.done) continue;
    const id = p?.contact?.id ?? p?.contact?.vid ?? p?.id;
    if (!isAuditableId(id)) continue;
    out.push({ id: String(id), name: p.name || '', email: p.email || '' });
  }
  return out;
}
