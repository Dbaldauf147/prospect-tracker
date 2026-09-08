// What a <LiveValue> hover panel is made of: the row lists it prints and
// the Excel export of the full, uncapped set behind them.
//
// Split from the component (LiveValue.jsx) rather than sitting beside it so
// that file exports components and nothing else — a mixed module breaks
// Vite's fast refresh for everything importing it.

import { sanitizeSheetJsWorkbook } from '../../utils/exportSanitize.js';

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

// Short date like 6/22/26 for the breakdown row lists.
export function fmtShortDate(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s || '';
  return new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// Map a full source array into breakdown rows: the capped display slice
// (`data` + a `more` overflow count so a busy stage can't render thousands
// of <tr>) plus the full uncapped set (`allData`) so the "Export to Excel"
// button can write every contributing row, not just the ~50 shown.
export function mapRows(source, mapFn, opts = {}) {
  const { max = 50, exportMapFn = null, exportColumns = null, exportSource = null } = opts;
  const arr = source || [];
  const all = arr.map(mapFn);
  const out = { data: all.slice(0, max), more: Math.max(0, all.length - max), allData: all };
  // The Excel export can carry extra columns (e.g. Scope) the compact
  // on-screen panel omits, and can draw from a separately filtered row set
  // (via exportSource) — supplied here so the two stay decoupled.
  if (exportMapFn) out.exportData = (exportSource || arr).map(exportMapFn);
  if (exportColumns) out.exportColumns = exportColumns;
  return out;
}

// Build a breakdown row list from a close-rate `included` opp array.
export function closeRateRows(included, head) {
  return {
    head,
    columns: ['Result', 'Account', 'Close', 'Amount'],
    aligns: ['', '', '', 'num'],
    ...mapRows(included, o => [
      o.stage,
      o.account || '(no account)',
      fmtShortDate(o.closeDate),
      o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '-',
    ], {
      exportColumns: ['Result', 'Account', 'BFO Opportunity Name', 'Scope', 'Close', 'Amount'],
      exportMapFn: o => [
        o.stage,
        o.account || '(no account)',
        o.bfoName || '',
        o.scope || '',
        fmtShortDate(o.closeDate),
        o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '-',
      ],
    }),
  };
}

// Export a live-value breakdown to a one-sheet .xlsx: the metric's value,
// formula and inputs up top, then the FULL (uncapped) contributing rows —
// so a pinned panel can be dropped into Excel for deeper analysis.
//
// The file is named after the page that raised it (`filePrefix` on the
// breakdown, defaulting to the pipeline dashboard this came from), so a
// folder of exports still says where each one is from.
export async function exportBreakdown(data) {
  try {
  const mod = await import('xlsx');
  const XLSX = mod.utils ? mod : (mod.default || mod);
  const aoa = [];
  if (data.title) aoa.push([data.title]);
  if (data.value != null && data.value !== '') aoa.push(['Value', data.value]);
  if (data.formula) aoa.push(['Formula', data.formula]);
  if (Array.isArray(data.inputs)) for (const it of data.inputs) aoa.push([it.label, it.value]);
  const rows = data.rows;
  if (rows && Array.isArray(rows.exportColumns || rows.columns)) {
    aoa.push([]);
    if (rows.head) aoa.push([rows.head]);
    aoa.push(rows.exportColumns || rows.columns);
    for (const r of (rows.exportData || rows.allData || rows.data || [])) aoa.push(r);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Breakdown');
  const slug = String(data.title || 'live-value')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'live-value';
  const stamp = new Date().toISOString().slice(0, 10);
  sanitizeSheetJsWorkbook(wb);
  XLSX.writeFile(wb, `${data.filePrefix || 'pipeline'}-${slug}-${stamp}.xlsx`);
  } catch (err) {
    console.error('Live value breakdown export failed', err);
    if (typeof window !== 'undefined') window.alert('Sorry: the Excel export failed to generate.');
  }
}
