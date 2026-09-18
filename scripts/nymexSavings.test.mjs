// Assertion tests for the Sourcing arithmetic - the NYMEX settle
// table, the paste that loads one, and the hedge/index comparison the whole
// subtab is built on.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/nymexSavings.test.mjs
//
// Two things are worth pinning hardest here.
//
// The first is the shipped table itself. It was typed in from a spreadsheet,
// and a digit typed wrong in 2008 would quietly move every savings figure
// the page ever quotes. The table carried an AVG column; the code does not
// store it, so recomputing it and checking it against the published one is a
// checksum over every cell of the row.
//
// The second is that the saving is a MEASUREMENT, not a sales figure: a
// hedge struck above the market has to come back negative, and the adder and
// basis have to drop out of it entirely.
import {
  NYMEX_SETTLES, NYMEX_MONTH_LABELS,
} from '../src/data/nymexHistory.js';
import { NYMEX_FORWARD, NYMEX_FORWARD_ASOF } from '../src/data/nymexForward.js';
import {
  SHIPPED_SETTLES, VOLUME_SHAPES, TERM_LADDER,
  normalizeSettles, parseNymexTable, monthlySeries, yearRows, priceStats,
  percentileRank, defaultScenario, normalizeScenario, hedgeSummary,
  buildSavings, termLadder, addMonths, monthKey, monthLabel, shortMonthLabel,
  normalizeSavingsState, getSavingsState, hasSavedSavings, SAVINGS_KEY,
  SHIPPED_FORWARD, SHIPPED_FORWARD_ASOF, normalizeForward, parseForwardTable,
  forwardSeries, sourceSummary,
} from '../src/utils/nymexSavings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }
function near(actual, expected, tol, name) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) { passed++; }
  else { failed++; console.error(`FAIL  ${name}\n        expected ${expected} ±${tol}\n        got      ${actual}`); }
}

const series = monthlySeries(SHIPPED_SETTLES);
const curve = forwardSeries(SHIPPED_FORWARD);

// ── the shipped table is the table that was handed over ──────────────────
//
// The AVG column off the source spreadsheet, year by year. Nothing in the
// app reads these - they exist so that a mistyped settle fails a test
// instead of moving a number in front of a customer.
{
  const PUBLISHED_AVG = {
    1990: 1.682, 1991: 1.547, 1992: 1.773, 1993: 2.154, 1994: 1.901, 1995: 1.636,
    1996: 2.592, 1997: 2.587, 1998: 2.108, 1999: 2.268, 2000: 3.886, 2001: 4.273,
    2002: 3.221, 2003: 5.388, 2004: 6.138, 2005: 8.616, 2006: 7.226, 2007: 6.860,
    2008: 9.035, 2009: 3.986, 2010: 4.393, 2011: 4.042, 2012: 2.789, 2013: 3.652,
    2014: 4.415, 2015: 2.664, 2016: 2.460, 2017: 3.108, 2018: 3.086, 2019: 2.628,
    2020: 2.077, 2021: 3.841, 2022: 6.644, 2023: 2.737, 2024: 2.269, 2025: 3.427,
    2026: 3.630,
  };
  const rows = yearRows(SHIPPED_SETTLES);
  eq(rows.length, Object.keys(PUBLISHED_AVG).length, 'every year of the source table is shipped');
  let mismatches = 0;
  for (const row of rows) {
    const want = PUBLISHED_AVG[row.year];
    if (want == null) { mismatches++; continue; }
    if (Math.abs(Math.round(row.avg * 1000) / 1000 - want) > 0.0011) {
      mismatches++;
      console.error(`        ${row.year}: computed ${row.avg.toFixed(3)}, published ${want}`);
    }
  }
  eq(mismatches, 0, 'each year recomputes to the average the source table published');

  eq(NYMEX_MONTH_LABELS.length, 12, 'twelve month labels');
  eq(NYMEX_SETTLES.every(r => r.length === 13), true, 'every row is a year and twelve months');
  eq(rows[0].year, 1990, 'the record opens in 1990');
  eq(rows[0].count, 7, 'and 1990 carries only the seven months the contract traded');
  eq(rows[0].months.slice(0, 5).every(v => v == null), true, 'the months before it are empty, not zero');
  eq(series[0].label, 'Jun 1990', 'so the first settle in the series is June 1990');
  eq(series.length, 436, 'and the record holds 436 settled months');
}

