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
 *     reasons: [{ reason, count, percent, sources: [{ source, count }] }],
 *     sources: [{ source, losses, wins, lossRate, percent,
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

  for (const r of losses) {
    const reason = reasonOf(r);
    const source = sourceOf(r);

    byReason.set(reason, (byReason.get(reason) || 0) + 1);

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

  const reasons = [...byReason.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      percent: share(count),
      sources: [...(reasonSources.get(reason) || new Map()).entries()]
        .map(([source, n]) => ({ source, count: n }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
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
        // Share of that source's decided opps that were lost. Null when
        // nothing has closed, which can't happen here — a source only
        // appears because it lost something — but kept for the same shape
        // the win-rate column uses.
        lossRate: decided > 0 ? (v.count / decided) * 100 : null,
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
