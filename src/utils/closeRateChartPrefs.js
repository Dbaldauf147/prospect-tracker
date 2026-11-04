// Close Rates tab chart preferences, saved on the user's settings
// (settings.closeRatesChartPrefs) so they follow the user to their other
// machine:
//
//   { labels: boolean,                                  // data labels: every line's default
//     lineLabels: { [chart]: { [seriesKey]: boolean } },  // a line's own choice over that
//     colours: { [chart]: { [seriesKey]: '#rrggbb' } },  // per-chart overrides
//     targets: { [chart]: 0-100 } }                       // a target line per chart
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
  return { labels: prefs.labels === true, lineLabels, colours, targets };
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