// ── reading a table back in ──────────────────────────────────────────────
{
  const settles = normalizeSettles([[2020, 2, 3, '4', null, '', 'x', -1, 8, 9, 10, 11, 12]]);
  eq(settles[0][1], 2, 'a number comes through');
  eq(settles[0][3], 4, 'and so does a number written as text');
  eq(settles[0][4], null, 'a missing month stays missing');
  eq(settles[0][6], null, 'a cell that is not a price is dropped rather than read as zero');
  eq(settles[0][7], null, 'and so is a negative one');

  eq(normalizeSettles('nonsense'), [], 'anything that is not rows reads as an empty table');
  eq(normalizeSettles([[1500, 1]]), [], 'a year outside the range the contract could have is dropped');
  eq(normalizeSettles([[2001, 1], [2000, 2]])[0][0], 2000, 'years come back in order');
  eq(normalizeSettles([[2000, 1], [2000, 5]])[0][1], 5, 'a second row for a year replaces the first');
}

// ── the paste box ────────────────────────────────────────────────────────
{
  const pasted = parseNymexTable([
    'YEAR\tJan\tFeb\tMar\tApr\tMay\tJun\tJul\tAug\tSep\tOct\tNov\tDec\tAVG.',
    '2024\t2.619\t2.490\t1.615\t1.575\t1.614\t2.493\t2.628\t1.907\t1.930\t2.585\t2.346\t3.431\t2.269',
    '2025\t3.514\t3.535\t3.906\t3.950\t3.170\t3.204\t3.261\t3.081\t2.867\t2.835\t3.376\t4.424\t3.427',
  ].join('\n'));
  eq(pasted.years, 2, 'two years came in');
  eq(pasted.months, 24, 'with all of their months');
  eq(pasted.skipped, ['YEAR Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec AVG.'], 'the header is reported, not read as data');
  eq(pasted.settles[0][12], 3.431, 'December landed in December');
  eq(pasted.settles[0].length, 13, 'and the AVG column on the end was ignored rather than read as a thirteenth month');

  // The row the source spreadsheet writes for a year that has not finished:
  // tabs with nothing between them.
  const partial = parseNymexTable('2026\t4.687\t7.460\t2.969\t3.095\t2.559\t3.040\t3.231\t2.725\t2.907\t\t\t');
  eq(partial.settles[0].slice(10), [null, null, null], 'empty tabbed cells stay empty months');
  eq(partial.months, 9, 'so only the months that settled come in');

  const gapped = parseNymexTable('1990\t\t\t\t\t\t1.560\t1.529\t1.440\t1.422\t1.551\t1.920\t2.355');
  eq(gapped.settles[0][6], 1.56, 'a leading gap pushes the prices to the months they belong to');
  eq(gapped.settles[0][1], null, 'rather than to January');

  eq(parseNymexTable('2024 2.619 2.490').settles[0][2], 2.49, 'a space-separated row reads too');
  eq(parseNymexTable('2024,2.619,2.490').settles[0][2], 2.49, 'and a comma-separated one');
  eq(parseNymexTable('2024\t$2.62\t$1,010.00').settles[0][1], 2.62, 'currency formatting is stripped');
  eq(parseNymexTable('').years, 0, 'an empty paste is an empty table, not an error');
  eq(parseNymexTable('just a note').skipped.length, 1, 'a line with no year is skipped and reported');
  eq(parseNymexTable('2024\t\t\t').years, 0, 'a year with no prices at all is not a row');
}

