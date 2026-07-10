// Persists user overrides for the YOY charts, scoped per user (localStorage
// via userLs, mirroring quotedProjectionsStore). The YOY numbers are all
// computed live off the Opps cache; an override lets the user pin a
// corrected value onto a specific data point so it wins over the computed
// one until they clear it.
//
// Shape: { [chartId]: { [rowKey]: { [field]: number } } }
//   chartId  — 'leads' | 'closeRate' | 'leadSources' | 'quotedByYear' |
//              'notSolds' | 'topAccounts' | 'annualSales' | 'dealSize' |
//              'commissions'
//   rowKey   — the row's x-axis category (year as a string, 'Projected',
//              or a Lead Source name)
//   field    — the plotted dataKey being overridden (e.g. 'count', 'sold')

import { userLsGet, userLsSet } from './userLs';

const KEY = 'yoy-chart-overrides';

export function loadYoyOverrides() {
  try {
    const raw = userLsGet(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  } catch (err) {
    console.warn('Failed to read YOY overrides:', err);
  }
  return {};
}

export function saveYoyOverrides(map) {
  try { userLsSet(KEY, JSON.stringify(map || {})); } catch { /* ignore quota */ }
}
