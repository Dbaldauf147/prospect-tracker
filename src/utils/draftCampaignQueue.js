// Shared "queued for Draft Emails campaign" state.
// Lives in localStorage so the queue survives a refresh and is shared
// across the Active / Client / Key Contacts pages and the Draft
// Emails page (Custom Email Campaign card). Components subscribe via
// the useDraftCampaignQueue hook so flipping a checkbox on one page
// updates the count on another instantly. Scoped per user — accounts
// sharing a browser don't inherit each other's draft-campaign queue.

import { useEffect, useState } from 'react';
import { userLsGet, userLsSet } from './userLs';

const STORAGE_KEY = 'draft-campaign:queued-contact-ids';
const EVENT = 'draft-campaign-queue-changed';

function readFromStorage() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(id => id != null).map(String) : [];
  } catch {
    return [];
  }
}

function writeToStorage(ids) {
  try {
    userLsSet(STORAGE_KEY, JSON.stringify(ids));
  } catch (e) { void e; }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch (e) { void e; }
}

export function getQueuedContactIds() {
  return readFromStorage();
}

export function setQueuedContactIds(ids) {
  const next = Array.from(new Set((ids || []).map(String)));
  writeToStorage(next);
}

export function toggleQueuedContact(id) {
  const key = String(id);
  if (!key) return;
  const ids = readFromStorage();
  const next = ids.includes(key) ? ids.filter(x => x !== key) : [...ids, key];
  writeToStorage(next);
}

export function clearQueuedContacts() {
  writeToStorage([]);
}

export function useDraftCampaignQueue() {
  const [ids, setIds] = useState(readFromStorage);
  useEffect(() => {
    const onChange = () => setIds(readFromStorage());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return ids;
}
