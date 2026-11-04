// Close Rates tab chart preferences, saved on the user's settings
// (settings.closeRatesChartPrefs) so they follow the user to their other
// machine:
//
//   { labels: boolean,                                  // data labels: every line's default
//     lineLabels: { [chart]: { [seriesKey]: boolean } },  // a line's own choice over that
//     colours: { [chart]: { [seriesKey]: '#rrggbb' } },  // per-chart overrides
//     targets: { [chart]: [{ id, value: 0-100, colour: '#rrggbb', name }] } }
//                                                         // target lines, as many as wanted per chart
//
// An older save holds one number per chart; it reads as a single target in
// the default slate, so nothing set before is lost.
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
      const list = cleanTargets(v);
      if (list.length) targets[chart] = list;
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

// Target line colours offered in turn as targets are added: the old slate
// first, then hues that sit apart from it. Any colour can be picked after.
export const TARGET_COLOURS = ['#64748b', '#0f766e', '#b45309', '#7c3aed', '#be185d', '#1d4ed8'];
export const DEFAULT_TARGET_COLOUR = TARGET_COLOURS[0];

/**
 * A chart's saved targets, cleaned: a legacy number becomes one target;
 * entries with no usable value or colour are dropped or defaulted.
 */
export function cleanTargets(v) {
  if (typeof v === 'number' || typeof v === 'string') {
    const n = cleanTarget(v);
    return n == null ? [] : [{ id: 't1', value: n, colour: DEFAULT_TARGET_COLOUR, name: '' }];
  }
  if (!Array.isArray(v)) return [];
  const out = [];
  v.forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const n = cleanTarget(t.value);
    if (n == null) return;
    out.push({
      id: typeof t.id === 'string' && t.id ? t.id : `t${i + 1}`,
      value: n,
      colour: typeof t.colour === 'string' && HEX.test(t.colour) ? t.colour.toLowerCase() : DEFAULT_TARGET_COLOUR,
      name: typeof t.name === 'string' ? t.name.trim().slice(0, 40) : '',
    });
  });
  return out;
}

/** A chart's targets (always a list). */
export function targetsOf(prefs, chart) {
  return prefs.targets?.[chart] || [];
}

/** Store a chart's targets; an empty (or all-invalid) list clears them. */
export function withTargets(prefs, chart, list) {
  const targets = { ...(prefs.targets || {}) };
  const clean = cleanTargets(list);
  if (clean.length) targets[chart] = clean; else delete targets[chart];
  return { ...prefs, targets };
}

/** The colour the next added target gets: the first one not yet in use. */
export function nextTargetColour(list) {
  const used = new Set((list || []).map(t => t.colour));
  return TARGET_COLOURS.find(c => !used.has(c)) || TARGET_COLOURS[(list || []).length % TARGET_COLOURS.length];
}

/** What a target line is labelled: its name (or "Target") and value. */
export const targetLabel = (t) => `${t.name || 'Target'} ${labelText(t.value)}`;

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

/**
 * Props for each target's <ReferenceLine>, in value order. Two targets
 * within a few points of each other would print their labels on top of
 * one another, so a close neighbour's label drops below its line instead.
 * Label text stays in ink (not the line colour) so it reads on any chart.
 */
export function targetLineProps(list) {
  const sorted = [...(list || [])].sort((a, b) => a.value - b.value);
  let prevTop = null;
  return sorted.map((t) => {
    const crowded = prevTop != null && Math.abs(t.value - prevTop) < 6;
    const position = crowded ? 'insideBottomRight' : 'insideTopRight';
    if (!crowded) prevTop = t.value;
    return {
      key: t.id,
      y: t.value,
      stroke: t.colour,
      strokeWidth: 1.5,
      ifOverflow: 'extendDomain',
      label: { value: targetLabel(t), position, fill: '#334155', fontSize: 10, fontWeight: 600, stroke: '#fff', strokeWidth: 3, paintOrder: 'stroke' },
    };
  });
}
