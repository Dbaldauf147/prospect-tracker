// The arithmetic behind the Sourcing area on Service Deep Dives.
//
// The question the subtab answers is the one every gas conversation ends on:
// "what did the hedge save?" So everything here prices the SAME volume twice
// - once at the index the market actually settled at, once at what the
// contract charges after its hedge layers - and the gap between them is the
// saving. That is the only definition used anywhere on the page, which is
// why a month where the market fell below the strike shows a NEGATIVE saving
// rather than a zero: a hedge that cost money cost money, and a page that
// hid those months would be a sales prop rather than an analysis.
//
// Basis and the retail adder are charged on both legs, so they drop out of
// the saving and stay in the cost totals. That is deliberate: the totals are
// what the customer recognises off an invoice, and the saving is what the
// hedge is responsible for.
//
// A month is priced from one of three places, in this order, and every row
// carries which one on `source`:
//
//   settled   the NYMEX settle. What the market DID. A measurement.
//   forward   the forward curve. What the market is QUOTED at. A price
//             somebody would deal on, and a snapshot that goes stale.
//   assumed   one flat number, for months neither table reaches - past the
//             end of the curve, or in the gap between the last settle and
//             the first quote. The weakest of the three and the loudest on
//             the page.
//
// They are never averaged into one "how confident is this" score. The counts
// travel separately all the way to the tiles, because a term that is mostly
// settled and a term that is mostly guessed can produce the same saving and
// are not the same claim.
//
// Nothing here knows about React, settings or the DOM - it takes a settle
// table and a scenario and hands back rows. scripts/nymexSavings.test.mjs
// pins the results.

import { NYMEX_MONTH_LABELS, NYMEX_SETTLES } from '../data/nymexHistory.js';
import { NYMEX_FORWARD, NYMEX_FORWARD_ASOF } from '../data/nymexForward.js';

/** Where the subtab's scenario and settle table live in the settings document. */
export const SAVINGS_KEY = 'deepDiveSavings';

const MAX_YEARS = 120;
const MAX_LAYERS = 12;
const MAX_TERM_MONTHS = 120;
// A curve this long is somebody pasting a settle table into the wrong box.
const MAX_FORWARD_MONTHS = 240;
const MAX_NAME = 80;

/** The term lengths the ladder compares, in months. */
export const TERM_LADDER = [12, 24, 36, 48, 60];

/**
 * How a year's volume is spread across its months.
 *
 * "Even" is the honest default when nobody has said otherwise. "Heating
 * load" is the shape a space-heating account actually burns, and it matters
 * to the answer rather than to the presentation: gas is dearest in the
 * months a heating account buys most of it, so an even split flatters every
 * winter-weighted hedge on the page.
 */
export const VOLUME_SHAPES = {
  even: {
    label: 'Even',
    note: 'the same volume every month',
    weights: Array.from({ length: 12 }, () => 1 / 12),
  },
  heating: {
    label: 'Heating load',
    note: 'winter-weighted, the way a space-heating account burns it',
    weights: [0.145, 0.130, 0.105, 0.070, 0.050, 0.040, 0.038, 0.038, 0.042, 0.065, 0.110, 0.167],
  },
};

const num = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const text = (v, max = MAX_NAME) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The volumes somebody typed or pasted for the term, a value per month of
 * it, indexed from the first month.
 *
 * A null is a month they have NOT given a volume for, and it is a different
 * thing from a zero: a zero is an assertion that nothing burns that month,
 * and a null falls back to the annual volume spread over the shape. Both
 * have to survive a round trip through settings, so blanks are kept in place
 * rather than compacted out - dropping them would slide December's volume
 * onto November.
 *
 * Trailing nulls are trimmed, because they carry no information and they are
 * what shortening the term leaves behind.
 */
