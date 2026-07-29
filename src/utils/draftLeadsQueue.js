// Shared "queued for Draft Emails" leads from the Marketing Leads page.
//
// Unlike draftCampaignQueue (which stores HubSpot contact ids and resolves
// them against the HubSpot cache), Marketing Leads aren't necessarily
// HubSpot contacts — so this queue stores the full contact-shaped object
// the Draft Emails composer needs (name / firstName / lastName / email /
// company / title). Persisted per user in localStorage and shared via a
// change event so ticking leads on the Marketing Leads page shows up on
// the Draft Emails page instantly.

import { useEffect, useState } from 'react';
import { userLsGet, userLsSet } from './userLs';

const STORAGE_KEY = 'draft-leads:queued-contacts';
const EVENT = 'draft-leads-queue-changed';

// Stable identity for a queued lead: prefer the (lower-cased) email so the
// same person queued twice — or already sitting in the draft — collapses
// to one entry; fall back to the synthetic contact id when there's no
// email (those can't actually be drafted, but the key still has to exist).
export function leadQueueKey(c) {
  return String(c?.email || '').trim().toLowerCase() || `id:${c?.id || ''}`;
}

function readFromStorage() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(c => c && c.email) : [];
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

export function getQueuedLeads() {
  return readFromStorage();
}

export function setQueuedLeads(list) {
  writeToStorage(Array.isArray(list) ? list.filter(c => c && c.email) : []);
}

// Merge `contacts` into the queue, deduped by leadQueueKey. Returns the
// number of genuinely new leads added (already-queued ones are skipped).
export function addQueuedLeads(contacts) {
  const byKey = new Map(readFromStorage().map(c => [leadQueueKey(c), c]));
  let added = 0;
  for (const c of (contacts || [])) {
    if (!c || !c.email) continue;
    const k = leadQueueKey(c);
    if (byKey.has(k)) continue;
    byKey.set(k, c);
    added++;
  }
  writeToStorage(Array.from(byKey.values()));
  return added;
}

export function removeQueuedLead(key) {
  writeToStorage(readFromStorage().filter(c => leadQueueKey(c) !== key));
}

export function clearQueuedLeads() {
  writeToStorage([]);
}

export function useDraftLeadsQueue() {
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
