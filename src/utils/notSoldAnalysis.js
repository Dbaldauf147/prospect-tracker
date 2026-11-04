// The roll-ups behind Opps › Not Sold Analysis.
//
// The By Source tab answers "where do leads come from and how do they
// convert". Losing is a different question — which reasons keep coming up
// and which sources they cluster in — and it was only ever a single column
// on that table. This is the same close-reason data read the other way
// round: reason first, then source, with each source's reasons broken out
// underneath it.
//
// The window is a CLOSE DATE one, not a start date: "losses in 2026" means
// deals lost in 2026, whenever they opened. Filtering the other way would
// answer a question nobody asks of a loss report. Opps with no Close Date
// are counted while no window is set and reported as excluded once one is,
// rather than being silently dropped or silently kept.
//
// Pure — records in, plain rows out — so scripts/notSoldAnalysis.test.mjs
// can exercise it without React.

import { closeReasonOf, parseYear } from './oppsMetrics.js';
import { lookupCloseNotSold } from '../data/closeNotSoldRules.js';

export const NOT_SOLD = 'Not Sold';
export const SOLD = 'Sold';

export function stageOf(r) {
  return String(r?.['Stage'] ?? '').trim();
}

/** The Source bucket a record falls in — the same rule the By Source tab uses. */
export function sourceOf(r) {
  const raw = String(r?.['Source'] ?? '').trim();
  const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
  return cleaned || '(Unspecified)';
}

// A reason every loss can be filed under, so the totals add up: a loss with
// nothing recorded is its own bucket rather than missing from the table.
export const NO_REASON = '(No reason recorded)';

export function reasonOf(r) {
  return closeReasonOf(r) || NO_REASON;
}

// Same bucket-everything rule for the two columns below: a loss with the
// field blank is filed under a named bucket rather than dropped, so the
// breakdown beside a reason always adds up to that reason's losses.
export const NO_COMPETITION = '(Unspecified)';
export const UNMAPPED_STATUS = '(Unmapped)';

/** Who else was in the deal — the Competition cell, placeholders cleaned. */
export function competitionOf(r) {
  const raw = String(r?.['Competition'] ?? '').trim();
  const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
  return cleaned || NO_COMPETITION;
}

/**
 * How this loss closes out in BFO — Lost, Cancelled by Customer, Cancelled
 * by Schneider — read through the same (Competition, Reason Not Sold)
 * mapping the Close Not Solds flow runs on, so the analysis and the
 * close-out agent can't name two different statuses for one opp.
 *
 * A pair with no rule reads as unmapped rather than blank: those are the
 * rows the Agents page already highlights as needing a Competition or a
 * Reason before they can be closed, and a silent gap here would hide from
 * this table exactly the losses that aren't finished being recorded.
 */
export function bfoStatusOf(r) {
  const competition = String(r?.['Competition'] ?? '').trim();
  const mapped = lookupCloseNotSold(competition, closeReasonOf(r));
  return mapped?.status || UNMAPPED_STATUS;
}

/**
 * The year an opp closed in, or null when it carries no usable Close Date.
 *
 * Read off the year digits rather than through a Date, because a local-time
 * read of an ISO date parsed as UTC midnight lands in the previous year for
 * anyone west of Greenwich — "2026-01-01" would file under 2025.
 */
export function closeYearOf(r) {
  return parseYear(r?.['Close Date']);
}

