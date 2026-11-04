// The rolling windows the Close Rates tab offers: for the Close Date window
// (the controls at the top and each chart's Own filters) and for Stage
// reach's Start Date window. A window is stored as its key, never the dates
// it resolved to, so "Last 12 months" saved in May still means the last 12
// months in November. Pure, so scripts/closeRateWindows.test.mjs checks it.

export const WINDOW_PRESETS = [
  { key: '6m', label: 'Last 6 months', months: 6 },
  // '1y' and '2y' are the keys saved filters already hold; keep them.
  { key: '1y', label: 'Last 12 months', months: 12 },
  { key: '18m', label: 'Last 18 months', months: 18 },
  { key: '24m', label: 'Last 24 months', months: 24 },
  { key: '36m', label: 'Last 36 months', months: 36 },
  { key: '2y', label: 'Since Jan, 2 yrs ago' },
  { key: 'ytd', label: 'This year' },
  { key: 'all', label: 'All time' },
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The From date a preset means today ('' = open), or null if unknown. */
export function presetFrom(key, now = new Date()) {
  const p = WINDOW_PRESETS.find(x => x.key === key);
  if (!p) return null;
  if (key === 'all') return '';
  if (key === 'ytd') return `${now.getFullYear()}-01-01`;
  if (key === '2y') return `${now.getFullYear() - 2}-01-01`;
  const target = now.getMonth() - p.months;
  const d = new Date(now.getFullYear(), target, now.getDate());
  // 31 Aug minus 6 months would roll into March; clamp to Feb's last day.
  if (d.getMonth() !== ((target % 12) + 12) % 12) d.setDate(0);
  return iso(d);
}

/** Presets as the tab uses them: { key, label, from() }. */
export const PRESET_LIST = WINDOW_PRESETS.map(p => ({ ...p, from: () => presetFrom(p.key) }));

// The Weekly email table's length. The email itself shows 6.
export const WEEKLY_MONTHS = [3, 6, 9, 12];
export const DEFAULT_WEEKLY_MONTHS = 6;
export const cleanWeeklyMonths = (n) => (WEEKLY_MONTHS.includes(Number(n)) ? Number(n) : DEFAULT_WEEKLY_MONTHS);