// ── month arithmetic ─────────────────────────────────────────────────────
{
  eq(addMonths(2024, 12, 1), { year: 2025, month: 1 }, 'December rolls into January');
  eq(addMonths(2024, 1, -1), { year: 2023, month: 12 }, 'and January rolls back into December');
  eq(addMonths(2024, 6, 0), { year: 2024, month: 6 }, 'nowhere is where it started');
  eq(addMonths(2020, 3, 36), { year: 2023, month: 3 }, 'three years on is the same month');
  eq(monthKey(2024, 3), '2024-03', 'a key that sorts as a string sorts as a date');
  eq(monthLabel(2024, 3), 'Mar 2024', 'the long label names the year');
  eq(shortMonthLabel(2024, 3), 'Mar', 'the short one does not');
  eq(shortMonthLabel(2024, 1), 'Jan 2024', 'except in January, which is where an axis needs it');
}

// ── what the record says about a price ───────────────────────────────────
{
  const stats = priceStats(series);
  near(stats.min, 1.090, 0.0005, 'the cheapest month on record is February 1992');
  near(stats.max, 13.907, 0.0005, 'the dearest is October 2005');
  eq(stats.count, series.length, 'every settled month counts');
  eq(priceStats([]), null, 'an empty record has no statistics rather than zeroes');

  eq(percentileRank(series, stats.min - 1), 0, 'nothing settled below the floor');
  eq(percentileRank(series, stats.max + 1), 1, 'and everything settled below the ceiling');
  eq(percentileRank([], 3), null, 'an empty record ranks nothing');
  eq(percentileRank(series, NaN), null, 'and neither does a price that is not one');
  const mid = percentileRank(series, stats.median);
  ok(mid >= 0.49 && mid <= 0.51, 'the median sits at the half-way mark');
}

// ── hedge layers ─────────────────────────────────────────────────────────
{
  eq(hedgeSummary([]), { pct: 0, price: null, over: false }, 'no layers is no hedge, and no price to average');
  const two = hedgeSummary([{ pct: 50, price: 3 }, { pct: 25, price: 5 }]);
  eq(two.pct, 75, 'the layers add up to the hedged share');
  near(two.price, 3.6667, 0.001, 'and the strike is weighted by how much each layer carries');
  eq(hedgeSummary([{ pct: 80, price: 3 }, { pct: 40, price: 4 }]).over, true, 'layers past the whole volume are called out');
  eq(hedgeSummary([{ pct: 80, price: 3 }, { pct: 40, price: 4 }]).pct, 100, 'and clipped rather than allowed to over-hedge the term');
}

// ── the scenario ─────────────────────────────────────────────────────────
{
  // With a curve loaded the page opens on the deal somebody is deciding
  // about: the whole quoted strip.
  const withCurve = defaultScenario(series, curve);
  eq({ year: withCurve.startYear, month: withCurve.startMonth }, { year: curve[0].year, month: curve[0].month },
    'the page opens at the first quoted month');
  eq(withCurve.termMonths, curve.length, 'and runs the length of the curve');
  const opening = buildSavings(withCurve, series, curve).totals;
  eq(opening.forwardMonths, curve.length, 'so every month of it is quoted');
  eq(opening.assumedMonths, 0, 'and none of it is the flat assumption');
  eq(withCurve.forwardPrice, Math.round(curve[curve.length - 1].price * 100) / 100,
    'the flat number carries on from the end of the curve, not from a settle years behind it');

  // With no curve it falls back to the backtest it opened on before there
  // was one to price against.
  const base = defaultScenario(series, []);
  const last = series[series.length - 1];
  eq(addMonths(base.startYear, base.startMonth, base.termMonths - 1), { year: last.year, month: last.month },
    'with no curve the page opens on a term that ends at the last settle');
  eq(buildSavings(base, series).totals.assumedMonths, 0, 'so every month of it is measured, not assumed');

  eq(normalizeScenario(null, series, []).termMonths, base.termMonths, 'nothing saved yet opens the default');
  eq(normalizeScenario({ termMonths: 999 }, series).termMonths, 120, 'a term longer than the page holds is clipped');
  eq(normalizeScenario({ termMonths: 0 }, series).termMonths, 1, 'and a term of nothing is a month');
  eq(normalizeScenario({ annualVolumeDth: -5 }, series).annualVolumeDth, 0, 'volume cannot be negative');
  eq(normalizeScenario({ basis: -0.4 }, series).basis, -0.4, 'but basis can be, because basis is');
  eq(normalizeScenario({ volumeShape: 'made up' }, series).volumeShape, 'even', 'a shape nobody defined falls back to even');
  eq(normalizeScenario({ layers: [] }, series).layers.length > 0, true, 'a scenario always has a layer to edit');
  eq(normalizeScenario({ startMonth: 13 }, series).startMonth, 12, 'a month past December is December');
  eq(defaultScenario([], []).termMonths, 36, 'and an empty record still opens a scenario rather than nothing');
  eq(defaultScenario([], curve).termMonths, curve.length, 'a curve with no settles behind it still opens a term');
}