/** Close years present among the losses, newest first — the year filter's options. */
export function notSoldYears(records) {
  const years = new Set();
  for (const r of records || []) {
    if (stageOf(r) !== NOT_SOLD) continue;
    const y = closeYearOf(r);
    if (y != null) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

// Does this opp's close fall inside the window? Returns null when it has no
// usable Close Date, so the caller can tell "outside the window" from
// "can't say" — the two want different treatment.
function inWindow(r, fromTs, toTs, yearSet) {
  const raw = r?.['Close Date'];
  const ts = raw ? Date.parse(raw) : NaN;
  if (isNaN(ts)) return null;
  if (fromTs != null && ts < fromTs) return false;
  if (toTs != null && ts > toTs) return false;
  if (yearSet) {
    const y = closeYearOf(r);
    if (y == null || !yearSet.has(y)) return false;
  }
  return true;
}

/**
 * Everything the Not Sold Analysis tab shows, from one pass over the records.
 *
 *   {
 *     lossCount, winCount,
 *     undated,        // losses left out because they carry no Close Date
 *     reasons: [{ reason, count, percent, sources: [{ source, count }],
 *                 competitions: [{ value, count }], bfoStatuses: [{ value, count }] }],
 *     sources: [{ source, losses, wins, closeRate, percent,
 *                 reasons: [{ reason, count, percent, percentAll }],
 *                 topReason }],
 *     rows,           // the Not Sold opps themselves, newest close first
 *   }
 *
 * A source's own reason rows carry two percentages, because they answer two
 * different questions: `percent` is the share of THAT source's losses, which
 * is how you read what goes wrong with a source; `percentAll` is the share
 * of every loss in the window, which is how you tell a source's biggest
 * problem from the business's.
 *
 * Everywhere else `percent` is a share of the losses in the window, so the
 * reason table and the source table are read against one denominator.
 *
 * `years` is a list of close years to include; empty means every year, so a
 * year that only appears in next year's data needs no re-selecting.
 */
export function notSoldBreakdown(records, { from = '', to = '', years = [] } = {}) {
  const fromTs = from ? Date.parse(from) : null;
  const toTs = to ? Date.parse(to) + 86399999 : null;
  const yearList = (years || []).map(Number).filter(Number.isFinite);
  const yearSet = yearList.length ? new Set(yearList) : null;
  const windowed = fromTs != null || toTs != null || yearSet != null;

  const losses = [];
  let winCount = 0;
  let undated = 0;
  const winsBySource = new Map();

  for (const r of records || []) {
    const stage = stageOf(r);
    if (stage !== NOT_SOLD && stage !== SOLD) continue;
    const within = inWindow(r, fromTs, toTs, yearSet);
    // No Close Date: kept while the report is unbounded, since it's still a
    // loss that happened; excluded once a window is set, because there's no
    // way to say whether it belongs in it.
    if (within === false) continue;
    if (within === null && windowed) {
      if (stage === NOT_SOLD) undated += 1;
      continue;
    }
    if (stage === SOLD) {
      winCount += 1;
      const s = sourceOf(r);
      winsBySource.set(s, (winsBySource.get(s) || 0) + 1);
      continue;
    }
    losses.push(r);
  }

  const byReason = new Map();
  const bySource = new Map();
  // Which sources each reason shows up in, so a reason row can say where it
  // is concentrated without a second pass.
  const reasonSources = new Map();
  // And the same for who else was in those deals, and how they close out in
  // BFO. Both are per-opp facts under a row that is a group of opps, so the
  // only honest way to show them is the mix: "Only SE (4), RFP (2)" says
  // something a single value would have to lie about.
  const reasonCompetitions = new Map();
  const reasonStatuses = new Map();
  const tallyInto = (outer, key, value) => {
    const inner = outer.get(key) || new Map();
    inner.set(value, (inner.get(value) || 0) + 1);
    outer.set(key, inner);
  };

  for (const r of losses) {
    const reason = reasonOf(r);
    const source = sourceOf(r);

    byReason.set(reason, (byReason.get(reason) || 0) + 1);
    tallyInto(reasonCompetitions, reason, competitionOf(r));
    tallyInto(reasonStatuses, reason, bfoStatusOf(r));

    const sEntry = bySource.get(source) || { count: 0, reasons: new Map() };
    sEntry.count += 1;
    sEntry.reasons.set(reason, (sEntry.reasons.get(reason) || 0) + 1);
    bySource.set(source, sEntry);

    const rs = reasonSources.get(reason) || new Map();
    rs.set(source, (rs.get(source) || 0) + 1);
    reasonSources.set(reason, rs);
  }

  const lossCount = losses.length;
  const share = (n) => (lossCount > 0 ? (n / lossCount) * 100 : 0);

  // Commonest first, then alphabetical — the same order the source list
  // beside them is ranked in, so all three columns read the same way.
  const ranked = (tally) => [...(tally || new Map()).entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const reasons = [...byReason.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      percent: share(count),
      sources: [...(reasonSources.get(reason) || new Map()).entries()]
        .map(([source, n]) => ({ source, count: n }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
      competitions: ranked(reasonCompetitions.get(reason)),
      bfoStatuses: ranked(reasonStatuses.get(reason)),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const sources = [...bySource.entries()]
    .map(([source, v]) => {
      const wins = winsBySource.get(source) || 0;
      const decided = wins + v.count;
      const ranked = [...v.reasons.entries()]
        .map(([reason, count]) => ({
          reason,
          count,
          percent: v.count > 0 ? (count / v.count) * 100 : 0,
          percentAll: share(count),
        }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
      return {
        source,
        losses: v.count,
        wins,
        // Close rate: share of that source's decided opps (Sold + Not
        // Sold) that were won, the same rule as By Source's Win Rate. This
        // page reports close rates only, never the loss-side mirror.
        closeRate: decided > 0 ? (wins / decided) * 100 : null,
        percent: share(v.count),
        reasons: ranked,
        topReason: ranked.length ? ranked[0] : null,
      };
    })
    .sort((a, b) => b.losses - a.losses || a.source.localeCompare(b.source));

  const rows = losses.slice().sort((a, b) => {
    const ta = a['Close Date'] ? Date.parse(a['Close Date']) : NaN;
    const tb = b['Close Date'] ? Date.parse(b['Close Date']) : NaN;
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });

  return { lossCount, winCount, undated, reasons, sources, rows, windowed };
}

/**
 * Every source-and-reason pair as a flat row, for the Excel export — the
 * expansion rows are on screen only, and a breakdown you can't take with you
 * is half a report.
 */
export function sourceReasonRows(sources) {
  const out = [];
  for (const s of sources || []) {
    for (const r of s.reasons) {
      out.push({
        Source: s.source,
        'Reason Not Sold': r.reason,
        Losses: r.count,
        '% of Source Losses': Number(r.percent.toFixed(1)),
        '% of All Losses': Number(r.percentAll.toFixed(1)),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trend over time
//
// The two tables above answer "why do we lose, and where" for one window.
// They can't say whether a reason is growing or fading, which is the
// question you actually act on. This buckets the same losses by the period
// they closed in, so each reason (or source) becomes a row of counts across
// quarters, months or years.
//
// A loss with no Close Date can't be put in a period at all, so it is always
// left out here and counted in `undated`, the same disclosure the tables
// make once a window is set.

export const TREND_OTHER = 'Other';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Year and 0-based month of a close, read off the digits for ISO strings so
// a 2026-01-01 close can't slip into December 2025 west of Greenwich.
function closeYearMonth(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]) - 1 };
  const ts = Date.parse(s);
  if (isNaN(ts)) return null;
  const d = new Date(ts);
  return { y: d.getFullYear(), m: d.getMonth() };
}

// A sortable key per period: "2026", "2026-Q1", "2026-03".
function periodKey(ym, period) {
  if (period === 'year') return String(ym.y);
  if (period === 'month') return `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`;
  return `${ym.y}-Q${Math.floor(ym.m / 3) + 1}`;
}

/** What a period key reads as on screen: "2026", "Q1 2026", "Mar 2026". */
export function periodLabel(key, period) {
  if (period === 'year') return key;
  if (period === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  const [y, q] = key.split('-');
  return `${q} ${y}`;
}

// Every period from the first key to the last, so a quarter with no losses
// shows as a zero rather than vanishing and making the line look smoother
// than it was.
export function periodRange(first, last, period) {
  if (!first) return [];
  const out = [];
  if (period === 'year') {
    for (let y = Number(first); y <= Number(last); y += 1) out.push(String(y));
    return out;
  }
  const step = period === 'month' ? 1 : 3;
  const toIdx = (k) => {
    const [y, rest] = k.split('-');
    const n = period === 'month' ? Number(rest) - 1 : (Number(rest.slice(1)) - 1) * 3;
    return Number(y) * 12 + n;
  };
  for (let i = toIdx(first); i <= toIdx(last); i += step) {
    out.push(periodKey({ y: Math.floor(i / 12), m: i % 12 }, period));
  }
  return out;
}

/**
 * Losses per period, broken out by reason or by source.
 *
 *   {
 *     periods: ['2025-Q1', ...],            // oldest first, gaps filled
 *     series:  [{ key, total, counts: { [period]: n } }],  // commonest first
 *     totals:  { [period]: { losses, wins, closeRate } },
 *     lossCount, undated,
 *   }
 *
 * Filters:
 *   from / to / years  the same close window the tables use
 *   sources            only opps from these sources (wins too, so the loss
 *                      rate is that slice's own)
 *   reasons            only losses filed under these reasons. Wins carry no
 *                      reason, so they stay in: the close rate then reads as
 *                      wins over (wins + losses to these reasons).
 *   hideReasons        losses filed under these reasons are taken out of
 *                      everything: series, totals and the close rate, as if
 *                      they had never been lost. For reading the picture
 *                      without the noise of, say, "Cancelled internally".
 *   topN               series past this many fold into "Other" so the chart
 *                      stays readable; 0 keeps them all
 */
// Where one record falls in the trend, under the given filters:
//   null                       not part of it (open, filtered out, outside window)
//   { stage, undated: true }   a loss that can't be placed, no Close Date
//   { stage, period }          counted in that period
// One rule for the chart and for the opps exported beside it, so the two
// can never disagree about which deals are in.
function trendPlacer({
  from = '', to = '', years = [], period = 'quarter',
  sources = [], reasons = [], hideReasons = [],
} = {}) {
  const fromTs = from ? Date.parse(from) : null;
  const toTs = to ? Date.parse(to) + 86399999 : null;
  const yearList = (years || []).map(Number).filter(Number.isFinite);
  const yearSet = yearList.length ? new Set(yearList) : null;
  const sourceSet = sources && sources.length ? new Set(sources) : null;
  const reasonSet = reasons && reasons.length ? new Set(reasons) : null;
  const hideSet = hideReasons && hideReasons.length ? new Set(hideReasons) : null;
  return (r) => {
    const stage = stageOf(r);
    if (stage !== NOT_SOLD && stage !== SOLD) return null;
    if (sourceSet && !sourceSet.has(sourceOf(r))) return null;
    if (stage === NOT_SOLD && reasonSet && !reasonSet.has(reasonOf(r))) return null;
    if (stage === NOT_SOLD && hideSet && hideSet.has(reasonOf(r))) return null;
    const within = inWindow(r, fromTs, toTs, yearSet);
    if (within === false) return null;
    const ym = within === null ? null : closeYearMonth(r['Close Date']);
    if (!ym) return { stage, undated: true };
    return { stage, period: periodKey(ym, period) };
  };
}

export function notSoldTrend(records, opts = {}) {
  const { period = 'quarter', groupBy = 'reason', topN = 0 } = opts;
  const place = trendPlacer(opts);
  const keyOf = groupBy === 'source' ? sourceOf : reasonOf;

  const bySeries = new Map();
  const totals = new Map();
  const seen = [];
  let lossCount = 0;
  let undated = 0;
  const bump = (p) => {
    if (!totals.has(p)) { totals.set(p, { losses: 0, wins: 0 }); seen.push(p); }
    return totals.get(p);
  };

  for (const r of records || []) {
    const at = place(r);
    if (!at) continue;
    if (at.undated) { if (at.stage === NOT_SOLD) undated += 1; continue; }
    const { stage, period: p } = at;
    const t = bump(p);
    if (stage === SOLD) { t.wins += 1; continue; }
    t.losses += 1;
    lossCount += 1;
    const k = keyOf(r);
    const s = bySeries.get(k) || { key: k, total: 0, counts: {} };
    s.total += 1;
    s.counts[p] = (s.counts[p] || 0) + 1;
    bySeries.set(k, s);
  }

  seen.sort();
  const periods = periodRange(seen[0], seen[seen.length - 1], period);

  let series = [...bySeries.values()]
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  if (topN > 0 && series.length > topN) {
    const kept = series.slice(0, topN);
    const other = { key: TREND_OTHER, total: 0, counts: {}, folded: [] };
    for (const s of series.slice(topN)) {
      other.total += s.total;
      other.folded.push(s.key);
      for (const [p, n] of Object.entries(s.counts)) other.counts[p] = (other.counts[p] || 0) + n;
    }
    series = [...kept, other];
  }

  const totalsOut = {};
  for (const p of periods) {
    const t = totals.get(p) || { losses: 0, wins: 0 };
    const decided = t.losses + t.wins;
    totalsOut[p] = { ...t, closeRate: decided > 0 ? (t.wins / decided) * 100 : null };
  }

  return { periods, series, totals: totalsOut, lossCount, undated };
}

/** Every distinct reason and source among the losses, for the filter pickers. */
export function notSoldFacets(records) {
  const reasons = new Set();
  const sources = new Set();
  for (const r of records || []) {
    if (stageOf(r) !== NOT_SOLD) continue;
    reasons.add(reasonOf(r));
    sources.add(sourceOf(r));
  }
  const sort = (s) => [...s].sort((a, b) => a.localeCompare(b));
  return { reasons: sort(reasons), sources: sort(sources) };
}

/** The period a loss closed in, for drilling a chart bar down to its opps. */
export function closePeriodOf(r, period) {
  const ym = closeYearMonth(r?.['Close Date']);
  return ym ? periodKey(ym, period) : null;
}

/**
 * The chart as a sheet: one row per period, one column per series showing,
 * then the period's totals. What you export is what the bars say, so
 * series switched off in the legend are left out, and in "% of losses" mode
 * the series cells are shares rather than counts.
 */
export function trendChartRows(trend, { period = 'quarter', mode = 'count', hiddenSeries = [] } = {}) {
  const hidden = new Set(hiddenSeries || []);
  const shown = (trend?.series || []).filter(s => !hidden.has(s.key));
  return (trend?.periods || []).map((p) => {
    const t = trend.totals[p];
    const row = { Period: periodLabel(p, period) };
    for (const s of shown) {
      const n = s.counts[p] || 0;
      row[s.key] = mode === 'percent'
        ? Number((t.losses > 0 ? (n / t.losses) * 100 : 0).toFixed(1))
        : n;
    }
    row['Total losses'] = t.losses;
    row['Won (Sold)'] = t.wins;
    row['Close rate %'] = t.closeRate == null ? '' : Number(t.closeRate.toFixed(1));
    return row;
  });
}

// ---------------------------------------------------------------------------
// Saved views
//
// A view is everything on the Trend screen that decides what the chart
// shows, saved under a name so it is one click to get back. Stored in the
// user's settings (settings.notSoldTrendViews) so it follows them to their
// other machine.

export const TREND_VIEWS_KEY = 'notSoldTrendViews';

const VIEW_FIELDS = {
  groupBy: ['reason', 'source'],
  period: ['month', 'quarter', 'year'],
  mode: ['count', 'percent'],
};
const VIEW_LISTS = ['sources', 'reasons', 'hideReasons', 'hiddenSeries', 'years'];

/** A view's state with anything missing or malformed set to its default. */
export function normaliseTrendState(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const out = {
    groupBy: VIEW_FIELDS.groupBy.includes(v.groupBy) ? v.groupBy : 'reason',
    period: VIEW_FIELDS.period.includes(v.period) ? v.period : 'quarter',
    mode: VIEW_FIELDS.mode.includes(v.mode) ? v.mode : 'count',
    from: typeof v.from === 'string' ? v.from : '',
    to: typeof v.to === 'string' ? v.to : '',
  };
  for (const k of VIEW_LISTS) {
    const list = Array.isArray(v[k]) ? v[k] : [];
    out[k] = k === 'years'
      ? list.map(Number).filter(Number.isFinite).sort((a, b) => b - a)
      : [...new Set(list.filter(x => typeof x === 'string'))].sort((a, b) => a.localeCompare(b));
  }
  return out;
}

/** The saved views list, cleaned: bad entries dropped, oldest first. */
export function sanitizeTrendViews(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(v => v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string' && v.name.trim())
    .map(v => ({ id: v.id, name: v.name.trim(), createdAt: Number(v.createdAt) || 0, state: normaliseTrendState(v.state) }));
}

/**
 * Save the current state under a name. Saving over an existing name
 * (ignoring case) replaces that view rather than making a second chip with
 * the same label.
 */
export function saveTrendView(views, { name, state, now = Date.now(), id } = {}) {
  const clean = String(name || '').trim();
  if (!clean) return sanitizeTrendViews(views);
  const list = sanitizeTrendViews(views);
  const existing = list.find(v => v.name.toLowerCase() === clean.toLowerCase());
  const entry = {
    id: existing?.id || id || `v${now.toString(36)}`,
    name: clean,
    createdAt: existing?.createdAt || now,
    state: normaliseTrendState(state),
  };
  return existing ? list.map(v => (v.id === existing.id ? entry : v)) : [...list, entry];
}

export function deleteTrendView(views, id) {
  return sanitizeTrendViews(views).filter(v => v.id !== id);
}

/** Is the screen showing exactly this view right now? Lights up its chip. */
export function trendViewMatches(view, state) {
  if (!view) return false;
  return JSON.stringify(normaliseTrendState(view.state)) === JSON.stringify(normaliseTrendState(state));
}

/**
 * The opps behind the trend, one row each, for the export's details sheet:
 * every loss AND every win the chart counted (wins are the other half of
 * the close rate), under exactly the filters on screen. A loss with no Close
 * Date is listed too, marked as not counted, since the screen says it was
 * left out and the file should be able to show which ones.
 *
 * `series` is the bar segment the opp sits in; a loss folded into Other
 * says so. `hiddenSeries` (legend-hidden) marks rows the chart isn't
 * drawing but that still count toward the totals.
 */
export function trendDetailRows(records, opts = {}) {
  const { period = 'quarter', groupBy = 'reason', topN = 0, hiddenSeries = [] } = opts;
  const place = trendPlacer(opts);
  const keyOf = groupBy === 'source' ? sourceOf : reasonOf;
  const trend = notSoldTrend(records, opts);
  const named = new Set(trend.series.filter(s => s.key !== TREND_OTHER).map(s => s.key));
  const folded = topN > 0 && trend.series.some(s => s.key === TREND_OTHER);
  const hidden = new Set(hiddenSeries || []);
  const out = [];
  for (const r of records || []) {
    const at = place(r);
    if (!at) continue;
    const lost = at.stage === NOT_SOLD;
    const key = keyOf(r);
    const series = !lost ? '' : (named.has(key) || !folded ? key : TREND_OTHER);
    let counted = 'Yes';
    if (at.undated) counted = 'No, no Close Date';
    else if (lost && hidden.has(series)) counted = 'In totals, hidden on chart';
    out.push({
      Account: r['Account'] || '',
      Stage: at.stage,
      'Close Date': r['Close Date'] || '',
      Period: at.period ? periodLabel(at.period, period) : '',
      Source: sourceOf(r),
      'Reason Not Sold': lost ? reasonOf(r) : '',
      'Chart Series': series,
      'BFO Status': lost ? bfoStatusOf(r) : '',
      Competition: r['Competition'] || '',
      Scope: r['Scope'] || '',
      'Quoted Amount': r['Quoted Amount'] || '',
      'Start Date': r['Start Date'] || '',
      Contact: r['Contact'] || '',
      'Sales Partner': r['Sales Partner'] || '',
      'PE Owner': r['PE Owner'] || '',
      'BFO Link': r['BFO Link'] || '',
      Counted: counted,
      _sort: at.period || '',
    });
  }
  // Oldest period first like the chart, losses before wins inside a
  // period, then by account.
  out.sort((a, b) => (a._sort === b._sort ? 0 : !a._sort ? 1 : !b._sort ? -1 : a._sort < b._sort ? -1 : 1)
    || (a.Stage === b.Stage ? 0 : a.Stage === NOT_SOLD ? -1 : 1)
    || String(a.Account).localeCompare(String(b.Account)));
  return out.map((row) => { const copy = { ...row }; delete copy._sort; return copy; });
}

// ---------------------------------------------------------------------------
// Close rate by source over time
//
// The other side of the same deals: of the opps from each source that were
// decided in a period (Sold + Not Sold, by Close Date), how many were won.
// Same rule as By Source's Win Rate, bucketed by close period so you can see
// whether a source is getting better or worse.

/**
 *   {
 *     periods: [...],                               // oldest first, gaps filled
 *     series:  [{ key, wins, decided, rate,
 *                 byPeriod: { [p]: { wins, decided, rate } } }],  // most decided first
 *     overall: { [p]: { wins, decided, rate } },    // every source shown, together
 *     wins, decided, rate,                          // the whole window
 *     undated,                                      // decided opps with no Close Date
 *   }
 *
 * `rate` is null where nothing was decided, so a chart can leave a gap
 * rather than draw a misleading 0%. Past `topN` sources the rest fold into
 * "Other" (their wins and decided summed, then the rate taken).
 */
export function closeRateTrend(records, opts = {}) {
  const { period = 'quarter', topN = 0 } = opts;
  // Reasons only describe losses; a close rate needs both sides untouched.
  const place = trendPlacer({ ...opts, reasons: [], hideReasons: [] });
  const rate = (w, d) => (d > 0 ? (w / d) * 100 : null);
  const bySource = new Map();
  const overall = new Map();
  const seen = new Set();
  // The opps behind the figures, for the export's Details sheet.
  const opps = [];
  let undated = 0;
  const add = (map, k, won) => {
    const c = map.get(k) || { wins: 0, decided: 0 };
    c.decided += 1;
    if (won) c.wins += 1;
    map.set(k, c);
  };
  for (const r of records || []) {
    const at = place(r);
    if (!at) continue;
    if (at.undated) { undated += 1; continue; }
    const won = at.stage === SOLD;
    const src = sourceOf(r);
    opps.push({ r, period: at.period, won, counted: [src] });
    seen.add(at.period);
    add(overall, at.period, won);
    const s = bySource.get(src) || { key: src, wins: 0, decided: 0, cells: new Map() };
    s.decided += 1;
    if (won) s.wins += 1;
    add(s.cells, at.period, won);
    bySource.set(src, s);
  }
  const sorted = [...seen].sort();
  const periods = periodRange(sorted[0], sorted[sorted.length - 1], period);

  let list = [...bySource.values()].sort((a, b) => b.decided - a.decided || a.key.localeCompare(b.key));
  if (topN > 0 && list.length > topN) {
    const other = { key: TREND_OTHER, wins: 0, decided: 0, cells: new Map(), folded: [] };
    for (const s of list.slice(topN)) {
      other.wins += s.wins;
      other.decided += s.decided;
      other.folded.push(s.key);
      for (const [p, c] of s.cells) {
        const o = other.cells.get(p) || { wins: 0, decided: 0 };
        o.wins += c.wins; o.decided += c.decided;
        other.cells.set(p, o);
      }
    }
    list = [...list.slice(0, topN), other];
  }
  const cellsOut = (cells) => {
    const out = {};
    for (const p of periods) {
      const c = cells.get(p) || { wins: 0, decided: 0 };
      out[p] = { wins: c.wins, decided: c.decided, rate: rate(c.wins, c.decided) };
    }
    return out;
  };
  const series = list.map(s => ({
    key: s.key, wins: s.wins, decided: s.decided, rate: rate(s.wins, s.decided),
    byPeriod: cellsOut(s.cells), ...(s.folded ? { folded: s.folded } : {}),
  }));
  let wins = 0; let decided = 0;
  for (const c of overall.values()) { wins += c.wins; decided += c.decided; }
  return { periods, series, overall: cellsOut(overall), wins, decided, rate: rate(wins, decided), undated, opps };
}

/** The close-rate chart as a sheet: a row per period, a rate column per source shown. */
export function closeRateChartRows(cr, { period = 'quarter', hiddenSeries = [] } = {}) {
  const hidden = new Set(hiddenSeries || []);
  const shown = (cr?.series || []).filter(s => !hidden.has(s.key));
  const r1 = (v) => (v == null ? '' : Number(v.toFixed(1)));
  return (cr?.periods || []).map((p) => {
    const row = { Period: periodLabel(p, period) };
    for (const s of shown) {
      const c = s.byPeriod[p];
      row[`${s.key} close rate %`] = r1(c.rate);
      row[`${s.key} won`] = c.wins;
      row[`${s.key} decided`] = c.decided;
    }
    const o = cr.overall[p];
    row['Overall close rate %'] = r1(o.rate);
    row['Overall won'] = o.wins;
    row['Overall decided'] = o.decided;
    return row;
  });
}
