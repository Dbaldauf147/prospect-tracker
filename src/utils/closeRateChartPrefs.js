// Close Rates tab chart preferences, saved on the user's settings
// (settings.closeRatesChartPrefs) so they follow the user to their other
// machine:
//
//   { labels: boolean,                                  // data labels on the points
//     colours: { [chart]: { [seriesKey]: '#rrggbb' } } }  // per-chart overrides
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
  return { labels: prefs.labels === true, colours };
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

export function withLabels(prefs, on) {
  return { ...prefs, labels: !!on };
}

/** A point's label: whole points, blank where nothing closed. */
export const labelText = (v) => (v == null || Number.isNaN(Number(v)) ? '' : `${Math.round(Number(v))}%`);