export function normalizeMonthlyVolumes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = raw.slice(0, MAX_TERM_MONTHS).map((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = num(v, NaN);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
  while (out.length && out[out.length - 1] == null) out.pop();
  return out;
}

/**
 * Read pasted monthly consumption: one value per month of the term, in the
 * order the term runs.
 *
 * What arrives is a column off a spreadsheet, and it comes in every shape
 * that implies - bare numbers a line each, a label in front of each number
 * ("Jan 2027  3,100", "Month 1: 3100"), a unit after it ("3100 Dth"), or one
 * tab-separated row copied across instead of down. So each line is read for
 * the LAST number on it, the same rule the forward curve parser follows, and
 * a single line carrying several numbers is read as the whole run.
 *
 * A blank line is a month with NO volume of its own, not a zero: copying a
 * column of twelve cells with March empty has to come back with March empty,
 * because compacting it would slide April's volume onto March. A zero
 * somebody typed is kept, since a month that burns nothing is a real answer.
 * A line with no number at all (a header, a note) is skipped and reported,
 * and skipping it shifts nothing because it never held a month.
 *
 * Returns { volumes, count, blanks, skipped }.
 */
export function parseMonthlyVolumes(input) {
  const skipped = [];
  const report = (line) => skipped.push(String(line).replace(/\s+/g, ' ').trim().slice(0, 120));

  // "3,100" is one number and "3100,2780" is two, so a comma is a thousands
  // separator only where exactly three digits follow it. Dropping those
  // first is what lets the same line be split on commas afterwards.
  const deComma = (s) => String(s).replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
  const numbersOn = (s) => deComma(s).match(/-?\d+(?:\.\d+)?/g) || [];

  const lines = String(input ?? '').split(/\r?\n/);
  const filled = lines.filter(l => l.trim());
  // One line holding several numbers is a row copied across rather than a
  // column copied down.
  const asRow = filled.length === 1 && numbersOn(filled[0]).length > 1;
  const cells = asRow
    ? deComma(filled[0]).split(/\t|;|,|\s{2,}/)
    : lines;

  const values = [];
  for (const cell of cells) {
    const line = String(cell).trim();
    // A month they have not given a volume for, holding its place.
    if (!line) { values.push(null); continue; }
    const found = numbersOn(line);
    if (!found.length) { report(line); continue; }
    const n = Number(found[found.length - 1]);
    if (!Number.isFinite(n) || n < 0) { report(line); values.push(null); continue; }
    values.push(n);
  }

  const volumes = normalizeMonthlyVolumes(values);
  return {
    volumes,
    count: volumes.filter(v => v != null).length,
    blanks: volumes.filter(v => v == null).length,
    skipped,
  };
}

/**
 * One line saying where the term's volumes came from, for the tile and the
 * export - the same job sourceSummary does for the prices.
 */
export function volumeSummary(totals) {
  const parts = [];
  if (totals.enteredVolumeMonths) parts.push(`${totals.enteredVolumeMonths} entered`);
  if (totals.shapedVolumeMonths) parts.push(`${totals.shapedVolumeMonths} off the shape`);
  return parts.join(', ') || 'no months';
}

/** Jan is 1. A key that sorts as a string sorts as a date. */
export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
export const monthLabel = (year, month) => `${NYMEX_MONTH_LABELS[month - 1]} ${year}`;
/** "Jan 2026" for the first month of a year, "Jul" for the rest, so an axis of 60 of them stays readable. */
export const shortMonthLabel = (year, month) => (month === 1 ? `${NYMEX_MONTH_LABELS[0]} ${year}` : NYMEX_MONTH_LABELS[month - 1]);

/** The month `n` months on from one, Jan being 1. */
export function addMonths(year, month, n) {
  const zero = (year * 12 + (month - 1)) + n;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * A settle table from anywhere - the shipped one, a saved one, a parsed
 * paste - reduced to rows of [year, ...12 prices or null], sorted, one row
 * per year.
 *
 * Never throws and never returns a ragged row: a stored table is user data
 * that has been through a browser, a JSON round trip and possibly a hand
 * edit, and the subtab has to open on whatever came back.
 */
export function normalizeSettles(raw) {
  const byYear = new Map();
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(row)) continue;
    const year = Math.trunc(num(row[0], 0));
    if (!year || year < 1900 || year > 2400) continue;
    const months = [];
    for (let i = 1; i <= 12; i++) {
      const cell = row[i];
      if (cell == null || cell === '') { months.push(null); continue; }
      const price = num(cell, NaN);
      months.push(Number.isFinite(price) && price > 0 ? Math.round(price * 1000) / 1000 : null);
    }
    // A later row for the same year wins: that is what a paste of a corrected
    // year is asking for.
    byYear.set(year, [year, ...months]);
  }
  return [...byYear.values()].sort((a, b) => a[0] - b[0]).slice(-MAX_YEARS);
}

