// The quarterly Close Rates email's HTML and Excel attachment, from the
// report src/utils/closeRatesQuarterly.js builds. Pure (the workbook is
// written with xlsx, already a dependency), so the test renders it too.
//
// Layout, top to bottom, as the Close Rates tab reads:
//   the quarter's close rate against the quarter before and a year back
//   1. the Weekly email table (by stage, the months ending with the quarter)
//   2. by source, 3. by service, 4. by stage, each over the tab's window
//   the raw data: every closed opp those figures were built from
//
// Table-based, inline-styled markup like the Weekly Report email, so Outlook
// and Gmail draw it the same. No em dashes anywhere (CLAUDE.md).

import { periodLabel } from '../../src/utils/notSoldAnalysis.js';
import { trendTableRows, fmtRate } from '../../src/utils/closeRateDeepDive.js';

const INK = '#1E2A36';
const INK_SOFT = '#5A6B7E';
const MUTED = '#8896A6';
const BORDER = '#E2E8F0';
const SURFACE_ALT = '#F0F3F7';
const PAGE_BG = '#F4F6F9';
const GOOD = '#047857';
const BAD = '#B45309';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const WIDTH = 960;
// Trend tables show the most recent periods only, so a monthly window
// still fits the page; the totals and the attachment cover the whole window.
export const MAX_PERIOD_COLUMNS = 8;

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const table = (attrs, rows) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs}>${rows}</table>`;
const spacer = (h) => `<div style="line-height:${h}px;font-size:0;height:${h}px">&nbsp;</div>`;
const card = (inner) => table(`width="100%" style="border-collapse:separate;background:#fff;border:1px solid ${BORDER};border-radius:8px"`, `<tr><td style="padding:14px 16px">${inner}</td></tr>`);
const heading = (title, note) => `<div style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK};line-height:1.3">${esc(title)}${note ? `<span style="font-weight:400;font-size:12px;color:${MUTED};padding-left:8px">${esc(note)}</span>` : ''}</div>${spacer(8)}`;
const noteHtml = (text) => `<div style="margin-top:8px;font-family:${FONT};font-size:11px;line-height:1.45;color:${MUTED}">${esc(text)}</div>`;

// Trend-table cells are styled by class too (TREND_STYLE in the head).
const th = (label, { left = false } = {}) => `<th${left ? ' class="l"' : ''}>${esc(label)}</th>`;
const td = (html, { left = false, bold = false } = {}) => {
  const cls = [left ? 'l' : '', bold ? 'b' : ''].filter(Boolean).join(' ');
  return `<td${cls ? ` class="${cls}"` : ''}>${html}</td>`;
};
const TREND_STYLE = `table.t{border-collapse:collapse;width:100%;font-family:${FONT};font-size:12px;color:${INK}}`
  + `table.t th{padding:0 6px 5px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${BORDER};white-space:nowrap}`
  + `table.t td{padding:5px 6px;text-align:right;vertical-align:top;border-bottom:1px solid ${SURFACE_ALT};white-space:nowrap}`
  + 'table.t th.l,table.t td.l{text-align:left;white-space:normal}table.t td.b{font-weight:700}table.t tr.o td{background:#F8FAFC;font-weight:700}'
  + `table.t b{display:block}table.t i{display:block;font-style:normal;font-size:10px;color:${MUTED};font-weight:400}table.t .x{color:${MUTED}}`;

// A rate over its Sold / Closed count, or a dash when nothing closed: no
// evidence is not a 0% close rate.
const figure = (rate, wins, decided) => (decided ? `<b>${esc(fmtRate(rate))}</b><i>${wins}/${decided}</i>` : '<span class="x">-</span>');
const T_OPEN = '<table class="t" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">';

/** One trend (by source / service / stage) as a table. */
export function trendTableHtml(trend, { period, nameHeader, keepOrder = false }) {
  if (!trend?.periods?.length) return `<div style="font-family:${FONT};font-size:12px;color:${MUTED}">No closed opps in this window.</div>`;
  const periods = trend.periods.slice(-MAX_PERIOD_COLUMNS);
  const rows = trendTableRows(trend);
  const overall = rows.pop();
  const body = (keepOrder ? rows : [...rows].sort((a, b) => b.decided - a.decided)).filter(r => r.decided > 0);
  const line = (r) => `<tr${r.isOverall ? ' class="o"' : ''}>${td(esc(r.label), { left: true })}${td(figure(r.rate, r.wins, r.decided))}${periods.map(p => {
    const c = r.byPeriod?.[p];
    return td(figure(c?.rate, c?.wins, c?.decided));
  }).join('')}</tr>`;
  const clipped = trend.periods.length > periods.length
    ? noteHtml(`Showing the last ${periods.length} of ${trend.periods.length} periods; Window and the attachment cover all of them.`)
    : '';
  return `${T_OPEN}<tr>${th(nameHeader, { left: true })}${th('Window')}${periods.map(p => th(periodLabel(p, period))).join('')}</tr>\n${body.map(line).join('\n')}\n${line(overall)}</table>${clipped}`;
}

