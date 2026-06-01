// Persists the YOY "Quoted Projections" monthly values, scoped per user.
// The chart is no longer computed live from opps — it plots month-end
// snapshots the user records. Values are in THOUSANDS of dollars ($K):
// weak / ok / expected are the quoted-$ Chance buckets and agreements is
// Agreements Sent. BFO Pipe Total is NOT stored — it's computed as a
// coverage ratio (quoted $ ÷ monthly target). Keyed by month "YYYY-MM".

import { userLsGet, userLsSet } from './userLs';

const KEY = 'yoy-quoted-projections';

export const QUOTED_FIELDS = ['weak', 'ok', 'expected', 'agreements'];

// Historical values supplied for the fiscal year ending Nov 2026
// (Dec 2025 → May 2026). Everything in $K.
export const QUOTED_HISTORICAL_SEED = {
  '2025-12': { weak: 757, ok: 757, expected: 212, agreements: 202 },
  '2026-01': { weak: 829, ok: 829, expected: 437, agreements: 257 },
  '2026-02': { weak: 630, ok: 630, expected: 467, agreements: 253 },
  '2026-03': { weak: 636, ok: 577, expected: 253, agreements: 253 },
  '2026-04': { weak: 579, ok: 579, expected: 359, agreements: 236 },
  '2026-05': { weak: 402, ok: 402, expected: 329, agreements: 311 },
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
}
