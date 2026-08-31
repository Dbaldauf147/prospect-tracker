// Custom "Timeline Type" options for the Opps Notes / Follow Up timelines
// editor. The editor ships two presets (Budget / Compliance); anything the
// user types into a Timeline Type cell is remembered here so it joins the
// dropdown for the next timeline, on this page and everywhere the editor
// appears.
//
// Small, self-contained store on the same pattern as the other util stores:
// user-scoped localStorage (via userLs, so two accounts sharing a browser
// don't see each other's list) plus a change event so any open editor
// refreshes its datalist the moment a new option is added.

import { userLsGet, userLsSet } from './userLs';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

// Seed presets. Kept here so the editor imports the merged list from one
// place; the defaults always lead the dropdown, custom entries follow.
export const DEFAULT_TIMELINE_TYPES = ['Budget timeline', 'Compliance timeline'];

const STORAGE_KEY = 'opps-timeline-type-options';
// Fired (in-tab) whenever the custom list changes so mounted editors can
// re-read without waiting for a focus / reload. Cross-tab updates ride the
// native `storage` event instead.
export const TIMELINE_TYPE_OPTIONS_EVENT = 'timeline-type-options-updated';

// Mirrored to Firestore: the custom entries here are typed once and then
// expected to be in the dropdown forever, including on the other machine.
registerMirroredKey(STORAGE_KEY, TIMELINE_TYPE_OPTIONS_EVENT);

function readCustom() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(v => typeof v === 'string' && v.trim() !== '');
  } catch {
    return [];
  }
}

// Merge presets + saved custom entries, de-duped case-insensitively with the
// presets first and custom entries in the order they were added. The label
// shown is the first spelling seen for a given case-folded key, so "Q3 plan"
// and "q3 plan" collapse to one option rather than cluttering the list.
export function loadTimelineTypeOptions() {
  const out = [];
  const seen = new Set();
  for (const v of [...DEFAULT_TIMELINE_TYPES, ...readCustom()]) {
    const label = String(v).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

// Remember a typed Timeline Type. No-op for blanks or values already offered
// (preset or custom, case-insensitive). Returns true when a new option was
// actually stored so callers can skip a needless event dispatch.
export function addTimelineTypeOption(value) {
  const label = String(value == null ? '' : value).trim();
  if (!label) return false;
  const existing = new Set(loadTimelineTypeOptions().map(o => o.toLowerCase()));
  if (existing.has(label.toLowerCase())) return false;
  const nextCustom = [...readCustom(), label];
  try {
    userLsSet(STORAGE_KEY, JSON.stringify(nextCustom));
    queueMirrorPush(STORAGE_KEY);
  } catch (err) {
    console.warn('Saving timeline type option failed', err);
    return false;
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(TIMELINE_TYPE_OPTIONS_EVENT));
    }
  } catch { /* CustomEvent unavailable */ }
  return true;
}