/** The Weekly email table (emailCloseRateTrend's shape). */
export function weeklyTableHtml(weekly) {
  if (!weekly?.months?.length || !weekly?.rows?.length) return `<div style="font-family:${FONT};font-size:12px;color:${MUTED}">Nothing closed in these months.</div>`;
  const cell = (c) => (c ? `<b>${esc(c.rate)}</b><i>${esc(c.count)}</i>` : '<span class="x">-</span>');
  const n = weekly.months.length;
  const body = weekly.rows.map(r => `<tr>${td(esc(r.label), { left: true })}${(r.cells || []).map(c => td(cell(c))).join('')}${td(cell(r.overall))}${td(cell(r.rolling12), { bold: true })}</tr>`).join('');
  return `${T_OPEN}<tr>${th('Stage reached', { left: true })}${weekly.months.map(m => th(m)).join('')}${th(`${n} mo`)}${th('12 mo')}</tr>${body}</table>`
    + noteHtml(`A deal counts toward every stage it reached, so the rates are not meant to add up. Each month is the deals whose Close Date falls in it. ${n} mo adds up the months shown; 12 mo is the rolling year to the end of the quarter.`);
}

// The raw-data table's columns, in order. The attachment has every column
// of the tab's Closed opps export, including the Reached Stage ones.
export const RAW_COLUMNS = ['Account', 'BFO Opp Name', 'Scope', 'Source', 'Stage', 'Start Date', 'Close Date', 'Period', 'Quoted Amount', 'Pull-through', 'Reached Lead'];

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return v === '' || v == null || !Number.isFinite(n) ? '' : `$${Math.round(n).toLocaleString('en-US')}`;
};

// The raw table can run to hundreds of rows, so its cells carry no inline
// styles: the <style> block in the head styles them by class, which keeps a
// big quarter's email well under the size where Gmail starts clipping.
const RAW_STYLE = `table.raw{border-collapse:collapse;width:100%;font-family:${FONT};font-size:11px;color:${INK}}`
  + `table.raw th{padding:0 5px 5px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${BORDER}}`
  + `table.raw td{padding:4px 5px;border-bottom:1px solid ${SURFACE_ALT};vertical-align:top}`
  + `table.raw td.n,table.raw th.n{text-align:right;white-space:nowrap}table.raw td.d{white-space:nowrap}`
  + `table.raw td.w{color:${GOOD};font-weight:600;white-space:nowrap}table.raw td.l{color:${BAD};font-weight:600;white-space:nowrap}`;
const RAW_CLASS = { 'Quoted Amount': 'n', 'Start Date': 'd', 'Close Date': 'd', Period: 'd' };

export function rawTableHtml(opps) {
  if (!opps?.length) return `<div style="font-family:${FONT};font-size:12px;color:${MUTED}">No closed opps in this window.</div>`;
  const body = opps.map((r) => `<tr>${RAW_COLUMNS.map(k => {
    if (k === 'Quoted Amount') return `<td class="n">${esc(money(r[k]))}</td>`;
    if (k === 'Stage') return `<td class="${/^sold$/i.test(String(r[k] || '').trim()) ? 'w' : 'l'}">${esc(r[k])}</td>`;
    const c = RAW_CLASS[k];
    return c ? `<td class="${c}">${esc(r[k] ?? '')}</td>` : `<td>${esc(r[k] ?? '')}</td>`;
  }).join('')}</tr>`).join('\n');
  return `<table class="raw" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${RAW_COLUMNS.map(k => `<th${k === 'Quoted Amount' ? ' class="n"' : ''}>${esc(k)}</th>`).join('')}</tr>\n${body}</table>`;
}

