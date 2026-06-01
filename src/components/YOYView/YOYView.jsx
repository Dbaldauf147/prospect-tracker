// YOY tab — recreates the Leads / Quoted Projections / Close Rate
// summary charts off the Opps tab data cached in IndexedDB.

import { useEffect, useMemo, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList, Cell,
} from 'recharts';
import { dbGet } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadCommissions } from '../../utils/commissionsStore';
import { loadDealsList } from '../../utils/dealsStore';
import { indexCommissionsByBfo, normBfo, DEAL_BFO_KEY } from '../../utils/dealCommissions';
import { loadQuotedProjections, saveQuotedProjections, QUOTED_FIELDS } from '../../utils/quotedProjectionsStore';
import styles from './YOYView.module.css';

const PIPELINE_STORE = 'pipeline-dashboard';
const PIPELINE_KEY = 'current';
const BFO_ACTIVITY_STORE = 'bfo-activity';
const BFO_ACTIVITY_KEY = 'current';
const DEFAULT_ANNUAL_TARGET = 1325000;

function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseYear(v) {
  const n = Number(String(v ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Quoted Projections runs on a Dec-to-Nov fiscal year, starting in
// December of the previous calendar year and ending in November of the
// current calendar year. Returns 12 buckets each { label, year,
// monthIdx, key } so a Close Date can be looked up in O(1).
function fiscalMonths(currentYear) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (11 + i) % 12; // 11 = Dec, 0 = Jan, …, 10 = Nov
    const year = i === 0 ? currentYear - 1 : currentYear;
    months.push({
      label: MONTH_LABELS[monthIdx],
      year,
      monthIdx,
      key: `${year}-${monthIdx}`,
    });
  }
  return months;
}

// Status values that mean the opp got priced. Used as the Quoted+
// filter for Quoted C/R denominator.
const QUOTED_PLUS_STATUSES = new Set([
  'Quoted', 'Contracting', 'Agreement Sent', 'Sold', 'Not Sold',
]);

function isQuotedPlus(record) {
  const status = String(record.Status || '').trim();
  if (QUOTED_PLUS_STATUSES.has(status)) return true;
  const amt = parseMoney(record['Quoted Amount']);
  return typeof amt === 'number' && amt > 0;
}

// Annualization factor for "Projected" lead bar — scale YTD count up
// to a full year based on fraction of the year elapsed.
function yearElapsedFraction(year) {
  const now = new Date();
  if (year !== now.getFullYear()) return 1;
  const start = new Date(year, 0, 1).getTime();
  const elapsedMs = now.getTime() - start;
  const yearMs = (new Date(year + 1, 0, 1).getTime() - start);
  const frac = elapsedMs / yearMs;
  return Math.max(1 / 366, Math.min(1, frac));
}

function fmtMoneyShort(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}`;
  return `$${Math.round(n)}`;
}

function fmtMoneyFull(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// Quoted Projections values are stored in thousands of dollars ($K), so
// e.g. 757 → "$757K" and 4061 → "$4.06M".
function fmtKLabel(v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}M`;
  return `$${Math.round(v).toLocaleString('en-US')}K`;
}

// To keep the explanation from ever covering the bars/points being
// reviewed, the hover content is rendered into a single docked panel
// (sticky strip at the top of the YOY body) instead of floating over
// the plot. This context carries a ref to that panel down to the
// per-chart tooltips; CalcTooltip portals its content into it. Only one
// chart is hovered at a time, so a shared panel is enough.
const CalcPanelContext = createContext(null);

// Recharts still owns the cursor highlight, but we suppress its floating
// box by portaling the content away — keep its wrapper from reserving
// space or eating pointer events just in case the portal target is
// missing (then it falls back to a small floating box).
const TOOLTIP_WRAPPER_STYLE = { pointerEvents: 'none', zIndex: 30 };