/** The shipped table, normalized once so callers can treat it like any other. */
export const SHIPPED_SETTLES = normalizeSettles(NYMEX_SETTLES);

/**
 * Read a pasted settle table.
 *
 * The format is what comes off a spreadsheet: a year, then twelve monthly
 * prices, tab or space separated. An AVG column on the end is ignored rather
 * than refused, because the table people have in front of them carries one
 * and re-typing the row without it is the kind of chore that stops a paste
 * being worth it. A header row is skipped the same way.
 *
 * Returns { settles, years, months, skipped }. `skipped` holds the lines it
 * could not read, with their whitespace collapsed so a tabbed header reads
 * as a header when the subtab lists it back, rather than silently dropping
 * them.
 */
export function parseNymexTable(input) {
  const skipped = [];
  const rows = [];
  const report = (line) => skipped.push(line.replace(/\s+/g, ' ').trim().slice(0, 120));
  for (const rawLine of String(input ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(/\t|\s{1,}|,/).map(c => c.trim());
    const year = Math.trunc(num(cells[0], 0));
    // A header ("YEAR Jan Feb ...") and a stray note both land here.
    if (!year || year < 1900 || year > 2400) { report(line); continue; }
    // Tabs carry empty months as empty cells, which is what a spreadsheet
    // copy does. Splitting on runs of spaces cannot, so a space-separated
    // line is read as "these prices, starting at January" - the common case,
    // and the one a full row always is.
    const tabbed = rawLine.includes('\t');
    const body = tabbed ? rawLine.split('\t').slice(1) : cells.slice(1);
    const months = [];
    for (let i = 0; i < 12; i++) {
      const cell = String(body[i] ?? '').trim();
      if (!cell) { months.push(null); continue; }
      const price = num(cell, NaN);
      months.push(Number.isFinite(price) && price > 0 ? price : null);
    }
    if (months.every(m => m == null)) { report(line); continue; }
    rows.push([year, ...months]);
  }
  const settles = normalizeSettles(rows);
  return {
    settles,
    years: settles.length,
    months: settles.reduce((n, r) => n + r.slice(1).filter(v => v != null).length, 0),
    skipped,
  };
}

/** Month names to a number, so "Nov", "November" and "nov" all land on 11. */
const MONTH_NUMBER = (() => {
  const map = new Map();
  NYMEX_MONTH_LABELS.forEach((label, i) => {
    map.set(label.toLowerCase(), i + 1);
    map.set(String(i + 1), i + 1);
  });
  for (const [long, n] of [
    ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
    ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12],
  ]) map.set(long, n);
  return map;
})();

/** A two-digit year is this century. Curves are quoted "Nov 26", never "Nov 2026". */
const fullYear = (n) => (n < 100 ? 2000 + n : n);

/**
 * A forward curve from anywhere, reduced to [year, month, price] triples,
 * sorted, one row per month.
 *
 * Same contract as normalizeSettles: never throws, never returns a row that
 * cannot be priced off.
 */
