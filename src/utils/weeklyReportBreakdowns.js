// What a click on any figure of the Weekly Report tab opens: the number,
// the arithmetic behind it and the raw rows that produced it, with an
// "Excel" button that writes every row (components/common/LiveValue).
//
// The email carries these figures as pictures and bare numbers; the tab is
// where one that looks wrong gets traced, so every chart point and card on
// it answers with the records it was counted from. Pure builders, one per
// kind of figure, so scripts/weeklyReportBreakdowns.test.mjs can drive
// them without a browser.
import { mapRows, fmtShortDate } from '../components/common/liveValueBreakdown.js';
import { computeActivity, computeOppChanges } from './weeklyReport.js';
import { annualSalesProjection, parseMoney, parseDateYear, parseYear } from './oppsMetrics.js';

export const BREAKDOWN_FILE_PREFIX = 'weekly-report';

const DAY_MS = 24 * 60 * 60 * 1000;

const money = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '-');
const dateTime = (ms) => (Number.isFinite(ms)
  ? new Date(ms).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })
  : '');
const str = (v) => String(v ?? '').trim();

// Local midnight of a YYYY-MM-DD week key, and the week it opens.
export function weekWindow(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const start = new Date(y, m - 1, d).getTime();
  return { start, end: start + 7 * DAY_MS };
}