// ── the saving is a measurement ──────────────────────────────────────────
{
  // One month, one settle, so every figure can be checked by hand.
  const one = monthlySeries(normalizeSettles([[2024, 5]]));
  const flat = {
    startYear: 2024, startMonth: 1, termMonths: 1, annualVolumeDth: 1200,
    volumeShape: 'even', basis: 0, adder: 0, forwardPrice: 5,
    layers: [{ pct: 100, price: 4 }],
  };
  const run = buildSavings(flat, one);
  eq(run.months.length, 1, 'a one-month term is one row');
  eq(run.months[0].volume, 100, 'an even shape splits the year twelve ways');
  eq(run.months[0].index, 5, 'the month prices at what it settled at');
  eq(run.months[0].assumed, false, 'and is marked as settled');
  eq(run.totals.indexCost, 500, 'at index, 100 Dth at $5 is $500');
  eq(run.totals.contractCost, 400, 'fully hedged at $4 it is $400');
  eq(run.totals.saving, 100, 'so the hedge saved $100');
  near(run.totals.savingPerDth, 1, 1e-9, 'which is $1 a Dth');
  near(run.totals.savingPct, 0.2, 1e-9, 'and a fifth of the index bill');

  // The direction that matters: a hedge above the market is a cost.
  const under = buildSavings({ ...flat, layers: [{ pct: 100, price: 6 }] }, one);
  eq(under.totals.saving, -100, 'a hedge struck above the market comes back negative, not zero');

  // Adder and basis are charged either way, so they move the bill and not
  // the saving.
  const loaded = buildSavings({ ...flat, adder: 0.35, basis: -0.2 }, one);
  near(loaded.totals.saving, 100, 1e-9, 'the adder and basis drop out of the saving');
  near(loaded.totals.indexCost, 515, 1e-9, 'while both legs of the bill carry them');
  near(loaded.totals.contractCost, 415, 1e-9, 'the contract leg too');

  // Half hedged is half the saving.
  const half = buildSavings({ ...flat, layers: [{ pct: 50, price: 4 }] }, one);
  eq(half.totals.saving, 50, 'hedging half the volume saves half as much');

  // No hedge at all is the index, twice.
  const none = buildSavings({ ...flat, layers: [{ pct: 0, price: 4 }] }, one);
  eq(none.totals.saving, 0, 'an unhedged term saves nothing, because it IS the index');
}

// ── months the market has not reached ────────────────────────────────────
{
  const one = monthlySeries(normalizeSettles([[2024, 5]]));
  const run = buildSavings({
    startYear: 2024, startMonth: 1, termMonths: 3, annualVolumeDth: 1200,
    volumeShape: 'even', basis: 0, adder: 0, forwardPrice: 9,
    layers: [{ pct: 100, price: 4 }],
  }, one);
  eq(run.months.map(m => m.assumed), [false, true, true], 'a month past the last settle is marked');
  eq(run.months.map(m => m.index), [5, 9, 9], 'and priced at the forward assumption');
  eq(run.totals.settledMonths, 1, 'the totals say how much of the term is measured');
  eq(run.totals.assumedMonths, 2, 'and how much of it is assumed');
  eq(run.months.map(m => m.cumulative), [100, 600, 1100], 'the saving accumulates across the term');
}

