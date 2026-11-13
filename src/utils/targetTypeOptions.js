// The Target Type options on the company popup's Targets tab.
//
// The list is the user's own standard vocabulary: anything typed into a
// Target Type cell joins it, so the next company offers the same names, and
// any entry can be taken off again from the dropdown. Same store as
// timelineTypeOptions.js - user-scoped localStorage, a change event, and a
// Firestore mirror so the list follows the user to their other machine.
//
// Stored as the whole list, defaults included, once anything has been
// written: that is the only way a removed default can stay removed. Until
// then the defaults stand in for it.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const DEFAULT_TARGET_TYPES = [
  'Net zero',
  'SBTi near-term',
  'SBTi long-term',
  'Absolute emissions reduction',
  'Emissions intensity reduction',
  'Renewable electricity (RE100)',
];

const STORAGE_KEY = 'company-target-type-options';
export const TARGET_TYPE_OPTIONS_EVENT = 'target-type-options-updated';

registerMirroredKey(STORAGE_KEY, TARGET_TYPE_OPTIONS_EVENT);

// Trimmed, blanks dropped, de-duped case-insensitively keeping the first
// spelling, so "net zero" typed later doesn't sit beside "Net zero".
export function dedupeTypes(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const label = typeof v === 'string' ? v.trim() : '';
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out;
}

export function loadTargetTypeOptions() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return dedupeTypes(parsed);
    }
  } catch { /* unreadable: fall back to the defaults */ }
  return [...DEFAULT_TARGET_TYPES];
}

function save(list) {
  try {
    userLsSet(STORAGE_KEY, JSON.stringify(dedupeTypes(list)));
    queueMirrorPush(STORAGE_KEY);
  } catch (err) {
    console.warn('Saving target type options failed', err);
    return false;
  }
  try {
    window.dispatchEvent(new CustomEvent(TARGET_TYPE_OPTIONS_EVENT));
  } catch { /* no window / CustomEvent */ }
  return true;
}

// Add a typed type to the list. No-op (false) for blanks and names already
// on it, whatever their case.
export function addTargetTypeOption(value) {
  const label = String(value ?? '').trim();
  if (!label) return false;
  const list = loadTargetTypeOptions();
  if (list.some(o => o.toLowerCase() === label.toLowerCase())) return false;
  return save([...list, label]);
}

// Take a type off the list. Targets already logged with it keep it.
export function removeTargetTypeOption(value) {
  const key = String(value ?? '').trim().toLowerCase();
  const list = loadTargetTypeOptions();
  const next = list.filter(o => o.toLowerCase() !== key);
  return next.length === list.length ? false : save(next);
}
