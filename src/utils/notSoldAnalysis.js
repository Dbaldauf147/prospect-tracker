// The roll-ups behind Opps › Not Sold Analysis.
//
// The By Source tab answers "where do leads come from and how do they
// convert". Losing is a different question — which reasons keep coming up,
// which sources they cluster in, and what the losses were worth — and it was
// only ever a single column on that table. This is the same close-reason data
// read the other way round: reason first, then source.
//
// The window is a CLOSE DATE range, not a start date range. "Losses in Q3"
// means deals lost in Q3, whenever they opened; filtering the other way would
// answer a question nobody asks of a loss report. Opps with no Close Date are
// counted while no range is set and reported as excluded once one is, rather
// than being silently dropped or silently kept.
//
// Pure — records in, plain rows out — so scripts/notSoldAnalysis.test.mjs can
// exercise it without React.

import { parseMoney, closeReasonOf } from './oppsMetrics.js';

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

/** The Quoted Amount as a number, or null. Zero counts as "not quoted". */
export function quotedOf(r) {
  const n = parseMoney(r?.['Quoted Amount']);
  return n != null && n > 0 ? n : null;
}

// Does this opp's Close Date fall in the window? Returns null when it has no
// usable Close Date, so the caller can tell "outside the range" from "can't
// say" — the two want different treatment.
function inCloseWindow(r, fromTs, toTs) {
  const raw = r?.['Close Date'];
  const ts = raw ? Date.parse(raw) : NaN;
  if (isNaN(ts)) return null;
  if (fromTs != null && ts < fromTs) return false;
  if (toTs != null && ts > toTs) return false;
  return true;
}

function rank(tally) {
  return [...tally.entries()]
    .map(([reason, v]) => ({ reason, count: v.count, lost: v.lost }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * Everything the Not Sold Analysis tab shows, from one pass over the records.
 *
 *   {
 *     lossCount, winCount, lostValue, quotedLosses,
 *     undated,        // losses left out because they carry no Close Date
 *     reasons: [{ reason, count, percent, lost, sources: [{ source, count }] }],
 *     sources: [{ source, losses, wins, lossRate, percent, lost,
 *                 reasons, topReason }],
 *     rows,           // the Not Sold opps themselves, newest close first
 *   }
 *
 * `percent` is always a share of the losses in the window, so the reason
 * table and the source table are read against the same denominator.
 */
export function notSoldBreakdown(records, { from = '', to = '' } = {}) {
  const fromTs = from ? Date.parse(from) : null;
  const toTs = to ? Date.parse(to) + 86399999 : null;
  const ranged = fromTs != null || toTs != null;

  const losses = [];
  let winCount = 0;
  let undated = 0;
  const winsBySource = new Map();

  for (const r of records || []) {
    const stage = stageOf(r);
    if (stage !== NOT_SOLD && stage !== SOLD) continue;
    const within = inCloseWindow(r, fromTs, toTs);
    // No Close Date: kept while the report is unbounded, since it's still a
    // loss that happened; excluded once a range is set, because there's no
    // way to say whether it belongs in it.
    if (within === false) continue;
    if (within === null && ranged) {
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

  let lostValue = 0;
  let quotedLosses = 0;
  const byReason = new Map();
  const bySource = new Map();
  // Which sources each reason shows up in, so a reason row can say where it
  // is concentrated without a second pass.
  const reasonSources = new Map();

  for (const r of losses) {
    const amt = quotedOf(r);
    if (amt != null) { lostValue += amt; quotedLosses += 1; }
    const reason = reasonOf(r);
    const source = sourceOf(r);

    const rEntry = byReason.get(reason) || { count: 0, lost: 0 };
    rEntry.count += 1;
    rEntry.lost += amt || 0;
    byReason.set(reason, rEntry);

    const sEntry = bySource.get(source) || { count: 0, lost: 0, reasons: new Map() };
    sEntry.count += 1;
    sEntry.lost += amt || 0;
    const sr = sEntry.reasons.get(reason) || { count: 0, lost: 0 };
    sr.count += 1;
    sr.lost += amt || 0;
    sEntry.reasons.set(reason, sr);
    bySource.set(source, sEntry);

    const rs = reasonSources.get(reason) || new Map();
    rs.set(source, (rs.get(source) || 0) + 1);
    reasonSources.set(reason, rs);
  }

  const lossCount = losses.length;
  const share = (n) => (lossCount > 0 ? (n / lossCount) * 100 : 0);

  const reasons = [...byReason.entries()]
    .map(([reason, v]) => ({
      reason,
      count: v.count,
      percent: share(v.count),
      lost: v.lost,
      sources: [...(reasonSources.get(reason) || new Map()).entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const sources = [...bySource.entries()]
    .map(([source, v]) => {
      const wins = winsBySource.get(source) || 0;
      const decided = wins + v.count;
      const ranked = rank(v.reasons);
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
        lost: v.lost,
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

  return { lossCount, winCount, lostValue, quotedLosses, undated, reasons, sources, rows };
}
