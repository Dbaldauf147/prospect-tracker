// Close Rates tab chart preferences, saved on the user's settings
// (settings.closeRatesChartPrefs) so they follow the user to their other
// machine:
//
//   { labels: boolean,                                  // data labels: every line's default
//     lineLabels: { [chart]: { [seriesKey]: boolean } },  // a line's own choice over that
//     colours: { [chart]: { [seriesKey]: '#rrggbb' } },  // per-chart overrides
//     targets: { [chart]: 0-100 },                        // a target line per chart
//     windows: { [chart]: windowKey },                    // each chart's default time frame
//     weeklyMonths: 3 | 6 | 9 | 12 }                      // months in the Weekly email table
//
// chart is 'source' | 'service' | 'stage' | 'reach'. A series with no
// override keeps the palette colour the page gives it. Pure, for tests.

export const CHART_PREFS_KEY = 'closeRatesChartPrefs';

const HEX = /^#[0-9a-f]{6}$/i;

/** The saved prefs, cleaned: anything malformed falls back to defaults. */
export function readChartPrefs(settings) {
  const raw = settings?.[CHART_PREFS_KEY];
  const prefs = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const colours = {};
  if (prefs.colours && typeof prefs.colours === 'object') {
    for (const [chart, map] of Object.entries(prefs.colours)) {
      if (!map || typeof map !== 'object') continue;
      const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string' && HEX.test(v)));
      if (Object.keys(clean).length) colours[chart] = clean;
    }
  }
  const lineLabels = {};
  if (prefs.lineLabels && typeof prefs.lineLabels === 'object') {
    for (const [chart, map] of Object.entries(prefs.lineLabels)) {
      if (!map || typeof map !== 'object') continue;
      const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'boolean'));
      if (Object.keys(clean).length) lineLabels[chart] = clean;
    }
  }
  const targets = {};
  if (prefs.targets && typeof prefs.targets === 'object') {
    for (const [chart, v] of Object.entries(prefs.targets)) {
      const n = cleanTarget(v);
      if (n != null) targets[chart] = n;
    }
  }
  const windows = {};
  if (prefs.windows && typeof prefs.windows === 'object') {
    for (const [chart, v] of Object.entries(prefs.windows)) if (WINDOW_KEYS.has(v)) windows[chart] = v;
  }
  const weeklyMonths = WEEKLY_MONTHS.includes(prefs.weeklyMonths) ? prefs.weeklyMonths : DEFAULT_WEEKLY_MONTHS;
  return { labels: prefs.labels === true, lineLabels, colours, targets, windows, weeklyMonths };
}

// ---------------------------------------------------------------------------
// Each chart's time frame. 'page' follows the window at the top of the tab;
// the rest are rolling, worked out from today every time, so "Last 12
// months" saved in May still means the last 12 months in November.

export const WINDOW_OPTIONS = [
  { key: 'page', label: 'Same as page' },
  { key: '6m', label: 'Last 6 months', months: 6 },
  { key: '12m', label: 'Last 12 months', months: 12 },
  { key: '18m', label: 'Last 18 months', months: 18 },
  { key: '24m', label: 'Last 24 months', months: 24 },
  { key: '36m', label: 'Last 36 months', months: 36 },
  { key: 'ytd', label: 'This year' },
  { key: 'all', label: 'All time' },
];
const WINDOW_KEYS = new Set(WINDOW_OPTIONS.map(o => o.key));
export const WEEKLY_MONTHS = [3, 6, 9, 12];
export const DEFAULT_WEEKLY_MONTHS = 6;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A window key as { from, to } ISO dates ('' = open), or null for 'page'
 * (use the page's own window). Rolling N months runs from the same day N
 * months back, to today.
 */
export function windowRange(key, now = new Date()) {
  const opt = WINDOW_OPTIONS.find(o => o.key === key);
  if (!opt || key === 'page') return null;
  if (key === 'all') return { from: '', to: '' };
  if (key === 'ytd') return { from: `${now.getFullYear()}-01-01`, to: '' };
  const d = new Date(now.getFullYear(), now.getMonth() - opt.months, now.getDate());
  // 31 Mar minus a month would roll into March again; clamp to the month's end.
  if (d.getMonth() !== ((now.getMonth() - opt.months) % 12 + 12) % 12) d.setDate(0);
  return { from: iso(d), to: '' };
}

/** A chart's saved default time frame ('page' when none saved). */
export function savedWindow(prefs, chart) {
  return prefs.windows?.[chart] || 'page';
}

/** Save a chart's default time frame; 'page' removes the saved choice. */
export function withWindow(prefs, chart, key) {
  if (!WINDOW_KEYS.has(key)) return prefs;
  const windows = { ...(prefs.windows || {}) };
  if (key === 'page') delete windows[chart]; else windows[chart] = key;
  return { ...prefs, windows };
}

export function withWeeklyMonths(prefs, months) {
  const n = Number(months);
  return WEEKLY_MONTHS.includes(n) ? { ...prefs, weeklyMonths: n } : prefs;
}

/** A target as typed: a number from 0 to 100 (one decimal), else null. */
export function cleanTarget(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[%\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

/** Set a chart's target (a number 0-100), or clear it with null / ''. */
export function withTarget(prefs, chart, value) {
  const targets = { ...(prefs.targets || {}) };
  const n = cleanTarget(value);
  if (n == null) delete targets[chart]; else targets[chart] = n;
  return { ...prefs, targets };
}

/** Does this line show its data labels? Its own choice, else the default. */
export function isLabelled(prefs, chart, key) {
  const own = prefs.lineLabels?.[chart]?.[key];
  return typeof own === 'boolean' ? own : !!prefs.labels;
}

/** Switch one line's labels on or off, leaving every other line alone. */
export function withLineLabel(prefs, chart, key, on) {
  return { ...prefs, lineLabels: { ...prefs.lineLabels, [chart]: { ...(prefs.lineLabels?.[chart] || {}), [key]: !!on } } };
}

export function withColour(prefs, chart, key, hex) {
  if (!HEX.test(String(hex || ''))) return prefs;
  return { ...prefs, colours: { ...prefs.colours, [chart]: { ...(prefs.colours[chart] || {}), [key]: hex.toLowerCase() } } };
}

export function withoutColours(prefs, chart) {
  const colours = { ...prefs.colours };
  delete colours[chart];
  return { ...prefs, colours };
}

/**
 * The Data labels button: every line on every chart on (or off). It clears
 * the per-line choices, so the button always does what it says.
 */
export function withLabels(prefs, on) {
  return { ...prefs, labels: !!on, lineLabels: {} };
}

/**
 * The Data labels button's state: 'all' (default on, no line switched off),
 * 'none' (default off, no line switched on) or 'some'.
 */
export function labelsState(prefs) {
  const choices = Object.values(prefs.lineLabels || {}).flatMap(m => Object.values(m));
  if (prefs.labels) return choices.some(v => !v) ? 'some' : 'all';
  return choices.some(v => v) ? 'some' : 'none';
}

/** A point's label: whole points, blank where nothing closed. */
export const labelText = (v) => (v == null || Number.isNaN(Number(v)) ? '' : `${Math.round(Number(v))}%`);
