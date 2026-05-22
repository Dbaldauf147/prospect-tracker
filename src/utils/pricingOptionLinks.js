// Pricing-option ↔ Opp snapshots — a per-user map of `oppId → snapshot`
// that backs the "Pricing Option" column on the Opps 2 tab.
//
// The Pricing tab is the writer (that's where the user clicks "Save to
// Opp…"). Opps 2 reads this map and renders the snapshot's optionName
// as a computed column. The opp record itself never carries the data,
// so the two tabs can't disagree about what was saved.
//
// Snapshots are FROZEN at save time:
//   { optionName, years, escPct, rows, savedAt }
// Later edits to the Option on the Pricing tab don't follow through to
// already-saved snapshots — to refresh a snapshot the user clicks
// "Save to Opp…" again on the same opp.
//
// Storage: pricing-cache store, key `optionSnapshots`. Cross-tab
// updates broadcast via the `pricing:optionSnapshotsChanged` window
// event so the Opps 2 view re-renders the moment the user saves from
// Pricing.

import { dbGet, dbPut } from './db';

const PRICING_STORE = 'pricing-cache';
const SNAPSHOTS_KEY = 'optionSnapshots';
const EVENT_NAME = 'pricing:optionSnapshotsChanged';

export async function loadOptionSnapshots() {
  try {
    const val = await dbGet(PRICING_STORE, SNAPSHOTS_KEY);
    return (val && typeof val === 'object') ? val : {};
  } catch {
    return {};
  }
}

async function persistOptionSnapshots(snapshots) {
  try { await dbPut(PRICING_STORE, snapshots, SNAPSHOTS_KEY); } catch { /* idb best-effort */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: snapshots }));
  } catch { /* SSR / non-DOM environment */ }
}

// Save / refresh / clear the snapshot for a single opp. Passing null
// removes the snapshot entirely. The `option` argument is a plain
// object cloned via JSON to guarantee no live references leak across
// the freeze boundary.
export async function saveOppOptionSnapshot(oppId, option) {
  if (oppId == null) return null;
  const snapshots = await loadOptionSnapshots();
  const next = { ...snapshots };
  const key = String(oppId);
  if (!option) {
    delete next[key];
  } else {
    const name = String(option.name || '').trim();
    if (!name) return snapshots;
    next[key] = {
      optionName: name,
      years: Number(option.years) || 0,
      escPct: Number(option.escPct) || 0,
      rows: JSON.parse(JSON.stringify(option.rows || [])),
      savedAt: new Date().toISOString(),
    };
  }
  await persistOptionSnapshots(next);
  return next;
}

export const OPTION_SNAPSHOTS_EVENT = EVENT_NAME;