// ── the volume shape changes the answer, not just the picture ────────────
{
  // Cheap summer, dear winter: a heating account buys most of its gas in the
  // expensive months, so the same hedge is worth more to it.
  const cheapSummerDearWinter = monthlySeries(normalizeSettles([
    [2024, 10, 10, 5, 5, 5, 5, 5, 5, 5, 5, 10, 10],
  ]));
  const shared = {
    startYear: 2024, startMonth: 1, termMonths: 12, annualVolumeDth: 12000,
    basis: 0, adder: 0, forwardPrice: 5, layers: [{ pct: 100, price: 5 }],
  };
  const even = buildSavings({ ...shared, volumeShape: 'even' }, cheapSummerDearWinter);
  const heat = buildSavings({ ...shared, volumeShape: 'heating' }, cheapSummerDearWinter);
  near(even.totals.volume, 12000, 1e-6, 'both shapes buy the same volume over the year');
  near(heat.totals.volume, 12000, 1e-6, 'the heating shape included');
  ok(heat.totals.saving > even.totals.saving, 'but the heating shape buys more of it in the dear months, so the hedge is worth more');
  eq(VOLUME_SHAPES.heating.weights.length, 12, 'the heating shape covers the year');
  near(VOLUME_SHAPES.heating.weights.reduce((a, b) => a + b, 0), 1, 1e-9, 'and adds up to all of it');
  near(VOLUME_SHAPES.even.weights.reduce((a, b) => a + b, 0), 1, 1e-9, 'so does the even one');
}

// ── the year rollup ──────────────────────────────────────────────────────
{
  const run = buildSavings({
    startYear: 2024, startMonth: 11, termMonths: 4, annualVolumeDth: 1200,
    volumeShape: 'even', basis: 0, adder: 0, forwardPrice: 5,
    layers: [{ pct: 100, price: 4 }],
  }, monthlySeries(normalizeSettles([[2024, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], [2025, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]])));
  eq(run.years.map(y => y.year), [2024, 2025], 'a term that crosses New Year reports both years');
  eq(run.years.map(y => y.months), [2, 2], 'each with the months it actually holds');
  near(run.years[0].saving + run.years[1].saving, run.totals.saving, 1e-9, 'and the years add back up to the term');
}

// ── the term ladder ──────────────────────────────────────────────────────
{
  const base = defaultScenario(series, []);
  const ladder = termLadder(base, series);
  eq(ladder.map(r => r.termMonths), TERM_LADDER, 'the ladder runs the terms it advertises');
  eq(ladder.find(r => r.termMonths === 36).saving, buildSavings({ ...base, termMonths: 36 }, series).totals.saving,
    'and each row is that term priced the same way the page prices it');
  ok(ladder[0].assumedMonths <= ladder[ladder.length - 1].assumedMonths,
    'a longer term runs further past the settles, never less far');

  // The curve reaches the ladder too, so a longer term is not punished for
  // running into months the curve actually quotes.
  const onCurve = defaultScenario(series, curve);
  const withCurve = termLadder(onCurve, series, curve);
  const withoutCurve = termLadder(onCurve, series, []);
  eq(withCurve[0].forwardMonths, 12, 'a 12-month term off the curve is twelve quoted months');
  eq(withoutCurve[0].forwardMonths, 0, 'the same term with no curve loaded has none');
  ok(withCurve[0].saving !== withoutCurve[0].saving, 'so the curve changes the answer rather than only the label');
}