export function YOYView() {
  const [opps, setOpps] = useState(null);
  const [bfoActivity, setBfoActivity] = useState(null);
  const [target, setTarget] = useState(DEFAULT_ANNUAL_TARGET);
  const [commissions, setCommissions] = useState(() => loadCommissions().data);
  const [deals, setDeals] = useState(() => loadDealsList().data);
  // Quoted Projections is now a user-maintained table of month-end values
  // (seeded with the supplied Dec–May history) rather than a live compute.
  const [quotedTable, setQuotedTable] = useState(loadQuotedProjections);
  const updateQuotedTable = (next) => { setQuotedTable(next); saveQuotedProjections(next); };
  useEffect(() => {
    function onStorage(e) {
      if (!e || e.key === 'commissions-list-override') {
        setCommissions(loadCommissions().data);
      }
      if (!e || e.key === 'deals-list-override') {
        setDeals(loadDealsList().data);
      }
    }
    function onFocus() {
      setCommissions(loadCommissions().data);
      setDeals(loadDealsList().data);
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const oppsSaved = await loadOppsFromCache();
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
      } catch (e) {
        console.warn('YOY opps hydrate failed', e);
      }
      try {
        const pipe = await dbGet(PIPELINE_STORE, PIPELINE_KEY);
        if (!cancelled && pipe && Number.isFinite(Number(pipe.target))) {
          setTarget(Number(pipe.target));
        }
      } catch {
        // Pipeline target falls back to DEFAULT_ANNUAL_TARGET — no-op.
      }
      try {
        const bfo = await dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY);
        if (!cancelled && bfo) setBfoActivity(bfo);
      } catch {
        // BFO Pipe Total falls back to blank when no activity is cached.
      }
    })();
    function onFocus() {
      loadOppsFromCache().then(o => setOpps(o || null)).catch(() => {});
      dbGet(PIPELINE_STORE, PIPELINE_KEY).then(p => {
        if (p && Number.isFinite(Number(p.target))) setTarget(Number(p.target));
      }).catch(() => {});
      dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY).then(b => { if (b) setBfoActivity(b); }).catch(() => {});
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const records = useMemo(() => (opps && Array.isArray(opps.records)) ? opps.records : [], [opps]);

  const currentYear = new Date().getFullYear();

  // Leads — count of opps by Open Year. Bars go from earliest non-empty
  // year through the current year, then a separate "Projected" bar that
  // annualizes the current year's YTD count.
  const leadsData = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      byYear.set(y, (byYear.get(y) || 0) + 1);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      rows.push({ year: String(y), count: byYear.get(y) || 0, isProjected: false });
    }
    const ytdCount = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdCount / frac) : ytdCount;
    // _ytd / _frac feed the hover tooltip so the Projected bar can show
    // its annualization (YTD count ÷ fraction of year elapsed).
    rows.push({ year: 'Projected', count: projected, isProjected: true, _ytd: ytdCount, _frac: frac });
    return rows;
  }, [records, currentYear]);

  // Live snapshot for the current calendar month, in $K. The Chance
  // buckets and Agreements Sent sum each open Opps 2 opp's current Quoted
  // Amount; BFO Pipe Total sums the Amount column on the BFO Activity
  // tab. Closed opps (Sold / Not Sold / Duplicate) are excluded from the
  // Chance buckets since they're no longer current pipeline. This fills
  // the current month automatically so it isn't blank until recorded — a
  // manual entry for that month still wins (see quotedData below).
  const liveQuoted = useMemo(() => {
    const CLOSED = new Set(['Sold', 'Not Sold', 'Duplicate Opp']);
    let weak = 0, ok = 0, expected = 0, agreements = 0;
    for (const r of records) {
      const amt = parseMoney(r['Quoted Amount']);
      if (typeof amt !== 'number' || amt <= 0) continue;
      const status = String(r.Status || '').trim();
      if (status === 'Agreement Sent') agreements += amt;
      if (CLOSED.has(status)) continue;
      const chance = String(r['Chance?'] || r['Chance'] || '').trim().toLowerCase();
      if (chance === 'weak') weak += amt;
      else if (chance === 'ok') ok += amt;
      else if (chance === 'expected') expected += amt;
    }
    let bfoPipe = 0;
    const headers = bfoActivity?.headers || [];
    const amountKey = headers.find(h => /^amount$/i.test(String(h).trim()));
    if (amountKey) {
      for (const row of (bfoActivity?.rows || [])) {
        const a = parseMoney(row[amountKey]);
        if (typeof a === 'number' && a > 0) bfoPipe += a;
      }
    }
    const k = (n) => (n > 0 ? Math.round(n / 1000) : null); // dollars → $K
    return { weak: k(weak), ok: k(ok), expected: k(expected), agreements: k(agreements), bfoPipe: k(bfoPipe) };
  }, [records, bfoActivity]);

  // Quoted Projections — month-end snapshots the user records (editable
  // via "Edit values"), plotted across the Dec→Nov fiscal year. Values
  // are in $K: weak/ok/expected are the quoted-$ Chance buckets,
  // agreements is Agreements Sent, and bfoPipe is the total BFO pipeline
  // $ (its own right-hand axis since it runs larger). The current month
  // auto-fills from the live snapshot above when nothing's recorded yet;
  // other unrecorded months stay null so the lines break rather than zero.
  const quotedData = useMemo(() => {
    const num = (x) => {
      if (x === '' || x == null) return null;
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    const now = new Date();
    const liveMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return fiscalMonths(currentYear).map((m) => {
      const key = `${m.year}-${String(m.monthIdx + 1).padStart(2, '0')}`;
      const manual = quotedTable[key] || null;
      const live = (!manual && key === liveMonthKey) ? liveQuoted : null;
      const src = manual || live;
      const weak = src ? num(src.weak) : null;
      const ok = src ? num(src.ok) : null;
      const expected = src ? num(src.expected) : null;
      const agreements = src ? num(src.agreements) : null;
      const bfoPipe = src ? num(src.bfoPipe) : null;
      const _hasData = [weak, ok, expected, agreements, bfoPipe].some(x => x != null);
      const _live = !!live && _hasData;
      return { month: m.label, year: m.year, monthKey: key, weak, ok, expected, agreements, bfoPipe, _hasData, _live };
    });
  }, [quotedTable, currentYear, liveQuoted]);

  // Close Rate — stacked bar of In Progress / Sold / Not Sold per Open
  // Year (percentages summing to 100), plus two C/R lines.
  const closeRateData = useMemo(() => {
    if (records.length === 0) return [];
    // Group records by year.
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const list = byYear.get(y) || [];
      let sold = 0, notSold = 0, inProgress = 0, quotedNotSold = 0;
      for (const r of list) {
        const stage = String(r.Stage || '').trim();
        if (stage === 'Sold') sold += 1;
        else if (stage === 'Not Sold') {
          notSold += 1;
          if (isQuotedPlus(r)) quotedNotSold += 1;
        } else {
          inProgress += 1;
        }
      }
      const total = sold + notSold + inProgress;
      // Total C/R — every Sold/Not Sold opp counts.
      const totalCR = (sold + notSold) > 0 ? (sold / (sold + notSold)) * 100 : null;
      // Quoted C/R — Not Sold restricted to opps that actually reached
      // Quoted+ (priced). Sold opps are Quoted+ by definition.
      const quotedDenom = sold + quotedNotSold;
      const quotedCR = quotedDenom > 0 ? (sold / quotedDenom) * 100 : null;
      rows.push({
        year: String(y),
        totalNotSold: total > 0 ? +((notSold / total) * 100).toFixed(2) : 0,
        totalSold: total > 0 ? +((sold / total) * 100).toFixed(2) : 0,
        inProgress: total > 0 ? +((inProgress / total) * 100).toFixed(2) : 0,
        totalCR: totalCR == null ? null : +totalCR.toFixed(2),
        quotedCR: quotedCR == null ? null : +quotedCR.toFixed(2),
        // Raw counts behind the percentages / C/R lines, surfaced in the
        // hover tooltip so each year's math can be audited.
        _sold: sold,
        _notSold: notSold,
        _inProgress: inProgress,
        _quotedNotSold: quotedNotSold,
        _total: total,
      });
    }
    return rows;
  }, [records, currentYear]);

  // Lead Sources 2020+ — horizontal stacked bars per source value with
  // counts of In Progress / Not Sold / Sold plus the Sold-count and
  // close-rate (Sold / (Sold + Not Sold)) label at the end of each row.
  // `Lead Source` is preferred; we fall back to `Source` per the column
  // names already used elsewhere (PipelineView).
  const leadSourcesData = useMemo(() => {
    if (records.length === 0) return [];
    const byKey = new Map();
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null || y < 2020) continue;
      const src = String(r['Lead Source'] || r['Source'] || '').trim();
      if (!src || src === '-' || src === '#N/A') continue;
      const stage = String(r.Stage || '').trim();
      let bucket;
      if (stage === 'Sold') bucket = 'sold';
      else if (stage === 'Not Sold') bucket = 'notSold';
      else bucket = 'inProgress';
      if (!byKey.has(src)) byKey.set(src, { source: src, inProgress: 0, notSold: 0, sold: 0 });
      byKey.get(src)[bucket] += 1;
    }
    if (byKey.size === 0) return [];
    const rows = Array.from(byKey.values()).map(r => {
      const closeDenom = r.sold + r.notSold;
      const closeRate = closeDenom > 0 ? r.sold / closeDenom : null;
      const total = r.inProgress + r.notSold + r.sold;
      return { ...r, total, closeRate };
    });
    // Sort descending by total so the biggest source sits on top, matching
    // the screenshot layout.
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [records]);

  // Quoted (Thousands) — sum of Quoted Amount bucketed by the calendar
  // year of each opp's Quoted On date (any stage), displayed in $k. Opps
  // without a parseable Quoted On date are excluded since they have no
  // quote year to attribute. Includes a Projected bar for the current year.
  const quotedByYearData = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const ts = Date.parse(r['Quoted On'] || r['Quoted Date'] || '');
      if (Number.isNaN(ts)) continue;
      const y = new Date(ts).getFullYear();
      if (!Number.isFinite(y) || y < 1900 || y > 2100) continue;
      const amt = parseMoney(r['Quoted Amount']);
      const v = (typeof amt === 'number' && Number.isFinite(amt)) ? amt : 0;
      byYear.set(y, (byYear.get(y) || 0) + v);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const total = byYear.get(y) || 0;
      rows.push({
        year: String(y),
        thousands: Math.round(total / 1000),
        isProjected: false,
      });
    }
    const ytd = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round((ytd / frac) / 1000) : Math.round(ytd / 1000);
    // _ytdThousands / _frac let the tooltip explain the Projected bar.
    rows.push({
      year: 'Projected', thousands: projected, isProjected: true,
      _ytdThousands: Math.round(ytd / 1000), _frac: frac,
    });
    return rows;
  }, [records, currentYear]);

  // Not Solds — count of Stage=Not Sold per Open Year + Projected, with
  // three day-count lines on the same axis:
  //   Avg Opp Life      — mean Age across Sold + Not Sold opps that year.
  //   Age of not Quoted — mean Age across opps still in pre-quote stages
  //                       (Lead / Not Started / Qualifying / Quoting).
  //   Quote to Close    — mean (Close Date − Quoted On) for closed opps
  //                       that have a parseable Quoted On / Quoted Date.
  const notSoldsData = useMemo(() => {
    if (records.length === 0) return [];
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting']);
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const list = byYear.get(y) || [];
      let notSold = 0;
      let lifeSum = 0, lifeCount = 0;
      let notQuotedSum = 0, notQuotedCount = 0;
      let qtcSum = 0, qtcCount = 0;
      for (const r of list) {
        const stage = String(r.Stage || '').trim();
        if (stage === 'Not Sold') notSold += 1;
        const age = Number(String(r.Age ?? '').replace(/[^0-9.-]/g, ''));
        const closedStage = (stage === 'Sold' || stage === 'Not Sold');
        if (closedStage && Number.isFinite(age)) { lifeSum += age; lifeCount += 1; }
        if (NOT_QUOTED_STAGES.has(stage) && Number.isFinite(age)) {
          notQuotedSum += age; notQuotedCount += 1;
        }
        if (closedStage) {
          const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
          const closeDate = r['Close Date'] || '';
          const qt = Date.parse(quotedOn);
          const ct = Date.parse(closeDate);
          if (!Number.isNaN(qt) && !Number.isNaN(ct) && ct >= qt) {
            qtcSum += (ct - qt) / 86400000;
            qtcCount += 1;
          }
        }
      }
      rows.push({
        year: String(y),
        notSold,
        isProjected: false,
        avgOppLife: lifeCount > 0 ? Math.round(lifeSum / lifeCount) : null,
        ageNotQuoted: notQuotedCount > 0 ? Math.round(notQuotedSum / notQuotedCount) : null,
        quoteToClose: qtcCount > 0 ? Math.round(qtcSum / qtcCount) : null,
        // Sample sizes behind each averaged line, surfaced in the tooltip.
        _lifeCount: lifeCount,
        _notQuotedCount: notQuotedCount,
        _qtcCount: qtcCount,
      });
    }
    // Projected Not Sold bar — annualize the current year's count.
    const ytdNotSold = (byYear.get(currentYear) || []).filter(r => String(r.Stage || '').trim() === 'Not Sold').length;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdNotSold / frac) : ytdNotSold;
    rows.push({
      year: 'Projected', notSold: projected, isProjected: true,
      avgOppLife: null, ageNotQuoted: null, quoteToClose: null,
      _ytdNotSold: ytdNotSold, _frac: frac,
    });
    return rows;
  }, [records, currentYear]);

  // Year range shared by Top Accounts / Annual Sales / Deal Size — use
  // the same min-year-with-data → max(currentYear, maxYearInData) span
  // as the other charts so future-dated Open Years (e.g. 2026 entered
  // while the browser clock still reads 2025) still get a bar.
  const yearRange = useMemo(() => {
    if (records.length === 0) return [];
    let minYear = currentYear;
    let maxYear = currentYear;
    let any = false;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (!any) return [];
    const out = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [records, currentYear]);

  // Top Accounts — pick the top 4 accounts by lifetime Sold $, then
  // stack per Open Year. Everything outside the top-4 lumps into the
  // "Remaining" bucket. The Projected bar for the current year adds
  // YTD Sold $ + the in-progress pipeline (opps opened this year that
  // haven't closed yet) using the same per-account breakdown.
  const topAccountsData = useMemo(() => {
    if (records.length === 0 || yearRange.length === 0) return { years: [], topAccounts: [], colors: {} };
    const lifetimeSold = new Map();
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold') continue;
      const account = String(r.Account || '').trim();
      if (!account) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      lifetimeSold.set(account, (lifetimeSold.get(account) || 0) + amt);
    }
    const topAccounts = Array.from(lifetimeSold.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);
    const topSet = new Set(topAccounts);
    // Positional colors so the 1st top account is always blue, then red,
    // yellow, purple. Remaining is always green.
    const colors = {
      [topAccounts[0]]: '#3b82f6',
      [topAccounts[1]]: '#ef4444',
      [topAccounts[2]]: '#facc15',
      [topAccounts[3]]: '#a855f7',
      Remaining: '#22c55e',
    };
    // Year buckets — Sold $ split per top account + Remaining.
    const buckets = new Map();
    for (const y of yearRange) {
      const row = { year: String(y), _total: 0, Remaining: 0 };
      for (const a of topAccounts) row[a] = 0;
      buckets.set(y, row);
    }
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold') continue;
      const y = parseYear(r['Open Year']);
      if (y === null || !buckets.has(y)) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      const account = String(r.Account || '').trim();
      const row = buckets.get(y);
      if (topSet.has(account)) row[account] += amt;
      else row.Remaining += amt;
      row._total += amt;
    }
    const rows = Array.from(buckets.values()).map(r => ({
      ...r,
      year: r.year,
      _total: Math.round(r._total),
      Remaining: Math.round(r.Remaining),
      ...Object.fromEntries(topAccounts.map(a => [a, Math.round(r[a])])),
    }));
    // Projected bar — sum of pipeline (any opp with Open Year = current,
    // Stage NOT in Sold/Not Sold) added to YTD Sold $.
    const projected = { year: 'Projected', _total: 0, Remaining: 0, _isProjected: true };
    for (const a of topAccounts) projected[a] = 0;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y !== currentYear) continue;
      const stage = String(r.Stage || '').trim();
      if (stage === 'Not Sold') continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const account = String(r.Account || '').trim();
      if (topSet.has(account)) projected[account] += amt;
      else projected.Remaining += amt;
      projected._total += amt;
    }
    projected._total = Math.round(projected._total);
    projected.Remaining = Math.round(projected.Remaining);
    for (const a of topAccounts) projected[a] = Math.round(projected[a]);
    rows.push(projected);
    return { years: rows, topAccounts, colors };
  }, [records, yearRange, currentYear]);

  // Annual Sales — Sold Quoted Amount per Open Year split into Current
  // Client vs New Client buckets. Current Client classification mirrors
  // the regex PipelineView uses (client|existing|renewal|cross-sell|
  // expansion|upsell on the Lead Source value).
  const annualSalesData = useMemo(() => {
    if (records.length === 0 || yearRange.length === 0) return [];
    const CLIENT_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;
    const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
    const buckets = new Map();
    for (const y of yearRange) {
      buckets.set(y, { year: String(y), currentClient: 0, newClient: 0, _total: 0, _isProjected: false });
    }
    for (const r of records) {
      if (String(r.Stage || '').trim() !== 'Sold') continue;
      const y = parseYear(r['Open Year']);
      if (y === null || !buckets.has(y)) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      const src = String(r['Lead Source'] || r['Source'] || '');
      const row = buckets.get(y);
      if (CLIENT_RE.test(src)) row.currentClient += amt;
      else row.newClient += amt;
      row._total += amt;
    }
    const rows = Array.from(buckets.values()).map(r => ({
      ...r,
      currentClient: Math.round(r.currentClient),
      newClient: Math.round(r.newClient),
      _total: Math.round(r._total),
      pctQuota: annualTarget > 0 ? Math.round((r._total / annualTarget) * 100) : null,
    }));
    // Projected — current year YTD Sold + active-pipeline Quoted Amount.
    let projCurrent = 0, projNew = 0;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y !== currentYear) continue;
      const stage = String(r.Stage || '').trim();
      if (stage === 'Not Sold') continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const src = String(r['Lead Source'] || r['Source'] || '');
      if (CLIENT_RE.test(src)) projCurrent += amt;
      else projNew += amt;
    }
    const projTotal = projCurrent + projNew;
    rows.push({
      year: 'Projected',
      currentClient: Math.round(projCurrent),
      newClient: Math.round(projNew),
      _total: Math.round(projTotal),
      pctQuota: annualTarget > 0 ? Math.round((projTotal / annualTarget) * 100) : null,
      _isProjected: true,
    });
    return rows;
  }, [records, yearRange, currentYear, target]);

  // Deal Size — composed chart per Open Year:
  //   Deals (gray bars)     = count of closed opps (Sold + Not Sold)
  //   Quoted (red line)     = mean Quoted Amount across closed opps
  //   Deal Size (blue line) = mean Quoted Amount of Sold opps only
  // Projected bar treats still-active pipeline opps as if they were
  // future closes, so the Projected count/Quoted average reflect the
  // pipeline as well as YTD actuals.
  const dealSizeData = useMemo(() => {
    if (records.length === 0 || yearRange.length === 0) return [];
    const stats = new Map();
    for (const y of yearRange) {
      stats.set(y, { closedCount: 0, quotedSum: 0, quotedCount: 0, soldSum: 0, soldCount: 0 });
    }
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null || !stats.has(y)) continue;
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const s = stats.get(y);
      s.closedCount += 1;
      const amt = parseMoney(r['Quoted Amount']);
      if (typeof amt === 'number' && amt > 0) {
        s.quotedSum += amt;
        s.quotedCount += 1;
        if (stage === 'Sold') {
          s.soldSum += amt;
          s.soldCount += 1;
        }
      }
    }
    const rows = [];
    for (const y of yearRange) {
      const s = stats.get(y);
      rows.push({
        year: String(y),
        deals: s.closedCount,
        quoted: s.quotedCount > 0 ? Math.round(s.quotedSum / s.quotedCount) : null,
        dealSize: s.soldCount > 0 ? Math.round(s.soldSum / s.soldCount) : null,
        _isProjected: false,
        // Sample sizes behind the Quoted / Deal Size mean lines.
        _quotedCount: s.quotedCount,
        _soldCount: s.soldCount,
      });
    }
    // Projected — active-pipeline opps for the current year are added
    // to deals count and Quoted mean (treated as future closes). Deal
    // Size is reused from Sold actuals (no Sold $ to project on yet
    // for still-open opps).
    let projClosed = 0, projQuotedSum = 0, projQuotedCount = 0;
    let projSoldSum = 0, projSoldCount = 0;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y !== currentYear) continue;
      const stage = String(r.Stage || '').trim();
      const isClosed = (stage === 'Sold' || stage === 'Not Sold');
      const isPipeline = !isClosed; // any non-closed stage
      const amt = parseMoney(r['Quoted Amount']);
      if (isClosed) projClosed += 1;
      else if (isPipeline) projClosed += 1; // counted toward "expected deals"
      if (typeof amt === 'number' && amt > 0) {
        projQuotedSum += amt;
        projQuotedCount += 1;
        if (stage === 'Sold') {
          projSoldSum += amt;
          projSoldCount += 1;
        }
      }
    }
    rows.push({
      year: 'Projected',
      deals: projClosed,
      quoted: projQuotedCount > 0 ? Math.round(projQuotedSum / projQuotedCount) : null,
      dealSize: projSoldCount > 0 ? Math.round(projSoldSum / projSoldCount) : null,
      _isProjected: true,
      _quotedCount: projQuotedCount,
      _soldCount: projSoldCount,
    });
    return rows;
  }, [records, yearRange, currentYear]);

  const hasOpps = records.length > 0;

  // Commissions — total Paid to Date per year, sourced from the Deals
  // tab (Clients page). Each deal is bucketed by the calendar year of its
  // Current Term Start Date, and its Paid to Date amount is summed in.
  // Paid to Date mirrors what the Deals grid shows: the matching
  // Commissions roster total when the deal's BFO opp name maps to one,
  // otherwise the amount stored on the deal row. Years between the
  // earliest and latest are kept even if blank so a missing year shows
  // as a $0 bar instead of a gap.
  const commissionsData = useMemo(() => {
    const commByBfo = indexCommissionsByBfo(commissions || []);
    const byYear = new Map();
    const countByYear = new Map();
    for (const row of (deals || [])) {
      const ts = Date.parse(row?.['Current Term Start Date']);
      if (Number.isNaN(ts)) continue;
      const year = new Date(ts).getFullYear();
      if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
      // Match the Deals grid's Paid to Date numerator: auto-populate from
      // the Commissions roster when the BFO name matches, else fall back
      // to the value stored on the deal row.
      const bfo = normBfo(row?.[DEAL_BFO_KEY]);
      const hit = bfo ? commByBfo.get(bfo) : null;
      const paid = hit ? hit.commission : (parseMoney(row?.['Paid to Date']) ?? 0);
      if (!paid) continue;
      byYear.set(year, (byYear.get(year) || 0) + paid);
      countByYear.set(year, (countByYear.get(year) || 0) + 1);
    }
    if (byYear.size === 0) return [];
    const minY = Math.min(...byYear.keys());
    const maxY = Math.max(...byYear.keys());
    const rows = [];
    for (let y = minY; y <= maxY; y++) {
      // _rowCount = deal rows that fed this year's total (tooltip input).
      rows.push({ year: String(y), total: byYear.get(y) || 0, _rowCount: countByYear.get(y) || 0 });
    }
    return rows;
  }, [deals, commissions]);
  const hasCommissions = commissionsData.length > 0;

  // Per-chart underlying records. Each entry mirrors the filter used by
  // the matching useMemo above so the downloaded Excel rows tie back to
  // the chart values.
  const contributingRecords = useMemo(() => {
    const quotedMonths = fiscalMonths(currentYear);
    const quotedKeyToLabel = new Map(quotedMonths.map(m => [m.key, m.label]));
    const leads = [];
    const quoted = [];
    const closeRate = [];
    const leadSources = [];
    const quotedByYear = [];
    const notSolds = [];
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting']);
    for (const r of records) {
      const oy = parseYear(r['Open Year']);
      const account = String(r.Account || '').trim();
      const stage = String(r.Stage || '').trim();
      const status = String(r.Status || '').trim();
      const chance = String(r['Chance?'] || r['Chance'] || '').trim();
      const closeDate = r['Close Date'] || '';
      const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
      const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
      const quotedAmtRaw = r['Quoted Amount'] || '';
      const quotedAmt = parseMoney(quotedAmtRaw);
      const scope = String(r.Scope || '').trim();
      const ageNum = Number(String(r.Age ?? '').replace(/[^0-9.-]/g, ''));
      const age = Number.isFinite(ageNum) ? ageNum : '';

      // Quoted (Thousands) contributors — grouped by the calendar year of
      // the Quoted On date, so include any row with a parseable Quoted On
      // regardless of Open Year.
      const quotedOnTs = Date.parse(quotedOn);
      if (!Number.isNaN(quotedOnTs)) {
        const qy = new Date(quotedOnTs).getFullYear();
        if (Number.isFinite(qy) && qy >= 1900 && qy <= 2100) {
          quotedByYear.push({
            Account: account,
            'Quoted On': quotedOn,
            'Quoted Year': qy,
            Stage: stage,
            'Open Year': oy ?? '',
            'Quoted Amount': quotedAmt ?? 0,
          });
        }
      }

      if (oy !== null) {
        leads.push({
          Account: account,
          Stage: stage,
          Status: status,
          'Open Year': oy,
          'Close Date': closeDate,
          'Quoted Amount': quotedAmt ?? '',
          Scope: scope,
        });
        closeRate.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          'Quoted Amount': quotedAmt ?? '',
          Bucket: (stage === 'Sold') ? 'Sold'
            : (stage === 'Not Sold')
              ? (isQuotedPlus(r) ? 'Not Sold (Quoted+)' : 'Not Sold (pre-quote)')
              : 'In Progress',
          'Close Date': closeDate,
        });
        // Not Solds chart contributors — keep every row that fed any of
        // the bars or lines so the user can audit each year's stats.
        const closedStage = (stage === 'Sold' || stage === 'Not Sold');
        const isAgeForNotQuoted = NOT_QUOTED_STAGES.has(stage);
        const qt = Date.parse(quotedOn);
        const ct = Date.parse(closeDate);
        const quoteToClose = (!Number.isNaN(qt) && !Number.isNaN(ct) && ct >= qt && closedStage)
          ? Math.round((ct - qt) / 86400000) : '';
        notSolds.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          Age: age,
          'Counts in Not Sold bar': stage === 'Not Sold' ? 'Yes' : 'No',
          'Counts in Avg Opp Life': closedStage && Number.isFinite(ageNum) ? 'Yes' : 'No',
          'Counts in Age of not Quoted': isAgeForNotQuoted && Number.isFinite(ageNum) ? 'Yes' : 'No',
          'Quoted On': quotedOn,
          'Close Date': closeDate,
          'Quote to Close (days)': quoteToClose,
        });
      }
      // Lead Sources 2020+ contributors — Open Year ≥ 2020 with a
      // non-empty source value.
      if (oy !== null && oy >= 2020 && leadSource && leadSource !== '-' && leadSource !== '#N/A') {
        leadSources.push({
          'Lead Source': leadSource,
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          Bucket: stage === 'Sold' ? 'Sold' : stage === 'Not Sold' ? 'Not Sold' : 'In Progress',
          'Quoted Amount': quotedAmt ?? '',
        });
      }
      if (closeDate && quotedAmt && quotedAmt > 0) {
        const ts = Date.parse(closeDate);
        if (!Number.isNaN(ts)) {
          const d = new Date(ts);
          const monthLabel = quotedKeyToLabel.get(`${d.getFullYear()}-${d.getMonth()}`);
          if (monthLabel) {
            const lowerChance = chance.toLowerCase();
            const series =
              lowerChance === 'weak' ? 'Quoted Weak'
              : lowerChance === 'ok' ? 'Quoted OK'
              : lowerChance === 'expected' ? 'Quoted Expected'
              : '';
            quoted.push({
              Account: account,
              'Close Date': closeDate,
              Month: monthLabel,
              'Chance?': chance,
              Status: status,
              Stage: stage,
              'Quoted Amount': quotedAmt,
              'Chart Series': series,
              'Counts Toward BFO Pipe Total': series ? 'Yes' : 'No',
              'Agreements Sent Line': status === 'Agreement Sent' ? 'Yes' : 'No',
            });
          }
        }
      }
    }
    leads.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    closeRate.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    quotedByYear.sort((a, b) => a['Quoted Year'] - b['Quoted Year'] || a.Account.localeCompare(b.Account));
    notSolds.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    leadSources.sort((a, b) =>
      a['Lead Source'].localeCompare(b['Lead Source'])
      || a['Open Year'] - b['Open Year']
      || a.Account.localeCompare(b.Account));
    quoted.sort((a, b) => {
      const ta = Date.parse(a['Close Date']);
      const tb = Date.parse(b['Close Date']);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb;
    });
    // Row-3 chart contributors. Built from the same `records` loop in
    // a second pass so we don't disrupt the existing classifications.
    const topAccountsRecs = [];
    const annualSalesRecs = [];
    const dealSizeRecs = [];
    const CLIENT_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;
    const topSet = new Set(topAccountsData.topAccounts || []);
    for (const r of records) {
      const oy = parseYear(r['Open Year']);
      if (oy === null) continue;
      const account = String(r.Account || '').trim();
      const stage = String(r.Stage || '').trim();
      const closedStage = (stage === 'Sold' || stage === 'Not Sold');
      const amt = parseMoney(r['Quoted Amount']);
      const src = String(r['Lead Source'] || r['Source'] || '').trim();
      if (stage === 'Sold') {
        topAccountsRecs.push({
          Account: account,
          'Open Year': oy,
          'Quoted Amount': amt ?? '',
          'Top-4 Bucket': topSet.has(account) ? account : 'Remaining',
        });
        annualSalesRecs.push({
          Account: account,
          'Open Year': oy,
          'Lead Source': src,
          'Client Bucket': CLIENT_RE.test(src) ? 'Current Client' : 'New Client',
          'Quoted Amount': amt ?? '',
        });
      }
      if (closedStage) {
        dealSizeRecs.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          'Quoted Amount': amt ?? '',
          'Counts in Deals': 'Yes',
          'Counts in Quoted avg': (amt && amt > 0) ? 'Yes' : 'No',
          'Counts in Deal Size avg': (stage === 'Sold' && amt && amt > 0) ? 'Yes' : 'No',
        });
      }
    }
    topAccountsRecs.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    annualSalesRecs.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    dealSizeRecs.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    return {
      leads, quoted, closeRate, leadSources, quotedByYear, notSolds,
      topAccounts: topAccountsRecs, annualSales: annualSalesRecs, dealSize: dealSizeRecs,
    };
  }, [records, currentYear, topAccountsData]);

  function downloadLeads() {
    const summary = leadsData.map(r => ({
      Year: r.year,
      'Lead Count': r.count,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Leads by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.leads);
    XLSX.writeFile(wb, `yoy-leads-${todayStamp()}.xlsx`);
  }
  function downloadQuoted() {
    const summary = quotedData.map(r => ({
      Month: r.month,
      Year: r.year,
      'Quoted Weak ($K)': r.weak ?? '',
      'Quoted OK ($K)': r.ok ?? '',
      'Quoted Expected ($K)': r.expected ?? '',
      'Agreements Sent ($K)': r.agreements ?? '',
      'BFO Pipe Total ($K)': r.bfoPipe ?? '',
      Source: r._live ? 'Live (Opps 2 + BFO Activity)' : (r._hasData ? 'Recorded' : ''),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `Quoted Projections ${currentYear}`, summary);
    XLSX.writeFile(wb, `yoy-quoted-projections-${currentYear}-${todayStamp()}.xlsx`);
  }
  function downloadCloseRate() {
    const summary = closeRateData.map(r => ({
      'Open Year': r.year,
      'Total Not Sold (%)': r.totalNotSold,
      'Total Sold (OY) (%)': r.totalSold,
      'In Progress (OY) (%)': r.inProgress,
      'Quoted C/R (%)': r.quotedCR == null ? '' : r.quotedCR,
      'Total C/R (%)': r.totalCR == null ? '' : r.totalCR,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Close Rate by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.closeRate);
    XLSX.writeFile(wb, `yoy-close-rate-${todayStamp()}.xlsx`);
  }
  function downloadLeadSources() {
    const summary = leadSourcesData.map(r => ({
      'Lead Source': r.source,
      'In Progress': r.inProgress,
      'Not Sold': r.notSold,
      Sold: r.sold,
      Total: r.total,
      'Close Rate (%)': r.closeRate == null ? '' : Math.round(r.closeRate * 100),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Lead Sources 2020+', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.leadSources);
    XLSX.writeFile(wb, `yoy-lead-sources-${todayStamp()}.xlsx`);
  }
  function downloadQuotedByYear() {
    const summary = quotedByYearData.map(r => ({
      'Quoted Year': r.year,
      'Quoted ($k)': r.thousands,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Quoted by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.quotedByYear);
    XLSX.writeFile(wb, `yoy-quoted-by-year-${todayStamp()}.xlsx`);
  }
  function downloadNotSolds() {
    const summary = notSoldsData.map(r => ({
      'Open Year': r.year,
      'Not Solds': r.notSold,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
      'Avg Opp Life (days)': r.avgOppLife == null ? '' : r.avgOppLife,
      'Age of not Quoted (days)': r.ageNotQuoted == null ? '' : r.ageNotQuoted,
      'Quote to Close (days)': r.quoteToClose == null ? '' : r.quoteToClose,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Not Solds by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.notSolds);
    XLSX.writeFile(wb, `yoy-not-solds-${todayStamp()}.xlsx`);
  }
  function downloadTopAccounts() {
    const tops = topAccountsData.topAccounts || [];
    const summary = (topAccountsData.years || []).map(r => {
      const out = {
        Year: r.year,
        Type: r._isProjected ? 'Projected (YTD + active pipeline)' : 'Actual',
        Total: r._total,
      };
      for (const a of tops) out[a] = r[a] ?? 0;
      out.Remaining = r.Remaining ?? 0;
      return out;
    });
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Top Accounts', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.topAccounts);
    XLSX.writeFile(wb, `yoy-top-accounts-${todayStamp()}.xlsx`);
  }
  function downloadAnnualSales() {
    const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
    const summary = annualSalesData.map(r => ({
      Year: r.year,
      Type: r._isProjected ? 'Projected (YTD + active pipeline)' : 'Actual',
      'Current Client ($)': r.currentClient,
      'New Client ($)': r.newClient,
      'Total Sold ($)': r._total,
      'Annual Target ($)': annualTarget,
      '% Quota': r.pctQuota == null ? '' : r.pctQuota,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Annual Sales', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.annualSales);
    XLSX.writeFile(wb, `yoy-annual-sales-${todayStamp()}.xlsx`);
  }
  function downloadCommissions() {
    const summary = commissionsData.map(r => ({
      Year: r.year,
      'Total Commissions ($)': round0(r.total),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Commissions by Year', summary);
    XLSX.writeFile(wb, `yoy-commissions-${todayStamp()}.xlsx`);
  }

  function downloadDealSize() {
    const summary = dealSizeData.map(r => ({
      Year: r.year,
      Type: r._isProjected ? 'Projected (YTD + active pipeline)' : 'Actual',
      Deals: r.deals,
      'Quoted (mean of closed, $)': r.quoted == null ? '' : r.quoted,
      'Deal Size (mean of Sold, $)': r.dealSize == null ? '' : r.dealSize,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Deal Size', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.dealSize);
    XLSX.writeFile(wb, `yoy-deal-size-${todayStamp()}.xlsx`);
  }

  // The single panel every chart's hover content portals into. It's
  // docked (sticky) at the top of the body so the explanation is always
  // visible while hovering any chart and never floats over the plot.
  // Held in state (via a callback ref) rather than a ref so the element
  // is provided through context and is safe to read during render.
  const [calcPanelEl, setCalcPanelEl] = useState(null);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>YOY</h1>
          <div className={styles.subtitle}>
            Year-over-year summary, computed off the Opps tab cache.
            {opps?.fetchedAt ? ` Opps fetched ${new Date(opps.fetchedAt).toLocaleString()}.` : ' Open the Opps tab to load data.'}
          </div>
        </div>
      </div>
      <div className={styles.body}>
        <CalcPanelContext.Provider value={calcPanelEl}>
        <div
          ref={setCalcPanelEl}
          className={styles.calcPanel}
          data-empty-hint="Hover any chart’s bars or points to see how that number is calculated — shown here so it never covers the chart."
        />
        <div className={styles.row}>
          <LeadsCard data={leadsData} hasOpps={hasOpps} onDownload={downloadLeads} />
          <QuotedProjectionsCard data={quotedData} quotedTable={quotedTable} onSaveTable={updateQuotedTable} onDownload={downloadQuoted} />
          <CloseRateCard data={closeRateData} hasOpps={hasOpps} onDownload={downloadCloseRate} />
        </div>
        <div className={styles.row}>
          <LeadSourcesCard data={leadSourcesData} hasOpps={hasOpps} onDownload={downloadLeadSources} />
          <QuotedByYearCard data={quotedByYearData} hasOpps={hasOpps} onDownload={downloadQuotedByYear} />
          <NotSoldsCard data={notSoldsData} hasOpps={hasOpps} onDownload={downloadNotSolds} />
        </div>
        <div className={styles.row}>
          <TopAccountsCard data={topAccountsData} hasOpps={hasOpps} onDownload={downloadTopAccounts} />
          <AnnualSalesCard data={annualSalesData} hasOpps={hasOpps} target={target} onDownload={downloadAnnualSales} />
          <DealSizeCard data={dealSizeData} hasOpps={hasOpps} onDownload={downloadDealSize} />
        </div>
        <div className={styles.row}>
          <CommissionsCard data={commissionsData} hasCommissions={hasCommissions} onDownload={downloadCommissions} />
          {/* Empty slots keep the Commissions card at one-third row width
              so it matches the other charts above rather than stretching
              to the full row. */}
          <div style={{ flex: '1 1 0' }} aria-hidden="true" />
          <div style={{ flex: '1 1 0' }} aria-hidden="true" />
        </div>
        </CalcPanelContext.Provider>
      </div>
    </div>
  );
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function round0(n) {
  return n == null || !Number.isFinite(n) ? 0 : Math.round(n);
}

// Build a worksheet from an array of plain-object rows and append it to
// the workbook. Auto-sizes columns based on header + the first 50 rows.
function appendSheet(wb, name, rows) {
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['No rows']]);
  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    ws['!cols'] = keys.map(key => ({
      wch: Math.min(60, Math.max(
        key.length,
        ...rows.slice(0, 50).map(r => String(r[key] ?? '').length),
      ) + 2),
    }));
  }
  // Excel sheet names cap at 31 chars and can't contain []:?*/\
  const safe = String(name).replace(/[[\]:?*/\\]/g, ' ').slice(0, 31) || 'Sheet';
  XLSX.utils.book_append_sheet(wb, ws, safe);
}

// Makes a chart's <Legend> interactive: clicking a series label toggles
// it on/off. Spread `legendProps` onto <Legend> and set `hide={hidden[key]}`
// on each series (key = its dataKey). Hidden labels render struck-through
// and greyed so it's clear what's currently filtered out.
function useInteractiveLegend() {
  const [hidden, setHidden] = useState({});
  const legendProps = {
    wrapperStyle: { fontSize: 12, cursor: 'pointer' },
    onClick: (o) => {
      const key = o?.dataKey ?? o?.value;
      if (key == null) return;
      setHidden(h => ({ ...h, [key]: !h[key] }));
    },
    formatter: (value, entry) => {
      const key = entry?.dataKey ?? value;
      const off = hidden[key];
      return (
        <span style={{ color: off ? '#9ca3af' : '#374151', textDecoration: off ? 'line-through' : 'none' }}>
          {value}
        </span>
      );
    },
  };
  return { hidden, legendProps };
}

function ChartHeader({ title, onDownload, canDownload }) {
  return (
    <div className={styles.chartHeader}>
      <h2 className={styles.chartTitle}>{title}</h2>
      <button
        type="button"
        className={styles.downloadBtn}
        onClick={onDownload}
        disabled={!canDownload}
        title={canDownload
          ? `Download ${title} data as Excel (.xlsx)`
          : 'No data to download'}
      >Download .xlsx</button>
    </div>
  );
}

// Shared hover tooltip for every YOY chart. Recharts clones this element
// with `active` / `payload` / `label` injected at hover time. Beyond the
// usual per-series values it makes two things explicit:
//   1. None of the YOY numbers are static — they're recomputed live from
//      the Opps cache — so a "∑ calculated" badge sits in the header.
//   2. The formula and the specific inputs that produced *this* point, so
//      a number can be sanity-checked without opening the .xlsx export.
// `valueFormat(value, name, row)` formats each series line; `explain(row)`
// returns { formula, inputs: [{label, value}], note } for the lower block.
// Inner content shared by the docked panel (normal case) and the
// floating fallback. Laid out as a horizontal strip — heading + badge,
// then the per-series values, then the formula and its inputs — so it
// reads left-to-right in the wide docked panel without growing tall.
function CalcContent({ payload, label, labelText, valueFormat, explain }) {
  const row = payload[0]?.payload || {};
  const info = explain ? explain(row, payload, label) : null;
  const heading = labelText ? labelText(label, row) : label;
  return (
    <div className={styles.calcDock}>
      <div className={styles.calcDockLabel}>
        <span className={styles.calcDockHeading}>{heading}</span>
        <span className={styles.calcTipBadge} title="Recomputed live from the Opps cache — not a stored value">∑ calculated</span>
      </div>
      <div className={styles.calcDockSeries}>
        {payload.map((p, i) => (
          <span key={i} className={styles.calcDockSeriesItem}>
            <span className={styles.calcTipSwatch} style={{ background: p.color || p.stroke || p.fill || '#94a3b8' }} />
            <span className={styles.calcDockName}>{p.name}</span>
            <span className={styles.calcDockVal}>
              {valueFormat ? valueFormat(p.value, p.name, row) : (p.value == null ? '—' : p.value)}
            </span>
          </span>
        ))}
      </div>
      {info && (info.formula || (info.inputs && info.inputs.length) || info.note) ? (
        <div className={styles.calcDockExplain}>
          {info.formula ? <div className={styles.calcDockFormula}>{info.formula}</div> : null}
          {Array.isArray(info.inputs) && info.inputs.length > 0 ? (
            <div className={styles.calcDockInputs}>
              {info.inputs.map((it, i) => (
                <span key={i} className={styles.calcDockInput}>
                  <span className={styles.calcDockInputLabel}>{it.label}</span>
                  <span className={styles.calcDockInputVal}>{it.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {info.note ? <span className={styles.calcDockNote}>{info.note}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Shared hover tooltip for every YOY chart. Recharts clones this element
// with `active` / `payload` / `label` injected at hover time and would
// normally float it over the plot — which covers the very point being
// reviewed. Instead we portal the content into the docked panel at the
// top of the YOY body so the chart and its data stay fully visible. If
// no panel is mounted (defensive), it falls back to a small floating box.
function CalcTooltip({
  active, payload, label,
  labelText, valueFormat, explain,
}) {
  const target = useContext(CalcPanelContext);
  if (!active || !payload || payload.length === 0) return null;
  const body = (
    <CalcContent
      payload={payload}
      label={label}
      labelText={labelText}
      valueFormat={valueFormat}
      explain={explain}
    />
  );
  if (target) return createPortal(body, target);
  return <div className={styles.calcTip}>{body}</div>;
}

function LeadsCard({ data, hasOpps, onDownload }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Leads" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Open Year ${label}`}
                valueFormat={(v) => (v == null ? '—' : v.toLocaleString('en-US'))}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Annualized: YTD lead count ÷ fraction of the year elapsed.',
                      inputs: [
                        { label: 'YTD leads', value: (row._ytd ?? 0).toLocaleString('en-US') },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: (row.count ?? 0).toLocaleString('en-US') },
                      ],
                    }
                  : {
                      formula: 'Count of Opps rows whose Open Year equals this year.',
                      inputs: [{ label: 'Leads counted', value: (row.count ?? 0).toLocaleString('en-US') }],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="count" name="Leads" fill="#3b82f6" isAnimationActive={false} hide={hidden.count}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuotedProjectionsCard({ data, quotedTable, onSaveTable, onDownload }) {
  const [editing, setEditing] = useState(false);
  const hasAnyValues = data.some(r => r._hasData);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted Projections" onDownload={onDownload} canDownload={hasAnyValues} />
      <div className={styles.quotedEditRow}>
        <span className={styles.quotedUnitNote}>values in $K</span>
        <button type="button" className={styles.editValuesBtn} onClick={() => setEditing(true)}>Edit values</button>
      </div>
      {!hasAnyValues ? (
        <div className={styles.empty}>No values yet — click “Edit values” to record each month’s figures.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="dollars"
              tick={{ fontSize: 12 }}
              tickFormatter={fmtKLabel}
            />
            <YAxis
              yAxisId="pipe"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={fmtKLabel}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => `${label} ${row.year}`}
                valueFormat={(v) => (v == null ? '—' : fmtKLabel(v))}
                explain={(row) => ({
                  formula: row._live
                    ? 'Live snapshot for the current month (in $K): Quoted Weak/OK/Expected sum open Opps 2 opps’ current Quoted Amount by Chance, Agreements Sent sums opps with that Status, and BFO Pipe Total sums the BFO Activity tab’s Amount column. Record a value via “Edit values” to override.'
                    : 'Recorded month-end values (in $K). Quoted Weak/OK/Expected are the quoted-$ Chance buckets, Agreements Sent is contracts out, and BFO Pipe Total is the total pipeline $ (its own right-hand axis). Edit via “Edit values”.',
                  inputs: [
                    { label: 'Quoted Weak', value: row.weak == null ? '—' : fmtKLabel(row.weak) },
                    { label: 'Quoted OK', value: row.ok == null ? '—' : fmtKLabel(row.ok) },
                    { label: 'Quoted Expected', value: row.expected == null ? '—' : fmtKLabel(row.expected) },
                    { label: 'Agreements Sent', value: row.agreements == null ? '—' : fmtKLabel(row.agreements) },
                    { label: 'BFO Pipe Total', value: row.bfoPipe == null ? '—' : fmtKLabel(row.bfoPipe) },
                  ],
                  note: row._live
                    ? 'Live from Opps 2 + BFO Activity — not yet recorded.'
                    : (row._hasData ? null : 'No values recorded for this month yet.'),
                })}
              />
            } />
            <Legend {...legendProps} />
            <Line yAxisId="dollars" dataKey="weak" name="Quoted Weak" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.weak}>
              <LabelList dataKey="weak" position="top" style={{ fontSize: 10, fill: '#15803d' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="ok" name="Quoted OK" stroke="#eab308" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.ok}>
              <LabelList dataKey="ok" position="top" style={{ fontSize: 10, fill: '#a16207' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="expected" name="Quoted Expected" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.expected}>
              <LabelList dataKey="expected" position="top" style={{ fontSize: 10, fill: '#1d4ed8' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="agreements" name="Agreements Sent" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.agreements} />
            <Line
              yAxisId="pipe"
              dataKey="bfoPipe"
              name="BFO Pipe Total"
              stroke="#111827"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.bfoPipe}
            >
              <LabelList dataKey="bfoPipe" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#111827' }} formatter={fmtKLabel} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {editing && (
        <QuotedProjectionsEditor
          rows={data}
          table={quotedTable}
          onClose={() => setEditing(false)}
          onSave={(next) => { onSaveTable(next); setEditing(false); }}
        />
      )}
    </div>
  );
}

// Editable month-by-month table behind the Quoted Projections "Edit
// values" button. Lets the user record each month's figures (in $K);
// blank cells are omitted. Seeded values come from the store.
function QuotedProjectionsEditor({ rows, table, onClose, onSave }) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const r of rows) {
      const v = table[r.monthKey] || {};
      const cells = {};
      for (const f of QUOTED_FIELDS) cells[f] = (v[f] == null || v[f] === '') ? '' : String(v[f]);
      d[r.monthKey] = cells;
    }
    return d;
  });
  const setCell = (key, field, value) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const handleSave = () => {
    const next = { ...table };
    for (const r of rows) {
      const cells = draft[r.monthKey] || {};
      const out = {};
      let any = false;
      for (const f of QUOTED_FIELDS) {
        const raw = String(cells[f] ?? '').trim().replace(/[$,]/g, '');
        if (raw === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n)) { out[f] = n; any = true; }
      }
      if (any) next[r.monthKey] = out;
      else delete next[r.monthKey];
    }
    onSave(next);
  };
  const labels = [
    ['weak', 'Quoted Weak'], ['ok', 'Quoted OK'], ['expected', 'Quoted Expected'],
    ['agreements', 'Agreements Sent'], ['bfoPipe', 'BFO Pipe Total'],
  ];
  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>Quoted Projections — monthly values</div>
            <div className={styles.modalSub}>All figures in thousands of dollars ($K). Leave a cell blank to omit it. Saved per month for the Dec→Nov fiscal year.</div>
          </div>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.modalBody}>
          <table className={styles.editTable}>
            <thead>
              <tr>
                <th>Month</th>
                {labels.map(([f, lbl]) => <th key={f}>{lbl}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.monthKey}>
                  <td className={styles.editMonthCell}>{r.month} {r.year}</td>
                  {labels.map(([f]) => (
                    <td key={f}>
                      <input
                        type="number"
                        className={styles.editInput}
                        value={draft[r.monthKey]?.[f] ?? ''}
                        onChange={(e) => setCell(r.monthKey, f, e.target.value)}
                        placeholder="—"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CloseRateCard({ data, hasOpps, onDownload }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Close Rate" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="pct"
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              yAxisId="cr"
              orientation="right"
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label) => `Open Year ${label}`}
                valueFormat={(v) => (v == null ? '—' : `${v.toFixed(0)}%`)}
                explain={(row) => ({
                  formula: 'Bars = each stage as a % of all opps that year. Total C/R = Sold ÷ (Sold + Not Sold). Quoted C/R = Sold ÷ (Sold + Not Sold that reached Quoted+).',
                  inputs: [
                    { label: 'Sold', value: (row._sold ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold', value: (row._notSold ?? 0).toLocaleString('en-US') },
                    { label: 'In Progress', value: (row._inProgress ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold (Quoted+)', value: (row._quotedNotSold ?? 0).toLocaleString('en-US') },
                    { label: 'Total opps', value: (row._total ?? 0).toLocaleString('en-US') },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar yAxisId="pct" dataKey="totalNotSold" stackId="cr" name="Total Not Sold" fill="#ef4444" isAnimationActive={false} hide={hidden.totalNotSold} />
            <Bar yAxisId="pct" dataKey="totalSold" stackId="cr" name="Total Sold (OY)" fill="#facc15" isAnimationActive={false} hide={hidden.totalSold}>
              <LabelList
                dataKey="totalSold"
                position="insideTop"
                style={{ fontSize: 10, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => v >= 3 ? `${Math.round(v)}%` : ''}
              />
            </Bar>
            <Bar yAxisId="pct" dataKey="inProgress" stackId="cr" name="In Progress (OY)" fill="#3b82f6" isAnimationActive={false} hide={hidden.inProgress} />
            <Line yAxisId="cr" dataKey="quotedCR" name="Quoted C/R" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.quotedCR}>
              <LabelList dataKey="quotedCR" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#c2410c' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
            <Line yAxisId="cr" dataKey="totalCR" name="Total C/R" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.totalCR}>
              <LabelList dataKey="totalCR" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#15803d' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function LeadSourcesCard({ data, hasOpps, onDownload }) {
  const { hidden, legendProps } = useInteractiveLegend();
  // Per-row height keeps the chart legible even when source values
  // accumulate (e.g. opps tagged with novel sources over time). Pad
  // the wrapper height so the LabelList sold count + close-rate label
  // never collides with the rightmost gridline.
  const rowHeight = 28;
  const minHeight = 320;
  const height = Math.max(minHeight, data.length * rowHeight + 80);
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Lead Sources 2020+" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with a Lead Source and Open Year ≥ 2020.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 70, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="source"
              tick={{ fontSize: 11 }}
              width={155}
              interval={0}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label) => `Lead Source: ${label}`}
                valueFormat={(v) => (v == null ? '—' : v.toLocaleString('en-US'))}
                explain={(row) => ({
                  formula: 'Opps with this Lead Source (Open Year ≥ 2020), counted by stage. Row-end green % = Close Rate = Sold ÷ (Sold + Not Sold).',
                  inputs: [
                    { label: 'In Progress', value: (row.inProgress ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold', value: (row.notSold ?? 0).toLocaleString('en-US') },
                    { label: 'Sold', value: (row.sold ?? 0).toLocaleString('en-US') },
                    { label: 'Total', value: (row.total ?? 0).toLocaleString('en-US') },
                    { label: 'Close Rate', value: row.closeRate == null ? '—' : `${Math.round(row.closeRate * 100)}%` },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="inProgress" stackId="ls" name="In Progress" fill="#3b82f6" isAnimationActive={false} hide={hidden.inProgress} />
            <Bar dataKey="notSold" stackId="ls" name="Not Sold" fill="#ef4444" isAnimationActive={false} hide={hidden.notSold} />
            <Bar dataKey="sold" stackId="ls" name="Sold" fill="#facc15" isAnimationActive={false} hide={hidden.sold}>
              <LabelList
                dataKey="sold"
                position="right"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(value) => value || ''}
              />
              <LabelList
                dataKey="closeRate"
                position="right"
                offset={28}
                style={{ fontSize: 11, fontWeight: 600, fill: '#16a34a' }}
                formatter={(v) => v == null ? '' : `${Math.round(v * 100)}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuotedByYearCard({ data, hasOpps, onDownload }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted (Thousands)" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${v.toLocaleString('en-US')}`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Quoted ${label}`}
                valueFormat={(v) => (v == null ? '—' : `$${v.toLocaleString('en-US')}k`)}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Annualized: YTD quoted $ (by Quoted On date) ÷ fraction of the year elapsed, shown in $k.',
                      inputs: [
                        { label: 'YTD quoted', value: `$${(row._ytdThousands ?? 0).toLocaleString('en-US')}k` },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: `$${(row.thousands ?? 0).toLocaleString('en-US')}k` },
                      ],
                    }
                  : {
                      formula: 'Sum of Quoted Amount for every opp whose Quoted On date falls in this year (any stage), shown in $k.',
                      inputs: [{ label: 'Quoted total', value: `$${(row.thousands ?? 0).toLocaleString('en-US')}k` }],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="thousands" name="Quoted ($k)" fill="#3b82f6" isAnimationActive={false} hide={hidden.thousands}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList
                dataKey="thousands"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => `$${v.toLocaleString('en-US')}`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function NotSoldsCard({ data, hasOpps, onDownload }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Not Solds" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Open Year ${label}`}
                valueFormat={(v, name) => {
                  if (v == null) return '—';
                  if (name === 'Not Solds') return v.toLocaleString('en-US');
                  return `${v.toLocaleString('en-US')} days`;
                }}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Not Sold bar annualized: YTD Not Sold ÷ fraction of year elapsed. The day-count lines are actuals only — not projected.',
                      inputs: [
                        { label: 'YTD Not Sold', value: (row._ytdNotSold ?? 0).toLocaleString('en-US') },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: (row.notSold ?? 0).toLocaleString('en-US') },
                      ],
                    }
                  : {
                      formula: 'Bar = count of Not Sold opps. Lines = mean days — Avg Opp Life (closed opps), Age of not Quoted (pre-quote opps), Quote to Close (Close Date − Quoted On).',
                      inputs: [
                        { label: 'Not Solds', value: (row.notSold ?? 0).toLocaleString('en-US') },
                        { label: 'Avg Opp Life', value: row.avgOppLife == null ? '—' : `${row.avgOppLife} d (n=${row._lifeCount ?? 0})` },
                        { label: 'Age of not Quoted', value: row.ageNotQuoted == null ? '—' : `${row.ageNotQuoted} d (n=${row._notQuotedCount ?? 0})` },
                        { label: 'Quote to Close', value: row.quoteToClose == null ? '—' : `${row.quoteToClose} d (n=${row._qtcCount ?? 0})` },
                      ],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="notSold" name="Not Solds" isAnimationActive={false} hide={hidden.notSold}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList dataKey="notSold" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }} />
            </Bar>
            <Line
              dataKey="avgOppLife"
              name="Avg Opp Life"
              stroke="#dc2626"
              strokeWidth={2.5}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.avgOppLife}
            >
              <LabelList dataKey="avgOppLife" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#991b1b' }} formatter={(v) => v == null ? '' : v} />
            </Line>
            <Line
              dataKey="ageNotQuoted"
              name="Age of not Quoted"
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.ageNotQuoted}
            />
            <Line
              dataKey="quoteToClose"
              name="Quote to Close"
              stroke="#eab308"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.quoteToClose}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Compact `$1,234,567` formatter for label lists on $-axis charts.
function fmtMoneyLabel(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function TopAccountsCard({ data, hasOpps, onDownload }) {
  const { years = [], topAccounts = [], colors = {} } = data || {};
  const hasAny = years.some(r => r._total > 0);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Top Accounts" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No Sold opps with a Quoted Amount yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={years} margin={{ top: 20, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${(v / 1_000_000).toFixed(0)}M`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => row._isProjected ? 'Projected (YTD + active pipeline)' : `Year ${label}`}
                valueFormat={(v) => (v ? fmtMoneyLabel(v) : '$0')}
                explain={(row) => ({
                  formula: 'Sold Quoted Amount summed per Account for this year. The top 4 accounts by lifetime Sold $ get their own slice; everyone else is grouped as Remaining.',
                  inputs: [{ label: 'Year total', value: row._total ? fmtMoneyLabel(row._total) : '$0' }],
                  note: row._isProjected ? 'Projected adds active pipeline (non-closed current-year opps) to YTD Sold $.' : null,
                })}
              />
            } />
            <Legend {...legendProps} />
            {/* Stack order: largest (Brookfield) at bottom; Remaining at top. */}
            {topAccounts.map((a, i) => (
              <Bar
                key={a}
                dataKey={a}
                stackId="ta"
                name={a}
                fill={colors[a] || '#94a3b8'}
                isAnimationActive={false}
                hide={hidden[a]}
              >
                {i === 0 ? (
                  <LabelList
                    dataKey={a}
                    position="center"
                    style={{ fontSize: 10, fontWeight: 600, fill: '#fff' }}
                    formatter={(v) => v && v >= 50_000 ? fmtMoneyLabel(v) : ''}
                  />
                ) : null}
              </Bar>
            ))}
            <Bar dataKey="Remaining" stackId="ta" name="Remaining" fill={colors.Remaining || '#22c55e'} isAnimationActive={false} hide={hidden.Remaining}>
              <LabelList
                dataKey="_total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyLabel(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function AnnualSalesCard({ data, hasOpps, target, onDownload }) {
  const hasAny = data.some(r => r._total > 0);
  const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Annual Sales" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No Sold opps with a Quoted Amount yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 32, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v.toLocaleString('en-US')}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => row._isProjected ? 'Projected (YTD + active pipeline)' : `Year ${label}`}
                valueFormat={(v, name) => (name === '% Quota' ? `${v}%` : (v ? fmtMoneyLabel(v) : '$0'))}
                explain={(row) => ({
                  formula: 'Sold Quoted Amount for this year, split Current vs New Client by the Lead Source text. % Quota = Total Sold ÷ annual target.',
                  inputs: [
                    { label: 'Current Client', value: row.currentClient ? fmtMoneyLabel(row.currentClient) : '$0' },
                    { label: 'New Client', value: row.newClient ? fmtMoneyLabel(row.newClient) : '$0' },
                    { label: 'Total Sold', value: row._total ? fmtMoneyLabel(row._total) : '$0' },
                    { label: 'Annual target', value: fmtMoneyLabel(annualTarget) },
                    { label: '% Quota', value: row.pctQuota == null ? '—' : `${row.pctQuota}%` },
                  ],
                  note: row._isProjected ? 'Projected adds active pipeline to YTD Sold $.' : null,
                })}
              />
            } />
            <Legend
              {...legendProps}
              payload={[
                { value: '% Quota', type: 'circle', color: '#eab308', id: 'pct', dataKey: 'pctQuota' },
                { value: 'New Client', type: 'rect', color: '#ef4444', id: 'new', dataKey: 'newClient' },
                { value: 'Current Client', type: 'rect', color: '#3b82f6', id: 'cur', dataKey: 'currentClient' },
              ]}
            />
            <Bar dataKey="currentClient" stackId="as" name="Current Client" fill="#3b82f6" isAnimationActive={false} hide={hidden.currentClient} />
            <Bar dataKey="newClient" stackId="as" name="New Client" fill="#ef4444" isAnimationActive={false} hide={hidden.newClient}>
              <LabelList
                dataKey="_total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyLabel(v)}
              />
              {!hidden.pctQuota && (
                <LabelList
                  dataKey="pctQuota"
                  position="top"
                  offset={18}
                  style={{ fontSize: 10, fontWeight: 600, fill: '#a16207' }}
                  formatter={(v) => v == null ? '' : `${v}%`}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function DealSizeCard({ data, hasOpps, onDownload }) {
  const hasAny = data.some(r => r.deals > 0);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Deal Size" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No closed opps yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 20, right: 16, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="deals"
              tick={{ fontSize: 12 }}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="dollars"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label, row) => row._isProjected ? 'Projected (YTD + active pipeline)' : `Year ${label}`}
                valueFormat={(v, name) => {
                  if (v == null) return '—';
                  if (name === 'Deals') return v.toLocaleString('en-US');
                  return v ? fmtMoneyLabel(v) : '$0';
                }}
                explain={(row) => ({
                  formula: 'Deals = count of closed opps (Sold + Not Sold). Quoted = mean Quoted Amount across closed opps. Deal Size = mean Quoted Amount of Sold opps only.',
                  inputs: [
                    { label: 'Deals (closed)', value: (row.deals ?? 0).toLocaleString('en-US') },
                    { label: 'Quoted mean', value: row.quoted == null ? '—' : `${fmtMoneyLabel(row.quoted)} (n=${row._quotedCount ?? 0})` },
                    { label: 'Deal Size mean', value: row.dealSize == null ? '—' : `${fmtMoneyLabel(row.dealSize)} (n=${row._soldCount ?? 0})` },
                  ],
                  note: row._isProjected ? 'Projected counts active pipeline opps as expected future closes.' : null,
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar yAxisId="deals" dataKey="deals" name="Deals" isAnimationActive={false} hide={hidden.deals}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#94a3b8'} />
              ))}
              <LabelList dataKey="deals" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#475569' }} />
            </Bar>
            <Line
              yAxisId="dollars"
              dataKey="quoted"
              name="Quoted"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.quoted}
            >
              <LabelList dataKey="quoted" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#991b1b' }} formatter={(v) => fmtMoneyLabel(v)} />
            </Line>
            <Line
              yAxisId="dollars"
              dataKey="dealSize"
              name="Deal Size"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.dealSize}
            >
              <LabelList dataKey="dealSize" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#1d4ed8' }} formatter={(v) => fmtMoneyLabel(v)} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function CommissionsCard({ data, hasCommissions, onDownload }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Commissions" onDownload={onDownload} canDownload={hasCommissions && data.length > 0} />
      {!hasCommissions ? (
        <div className={styles.empty}>No deals with a Paid to Date amount — add deals on the Clients › Deals tab.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No deals with a Current Term Start Date.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => fmtMoneyShort(v)}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                labelText={(label) => `Year ${label}`}
                valueFormat={(v) => (v == null ? '—' : fmtMoneyFull(v))}
                explain={(row) => ({
                  formula: 'Sum of each deal’s Paid to Date amount, bucketed by the calendar year of its Current Term Start Date. Paid to Date mirrors the Deals tab — the matching Commissions roster total when the BFO name maps, else the value stored on the deal.',
                  inputs: [
                    { label: 'Deals counted', value: (row._rowCount ?? 0).toLocaleString('en-US') },
                    { label: 'Total', value: fmtMoneyFull(row.total) },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="total" name="Commissions" fill="#3b82f6" isAnimationActive={false} hide={hidden.total}>
              <LabelList
                dataKey="total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyFull(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
