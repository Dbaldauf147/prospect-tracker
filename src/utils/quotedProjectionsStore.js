// Persists the YOY "Quoted Projections" monthly values, scoped per user.
// The chart is no longer computed live from opps — it plots month-end
// snapshots the user records. Values are in THOUSANDS of dollars ($K):
// weak / ok / expected are the quoted-$ Chance buckets, agreements is
// Agreements Sent, and bfoPipe is the total BFO pipeline $ (plotted on
// its own right-hand axis since it runs larger). Keyed by month "YYYY-MM".

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush, dispatchStoreEvent } from './localMirrorSync.js';

const KEY = 'yoy-quoted-projections';

// Fired whenever the projections are saved, so same-window listeners (the
// YOY page) refresh — the native 'storage' event only fires in OTHER tabs.
export const QUOTED_PROJECTIONS_EVENT = 'yoy-quoted-projections-changed';

// Mirrored to Firestore: these are month-end figures typed in by hand, one
// month at a time, and nothing else in the app can recompute them. A cleared
// browser used to lose the lot.
registerMirroredKey(KEY, QUOTED_PROJECTIONS_EVENT);

export const QUOTED_FIELDS = ['weak', 'ok', 'expected', 'agreements', 'bfoPipe'];

// Historical values supplied for the fiscal year ending Nov 2026
// (Dec 2025 → May 2026). Everything in $K.
export const QUOTED_HISTORICAL_SEED = {
  '2025-12': { weak: 757, ok: 757, expected: 212, agreements: 202, bfoPipe: 4061 },
  '2026-01': { weak: 829, ok: 829, expected: 437, agreements: 257, bfoPipe: 4882 },
  '2026-02': { weak: 630, ok: 630, expected: 467, agreements: 253, bfoPipe: 3528 },
  '2026-03': { weak: 636, ok: 577, expected: 253, agreements: 253, bfoPipe: 2928 },
  '2026-04': { weak: 579, ok: 579, expected: 359, agreements: 236, bfoPipe: 3637 },
  '2026-05': { weak: 402, ok: 402, expected: 329, agreements: 311, bfoPipe: 3186 },
};

// Saved values win over the seed per month, so the user can correct a
// historical figure or add new months without losing the rest.
export function loadQuotedProjections() {
  try {
    const raw = userLsGet(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return { ...QUOTED_HISTORICAL_SEED, ...saved };
    }
  } catch (err) {
    console.warn('Failed to read quoted projections:', err);
  }
  return { ...QUOTED_HISTORICAL_SEED };
}

export function saveQuotedProjections(map) {
  try { userLsSet(KEY, JSON.stringify(map || {})); } catch { /* ignore quota */ }
  queueMirrorPush(KEY);
  dispatchStoreEvent(QUOTED_PROJECTIONS_EVENT);
}

// June 2026 was filled once with the then-current live totals as a stand-in,
// before past months could be rebuilt from the Opps data — so it ended up
// carrying July's numbers. This one-shot flag lets the rebuild replace that
// value exactly once per user, leaving any later hand correction alone.
const JUNE_REBUILD_KEY = 'yoy-quoted-june-2026-rebuilt';

// Mirrored alongside the values themselves. The flag is what makes the
// rebuild one-shot, so a browser that restored the projections but not the
// flag would run it a second time and overwrite a hand-corrected June.
registerMirroredKey(JUNE_REBUILD_KEY, QUOTED_PROJECTIONS_EVENT);

export function juneRebuildDone() {
  return userLsGet(JUNE_REBUILD_KEY) === '1';
}

export function markJuneRebuildDone() {
  try { userLsSet(JUNE_REBUILD_KEY, '1'); } catch { /* ignore quota */ }
  queueMirrorPush(JUNE_REBUILD_KEY);
}
