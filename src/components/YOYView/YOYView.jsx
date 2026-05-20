// YOY tab — recreates the Leads / Quoted Projections / Close Rate
// summary charts off the Opps tab data cached in IndexedDB.

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList, Cell,
} from 'recharts';
import { dbGet } from '../../utils/db';
import styles from './YOYView.module.css';

const OPPS_STORE = 'opps-cache';
const OPPS_KEY = 'data';
const PIPELINE_STORE = 'pipeline-dashboard';
const PIPELINE_KEY = 'current';
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

export function YOYView() {
  const [opps, setOpps] = useState(null);
  const [target, setTarget] = useState(DEFAULT_ANNUAL_TARGET);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const oppsSaved = await dbGet(OPPS_STORE, OPPS_KEY);
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
    })();
    function onFocus() {
      dbGet(OPPS_STORE, OPPS_KEY).then(o => setOpps(o || null)).catch(() => {});
      dbGet(PIPELINE_STORE, PIPELINE_KEY).then(p => {
        if (p && Number.isFinite(Number(p.target))) setTarget(Number(p.target));
      }).catch(() => {});
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
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      byYear.set(y, (byYear.get(y) || 0) + 1);
      if (y < minYear) minYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= currentYear; y++) {
      rows.push({ year: String(y), count: byYear.get(y) || 0, isProjected: false });
    }
    const ytdCount = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdCount / frac) : ytdCount;
    rows.push({ year: 'Projected', count: projected, isProjected: true });
    return rows;
  }, [records, currentYear]);

  // Quoted Projections — Dec-to-Nov fiscal year ending in the current
  // calendar year, monthly buckets keyed by Close Date. Quoted Weak/OK/
  // Expected come from the `Chance?` column; Agreements Sent from
  // `Status` == "Agreement Sent". BFO Pipe Total = sum of Quoted Amount
  // in month ÷ (annual target ÷ 12).
  const quotedData = useMemo(() => {
    const monthlyTarget = target > 0 ? target / 12 : 0;
    const months = fiscalMonths(currentYear);
    const indexByKey = new Map(months.map((m, i) => [m.key, i]));
    const rows = months.map((m) => ({
      month: m.label,
      year: m.year,
      weak: 0,
      ok: 0,
      expected: 0,
      agreements: 0,
      _quotedTotal: 0,
      _hasData: false,
    }));
    for (const r of records) {
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts)) continue;
      const d = new Date(ts);
      const idx = indexByKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (idx === undefined) continue;
      const amt = parseMoney(r['Quoted Amount']);
      if (typeof amt !== 'number' || amt <= 0) continue;
      const chance = String(r['Chance?'] || r['Chance'] || '').trim().toLowerCase();
      const status = String(r['Status'] || '').trim();
      const row = rows[idx];
      if (chance === 'weak') row.weak += amt;
      else if (chance === 'ok') row.ok += amt;
      else if (chance === 'expected') row.expected += amt;
      if (status === 'Agreement Sent') row.agreements += amt;
      if (chance === 'weak' || chance === 'ok' || chance === 'expected') {
        row._quotedTotal += amt;
      }
      row._hasData = true;
    }
    // Coverage ratio per month — sum of Quoted Amount across the 3
    // Chance buckets ÷ monthly quota target. Months without any opps
    // are left null so the dashed line breaks rather than dropping to 0.
    for (const row of rows) {
      if (monthlyTarget > 0 && row._hasData) {
        row.bfoPipe = +(row._quotedTotal / monthlyTarget).toFixed(2);
      } else {
        row.bfoPipe = null;
      }
    }
    return rows;
  }, [records, currentYear, target]);

  // Close Rate — stacked bar of In Progress / Sold / Not Sold per Open
  // Year (percentages summing to 100), plus two C/R lines.
  const closeRateData = useMemo(() => {
    if (records.length === 0) return [];
    // Group records by year.
    const byYear = new Map();
    let minYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= currentYear; y++) {
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

  // Quoted (Thousands) — sum of Quoted Amount per Open Year (any stage),
  // displayed in $k. Includes a Projected bar for the current year.
  const quotedByYearData = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      const amt = parseMoney(r['Quoted Amount']);
      const v = (typeof amt === 'number' && Number.isFinite(amt)) ? amt : 0;
      byYear.set(y, (byYear.get(y) || 0) + v);
      if (y < minYear) minYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= currentYear; y++) {
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
    rows.push({ year: 'Projected', thousands: projected, isProjected: true });
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
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= currentYear; y++) {
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
      });
    }
    // Projected Not Sold bar — annualize the current year's count.
    const ytdNotSold = (byYear.get(currentYear) || []).filter(r => String(r.Stage || '').trim() === 'Not Sold').length;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdNotSold / frac) : ytdNotSold;
    rows.push({
      year: 'Projected', notSold: projected, isProjected: true,
      avgOppLife: null, ageNotQuoted: null, quoteToClose: null,
    });
    return rows;
  }, [records, currentYear]);

  const hasOpps = records.length > 0;

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
        quotedByYear.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          'Quoted Amount': quotedAmt ?? 0,
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
    quotedByYear.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
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
    return { leads, quoted, closeRate, leadSources, quotedByYear, notSolds };
  }, [records, currentYear]);

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
    const monthlyTarget = target > 0 ? target / 12 : 0;
    const summary = quotedData.map(r => ({
      Month: r.month,
      'Quoted Weak ($)': round0(r.weak),
      'Quoted OK ($)': round0(r.ok),
      'Quoted Expected ($)': round0(r.expected),
      'Agreements Sent ($)': round0(r.agreements),
      'Quoted Total ($)': round0(r._quotedTotal),
      'Monthly Target ($)': monthlyTarget > 0 ? Math.round(monthlyTarget) : '',
      'BFO Pipe Total (ratio)': r.bfoPipe == null ? '' : r.bfoPipe,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `Quoted Projections ${currentYear}`, summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.quoted);
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
      Year: r.year,
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
        <div className={styles.row}>
          <LeadsCard data={leadsData} hasOpps={hasOpps} onDownload={downloadLeads} />
          <QuotedProjectionsCard data={quotedData} hasOpps={hasOpps} target={target} onDownload={downloadQuoted} />
          <CloseRateCard data={closeRateData} hasOpps={hasOpps} onDownload={downloadCloseRate} />
        </div>
        <div className={styles.row}>
          <LeadSourcesCard data={leadSourcesData} hasOpps={hasOpps} onDownload={downloadLeadSources} />
          <QuotedByYearCard data={quotedByYearData} hasOpps={hasOpps} onDownload={downloadQuotedByYear} />
          <NotSoldsCard data={notSoldsData} hasOpps={hasOpps} onDownload={downloadNotSolds} />
        </div>
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

function LeadsCard({ data, hasOpps, onDownload }) {
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
            <Tooltip formatter={(v) => v.toLocaleString('en-US')} />
            <Bar dataKey="count" isAnimationActive={false}>
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

function QuotedProjectionsCard({ data, hasOpps, target, onDownload }) {
  const monthlyTarget = target > 0 ? target / 12 : 0;
  const hasAnyValues = data.some(r => r._hasData);
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted Projections" onDownload={onDownload} canDownload={hasOpps && hasAnyValues} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAnyValues ? (
        <div className={styles.empty}>No opps with a Close Date between Dec {new Date().getFullYear() - 1} and Nov {new Date().getFullYear()}.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="dollars"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
            />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v.toFixed(2)}
            />
            <Tooltip
              formatter={(v, name) => {
                if (name === 'BFO Pipe Total') return [v == null ? '—' : v.toFixed(2), name];
                return [fmtMoneyFull(v), name];
              }}
              labelFormatter={(label) => `Month: ${label}${monthlyTarget > 0 ? ` (target ${fmtMoneyFull(Math.round(monthlyTarget))})` : ''}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="dollars" dataKey="weak" name="Quoted Weak" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false}>
              <LabelList dataKey="weak" position="top" style={{ fontSize: 10, fill: '#15803d' }} formatter={(v) => v ? fmtMoneyShort(v) : ''} />
            </Line>
            <Line yAxisId="dollars" dataKey="ok" name="Quoted OK" stroke="#eab308" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false}>
              <LabelList dataKey="ok" position="top" style={{ fontSize: 10, fill: '#a16207' }} formatter={(v) => v ? fmtMoneyShort(v) : ''} />
            </Line>
            <Line yAxisId="dollars" dataKey="expected" name="Quoted Expected" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false}>
              <LabelList dataKey="expected" position="top" style={{ fontSize: 10, fill: '#1d4ed8' }} formatter={(v) => v ? fmtMoneyShort(v) : ''} />
            </Line>
            <Line yAxisId="dollars" dataKey="agreements" name="Agreements Sent" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            <Line
              yAxisId="ratio"
              dataKey="bfoPipe"
              name="BFO Pipe Total"
              stroke="#111827"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
            >
              <LabelList dataKey="bfoPipe" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#111827' }} formatter={(v) => v == null ? '' : v.toFixed(2)} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function CloseRateCard({ data, hasOpps, onDownload }) {
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
            <Tooltip
              formatter={(v, name) => v == null ? ['—', name] : [`${v.toFixed(0)}%`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="pct" dataKey="totalNotSold" stackId="cr" name="Total Not Sold" fill="#ef4444" isAnimationActive={false} />
            <Bar yAxisId="pct" dataKey="totalSold" stackId="cr" name="Total Sold (OY)" fill="#facc15" isAnimationActive={false}>
              <LabelList
                dataKey="totalSold"
                position="insideTop"
                style={{ fontSize: 10, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => v >= 3 ? `${Math.round(v)}%` : ''}
              />
            </Bar>
            <Bar yAxisId="pct" dataKey="inProgress" stackId="cr" name="In Progress (OY)" fill="#3b82f6" isAnimationActive={false} />
            <Line yAxisId="cr" dataKey="quotedCR" name="Quoted C/R" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls>
              <LabelList dataKey="quotedCR" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#c2410c' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
            <Line yAxisId="cr" dataKey="totalCR" name="Total C/R" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls>
              <LabelList dataKey="totalCR" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#15803d' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function LeadSourcesCard({ data, hasOpps, onDownload }) {
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
            <Tooltip
              formatter={(v, name) => [v.toLocaleString('en-US'), name]}
              labelFormatter={(label) => `Lead Source: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="inProgress" stackId="ls" name="In Progress" fill="#3b82f6" isAnimationActive={false} />
            <Bar dataKey="notSold" stackId="ls" name="Not Sold" fill="#ef4444" isAnimationActive={false} />
            <Bar dataKey="sold" stackId="ls" name="Sold" fill="#facc15" isAnimationActive={false}>
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
            <Tooltip formatter={(v) => `$${v.toLocaleString('en-US')}k`} />
            <Bar dataKey="thousands" isAnimationActive={false}>
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
            <Tooltip
              formatter={(v, name) => {
                if (v == null) return ['—', name];
                if (name === 'Not Solds') return [v.toLocaleString('en-US'), name];
                return [`${v.toLocaleString('en-US')} days`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="notSold" name="Not Solds" isAnimationActive={false}>
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
            />
            <Line
              dataKey="quoteToClose"
              name="Quote to Close"
              stroke="#eab308"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