// ── the shipped forward curve ────────────────────────────────────────────
//
// Typed in from a two-column quote, so the same worry applies as to the
// settle table: a digit wrong here moves every figure on a forward deal.
// There is no AVG column to check it against, so the checks are on shape and
// on the handful of values at the ends and the extremes.
{
  eq(SHIPPED_FORWARD.length, 24, 'the shipped curve is two years of quotes');
  eq(NYMEX_FORWARD.length, SHIPPED_FORWARD.length, 'and normalizing it drops none of them');
  eq(SHIPPED_FORWARD[0], [2026, 11, 3.043], 'it opens at Nov 2026');
  eq(SHIPPED_FORWARD[SHIPPED_FORWARD.length - 1], [2028, 10, 3.671], 'and runs to Oct 2028');
  eq(SHIPPED_FORWARD.every(r => r[1] >= 1 && r[1] <= 12), true, 'every row names a real month');
  eq(new Set(SHIPPED_FORWARD.map(r => `${r[0]}-${r[1]}`)).size, SHIPPED_FORWARD.length, 'with no month quoted twice');

  // Consecutive, with no gap in the middle: a curve with a hole in it would
  // silently price that month off the flat assumption.
  let gaps = 0;
  for (let i = 1; i < SHIPPED_FORWARD.length; i++) {
    const want = addMonths(SHIPPED_FORWARD[i - 1][0], SHIPPED_FORWARD[i - 1][1], 1);
    if (want.year !== SHIPPED_FORWARD[i][0] || want.month !== SHIPPED_FORWARD[i][1]) gaps++;
  }
  eq(gaps, 0, 'and the months run consecutively, so nothing inside the strip falls through to the flat assumption');

  const prices = SHIPPED_FORWARD.map(r => r[2]);
  eq(Math.max(...prices), 4.626, 'the peak of the strip is Jan 2028');
  eq(Math.min(...prices), 2.731, 'and the trough is Apr 2027');
  eq(SHIPPED_FORWARD.find(r => r[0] === 2028 && r[1] === 1)[2], 4.626, 'Jan 2028 is quoted at 4.626');
  eq(SHIPPED_FORWARD.find(r => r[0] === 2027 && r[1] === 4)[2], 2.731, 'Apr 2027 at 2.731');
  near(prices.reduce((a, b) => a + b, 0) / prices.length, 3.4283, 0.0002, 'and the strip averages 3.428');
  ok(typeof SHIPPED_FORWARD_ASOF === 'string' && SHIPPED_FORWARD_ASOF.length > 0,
    'the curve says when it was quoted, because a quote goes stale and a settle does not');
  eq(SHIPPED_FORWARD_ASOF, NYMEX_FORWARD_ASOF, 'and that date travels with it');

  const cs = forwardSeries(SHIPPED_FORWARD);
  eq(cs[0].key, '2026-11', 'as a series it keys like the settles do');
  eq(cs[0].label, 'Nov 2026', 'and labels like them');
}

// ── reading a curve back in ──────────────────────────────────────────────
{
  eq(normalizeForward([[2027, 13, 3]]), [], 'a month that is not a month is dropped');
  eq(normalizeForward([[2027, 1, 0]]), [], 'and so is a price of nothing');
  eq(normalizeForward([[2027, 1, -3]]), [], 'or a negative one');
  eq(normalizeForward('nonsense'), [], 'anything that is not rows reads as an empty curve');
  eq(normalizeForward([[27, 1, 3]]), [[2027, 1, 3]], 'a two-digit year is this century, the way a curve is quoted');
  eq(normalizeForward([[2027, 2, 3], [2027, 1, 4]]).map(r => r[1]), [1, 2], 'months come back in order');
  eq(normalizeForward([[2027, 1, 3], [2027, 1, 9]]), [[2027, 1, 9]], 'a second quote for a month replaces the first');
}

