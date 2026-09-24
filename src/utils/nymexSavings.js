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
// The look-back is measured in months of settled record rather than in
// months of contract, so it gets a cap of its own and a far looser one: the
// shipped table alone is 437 months, and somebody pasting thirty years of
// their own is the case the feature exists for.
export const MAX_LOOKBACK_MONTHS = 720;
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
export function normalizeMonthlyVolumes(raw, max = MAX_TERM_MONTHS) {
  if (!Array.isArray(raw)) return [];
  const out = raw.slice(0, max).map((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = num(v, NaN);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
  while (out.length && out[out.length - 1] == null) out.pop();
  return out;
}

/**
 * How far back before the term the page looks.
 *
 * `'all'` is the whole settled record - back to the first month the settle
 * table has a price for, which is what "as far back as the data I gave you"
 * means and what it keeps meaning after somebody pastes a longer table. A
 * number is that many months and stays that many months.
 *
 * It is a separate reading from the term rather than a longer term, and the
 * distinction is the point: the term is a deal somebody is deciding about,
 * and the look-back is what the same hedge WOULD have done against market
 * that has already settled. Adding the two into one saving would hand the
 * forward deal credit for a backtest.
 */
export const LOOKBACK_ALL = 'all';

// How the contract is bought: the three purchasing strategies the Henry Hub,
// basis and retail adder pieces combine into, from least risk to most.
//
// All three price through the same formula in buildSavings - a locked share
// at a strike, the rest at the index, basis and adder on top of both - and
// differ only in what is locked:
//   fixed    - everything, at one all-in rate. The strike is that rate less
//              the basis and adder, so the all-in comes back out exactly.
//   index    - nothing. Henry Hub floats month by month; basis and the adder
//              are the fixed part.
//   layered  - the hedge layers: a share at a price, the rest at the index.
export const CONTRACT_TYPES = {
  fixed: {
    label: 'Fixed All-In Rate',
    formula: 'Henry Hub + Basis + Retail Adder, locked',
    note: 'Henry Hub, basis and the retail adder are all locked into a single fixed $/Dth rate for the full term.',
    risk: 'Lowest risk',
  },
  index: {
    label: 'Index + Fixed Basis',
    formula: 'Henry Hub floats; Basis + Retail Adder fixed',
    note: 'Basis and the retail adder are fixed for the term, while the Henry Hub commodity component floats monthly on the NYMEX settlement price.',
    risk: 'Most market exposure',
  },
  layered: {
    label: 'Block & Index (Layered)',
    formula: 'Blocks locked, the rest at the index',
    note: 'A percentage of expected volume (e.g. 50%) is locked for the term, with the remaining volume settled on the floating index.',
    risk: 'In between, set by the blocks',
  },
};
export const DEFAULT_CONTRACT_TYPE = 'layered';

// What the contract's saving is measured against: the baseline each month's
// contract cost is taken away from.
//   index     - the market: the index plus the same basis and adder. What
//               the page measured before there was a choice, so the default.
//   contract  - contract over contract: the customer's current third-party
//               all-in rate, carried across the new term.
//   avoided   - cost avoidance: what taking no action would cost. Both paths
//               face an increase (legislation, renewable requirements); the
//               no-action one faces a bigger one, and the gap between the two
//               percentages, on the contract's rate, is the avoided cost.
export const SAVINGS_BASES = {
  index: {
    label: 'Against the index',
    short: 'the index bill',
    note: 'The difference between the contract and paying the floating market price (Henry Hub plus the same basis and adder) for the same volume.',
    example: '',
  },
  contract: {
    label: 'Contract Over Contract',
    short: 'the current contract',
    note: 'The difference between the current third-party price and the recommended price for the following term.',
    example: 'Current contracted rate is $0.06/kWh; new rate is $0.0525/kWh. Savings equal $0.0075/kWh multiplied by the usage over the contract term. Contract term is 24 months, projected usage over 24 months is 2,000,000 kWh. Savings is 2,000,000 x $0.0075/kWh = $15,000.',
  },
  avoided: {
    label: 'Cost Avoidance',
    short: 'the no-action cost',
    note: 'The difference between a strategically purchased rate and the rate a customer would pay by taking no action.',
    example: 'Customers not on third-party supply in a given market are subject to a 4% increase in energy costs due to legislation for renewable requirements. Customers on third-party supply are subject to a 1% increase. Schneider recommends extending third-party agreements, resulting in 3% avoided cost. Avoided cost = $0.005/kWh for the contract term. Contract volume is 50,000,000 kWh. Avoided cost is $0.005/kWh x 50,000,000 kWh = $250,000.',
  },
};
export const DEFAULT_SAVINGS_BASIS = 'index';

// How Contract 1 (the contract the site is on today) is priced.
//   fixed - one all-in $/Dth for every month (currentRate).
//   index - no all-in to enter: each month is that month's index plus the
//           basis and Contract 1's own retail adder (currentAdder), the same
//           way an index contract 2 is built, so the two compare like for
//           like. The basis is the delivery point's, so it is shared.
export const CURRENT_CONTRACT_TYPES = {
  fixed: { label: 'Fixed all-in', note: 'One all-in $/Dth for every month' },
  index: { label: 'Index + adder', note: 'Each month\'s index plus basis and the retail adder' },
};
// Fixed is what Contract 1 was before it had a type: a saved all-in rate
// keeps meaning what it meant.
export const DEFAULT_CURRENT_TYPE = 'fixed';

function normalizeLookback(raw, fallback) {
  if (raw === LOOKBACK_ALL) return LOOKBACK_ALL;
  if (typeof raw === 'string' && raw.trim().toLowerCase() === LOOKBACK_ALL) return LOOKBACK_ALL;
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = num(raw, NaN);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.trunc(n), 0, MAX_LOOKBACK_MONTHS);
}

/**
 * The look-back as a COUNT of months, resolved against the record.
 *
 * `'all'` cannot be a number until there is a settle table to measure it
 * against, and the answer moves the moment somebody pastes a different one,
 * so it is resolved here at build time rather than frozen into the saved
 * scenario. A term that opens before the record starts looks back over
 * nothing, which is the honest answer rather than an error.
 */
export function lookbackMonths(scenario, series = []) {
  const back = scenario?.lookback;
  const startIdx = (Math.trunc(num(scenario?.startYear, 0)) * 12)
    + (clamp(Math.trunc(num(scenario?.startMonth, 1)), 1, 12) - 1);
  if (back !== LOOKBACK_ALL) return clamp(Math.trunc(num(back, 0)), 0, MAX_LOOKBACK_MONTHS);
  if (!series.length) return 0;
  const first = series[0];
  return clamp(startIdx - (first.year * 12 + (first.month - 1)), 0, MAX_LOOKBACK_MONTHS);
}

/**
 * Where a look-back month's volume lives in `historyVolumes`.
 *
 * The list is indexed BACKWARDS from the term: slot 0 is the month right
 * before the term opens, slot 1 the one before that. `i` is the month's
 * position in the run the page draws, which is oldest first.
 *
 * Backwards because the anchor has to be the thing that does not move.
 * Indexing history forwards from its own first month would make every
 * volume slide the moment the look-back got a month deeper, which is a
 * control somebody will drag - and the whole list would quietly be one
 * month out of step with itself.
 */
export const historySlot = (lookback, i) => lookback - 1 - i;

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
 * A line that is NOTHING BUT a month label is a label, even when it carries
 * a year. This is the one the month boxes walk straight into: copying them
 * off the page gives a label and a value on alternate lines, every label but
 * January holds no number and is skipped, and "Jan 2027" holds 2027 - so
 * January silently becomes a burn of two thousand Dth and every month after
 * it slides one place. A label is recognised and reported as a label rather
 * than read for its year. "Jan 2027  3,100" is untouched by this: it carries
 * a number past the label, so the label is ignored and the 3,100 is the
 * month's volume, exactly as before.
 *
 * A blank line is a month with NO volume of its own, not a zero: copying a
 * column of twelve cells with March empty has to come back with March empty,
 * because compacting it would slide April's volume onto March. A zero
 * somebody typed is kept, since a month that burns nothing is a real answer.
 * A line with no number at all (a header, a note) is skipped and reported,
 * and skipping it shifts nothing because it never held a month.
 *
 * Returns { volumes, count, blanks, labels, skipped }. `labels` and
 * `skipped` are both lines that held no volume, kept apart because they mean
 * different things to somebody reading the result back: a month label is
 * expected and carries no information, and a line the parser could not read
 * is a line worth looking at.
 */
export function parseMonthlyVolumes(input, max = MAX_TERM_MONTHS) {
  const skipped = [];
  const labels = [];
  const report = (line) => skipped.push(String(line).replace(/\s+/g, ' ').trim().slice(0, 120));

  // A month name on its own, with or without a year after it: "Nov",
  // "January", "Jan 2027", "Jan 27", "Jan '27", "Feb.". Nothing else on the
  // line, because anything else on it is the volume.
  const monthLabelOnly = (line) => {
    const m = /^([A-Za-z]{3,9})\.?(?:\s+'?\d{2}|\s+\d{4})?$/.exec(line);
    if (!m) return false;
    const word = m[1].toLowerCase();
    return MONTH_NUMBER.has(word) || MONTH_NUMBER.has(word.slice(0, 3));
  };

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
    // A label, not a value. Nothing is pushed: it never held a month, so
    // skipping it shifts nothing.
    if (monthLabelOnly(line)) { labels.push(line); continue; }
    const found = numbersOn(line);
    if (!found.length) { report(line); continue; }
    const n = Number(found[found.length - 1]);
    if (!Number.isFinite(n) || n < 0) { report(line); values.push(null); continue; }
    values.push(n);
  }

  const volumes = normalizeMonthlyVolumes(values, max);
  return {
    volumes,
    count: volumes.filter(v => v != null).length,
    blanks: volumes.filter(v => v == null).length,
    labels,
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
      lookback: LOOKBACK_ALL,
      annualVolumeDth: 250000, volumeShape: 'even', monthlyVolumes: [], historyVolumes: [],
      basis: 0, adder: 0.35,
      forwardPrice: 3.5,
      contractType: DEFAULT_CONTRACT_TYPE, fixedRate: 3.85,
      savingsBasis: DEFAULT_SAVINGS_BASIS, currentType: DEFAULT_CURRENT_TYPE, currentRate: 4.1, currentAdder: null, noActionPct: 4, strategyPct: 1,
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
    // The whole record behind the term, because the question the subtab is
    // asked next is always "and how does that compare with what we have
    // been paying?" - and the table to answer it off is already loaded.
    lookback: LOOKBACK_ALL,
    annualVolumeDth: 250000,
    volumeShape: 'even',
    // Nobody has given the term its own volumes yet, so every month prices
    // off the annual number and the shape.
    monthlyVolumes: [],
    historyVolumes: [],
    basis: 0,
    adder: 0.35,
    forwardPrice: Math.round(flat * 100) / 100,
    // Layered is what the page did before there was a choice, so a scenario
    // saved before then keeps pricing the way it did.
    contractType: DEFAULT_CONTRACT_TYPE,
    // A fixed all-in quote to start from: the strike with the default adder
    // on top, i.e. what the whole volume would cost locked today.
    fixedRate: Math.round((strike + 0.35) * 100) / 100,
    savingsBasis: DEFAULT_SAVINGS_BASIS,
    // Placeholders for the two other bases, until somebody types theirs: a
    // current contract a quarter above the fixed quote, and the percentages
    // from the cost-avoidance example.
    currentType: DEFAULT_CURRENT_TYPE,
    currentRate: Math.round((strike + 0.6) * 100) / 100,
    // Contract 1's retail adder. Unknown until somebody types it: the adder
    // on the contract a site is leaving is often buried in an all-in rate,
    // and a made-up default would split the saving on a guess.
    currentAdder: null,
    noActionPct: 4,
    strategyPct: 1,
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
    // A scenario saved before the look-back existed has no opinion about it,
    // so it takes the default rather than nothing: the months it gains are
    // measured market, and none of them move the term's own totals.
    lookback: normalizeLookback(raw.lookback, base.lookback),
    annualVolumeDth: Math.max(0, num(raw.annualVolumeDth, base.annualVolumeDth)),
    volumeShape: VOLUME_SHAPES[raw.volumeShape] ? raw.volumeShape : 'even',
    monthlyVolumes: normalizeMonthlyVolumes(raw.monthlyVolumes),
    historyVolumes: normalizeMonthlyVolumes(raw.historyVolumes, MAX_LOOKBACK_MONTHS),
    basis: clamp(num(raw.basis, base.basis), -20, 20),
    adder: clamp(num(raw.adder, base.adder), -20, 20),
    forwardPrice: clamp(num(raw.forwardPrice, base.forwardPrice), 0, 1000),
    contractType: CONTRACT_TYPES[raw.contractType] ? raw.contractType : DEFAULT_CONTRACT_TYPE,
    // `num` reads a missing value as 0, and a free contract is not a
    // default anybody wants, so an unset rate takes the base one.
    fixedRate: raw.fixedRate == null || raw.fixedRate === ''
      ? base.fixedRate
      : clamp(num(raw.fixedRate, base.fixedRate), 0, 1000),
    savingsBasis: SAVINGS_BASES[raw.savingsBasis] ? raw.savingsBasis : DEFAULT_SAVINGS_BASIS,
    currentType: CURRENT_CONTRACT_TYPES[raw.currentType] ? raw.currentType : DEFAULT_CURRENT_TYPE,
    currentRate: raw.currentRate == null || raw.currentRate === ''
      ? base.currentRate
      : clamp(num(raw.currentRate, base.currentRate), 0, 1000),
    currentAdder: raw.currentAdder == null || raw.currentAdder === '' || !Number.isFinite(Number(raw.currentAdder))
      ? null
      : clamp(num(raw.currentAdder, 0), -20, 20),
    noActionPct: raw.noActionPct == null || raw.noActionPct === ''
      ? base.noActionPct
      : clamp(num(raw.noActionPct, base.noActionPct), -100, 1000),
    strategyPct: raw.strategyPct == null || raw.strategyPct === ''
      ? base.strategyPct
      : clamp(num(raw.strategyPct, base.strategyPct), -100, 1000),
    // Kept whatever the type, so switching away from Layered and back
    // doesn't lose the blocks somebody set up.
    layers: layers.length ? layers : base.layers.map(normalizeLayer),
  };
}

/**
 * What the contract locks, by its type: { type, pct, price, over, allIn }.
 * `price` is the Henry Hub strike the locked share prices at (null when
 * nothing is locked); `allIn` is the fixed rate for a Fixed All-In contract.
 */
export function contractHedge(scenario) {
  const type = CONTRACT_TYPES[scenario?.contractType] ? scenario.contractType : DEFAULT_CONTRACT_TYPE;
  if (type === 'index') return { type, pct: 0, price: null, over: false, allIn: null };
  if (type === 'fixed') {
    const allIn = num(scenario.fixedRate, 0);
    return { type, pct: 100, price: allIn - num(scenario.basis, 0) - num(scenario.adder, 0), over: false, allIn };
  }
  return { type, ...hedgeSummary(scenario.layers), allIn: null };
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
 * Sum a run of priced months into the figures the tiles and the totals rows
 * draw.
 *
 * One implementation, used for the term, for the look-back and for the two
 * together, because the three are the same arithmetic over different months
 * and a second copy of it is how a tile ends up disagreeing with the table
 * under it.
 */
function rollup(months) {
  const volume = months.reduce((n, m) => n + m.volume, 0);
  const indexCost = months.reduce((n, m) => n + m.indexCost, 0);
  const contractCost = months.reduce((n, m) => n + m.contractCost, 0);
  // What the saving is measured against: the index on the default basis,
  // otherwise the current contract or the no-action cost.
  const baselineCost = months.reduce((n, m) => n + m.baselineCost, 0);
  const saving = baselineCost - contractCost;
  // Contract 1 over the same months, whatever the saving is measured
  // against, so Contract details can compare the two on any basis.
  const contract1Cost = months.reduce((n, m) => n + (m.contract1Cost ?? 0), 0);
  const settledMonths = months.filter(m => m.source === 'settled').length;
  const forwardMonths = months.filter(m => m.source === 'forward').length;
  const assumedMonths = months.filter(m => m.source === 'assumed').length;
  const enteredVolumeMonths = months.filter(m => m.volumeSource === 'entered').length;
  return {
    months: months.length,
    volume,
    indexCost,
    contractCost,
    baselineCost,
    saving,
    savingPct: baselineCost ? saving / baselineCost : 0,
    savingPerDth: volume ? saving / volume : 0,
    avgIndex: months.length ? months.reduce((n, m) => n + m.index, 0) / months.length : null,
    avgIndexAllIn: volume ? indexCost / volume : null,
    avgContractAllIn: volume ? contractCost / volume : null,
    avgBaselineAllIn: volume ? baselineCost / volume : null,
    contract1Cost,
    avgContract1AllIn: volume ? contract1Cost / volume : null,
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
  };
}

/**
 * One row per calendar year a run of months touches, which is how a customer
 * budgets and how the savings get reported internally.
 */
function yearRollup(months) {
  const yearMap = new Map();
  for (const m of months) {
    const row = yearMap.get(m.year) || {
      year: m.year, months: 0, settled: 0, forward: 0, assumed: 0, enteredVolume: 0,
      history: 0, term: 0,
      volume: 0, indexCost: 0, contractCost: 0, saving: 0, indexSum: 0,
    };
    row.months += 1;
    row.enteredVolume += m.volumeSource === 'entered' ? 1 : 0;
    row.settled += m.source === 'settled' ? 1 : 0;
    row.forward += m.source === 'forward' ? 1 : 0;
    row.assumed += m.source === 'assumed' ? 1 : 0;
    // A year the term opens or closes in holds months of both readings, so
    // the row says how many of each rather than picking one and being wrong
    // about the other eleven.
    row.history += m.phase === 'history' ? 1 : 0;
    row.term += m.phase === 'term' ? 1 : 0;
    row.volume += m.volume;
    row.indexCost += m.indexCost;
    row.contractCost += m.contractCost;
    row.saving += m.saving;
    row.indexSum += m.index;
    yearMap.set(m.year, row);
  }
  return [...yearMap.values()].map(r => ({
    ...r,
    avgIndex: r.months ? r.indexSum / r.months : null,
    savingPerDth: r.volume ? r.saving / r.volume : null,
  }));
}

/**
 * Price the term twice - at index, and at the contract - and hand back a row
 * per month plus the rollups the subtab draws.
 *
 * Months past the last settle are priced at the scenario's forward
 * assumption and marked `assumed`, because a term that runs into the future
 * is the normal case and refusing to price it would make the page useless
 * exactly when somebody is deciding whether to sign.
 *
 * The same hedge is also run BACKWARDS over the months before the term, as
 * far as the look-back reaches, and those come back separately on `history`
 * with their own totals. Separately rather than folded in, because they are
 * a different claim: the term is a deal being decided and the look-back is
 * settled market the deal never covered. `all` is the two in order for the
 * charts and tables that draw the whole window, and `totals` still means the
 * term alone - every tile, export and ladder that read it before this
 * existed go on meaning what they meant.
 */
export function buildSavings(scenario, series, forward = []) {
  const s = normalizeScenario(scenario, series);
  const priceOf = priceLookup(series, forward, s.forwardPrice);
  const lastSettled = series.length ? series[series.length - 1] : null;
  const curveStart = forward?.length ? forward[0] : null;
  const curveEnd = forward?.length ? forward[forward.length - 1] : null;
  const hedge = contractHedge(s);
  const weights = VOLUME_SHAPES[s.volumeShape].weights;
  const hedgedShare = hedge.pct / 100;
  const strike = hedge.price ?? 0;

  // One month, priced twice. `given` is the volume somebody typed for it, if
  // they typed one: same precedence idea the prices follow, where the number
  // somebody asserted beats the number the page derived and the page says
  // which it used. A zero somebody typed is a month that burns nothing,
  // which is a real answer; only a null falls through to the annual volume
  // and the shape.
  const priceMonth = (year, month, given, phase) => {
    // Settle, then quote, then the flat number. Never the other way round: a
    // month that settled is not an opinion any more.
    const { price: index, source } = priceOf(year, month);
    const volume = given == null ? s.annualVolumeDth * weights[month - 1] : given;
    const commodity = hedgedShare * strike + (1 - hedgedShare) * index;
    const indexAllIn = index + s.basis + s.adder;
    const contractAllIn = commodity + s.basis + s.adder;
    // The rate the saving is measured against. See SAVINGS_BASES.
    // Contract 1, the contract the site is on today, priced this month: its
    // fixed all-in, or the index plus basis and its own adder.
    const contract1AllIn = s.currentType === 'index'
      ? index + s.basis + (s.currentAdder ?? 0)
      : s.currentRate;
    const baselineAllIn = s.savingsBasis === 'contract'
      ? contract1AllIn
      : s.savingsBasis === 'avoided'
        ? contractAllIn * (1 + (s.noActionPct - s.strategyPct) / 100)
        : indexAllIn;
    return {
      key: monthKey(year, month),
      year,
      month,
      label: monthLabel(year, month),
      short: shortMonthLabel(year, month),
      // Which reading this month belongs to: 'history' for the look-back,
      // 'term' for the contract itself.
      phase,
      source,
      // "Not a settle" - what the charts shade and the tables flag. The
      // three-way `source` says which kind of not-a-settle it is.
      assumed: source !== 'settled',
      index,
      indexAllIn,
      contractAllIn,
      volume,
      volumeSource: given == null ? 'shape' : 'entered',
      baselineAllIn,
      contract1AllIn,
      contract1Cost: contract1AllIn * volume,
      indexCost: indexAllIn * volume,
      baselineCost: baselineAllIn * volume,
      contractCost: contractAllIn * volume,
      saving: (baselineAllIn - contractAllIn) * volume,
    };
  };

  // The look-back, oldest first, ending at the month before the term opens.
  const back = lookbackMonths(s, series);
  const priorVolumes = s.historyVolumes || [];
  const history = [];
  for (let i = 0; i < back; i++) {
    const { year, month } = addMonths(s.startYear, s.startMonth, i - back);
    history.push(priceMonth(year, month, priorVolumes[historySlot(back, i)], 'history'));
  }

  const entered = s.monthlyVolumes || [];
  const months = [];
  for (let i = 0; i < s.termMonths; i++) {
    const { year, month } = addMonths(s.startYear, s.startMonth, i);
    months.push(priceMonth(year, month, entered[i], 'term'));
  }

  // Running totals, so a chart can show the saving accumulating rather than
  // only the month it happened in. Each reading accumulates within itself -
  // the term's running saving still starts at zero on the month the term
  // opens, whatever the look-back did before it - and `cumulativeAll` runs
  // across both for the chart that draws the whole window.
  let running = 0;
  for (const m of history) { running += m.saving; m.cumulative = running; }
  running = 0;
  for (const m of months) { running += m.saving; m.cumulative = running; }
  const all = [...history, ...months];
  running = 0;
  for (const m of all) { running += m.saving; m.cumulativeAll = running; }

  return {
    scenario: s,
    hedge,
    // How many months the look-back actually reached, which is not what the
    // scenario asked for when it asked for the whole record.
    lookback: back,
    history,
    months,
    all,
    years: yearRollup(months),
    historyYears: yearRollup(history),
    allYears: yearRollup(all),
    lastSettled,
    curveStart,
    curveEnd,
    totals: rollup(months),
    historyTotals: rollup(history),
    allTotals: rollup(all),
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
    // No look-back on the rungs. The question the ladder answers is how long
    // to sign for, and the months before the term are the same months
    // whichever rung you take - carrying them would add an identical
    // constant to all five bars and make the one thing being compared
    // harder to see.
    const run = buildSavings({ ...scenario, termMonths, lookback: 0 }, series, forward);
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
  const scenario = normalizeScenario(raw?.scenario, series, curve);
  const { sites, activeSiteId } = normalizeSites(raw, scenario, series, curve);
  return {
    settles,
    forward,
    loadedAt: text(raw?.loadedAt, 40) || null,
    // When the curve was quoted. The user's own curve carries the day they
    // pasted it; the shipped one carries the as-of date it was quoted at,
    // which is not the same thing and is not guessed at from the file.
    forwardAsOf: text(raw?.forwardAsOf, 40) || null,
    scenario,
    sites,
    activeSiteId,
  };
}

// ── the list of sites ───────────────────────────────────────────────────
//
// Step by step keeps a list of sites, each a whole scenario of its own.
// `scenario` stays what it always was - the one every subtab prices - and
// is the scenario of the site that is open (`activeSiteId`). The list holds
// a copy of it that syncActiveSite keeps current on every edit, so the
// stored list is never stale and switching is a plain swap.
//
// A record saved before the list existed has just the one scenario; it
// becomes the first site, so nothing anybody entered goes missing.

export const MAX_SITES = 50;
const FIRST_SITE_ID = 'site-1';

function normalizeSites(raw, scenario, series, curve) {
  const seen = new Set();
  const sites = [];
  for (const x of Array.isArray(raw?.sites) ? raw.sites : []) {
    if (!x || typeof x !== 'object') continue;
    const id = text(x.id, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sites.push({ id, scenario: normalizeScenario(x.scenario, series, curve) });
    if (sites.length >= MAX_SITES) break;
  }
  if (!sites.length) return { sites: [{ id: FIRST_SITE_ID, scenario }], activeSiteId: FIRST_SITE_ID };
  let activeSiteId = text(raw?.activeSiteId, 40);
  if (!sites.some(x => x.id === activeSiteId)) activeSiteId = sites[0].id;
  // The live scenario is the truth for the open site.
  return { sites: sites.map(x => (x.id === activeSiteId ? { ...x, scenario } : x)), activeSiteId };
}

/** The state with the open site's entry in the list matching `scenario`. */
export function syncActiveSite(state) {
  if (!state || !Array.isArray(state.sites)) return state;
  return {
    ...state,
    sites: state.sites.map(x => (x.id === state.activeSiteId ? { ...x, scenario: state.scenario } : x)),
  };
}

/** Open another site from the list. Unknown ids leave the state as it is. */
export function switchSite(state, id) {
  const synced = syncActiveSite(state);
  const target = synced.sites.find(x => x.id === id);
  if (!target || id === synced.activeSiteId) return synced;
  return { ...synced, activeSiteId: id, scenario: target.scenario };
}

// The page's defaults with no name. Built from the default scenario rather
// than by normalizing a bare { name }, which would read every missing number
// as 0 and clamp the term to one month in 1900.
function blankSiteScenario(series, forward) {
  return { ...normalizeScenario(null, series, forward), name: '' };
}

function newSiteId(taken) {
  let id;
  do {
    id = `site-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

/**
 * Add a blank site (the page's defaults, no name) and open it. Returns the
 * state unchanged once the list is at MAX_SITES.
 */
export function addSite(state, series = null, forward = null) {
  const synced = syncActiveSite(state);
  if (synced.sites.length >= MAX_SITES) return synced;
  const id = newSiteId(new Set(synced.sites.map(x => x.id)));
  const scenario = blankSiteScenario(series, forward);
  return { ...synced, sites: [...synced.sites, { id, scenario }], activeSiteId: id, scenario };
}

/**
 * Take a site off the list. Removing the open one opens the one before it
 * (or the next, if it was first); removing the last one leaves a blank
 * site, since the page always prices something.
 */
export function removeSite(state, id, series = null, forward = null) {
  const synced = syncActiveSite(state);
  const idx = synced.sites.findIndex(x => x.id === id);
  if (idx < 0) return synced;
  const sites = synced.sites.filter(x => x.id !== id);
  if (!sites.length) {
    const scenario = blankSiteScenario(series, forward);
    return { ...synced, sites: [{ id: FIRST_SITE_ID, scenario }], activeSiteId: FIRST_SITE_ID, scenario };
  }
  if (id !== synced.activeSiteId) return { ...synced, sites };
  const next = sites[Math.max(0, idx - 1)];
  return { ...synced, sites, activeSiteId: next.id, scenario: next.scenario };
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
