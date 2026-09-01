// Persists which YOY charts the user has hidden, scoped per user
// (localStorage via userLs, mirroring yoyOverridesStore). Hiding a chart
// removes it from the YOY grid until the user restores it; the choice
// sticks across reloads.
//
// Shape: string[] of chartIds
//   chartId — 'leads' | 'quotedProjections' | 'closeRate' | 'leadSources' |
//             'quotedByYear' | 'notSolds' | 'topAccounts' | 'annualSales' |
//             'dealSize' | 'commissions'

import { userLsGet, userLsSet } from './userLs';

const KEY = 'yoy-hidden-charts';

export function loadHiddenCharts() {
  try {
    const raw = userLsGet(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (Array.isArray(saved)) return saved.filter((id) => typeof id === 'string');
  } catch (err) {
    console.warn('Failed to read YOY hidden charts:', err);
  }
  return [];
}

export function saveHiddenCharts(ids) {
  try { userLsSet(KEY, JSON.stringify(Array.isArray(ids) ? ids : [])); } catch { /* ignore quota */ }
}
