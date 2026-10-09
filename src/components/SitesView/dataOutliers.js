// The Data quality table on the Utility Lookup page: thresholds a reader
// sets per measure, and the sites that fall outside them.
//
// The Data summary beside it says where every input came from. It cannot
// say whether an input is believable: a 40 ft² warehouse, or an electric
// bill that works out to $4.10 a kWh, is "actual" all the same, and it
// flows through every total downstream. This is the check for that.
//
// Rates are only measured where both halves are on the upload. A cost the
// page estimated is the site's consumption times the state rate, so its
// rate is the state rate by construction and could never be an outlier;
// counting it would only dilute the share that is.
//
// Pure, so the arithmetic can be asserted without a browser:
// scripts/dataOutliers.test.mjs.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const OUTLIER_METRICS = [
  {
    key: 'sqft',
    label: 'Sqft per site',
    unit: 'ft²',
    digits: 0,
    step: 1000,
    title: 'Floor area per site, off the upload. Sites with no size are not measured.',
    measure: (r) => {
      const v = num(r.__propertySizeFt2__);
      return v !== null && v > 0 ? v : null;
    },
  },
  {
    key: 'ratePerKwh',
    label: 'Rate / kWh',
    unit: '$/kWh',
    digits: 3,
    step: 0.01,
    title: 'Electric cost divided by kWh, on sites where the upload gave both. '
      + 'An estimated cost is priced at the state rate, so it is never measured here.',
    measure: (r) => {
      const cost = num(r.__electricCostActual__);
      const kwh = num(r.__kwh__);
      if (cost === null || kwh === null || kwh <= 0 || !r.__kwhSource__) return null;
      return cost / kwh;
    },
  },
  {
    key: 'ratePerTherm',
    label: 'Rate / therm',
    unit: '$/therm',
    digits: 2,
    step: 0.1,
    title: 'Gas cost divided by therms, on sites where the upload gave both. '
      + 'An estimated cost is priced at the state rate, so it is never measured here.',
    measure: (r) => {
      const cost = num(r.__gasCostActual__);
      const therms = num(r.__therms__);
      if (cost === null || therms === null || therms <= 0 || !r.__thermsSource__) return null;
      return cost / therms;
    },
  },
];

// Where a fresh page starts. Wide on purpose: the point is to catch a
// typo or a unit mix-up (MWh in a kWh column, a monthly bill in an annual
// one), not to argue with a site that is merely expensive.
export const DEFAULT_OUTLIER_THRESHOLDS = {
  sqft: { min: '500', max: '2000000' },
  ratePerKwh: { min: '0.03', max: '0.5' },
  ratePerTherm: { min: '0.3', max: '3' },
};

/** A stored thresholds object, made safe to read: every metric, min and max as strings. */
export function normalizeThresholds(raw) {
  const out = {};
  for (const m of OUTLIER_METRICS) {
    const given = raw && typeof raw === 'object' ? raw[m.key] : null;
    const base = DEFAULT_OUTLIER_THRESHOLDS[m.key];
    out[m.key] = {
      min: given && typeof given.min === 'string' ? given.min : base.min,
      max: given && typeof given.max === 'string' ? given.max : base.max,
    };
  }
  return out;
}

// A threshold box holds text. Blank, or anything that is not a number,
// means no bound on that side. Commas are allowed because people type them.
export function parseBound(text) {
  const s = String(text ?? '').replace(/[,$\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Every metric, measured across `rows` and checked against `thresholds`.
 *
 * Returns { [key]: { measured, low, high, ids, min, max } } where `ids` is
 * the set of row ids outside the bounds, `low` and `high` count them by
 * side, and `min` / `max` are the observed range so a reader can see what
 * the threshold is being set against.
 */
export function findOutliers(rows = [], thresholds = {}) {
  const t = normalizeThresholds(thresholds);
  const out = {};
  for (const m of OUTLIER_METRICS) {
    const lo = parseBound(t[m.key].min);
    const hi = parseBound(t[m.key].max);
    let measured = 0, low = 0, high = 0;
    let min = null, max = null;
    const ids = new Set();
    for (const r of rows) {
      const v = m.measure(r);
      if (v === null) continue;
      measured += 1;
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
      if (lo !== null && v < lo) { low += 1; ids.add(r.id); }
      else if (hi !== null && v > hi) { high += 1; ids.add(r.id); }
    }
    out[m.key] = { measured, low, high, ids, min, max };
  }
  return out;
}

export function formatMetric(metric, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const s = v.toLocaleString(undefined, { minimumFractionDigits: metric.digits, maximumFractionDigits: metric.digits });
  return metric.unit.startsWith('$') ? `$${s}` : s;
}
