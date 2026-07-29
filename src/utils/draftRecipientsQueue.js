// Shared "queued for Draft Emails" recipients pushed from the Email Campaign
// tracker (the "Add unsent to Draft" button).
//
// Like draftLeadsQueue (and unlike draftCampaignQueue, which stores HubSpot
// contact ids), campaign recipients aren't necessarily HubSpot contacts — a
// campaign roster holds raw email addresses — so this queue stores the full
// contact-shaped object the Draft Emails composer needs (name / firstName /
// lastName / email / company). Persisted per user in localStorage and shared
// via a change event so queuing on the Email Campaigns page shows up on the
// Draft Emails page instantly, across tabs.

import { useEffect, useState } from 'react';
import { userLsGet, userLsSet } from './userLs';

const STORAGE_KEY = 'draft-recipients:queued-contacts';
const EVENT = 'draft-recipients-queue-changed';

// Stable identity for a queued recipient: the lower-cased email, so the same
// address queued twice — or already sitting in the draft — collapses to one.
export function recipientQueueKey(c) {
  return String(c?.email || '').trim().toLowerCase();
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

export function getQueuedRecipients() {
  return readFromStorage();
}

export function setQueuedRecipients(list) {
  writeToStorage(Array.isArray(list) ? list.filter(c => c && c.email) : []);
}

// Merge `contacts` into the queue, deduped by recipientQueueKey. Returns the
// number of genuinely new recipients added (already-queued ones are skipped).
export function addQueuedRecipients(contacts) {
  const byKey = new Map(readFromStorage().map(c => [recipientQueueKey(c), c]));
  let added = 0;
  for (const c of (contacts || [])) {
    if (!c || !c.email) continue;
    const k = recipientQueueKey(c);
    if (!k || byKey.has(k)) continue;
    byKey.set(k, c);
    added++;
  }
  writeToStorage(Array.from(byKey.values()));
  return added;
}

export function removeQueuedRecipient(key) {
  writeToStorage(readFromStorage().filter(c => recipientQueueKey(c) !== key));
}

export function clearQueuedRecipients() {
  writeToStorage([]);
}

export function useDraftRecipientsQueue() {
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