// ── the curve paste box ──────────────────────────────────────────────────
{
  // The shape the curve was actually handed over in.
  const pasted = parseForwardTable([
    'Month\tPrice',
    'Nov  26\t $3.043',
    'Dec  26\t $3.418',
    'Jan  27\t $3.787',
  ].join('\n'));
  eq(pasted.months, 3, 'three quotes came in');
  eq(pasted.forward, [[2026, 11, 3.043], [2026, 12, 3.418], [2027, 1, 3.787]], 'with the months and prices they were written with');
  eq(pasted.skipped, ['Month Price'], 'and the header reported rather than read as data');

  // Every other way a month gets written.
  eq(parseForwardTable('Nov 2026 3.043').forward, [[2026, 11, 3.043]], 'a four-digit year reads');
  eq(parseForwardTable('November 2026 3.043').forward, [[2026, 11, 3.043]], 'a spelled-out month reads');
  eq(parseForwardTable('NOV 26,3.043').forward, [[2026, 11, 3.043]], 'shouting and commas read');
  eq(parseForwardTable('2027-01\t3.787').forward, [[2027, 1, 3.787]], 'an ISO-ish month reads');
  eq(parseForwardTable('1/27 3.787').forward, [[2027, 1, 3.787]], 'and so does month-slash-year');
  eq(parseForwardTable('$1,010.50 is not a month').months, 0, 'a line with no month in it is skipped');
  eq(parseForwardTable('Nov 26').months, 0, 'and so is a month with no price');
  eq(parseForwardTable('').months, 0, 'an empty paste is an empty curve, not an error');
}

// ── settle, then quote, then the flat number ─────────────────────────────
//
// The precedence is the whole point of having three sources: a month that
// settled is not an opinion any more, and a month somebody has quoted is
// worth more than one flat guess.
{
  const settled = monthlySeries(normalizeSettles([[2026, null, null, null, null, null, null, null, null, 5]]));
  const quoted = forwardSeries(normalizeForward([
    [2026, 9, 99], // the same month the settle covers - must lose
    [2026, 11, 7],
    [2026, 12, 8],
  ]));
  const run = buildSavings({
    startYear: 2026, startMonth: 9, termMonths: 5, annualVolumeDth: 1200,
    volumeShape: 'even', basis: 0, adder: 0, forwardPrice: 1,
    layers: [{ pct: 100, price: 4 }],
  }, settled, quoted);

  eq(run.months.map(m => m.label), ['Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027'], 'five months of term');
  eq(run.months.map(m => m.source), ['settled', 'assumed', 'forward', 'forward', 'assumed'], 'each priced from the best source it has');
  eq(run.months[0].index, 5, 'the settle beats the quote for the month they both cover');
  eq(run.months[1].index, 1, 'the gap between the last settle and the first quote falls to the flat number');
  eq(run.months[2].index, 7, 'inside the curve the quote is used');
  eq(run.months[4].index, 1, 'and past the end of it the flat number takes over again');

  eq(run.totals.settledMonths, 1, 'the counts are kept apart');
  eq(run.totals.forwardMonths, 2, 'one bucket each');
  eq(run.totals.assumedMonths, 2, 'including the weakest one');
  eq(run.totals.pricedMonths, 3, 'and only settles and quotes count as priced off the market');
  eq(run.months.every(m => m.assumed === (m.source !== 'settled')), true,
    '"assumed" still means "not a settle", which is what the charts shade');

  eq(sourceSummary(run.totals), '1 settled, 2 on the curve, 2 at the flat assumption', 'and it is all spelled out rather than scored');
  eq(sourceSummary({ settledMonths: 0, forwardMonths: 0, assumedMonths: 0 }), 'no months', 'an empty term says so');
  eq(sourceSummary({ settledMonths: 3, forwardMonths: 0, assumedMonths: 0 }), '3 settled', 'a bucket with nothing in it is left out');

  // The year rollup splits the same three ways.
  const y2026 = run.years.find(y => y.year === 2026);
  eq([y2026.settled, y2026.forward, y2026.assumed], [1, 2, 1], 'and the year rows carry the split too');
}

