// The quarterly Close Rates email: the Opps > Close Rates tab's tables,
// rebuilt from the Opps records for the quarter that has just ended.
//
// Pure, so it loads in the serverless function (api/close-rates-quarterly.js)
// and in scripts/closeRatesQuarterly.test.mjs unchanged. It calls the same
// functions the tab does (utils/closeRateDeepDive and friends) with the
// same defaults, rather than restating any of the arithmetic, so the email
// and the tab cannot come to different answers.
//
// What it follows from the tab:
//   - the starred saved filter, when there is one (period, date basis,
//     window, Lead stage or higher, no pull-throughs); otherwise the tab's
//     own opening state: Quarter, "Since Jan, 2 yrs ago", both filters on
//   - the services hidden on By Service, and the service groups when on
//   - the Weekly email table's month count (settings.closeRateWeeklyMonths)
//
// What it changes: the window always stops at the last day of the quarter
// that just ended, so the email never carries a quarter one day old, and
// rolling windows are read from the first day of the new quarter.

import {
  applyCloseRateFilters, byDateBasis, stageCloseRateTrend, closedOppSheetRows,
} from './closeRateDeepDive.js';
import { closeRateTrend } from './notSoldAnalysis.js';
import { serviceCloseRateTrend } from './serviceTrends.js';
import { closeRateTrendByStage, emailCloseRateTrend } from './pipelineFunnelData.js';
import { groupsFromSettings } from './serviceTrendSettings.js';
import { readSavedFilters, filtersFromEntry } from './closeRateSavedFilters.js';
import { WINDOW_PRESETS, presetFrom, cleanWeeklyMonths } from './closeRateWindows.js';

const pad2 = (n) => String(n).padStart(2, '0');
const isoUTC = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
};

/**
 * The most recently completed calendar quarter, as of `nowMs` (UTC dates;
 * the job runs on the 1st, when UTC and US time agree on the month).
 * { key: '2026-Q3', label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30',
 *   nextStart: '2026-10-01' }
 */
export function lastCompletedQuarter(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3); // 0-3, the quarter we're in
  const py = q === 0 ? y - 1 : y;
  const pq = q === 0 ? 3 : q - 1;
  return {
    key: `${py}-Q${pq + 1}`,
    label: `Q${pq + 1} ${py}`,
    start: isoUTC(py, pq * 3, 1),
    end: isoUTC(py, pq * 3 + 3, 0),
    nextStart: isoUTC(y, q * 3, 1),
  };
}

// The quarter before a 'YYYY-Qn' key, and the same quarter a year back.
const shiftQuarter = (key, by) => {
  const [y, q] = key.split('-Q').map(Number);
  const i = y * 4 + (q - 1) + by;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
};

/** The tab's filters as the email reads them (see the header). */
export function emailFilters(settings, quarter) {
  // Noon on the new quarter's first day, so a local-time reading of it
  // lands on the same date in any US zone.
  const [ny, nm, nd] = quarter.nextStart.split('-').map(Number);
  const ref = new Date(ny, nm - 1, nd, 12);
  const presets = WINDOW_PRESETS.map(p => ({ ...p, from: () => presetFrom(p.key, ref) }));
  const saved = readSavedFilters(settings);
  const starred = saved.list.find(e => e.id === saved.defaultId) || null;
  const base = starred
    ? filtersFromEntry(starred, presets)
    : { period: 'quarter', dateBasis: 'close', preset: '2y', from: presetFrom('2y', ref), to: '', leadOrHigher: true, noPullThroughs: true };
  const to = base.to && base.to < quarter.end ? base.to : quarter.end;
  return {
    ...base,
    to,
    savedName: starred ? String(starred.name || '').trim() : '',
    presetLabel: WINDOW_PRESETS.find(p => p.key === base.preset)?.label || '',
  };
}

const cellOf = (trend, key) => {
  const c = trend?.overall?.[key];
  return c && c.decided ? { rate: c.rate, wins: c.wins, decided: c.decided } : null;
};

/**
 * Everything the email shows, from the Opps records and the owner's
 * settings. `nowMs` is the send time; the report covers the quarter before.
 */
export function buildCloseRatesQuarterly(records, settings = {}, { nowMs = Date.now() } = {}) {
  const quarter = lastCompletedQuarter(nowMs);
  const f = emailFilters(settings || {}, quarter);
  const filtered = applyCloseRateFilters(records || [], { leadOrHigher: f.leadOrHigher, noPullThroughs: f.noPullThroughs });
  const counted = byDateBasis(filtered.records, f.dateBasis);
  const window = { period: f.period, from: f.from, to: f.to };

  const hidden = Array.isArray(settings?.oppsHiddenServices) ? settings.oppsHiddenServices : [];
  const savedGroups = groupsFromSettings(settings);
  const groups = savedGroups.on && savedGroups.groups.length > 0 ? savedGroups.groups : [];

  const bySource = closeRateTrend(counted, window);
  const byService = serviceCloseRateTrend(counted, { ...window, hidden, groups });
  const byStage = stageCloseRateTrend(counted, { ...window, includePullThroughs: !f.noPullThroughs });

  // The Weekly email table, its months ending with the quarter's last.
  const weeklyMonths = cleanWeeklyMonths(settings?.closeRateWeeklyMonths);
  const [ey, em, ed] = quarter.end.split('-').map(Number);
  const weeklyRaw = closeRateTrendByStage(counted, { months: weeklyMonths, nowMs: new Date(ey, em - 1, ed, 12).getTime() });
  const weekly = emailCloseRateTrend(weeklyRaw);

  // The headline: the quarter that ended, against the one before and the
  // same quarter last year, from a quarterly run over the whole book so
  // the comparisons exist whatever window the tab is on.
  const quarterly = closeRateTrend(counted, { period: 'quarter', from: '', to: f.to });
  const headline = {
    quarter: cellOf(quarterly, quarter.key),
    prior: cellOf(quarterly, shiftQuarter(quarter.key, -1)),
    priorKey: shiftQuarter(quarter.key, -1),
    yearAgo: cellOf(quarterly, shiftQuarter(quarter.key, -4)),
    yearAgoKey: shiftQuarter(quarter.key, -4),
    window: bySource.decided ? { rate: bySource.rate, wins: bySource.wins, decided: bySource.decided } : null,
  };

  // The raw data: every closed opp the window's figures were built from,
  // newest first - the tab's "Closed opps" export sheet.
  const opps = closedOppSheetRows(counted, { ...window, includePullThroughs: !f.noPullThroughs });

  return {
    quarter,
    filters: f,
    counts: { belowLead: filtered.belowLead, unknownStage: filtered.unknownStage, pullThroughs: filtered.pullThroughs },
    headline,
    weekly,
    weeklyRaw,
    weeklyMonths,
    bySource,
    byService,
    byStage,
    opps,
  };
}
