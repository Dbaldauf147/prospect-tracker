// The arithmetic behind the Savings subtab on Service Deep Dives.
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
// Nothing here knows about React, settings or the DOM - it takes a settle
// table and a scenario and hands back rows. scripts/nymexSavings.test.mjs
// pins the results.

import { NYMEX_MONTH_LABELS, NYMEX_SETTLES } from '../data/nymexHistory.js';

/** Where the subtab's scenario and settle table live in the settings document. */
export const SAVINGS_KEY = 'deepDiveSavings';

const MAX_YEARS = 120;
const MAX_LAYERS = 12;
const MAX_TERM_MONTHS = 120;
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
 * It opens on a BACKTEST rather than on a forward deal: a 36-month term
 * ending at the last settle in the table, so every month on the page is
 * something the market actually did and the saving is measured rather than
 * assumed. The layer prices are the settle in the month before the term
 * starts, which is the closest thing the table has to "what you could have
 * locked when you would have signed" - a proxy, and the page says so, but a
 * defensible one rather than a number picked to look good.
 */
export function defaultScenario(series = monthlySeries(SHIPPED_SETTLES)) {
  const today = new Date();
  if (!series.length) {
    return {
      name: '', startYear: today.getFullYear() - 3, startMonth: 1, termMonths: 36,
      annualVolumeDth: 250000, volumeShape: 'even', basis: 0, adder: 0.35,
      forwardPrice: 3.5,
      layers: [{ id: 'L1', label: 'Layer 1', pct: 40, price: 3.5 }, { id: 'L2', label: 'Layer 2', pct: 25, price: 3.7 }],
    };
  }
  const last = series[series.length - 1];
  const termMonths = 36;
  const start = addMonths(last.year, last.month, -(termMonths - 1));
  // The settle in the month before the term opens. Falls back to the first
  // month in the record when the table is too short to have one.
  const beforeKey = (() => {
    const b = addMonths(start.year, start.month, -1);
    return monthKey(b.year, b.month);
  })();
  const before = series.find(p => p.key === beforeKey) || series[0];
  const strike = Math.round(before.price * 100) / 100;
  return {
    name: '',
    startYear: start.year,
    startMonth: start.month,
    termMonths,
    annualVolumeDth: 250000,
    volumeShape: 'even',
    basis: 0,
    adder: 0.35,
    // Past the last settle there is no market to price against, so the page
    // prices those months at the last one that settled and marks them.
    forwardPrice: Math.round(last.price * 100) / 100,
    layers: [
      { id: 'L1', label: 'Layer 1', pct: 40, price: strike },
      { id: 'L2', label: 'Layer 2', pct: 25, price: Math.round((strike + 0.2) * 100) / 100 },
    ],
  };
}

/** A scenario from settings, made safe to compute with. */
export function normalizeScenario(raw, series = null) {
  const base = defaultScenario(series || monthlySeries(SHIPPED_SETTLES));
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
 * Price the term twice - at index, and at the contract - and hand back a row
 * per month plus the rollups the subtab draws.
 *
 * Months past the last settle are priced at the scenario's forward
 * assumption and marked `assumed`, because a term that runs into the future
 * is the normal case and refusing to price it would make the page useless
 * exactly when somebody is deciding whether to sign.
 */
export function buildSavings(scenario, series) {
  const s = normalizeScenario(scenario, series);
  const byKey = new Map(series.map(p => [p.key, p.price]));
  const lastSettled = series.length ? series[series.length - 1] : null;
  const hedge = hedgeSummary(s.layers);
  const weights = VOLUME_SHAPES[s.volumeShape].weights;
  const hedgedShare = hedge.pct / 100;
  const strike = hedge.price ?? 0;

  const months = [];
  for (let i = 0; i < s.termMonths; i++) {
    const { year, month } = addMonths(s.startYear, s.startMonth, i);
    const settled = byKey.get(monthKey(year, month));
    const assumed = settled == null;
    const index = assumed ? s.forwardPrice : settled;
    const volume = s.annualVolumeDth * weights[month - 1];
    const commodity = hedgedShare * strike + (1 - hedgedShare) * index;
    const indexAllIn = index + s.basis + s.adder;
    const contractAllIn = commodity + s.basis + s.adder;
    months.push({
      key: monthKey(year, month),
      year,
      month,
      label: monthLabel(year, month),
      short: shortMonthLabel(year, month),
      assumed,
      index,
      indexAllIn,
      contractAllIn,
      volume,
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
  const assumedMonths = months.filter(m => m.assumed).length;

  // One row per calendar year the term touches, which is how a customer
  // budgets and how the savings get reported internally.
  const yearMap = new Map();
  for (const m of months) {
    const row = yearMap.get(m.year) || {
      year: m.year, months: 0, assumed: 0, volume: 0, indexCost: 0, contractCost: 0, saving: 0, indexSum: 0,
    };
    row.months += 1;
    row.assumed += m.assumed ? 1 : 0;
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
      assumedMonths,
      settledMonths: months.length - assumedMonths,
    },
  };
}

/**
 * The same hedge over a range of term lengths.
 *
 * Term length is the one input on the page that is usually still open when
 * the conversation happens, and the honest way to argue it is to show what
 * each length would have done rather than to assert that longer is better.
 */
export function termLadder(scenario, series, terms = TERM_LADDER) {
  return terms.map(termMonths => {
    const run = buildSavings({ ...scenario, termMonths }, series);
    return {
      termMonths,
      saving: run.totals.saving,
      savingPerDth: run.totals.savingPerDth,
      savingPct: run.totals.savingPct,
      avgIndex: run.totals.avgIndex,
      assumedMonths: run.totals.assumedMonths,
      settledMonths: run.totals.settledMonths,
      end: run.months.length ? run.months[run.months.length - 1] : null,
    };
  });
}

/**
 * The whole subtab's saved state: the scenario, and the settle table if the
 * user replaced the shipped one.
 *
 * `settles` is null when they have not, rather than a copy of the shipped
 * table - a copy would freeze the table they are looking at at the version
 * that shipped the day they first opened the page, and the next update to
 * the shipped numbers would never reach them.
 */
export function normalizeSavingsState(raw) {
  const custom = raw && Array.isArray(raw.settles) ? normalizeSettles(raw.settles) : [];
  const settles = custom.length ? custom : null;
  const series = monthlySeries(settles || SHIPPED_SETTLES);
  return {
    settles,
    loadedAt: text(raw?.loadedAt, 40) || null,
    scenario: normalizeScenario(raw?.scenario, series),
  };
}

/** Read it out of the settings document, from nothing if need be. */
export function getSavingsState(settings) {
  return normalizeSavingsState(settings?.[SAVINGS_KEY]);
}

/** True once the user has saved something of their own, so the page can say whose numbers these are. */
export function hasSavedSavings(settings) {
  const raw = settings?.[SAVINGS_KEY];
  return !!raw && typeof raw === 'object' && (!!raw.scenario || Array.isArray(raw.settles));
}