const cmp = (now, then, label) => {
  if (!now || !then) return `<div style="font-size:11px;color:${MUTED}">${esc(label)}: no closed opps</div>`;
  const d = Math.round(now.rate) - Math.round(then.rate);
  const colour = d > 0 ? GOOD : d < 0 ? BAD : INK_SOFT;
  const word = d === 0 ? 'level with' : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} pts on`;
  return `<div style="font-size:11px;color:${colour}">${esc(word)} ${esc(label)} (${esc(fmtRate(then.rate))}, ${then.wins}/${then.decided})</div>`;
};

export function filtersText(report) {
  const f = report.filters;
  const basis = f.dateBasis === 'open' ? 'Start Date' : 'Close Date';
  const windowText = `${basis} ${f.from || 'start'} to ${f.to}`;
  return [
    f.savedName ? `Saved filter "${f.savedName}"` : 'The tab\'s default view',
    `by ${f.period}`,
    f.presetLabel ? `${f.presetLabel} (${windowText})` : windowText,
    f.leadOrHigher ? `Lead stage or higher only (${report.counts.belowLead} left out)` : 'every stage',
    f.noPullThroughs ? `pull-throughs left out (${report.counts.pullThroughs})` : 'pull-throughs included',
  ].join(', ');
}

export function closeRatesQuarterlySubject(report) {
  const h = report.headline.quarter;
  return `Close rates, ${report.quarter.label}${h ? `: ${fmtRate(h.rate)} (${h.wins}/${h.decided})` : ''}`;
}

/** The whole email. */
export function renderCloseRatesQuarterlyHtml(report) {
  const { quarter, headline, filters } = report;
  const q = headline.quarter;
  const pLabel = (k) => periodLabel(k, 'quarter');
  const top = card(`
    <div style="font-family:${FONT};font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.05em;font-weight:700">Close rate, ${esc(quarter.label)} (${esc(quarter.start)} to ${esc(quarter.end)})</div>
    <div style="font-family:${FONT};font-size:30px;font-weight:700;color:${INK};line-height:1.2">${q ? esc(fmtRate(q.rate)) : '-'} <span style="font-size:14px;font-weight:500;color:${MUTED}">${q ? `${q.wins} sold of ${q.decided} closed` : 'nothing closed this quarter'}</span></div>
    <div style="font-family:${FONT}">${cmp(q, headline.prior, pLabel(headline.priorKey))}${cmp(q, headline.yearAgo, pLabel(headline.yearAgoKey))}</div>
    ${headline.window ? `<div style="font-family:${FONT};font-size:11px;color:${INK_SOFT};margin-top:6px">Whole window: ${esc(fmtRate(headline.window.rate))} (${headline.window.wins}/${headline.window.decided})</div>` : ''}
    ${noteHtml(`Close rate is Sold / (Sold + Not Sold). ${filtersText(report)}.`)}
  `);
  const period = filters.period;
  const periodName = { month: 'month', quarter: 'quarter', year: 'year' }[period] || period;
  const sections = [
    ['Close rate trend (Weekly email)', `last ${report.weeklyMonths} months, by stage reached`, weeklyTableHtml(report.weekly)],
    ['By source', `by ${periodName}`, trendTableHtml(report.bySource, { period, nameHeader: 'Source' })],
    ['By service', `by ${periodName}`, trendTableHtml(report.byService, { period, nameHeader: 'Service' }) + noteHtml('An opp counts toward each service on its Scope. Services hidden on By Service are left out.')],
    ['By stage', `by ${periodName}`, trendTableHtml(report.byStage, { period, nameHeader: 'Stage', keepOrder: true }) + noteHtml('An opp counts toward every stage it reached, so stage rows do not add up.')],
    ['Opportunities included', `${report.opps.length} closed opp${report.opps.length === 1 ? '' : 's'}, newest first`, rawTableHtml(report.opps) + noteHtml('Every closed opp behind the tables above. The attached Excel has the same rows with the Reached Stage columns.')],
  ];
  const body = sections.map(([title, note, html]) => `${spacer(18)}${heading(title, note)}${card(html)}`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${TREND_STYLE}${RAW_STYLE}</style></head>
<body style="margin:0;padding:0;background:${PAGE_BG}">
${table(`width="100%" style="background:${PAGE_BG}"`, `<tr><td align="center" style="padding:20px 10px">
  ${table(`width="100%" style="max-width:${WIDTH}px"`, `<tr><td>
    <div style="font-family:${FONT};font-size:20px;font-weight:700;color:${INK}">Quarterly close rates</div>
    <div style="font-family:${FONT};font-size:12px;color:${MUTED}">From Opps, Close Rates in Prospect Tracker</div>
    ${spacer(12)}${top}${body}
  </td></tr>`)}
</td></tr>`)}
</body></html>`;
}

/** The Excel attachment: the summary tables and the raw data. */
export async function closeRatesQuarterlyWorkbook(report) {
  const mod = await import('xlsx');
  const XLSX = mod.default || mod;
  const { trendSheetRows, weeklyTrendSheetRows } = await import('../../src/utils/closeRateDeepDive.js');
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing in this window.' }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  const period = report.filters.period;
  add('Opportunities', report.opps);
  add('Weekly email trend', report.weeklyRaw ? weeklyTrendSheetRows(report.weeklyRaw) : []);
  add('By source', trendSheetRows(report.bySource, { period, nameHeader: 'Source' }));
  add('By service', trendSheetRows(report.byService, { period, nameHeader: 'Service' }));
  add('By stage', trendSheetRows(report.byStage, { period, nameHeader: 'Stage' }));
  add('About', [
    { Item: 'Quarter', Value: `${report.quarter.label} (${report.quarter.start} to ${report.quarter.end})` },
    { Item: 'Filters', Value: filtersText(report) },
  ]);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