export function normalizeForward(raw) {
  const byKey = new Map();
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(row)) continue;
    const year = fullYear(Math.trunc(num(row[0], 0)));
    const month = Math.trunc(num(row[1], 0));
    const price = num(row[2], NaN);
    if (!year || year < 1900 || year > 2400) continue;
    if (!(month >= 1 && month <= 12)) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    // A later row for the same month wins, which is what re-pasting a
    // corrected strip is asking for.
    byKey.set(monthKey(year, month), [year, month, Math.round(price * 1000) / 1000]);
  }
  return [...byKey.values()].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])).slice(0, MAX_FORWARD_MONTHS);
}

/** The shipped curve, normalized once. */
export const SHIPPED_FORWARD = normalizeForward(NYMEX_FORWARD);
export const SHIPPED_FORWARD_ASOF = NYMEX_FORWARD_ASOF;

/**
 * Read a pasted forward curve.
 *
 * The shape a curve is handed over in is two columns: a month, then a price.
 * The month is written every way there is - "Nov 26", "Nov 2026",
 * "November 2026", "2027-01", "1/27" - so all of them are read rather than
 * one of them being declared correct. A dollar sign and a header row are
 * ignored, same as in the settle table.
 *
 * Returns { forward, months, skipped }.
 */
export function parseForwardTable(input) {
  const skipped = [];
  const rows = [];
  const report = (line) => skipped.push(line.replace(/\s+/g, ' ').trim().slice(0, 120));
  for (const rawLine of String(input ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(/\t|,|\s+/).map(c => c.trim()).filter(Boolean);
    if (!cells.length) continue;

    // The price is the last cell that reads as a number. Taking it from the
    // end rather than from a fixed column is what lets "Nov 26  $3.043" and
    // "2027-01  3.787" through the same path.
    const priceCell = cells[cells.length - 1];
    const price = num(priceCell, NaN);
    if (!Number.isFinite(price) || price <= 0) { report(line); continue; }

    const monthCells = cells.slice(0, -1);
    let year = 0, month = 0;
    // "2027-01" or "1/27" - one cell carrying both.
    const joined = monthCells.join(' ');
    const slashed = joined.match(/^(\d{1,4})\s*[-/]\s*(\d{1,4})$/);
    if (slashed) {
      const a = Number(slashed[1]), b = Number(slashed[2]);
      // The four-digit side is the year; with two two-digit numbers the
      // month is whichever one could be a month.
      if (a > 12) { year = fullYear(a); month = b; }
      else if (b > 12) { year = fullYear(b); month = a; }
      else { month = a; year = fullYear(b); }
    } else {
      for (const cell of monthCells) {
        const asMonth = MONTH_NUMBER.get(cell.toLowerCase().replace(/\.$/, '').slice(0, 3))
          ?? MONTH_NUMBER.get(cell.toLowerCase().replace(/\.$/, ''));
        const asNumber = Math.trunc(num(cell, NaN));
        if (asMonth && !month) { month = asMonth; continue; }
        if (Number.isFinite(asNumber) && asNumber > 0) year = fullYear(asNumber);
      }
    }
    if (!month || !year) { report(line); continue; }
    rows.push([year, month, price]);
  }
  const forward = normalizeForward(rows);
  return { forward, months: forward.length, skipped };
}

/** The curve as a series, the same shape the settles come back in. */
export function forwardSeries(forward) {
  return (forward || []).map(([year, month, price]) => ({
    key: monthKey(year, month), year, month, label: monthLabel(year, month), price,
  }));
}

/** Every month that has a settle, oldest first. */
export function monthlySeries(settles) {
  const out = [];
  for (const row of settles) {
    const year = row[0];
    for (let m = 1; m <= 12; m++) {
      const price = row[m];
      if (price == null) continue;
      out.push({ key: monthKey(year, m), year, month: m, label: monthLabel(year, m), price });
    }
  }
  return out;
}

/** One row per year with its average, for the history table. */
export function yearRows(settles) {
  return settles.map(row => {
    const months = row.slice(1);
    const known = months.filter(v => v != null);
    return {
      year: row[0],
      months,
      count: known.length,
      avg: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
    };
  });
}

/** Min, max, mean and median over a series, plus the ends of it. */
export function priceStats(series) {
  if (!series.length) return null;
  const prices = series.map(p => p.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return {
    count: prices.length,
    min: prices[0],
    max: prices[prices.length - 1],
    mean: prices.reduce((a, b) => a + b, 0) / prices.length,
    median: prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2,
    first: series[0],
    last: series[series.length - 1],
  };
}

/**
 * The share of months in the record that settled at or below `price`, 0 to 1.
 *
 * This is the line that sells a hedge or kills it: a strike at the 20th
 * percentile of thirty-five years of settles is a different conversation
 * from one at the 80th, and it is the same number either way.
 */
export function percentileRank(series, price) {
  if (!series.length || !Number.isFinite(price)) return null;
  const below = series.reduce((n, p) => n + (p.price <= price ? 1 : 0), 0);
  return below / series.length;
}

/** One hedge layer: a slice of the volume, locked at a price. */
function normalizeLayer(raw, index) {
  return {
    id: text(raw?.id, 24) || `L${index + 1}`,
    label: text(raw?.label, 40) || `Layer ${index + 1}`,
    pct: clamp(num(raw?.pct, 0), 0, 100),
    price: clamp(num(raw?.price, 0), 0, 1000),
  };
}

/**
 * The scenario the subtab opens on, before anybody touches it.
 *
 * It opens on the FORWARD deal when there is a curve to price one against:
 * a term starting at the first quoted month and running the length of the
 * curve, which is the deal somebody is actually deciding about. The layer
 * prices are the last settle, as the closest thing the tables have to "what
 * you could lock today" - a proxy, and the page says so, but a defensible
 * one rather than a number picked to make the opening screen look good.
 *
 * With no curve loaded it opens on a BACKTEST instead: a 36-month term
 * ending at the last settle, every month of it measured. Either way the
 * first thing on screen is priced off the market rather than off the flat
 * assumption.
 */
export function defaultScenario(series = monthlySeries(SHIPPED_SETTLES), forward = forwardSeries(SHIPPED_FORWARD)) {
  const today = new Date();
  const curve = forward || [];
  if (!series.length && !curve.length) {
    return {
      name: '', startYear: today.getFullYear() - 3, startMonth: 1, termMonths: 36,
      annualVolumeDth: 250000, volumeShape: 'even', monthlyVolumes: [], basis: 0, adder: 0.35,
      forwardPrice: 3.5,
      layers: [{ id: 'L1', label: 'Layer 1', pct: 40, price: 3.5 }, { id: 'L2', label: 'Layer 2', pct: 25, price: 3.7 }],
    };
  }

  const lastSettle = series.length ? series[series.length - 1] : null;
  // Past the end of the curve there is nothing quoted, so the flat number
  // carries on from where the curve stopped rather than from a settle years
  // behind it. With no curve at all it is the last settle.
  const flat = curve.length ? curve[curve.length - 1].price : lastSettle.price;
  // What a hedge would be struck at if it were struck now.
  const strike = Math.round((lastSettle ? lastSettle.price : curve[0].price) * 100) / 100;

  let startYear, startMonth, termMonths;
  if (curve.length) {
    startYear = curve[0].year;
    startMonth = curve[0].month;
    termMonths = Math.min(curve.length, MAX_TERM_MONTHS);
  } else {
    termMonths = 36;
    const start = addMonths(lastSettle.year, lastSettle.month, -(termMonths - 1));
    startYear = start.year;
    startMonth = start.month;
  }

  return {
    name: '',
    startYear,
    startMonth,
    termMonths,
    annualVolumeDth: 250000,
    volumeShape: 'even',
    // Nobody has given the term its own volumes yet, so every month prices
    // off the annual number and the shape.
    monthlyVolumes: [],
    basis: 0,
    adder: 0.35,
    forwardPrice: Math.round(flat * 100) / 100,
    layers: [
      { id: 'L1', label: 'Layer 1', pct: 40, price: strike },
      { id: 'L2', label: 'Layer 2', pct: 25, price: Math.round((strike + 0.2) * 100) / 100 },
    ],
  };
}

/** A scenario from settings, made safe to compute with. */
export function normalizeScenario(raw, series = null, forward = null) {
  const base = defaultScenario(series || monthlySeries(SHIPPED_SETTLES), forward || forwardSeries(SHIPPED_FORWARD));
  if (!raw || typeof raw !== 'object') return base;
  const layers = (Array.isArray(raw.layers) ? raw.layers : base.layers)
    .slice(0, MAX_LAYERS)
    .map(normalizeLayer);
  return {
    name: text(raw.name),
    startYear: clamp(Math.trunc(num(raw.startYear, base.startYear)), 1900, 2400),
    startMonth: clamp(Math.trunc(num(raw.startMonth, base.startMonth)), 1, 12),
    termMonths: clamp(Math.trunc(num(raw.termMonths, base.termMonths)), 1, MAX_TERM_MONTHS),
    annualVolumeDth: Math.max(0, num(raw.annualVolumeDth, base.annualVolumeDth)),
    volumeShape: VOLUME_SHAPES[raw.volumeShape] ? raw.volumeShape : 'even',
    monthlyVolumes: normalizeMonthlyVolumes(raw.monthlyVolumes),
    basis: clamp(num(raw.basis, base.basis), -20, 20),
    adder: clamp(num(raw.adder, base.adder), -20, 20),
    forwardPrice: clamp(num(raw.forwardPrice, base.forwardPrice), 0, 1000),
    layers: layers.length ? layers : base.layers.map(normalizeLayer),
  };
}

/** The hedged share of volume and what it is locked at, across the layers. */
export function hedgeSummary(layers = []) {
  const pct = clamp(layers.reduce((n, l) => n + num(l.pct, 0), 0), 0, 100);
  const weight = layers.reduce((n, l) => n + num(l.pct, 0), 0);
  const price = weight > 0
    ? layers.reduce((n, l) => n + num(l.pct, 0) * num(l.price, 0), 0) / weight
    : null;
  return {
    pct,
    price,
    // Layers that add to more than the volume is a typo with a plausible
    // answer, so it is named rather than quietly clipped.
    over: layers.reduce((n, l) => n + num(l.pct, 0), 0) > 100.0001,
  };
}

/**
 * The settle-then-quote-then-flat rule, as a lookup.
 *
 * Extracted so that everything on the page pricing a month goes through one
 * implementation of the precedence. A second copy of it is how a table ends
 * up quietly disagreeing with the chart above it.
 */
export function priceLookup(series, forward = [], flat = 0) {
  const settled = new Map(series.map(p => [p.key, p.price]));
  const quoted = new Map((forward || []).map(p => [p.key, p.price]));
  return (year, month) => {
    const key = monthKey(year, month);
    const settle = settled.get(key);
    if (settle != null) return { price: settle, source: 'settled' };
    const quote = quoted.get(key);
    if (quote != null) return { price: quote, source: 'forward' };
    return { price: flat, source: 'assumed' };
  };
}

/**
 * Price the term twice - at index, and at the contract - and hand back a row
 * per month plus the rollups the subtab draws.
 *
 * Months past the last settle are priced at the scenario's forward
 * assumption and marked `assumed`, because a term that runs into the future
 * is the normal case and refusing to price it would make the page useless
 * exactly when somebody is deciding whether to sign.
 */
export function buildSavings(scenario, series, forward = []) {
  const s = normalizeScenario(scenario, series);
  const priceOf = priceLookup(series, forward, s.forwardPrice);
  const lastSettled = series.length ? series[series.length - 1] : null;
  const curveStart = forward?.length ? forward[0] : null;
  const curveEnd = forward?.length ? forward[forward.length - 1] : null;
  const hedge = hedgeSummary(s.layers);
  const weights = VOLUME_SHAPES[s.volumeShape].weights;
  // A volume the user gave this month, if they gave one. Same precedence
  // idea the prices follow: the number somebody asserted beats the number
  // the page derived, and the page says which it used.
  const entered = s.monthlyVolumes || [];
  const hedgedShare = hedge.pct / 100;
  const strike = hedge.price ?? 0;

  const months = [];
  for (let i = 0; i < s.termMonths; i++) {
    const { year, month } = addMonths(s.startYear, s.startMonth, i);
    const key = monthKey(year, month);
    // Settle, then quote, then the flat number. Never the other way round: a
    // month that settled is not an opinion any more.
    const { price: index, source } = priceOf(year, month);
    const assumed = source !== 'settled';
    // A zero somebody typed is a month that burns nothing, which is a real
    // answer; only a null falls through to the annual volume and the shape.
    const given = entered[i];
    const volume = given == null ? s.annualVolumeDth * weights[month - 1] : given;
    const volumeSource = given == null ? 'shape' : 'entered';
    const commodity = hedgedShare * strike + (1 - hedgedShare) * index;
    const indexAllIn = index + s.basis + s.adder;
    const contractAllIn = commodity + s.basis + s.adder;
    months.push({
      key,
      year,
      month,
      label: monthLabel(year, month),
      short: shortMonthLabel(year, month),
      source,
      // "Not a settle" - what the charts shade and the tables flag. The
      // three-way `source` says which kind of not-a-settle it is.
      assumed,
      index,
      indexAllIn,
      contractAllIn,
      volume,
      volumeSource,
      indexCost: indexAllIn * volume,
      contractCost: contractAllIn * volume,
      saving: (indexAllIn - contractAllIn) * volume,
    });
  }

  // Running total, so the chart can show the saving accumulating rather than
  // only the month it happened in.
  let running = 0;
  for (const m of months) { running += m.saving; m.cumulative = running; }

  const volume = months.reduce((n, m) => n + m.volume, 0);
  const indexCost = months.reduce((n, m) => n + m.indexCost, 0);
  const contractCost = months.reduce((n, m) => n + m.contractCost, 0);
  const saving = indexCost - contractCost;
  const enteredVolumeMonths = months.filter(m => m.volumeSource === 'entered').length;
  const settledMonths = months.filter(m => m.source === 'settled').length;
  const forwardMonths = months.filter(m => m.source === 'forward').length;
  const assumedMonths = months.filter(m => m.source === 'assumed').length;

  // One row per calendar year the term touches, which is how a customer
  // budgets and how the savings get reported internally.
  const yearMap = new Map();
  for (const m of months) {
    const row = yearMap.get(m.year) || {
      year: m.year, months: 0, settled: 0, forward: 0, assumed: 0, enteredVolume: 0,
      volume: 0, indexCost: 0, contractCost: 0, saving: 0, indexSum: 0,
    };
    row.months += 1;
    row.enteredVolume += m.volumeSource === 'entered' ? 1 : 0;
    row.settled += m.source === 'settled' ? 1 : 0;
    row.forward += m.source === 'forward' ? 1 : 0;
    row.assumed += m.source === 'assumed' ? 1 : 0;
    row.volume += m.volume;
    row.indexCost += m.indexCost;
    row.contractCost += m.contractCost;
    row.saving += m.saving;
    row.indexSum += m.index;
    yearMap.set(m.year, row);
  }
  const years = [...yearMap.values()].map(r => ({
    ...r,
    avgIndex: r.months ? r.indexSum / r.months : null,
    savingPerDth: r.volume ? r.saving / r.volume : null,
  }));

  return {
    scenario: s,
    hedge,
    months,
    years,
    lastSettled,
    curveStart,
    curveEnd,
    totals: {
      volume,
      indexCost,
      contractCost,
      saving,
      savingPct: indexCost ? saving / indexCost : 0,
      savingPerDth: volume ? saving / volume : 0,
      avgIndex: months.length ? months.reduce((n, m) => n + m.index, 0) / months.length : null,
      avgIndexAllIn: volume ? indexCost / volume : null,
      avgContractAllIn: volume ? contractCost / volume : null,
      settledMonths,
      forwardMonths,
      assumedMonths,
      // Volumes are counted the same way the prices are, and kept apart from
      // them: a term priced off settles and shaped from an annual number is
      // measured on one leg and derived on the other.
      enteredVolumeMonths,
      shapedVolumeMonths: months.length - enteredVolumeMonths,
      // Months with a real market price behind them, settled or quoted. The
      // rest is the flat number, which is the only one of the three that is
      // nobody's price.
      pricedMonths: settledMonths + forwardMonths,
    },
  };
}

/**
 * One line saying where a term's prices came from, for the tile and the
 * copied summary.
 *
 * Written out in full rather than as a ratio, because "36 of 36" reads as
 * reassurance regardless of whether those 36 are settles or guesses.
 */
export function sourceSummary(totals) {
  const parts = [];
  if (totals.settledMonths) parts.push(`${totals.settledMonths} settled`);
  if (totals.forwardMonths) parts.push(`${totals.forwardMonths} on the curve`);
  if (totals.assumedMonths) parts.push(`${totals.assumedMonths} at the flat assumption`);
  return parts.join(', ') || 'no months';
}

/**
 * The same hedge over a range of term lengths.
 *
 * Term length is the one input on the page that is usually still open when
 * the conversation happens, and the honest way to argue it is to show what
 * each length would have done rather than to assert that longer is better.
 */
export function termLadder(scenario, series, forward = [], terms = TERM_LADDER) {
  return terms.map(termMonths => {
    const run = buildSavings({ ...scenario, termMonths }, series, forward);
    return {
      termMonths,
      saving: run.totals.saving,
      savingPerDth: run.totals.savingPerDth,
      savingPct: run.totals.savingPct,
      avgIndex: run.totals.avgIndex,
      settledMonths: run.totals.settledMonths,
      forwardMonths: run.totals.forwardMonths,
      assumedMonths: run.totals.assumedMonths,
      pricedMonths: run.totals.pricedMonths,
      sources: sourceSummary(run.totals),
      end: run.months.length ? run.months[run.months.length - 1] : null,
    };
  });
}

/**
 * The whole subtab's saved state: the scenario, and either table if the user
 * replaced the shipped one.
 *
 * `settles` and `forward` are null when they have not, rather than a copy of
 * what shipped - a copy would freeze the tables at the version that shipped
 * the day they first opened the page, and the next update would never reach
 * them. That matters more for the curve than for the settles: a settle is
 * permanent and a quote goes stale.
 */
export function normalizeSavingsState(raw) {
  const customSettles = raw && Array.isArray(raw.settles) ? normalizeSettles(raw.settles) : [];
  const customForward = raw && Array.isArray(raw.forward) ? normalizeForward(raw.forward) : [];
  const settles = customSettles.length ? customSettles : null;
  const forward = customForward.length ? customForward : null;
  const series = monthlySeries(settles || SHIPPED_SETTLES);
  const curve = forwardSeries(forward || SHIPPED_FORWARD);
  return {
    settles,
    forward,
    loadedAt: text(raw?.loadedAt, 40) || null,
    // When the curve was quoted. The user's own curve carries the day they
    // pasted it; the shipped one carries the as-of date it was quoted at,
    // which is not the same thing and is not guessed at from the file.
    forwardAsOf: text(raw?.forwardAsOf, 40) || null,
    scenario: normalizeScenario(raw?.scenario, series, curve),
  };
}

/** Read it out of the settings document, from nothing if need be. */
export function getSavingsState(settings) {
  return normalizeSavingsState(settings?.[SAVINGS_KEY]);
}

/** True once the user has saved something of their own, so the page can say whose numbers these are. */
export function hasSavedSavings(settings) {
  const raw = settings?.[SAVINGS_KEY];
  return !!raw && typeof raw === 'object'
    && (!!raw.scenario || Array.isArray(raw.settles) || Array.isArray(raw.forward));
}