// ── a curve changes the answer, not just the labelling ───────────────────
{
  const settled = monthlySeries(normalizeSettles([[2026, null, null, null, null, null, null, null, null, 5]]));
  const shared = {
    startYear: 2026, startMonth: 10, termMonths: 2, annualVolumeDth: 1200,
    volumeShape: 'even', basis: 0, adder: 0, forwardPrice: 4,
    layers: [{ pct: 100, price: 4 }],
  };
  const flat = buildSavings(shared, settled, []);
  const withCurve = buildSavings(shared, settled, forwardSeries(normalizeForward([[2026, 10, 6], [2026, 11, 6]])));
  eq(flat.totals.saving, 0, 'at the flat number struck at the flat number, the hedge is worth nothing');
  eq(withCurve.totals.volume, 200, 'two months of a 1,200 Dth year is 200 Dth');
  eq(withCurve.totals.saving, 400, 'against a curve $2 above the strike that is $400');
  eq(buildSavings(shared, settled).totals.saving, 0, 'and a caller that passes no curve at all still prices the term');
}

// ── what gets saved, and what deliberately does not ──────────────────────
{
  eq(hasSavedSavings({}), false, 'a settings document with nothing in it has nothing saved');
  eq(getSavingsState({}).settles, null, 'and opens on the shipped table');
  eq(getSavingsState({}).scenario.termMonths, SHIPPED_FORWARD.length, 'with the default scenario, which runs the shipped curve');

  // The shipped table is NOT copied into settings. A user who never pasted
  // their own has to keep following the shipped one as it is updated.
  const untouched = normalizeSavingsState({ scenario: { termMonths: 24 } });
  eq(untouched.settles, null, 'saving a scenario does not freeze a copy of the shipped table under it');
  eq(untouched.scenario.termMonths, 24, 'while the scenario itself is kept');

  const own = normalizeSavingsState({ settles: [[2024, 3, 3, 3]], loadedAt: '2026-01-02' });
  eq(own.settles.length, 1, 'a pasted table is kept');
  eq(own.loadedAt, '2026-01-02', 'with the day it came in');
  eq(hasSavedSavings({ [SAVINGS_KEY]: { settles: [[2024, 3]] } }), true, 'and the page can tell whose numbers it is showing');

  // A scenario saved against a pasted table is normalized against THAT
  // table, not the shipped one.
  eq(normalizeSavingsState({ settles: [[2024, 3, 3, 3]] }).scenario.layers[0].price, 3,
    'the opening scenario is struck off the table actually loaded');

  // The curve is stored the same way and for the same reason - more so, in
  // fact, since a shipped curve is the one table that is expected to be
  // refreshed under a user who never pasted their own.
  eq(getSavingsState({}).forward, null, 'a fresh page opens on the shipped curve');
  eq(normalizeSavingsState({ scenario: { termMonths: 24 } }).forward, null,
    'saving a scenario does not freeze a copy of the shipped curve under it');
  const ownCurve = normalizeSavingsState({ forward: [[2030, 1, 5]], forwardAsOf: '2026-09-17' });
  eq(ownCurve.forward, [[2030, 1, 5]], 'a pasted curve is kept');
  eq(ownCurve.forwardAsOf, '2026-09-17', 'with the day it came in');
  eq(ownCurve.settles, null, 'and pasting a curve leaves the settle table alone');
  eq(normalizeSavingsState({ forward: [] }).forward, null, 'an empty pasted curve falls back to the shipped one');
  eq(normalizeSavingsState({ forward: 'nope' }).forward, null, 'and so does one that is not a curve');
  eq(hasSavedSavings({ [SAVINGS_KEY]: { forward: [[2030, 1, 5]] } }), true, 'a saved curve alone counts as saved');

  eq(normalizeSavingsState(null).settles, null, 'nothing at all still opens');
  eq(normalizeSavingsState({ settles: 'nope' }).settles, null, 'and so does a settles field that is not a table');
  eq(normalizeSavingsState({ settles: [] }).settles, null, 'an empty pasted table falls back to the shipped one rather than an empty page');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