const weekOf = (key) => {
  const w = weekWindow(key);
  return w ? new Date(w.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : key;
};

// The fields of an Opps 2 record that a raw export should carry, in the
// order a reader scans them.
const OPP_COLUMNS = ['Account', 'Scope', 'BFO Opportunity Name', 'Stage', 'Status', 'Quoted Amount', 'Open Year', 'Close Date', 'Lead Source'];
const oppRow = (r) => [
  str(r?.Account) || '(no account)',
  str(r?.Scope),
  str(r?.['BFO Opportunity Name']),
  str(r?.Stage),
  str(r?.Status),
  money(parseMoney(r?.['Quoted Amount'])),
  str(r?.['Open Year']),
  str(r?.['Close Date']),
  str(r?.['Lead Source'] || r?.Source),
];

// ---- Emails sent, one week --------------------------------------------

// `point` is an emailsByWeek entry. The rows are the sends the live HubSpot
// feed holds for that week; a week answered from the Activity tab's
// recording has a count and no rows, and says so rather than exporting an
// empty list as if nothing had gone out.
export function emailsWeekBreakdown({ point, cache, senderEmail }) {
  const w = weekWindow(point?.key);
  const emails = w ? computeActivity(cache, senderEmail, w.start, w.end).emails : [];
  const value = point?.value;
  let note = '';
  if (value == null) note = 'No record for this week: the HubSpot feed does not reach back this far and the Activity tab did not record it.';
  else if (point?.recorded && emails.length !== value) {
    note = `Counted from the Activity tab's recording of this week. The HubSpot feed now holds ${emails.length} of those sends, which are the rows listed.`;
  }
  return {
    title: `Emails sent, week of ${weekOf(point?.key)}`,
    value: value == null ? 'No record' : `${value} email${value === 1 ? '' : 's'}`,
    formula: 'External emails you sent in HubSpot, Monday to Sunday',
    inputs: [{ label: 'Source', value: point?.recorded ? 'Activity tab recording' : 'Live HubSpot feed' }],
    rows: {
      head: 'Emails',
      columns: ['Sent', 'To', 'Subject'],
      ...mapRows(emails, e => [dateTime(e.ts), e.to.join(', '), e.subject]),
    },
    note,
    filePrefix: BREAKDOWN_FILE_PREFIX,
  };
}

// ---- New opps, one week -----------------------------------------------

export function newOppsWeekBreakdown({ point, records }) {
  const w = weekWindow(point?.key);
  const list = Array.isArray(records) ? records : [];
  const byId = new Map(list.map(r => [r?._id, r]));
  const found = w ? computeOppChanges(list, w.start, w.end).newOpps : [];
  const full = found.map(o => byId.get(o.id) || { Account: o.account, Scope: o.scope, Stage: o.stage });
  return {
    title: `New opps, week of ${weekOf(point?.key)}`,
    value: `${found.length} opp${found.length === 1 ? '' : 's'}`,
    formula: 'Opps 2 rows whose earliest tracked edit falls in the week',
    rows: {
      head: 'Opportunities',
      columns: ['Account', 'Scope', 'Stage'],
      ...mapRows(full, r => [str(r.Account) || '(no account)', str(r.Scope), str(r.Stage)], {
        exportColumns: OPP_COLUMNS, exportMapFn: oppRow,
      }),
    },
    note: 'A best-effort count: the data carries no creation date, so an opp first edited in the tool this week can appear even if it was created earlier.',
    filePrefix: BREAKDOWN_FILE_PREFIX,
  };
}

// ---- Coverage ratio, one week -----------------------------------------

// `log` is the coverage ratio log (week key -> reading). Every reading is
// listed, the clicked week first, so the export is the whole history the
// chart is drawn from.
export function coverageRatioWeekBreakdown({ point, log }) {
  const readings = log && typeof log === 'object' ? log : {};
  const r = readings[point?.key] || null;
  const keys = Object.keys(readings).sort().reverse();
  const ordered = [point?.key, ...keys.filter(k => k !== point?.key)].filter(k => readings[k]);
  const ratioStr = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}×` : '-');
  return {
    title: `Coverage ratio, week of ${weekOf(point?.key)}`,
    value: point?.value == null ? 'No reading' : ratioStr(point.value),
    formula: 'Open pipeline ÷ annual target',
    inputs: r ? [
      { label: 'Open pipeline', value: money(r.pipeline) },
      { label: 'Annual target', value: money(r.target) },
      { label: 'Goal', value: ratioStr(r.goal) },
      { label: 'Recorded', value: dateTime(r.at) },
    ] : [],
    rows: {
      head: 'Every weekly reading',
      columns: ['Week of', 'Ratio', 'Pipeline', 'Target'],
      aligns: ['', 'num', 'num', 'num'],
      ...mapRows(ordered, k => [weekOf(k), ratioStr(readings[k].ratio), money(readings[k].pipeline), money(readings[k].target)], {
        exportColumns: ['Week of', 'Ratio', 'Open pipeline', 'Annual target', 'Goal', 'Recorded'],
        exportMapFn: k => {
          const x = readings[k];
          return [k, x.ratio, x.pipeline ?? '', x.target ?? '', x.goal ?? '', dateTime(x.at)];
        },
      }),
    },
    note: point?.value == null ? 'Nobody opened the report or the Pipeline tab that week, so no reading was taken.' : '',
    filePrefix: BREAKDOWN_FILE_PREFIX,
  };
}

// ---- Account coverage, one week, one tier -----------------------------

// The detail lists ProgressView stores on each weekly snapshot, per chart.
const COVERAGE_DETAIL = {
  contactPct: { metric: 'Has HubSpot Contacts', yes: 'WithContacts', no: 'NoContacts' },
  dmPct: { metric: 'Decision Maker Identified', yes: 'WithDM', no: 'NoDM' },
};

export function accountCoverageBreakdown({ chart, point, tier, progressWeeks }) {
  const snap = (Array.isArray(progressWeeks) ? progressWeeks : []).find(w => w?.week === point?.key) || null;
  const d = COVERAGE_DETAIL[chart?.id];
  const details = snap?.details || {};
  const t = tier === 2 ? 't2' : 't1';
  const company = (v) => (typeof v === 'string' ? v : str(v?.company));
  const rows = [];
  if (d) {
    for (const v of details[`${t}${d.yes}`] || []) rows.push([company(v), 'Yes']);
    for (const v of details[`${t}${d.no}`] || []) rows.push([company(v), 'No']);
  }
  const yes = rows.filter(r => r[1] === 'Yes').length;
  const pct = tier === 2 ? point?.t2 : point?.t1;
  return {
    title: `${chart?.title || 'Account coverage'}, Tier ${tier}, week of ${weekOf(point?.key)}`,
    value: pct == null ? 'No reading' : `${pct}%`,
    formula: rows.length
      ? `${yes} of ${rows.length} Tier ${tier} accounts: ${d.metric}`
      : `Share of Tier ${tier} accounts: ${d ? d.metric : 'covered'}`,
    rows: {
      head: 'Accounts',
      columns: ['Company', d?.metric || 'Covered'],
      ...mapRows(rows, r => r),
    },
    note: !snap ? 'The Progress tab recorded no snapshot for this week.'
      : (!rows.length ? 'This week\'s snapshot predates the per-account lists, so only the percentage was kept.' : ''),
    filePrefix: BREAKDOWN_FILE_PREFIX,
  };
}

// ---- Headline KPI cards -----------------------------------------------

function soldThisYear(records, nowMs) {
  const year = new Date(nowMs).getFullYear();
  return (Array.isArray(records) ? records : []).filter(r => str(r?.Stage) === 'Sold'
    && (parseDateYear(r?.['Close Date']) ?? parseYear(r?.['Open Year'])) === year);
}

// Every open opp behind the pipeline figure, off the pasted BFO rows the
// ratio is computed from (bfoStageMetrics), stage by stage.
function bfoOpenRows(bfoMetrics) {
  const out = [];
  for (const [num, m] of Object.entries(bfoMetrics || {})) {
    for (const r of m?.rows || []) out.push({ stage: Number(num), ...r });
  }
  return out.sort((a, b) => b.stage - a.stage || (b.amount || 0) - (a.amount || 0));
}

const BFO_COLUMNS = ['Stage', 'Account', 'Opportunity', 'Amount'];
const bfoRowView = (r) => [`Stage ${r.stage}`, r.account || '(no account)', r.oppName, money(r.amount)];
const BFO_EXPORT_COLUMNS = ['Stage', 'Account', 'Opportunity', 'Scope', 'Amount', 'Age (days)'];
const bfoRowExport = (r) => [r.stage, r.account, r.oppName, r.scope, r.amount ?? '', r.age ?? ''];

export function kpiBreakdown({ key, card, kpis, records, bfoMetrics, nowMs = Date.now() }) {
  const base = { title: card?.label || key, value: card?.value, filePrefix: BREAKDOWN_FILE_PREFIX };
  if (key === 'progress') {
    const p = kpis?.progressToTarget || {};
    const sold = soldThisYear(records, nowMs)
      .sort((a, b) => (parseMoney(b['Quoted Amount']) || 0) - (parseMoney(a['Quoted Amount']) || 0));
    return {
      ...base,
      formula: 'Sold this year ÷ annual target',
      inputs: [
        { label: 'Sold this year', value: money(p.soldYTD) },
        { label: 'Annual target', value: money(p.target) },
        { label: 'On-pace amount today', value: money(p.onPaceAmount) },
      ],
      rows: {
        head: 'Deals sold this year',
        columns: ['Account', 'Close', 'Amount'],
        aligns: ['', '', 'num'],
        ...mapRows(sold, r => [str(r.Account) || '(no account)', fmtShortDate(r['Close Date']), money(parseMoney(r['Quoted Amount']))], {
          exportColumns: OPP_COLUMNS, exportMapFn: oppRow,
        }),
      },
    };
  }
  if (key === 'coverage') {
    const c = kpis?.coverageRatio || {};
    const rows = bfoOpenRows(bfoMetrics);
    return {
      ...base,
      formula: 'Open pipeline ÷ annual target',
      inputs: [
        { label: 'Open pipeline', value: money(c.pipelineActual) },
        { label: 'Annual target', value: money(c.target) },
        { label: 'Goal', value: Number.isFinite(c.goal) ? `${c.goal.toFixed(2)}×` : '-' },
      ],
      rows: {
        head: 'Open opps (BFO Activity)',
        columns: BFO_COLUMNS,
        aligns: ['', '', '', 'num'],
        ...mapRows(rows, bfoRowView, { exportColumns: BFO_EXPORT_COLUMNS, exportMapFn: bfoRowExport }),
      },
      note: c.live ? '' : 'No BFO Activity pasted: the pipeline is the last hand-entered stage actuals, so there are no opps to list.',
    };
  }
  // Projected year-end: the Annual Sales chart's Projected bar.
  const j = kpis?.projectedYearEnd || {};
  const { deals } = annualSalesProjection(records, { nowMs, dealFor: r => r });
  deals.sort((a, b) => (parseMoney(b['Quoted Amount']) || 0) - (parseMoney(a['Quoted Amount']) || 0));
  return {
    ...base,
    formula: 'Sold this year + open opps at Agreement Sent or Contracting',
    inputs: [
      { label: 'Sold this year', value: money(j.soldYTD) },
      { label: 'Agreements out', value: money(j.committedAmount) },
      { label: 'Annual target', value: money(j.target) },
    ],
    rows: {
      head: 'Deals in the projection',
      columns: ['Account', 'Stage', 'Amount'],
      aligns: ['', '', 'num'],
      ...mapRows(deals, r => [str(r.Account) || '(no account)', str(r.Stage), money(parseMoney(r['Quoted Amount']))], {
        exportColumns: OPP_COLUMNS, exportMapFn: oppRow,
      }),
    },
    note: j.overridden ? 'The projection is pinned by hand on the YOY Annual Sales chart, so these deals may not add up to it.' : '',
  };
}

// ---- Pipeline funnel, one stage ---------------------------------------

export function funnelStageBreakdown({ stage, bfoMetrics }) {
  const rows = bfoOpenRows({ [stage?.stageNum]: bfoMetrics?.[stage?.stageNum] });
  return {
    title: stage?.label || `Stage ${stage?.stageNum}`,
    value: `${stage?.countActual ?? 0} opps · ${money(stage?.amtActual)}`,
    formula: 'Open opps at this stage and their total amount',
    inputs: [
      { label: 'Close rate (365 days)', value: Number.isFinite(stage?.closeRate) ? `${Math.round(stage.closeRate * 100)}%` : '-' },
    ],
    rows: {
      head: 'Open opps (BFO Activity)',
      columns: BFO_COLUMNS,
      aligns: ['', '', '', 'num'],
      ...mapRows(rows, bfoRowView, { exportColumns: BFO_EXPORT_COLUMNS, exportMapFn: bfoRowExport }),
    },
    note: rows.length ? '' : 'No BFO Activity rows at this stage: the figures are the hand-entered stage actuals.',
    filePrefix: BREAKDOWN_FILE_PREFIX,
  };
}
