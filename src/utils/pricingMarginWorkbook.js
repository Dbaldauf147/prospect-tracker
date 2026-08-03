// Pricing option → fee-margin Excel report.
//
// Two sheets: a Summary of every fee line on the option (what it bills
// over the term, what it costs, the margin that falls out), and a Fee
// Breakdown that shows, per fee, each cost item feeding it — its CTS,
// tech depreciation, the GM% it's marked up at, and how cost and revenue
// land year by year across the term. Every cost item on the option
// appears exactly once: costs that map to no fee get their own section
// at the end rather than being dropped.
//
// House ExcelJS style, matching pipelineWorkbook.js: SE palette, Nunito
// Sans, a branded header band per sheet, frozen panes and the repo's
// blob-anchor download. ExcelJS is lazy imported so it stays out of the
// main bundle. The caller passes an already-computed payload — this
// module formats, it does no pricing math of its own.

import { sanitizeExcelWorkbook, stripDashes } from './exportSanitize.js';

const SE_GREEN = 'FF3DCD58';
const SE_GREEN_DARK = 'FF009530';
const SE_TEXT_DARK = 'FF1E293B';
const SE_ZEBRA = 'FFF6F9F4';
const SE_BORDER = 'FFD4DDE1';
const SE_MUTED = 'FF64748B';
const FONT = 'Nunito Sans';

const OK_FILL = 'FFDCFCE7', OK_FG = 'FF166534';
const BAD_FILL = 'FFFEE2E2', BAD_FG = 'FF991B1B';

const MONEY = '$#,##0';
const MONEY2 = '$#,##0.00';
const PCT1 = '0.0%';
const INT = '#,##0';

const thin = { style: 'thin', color: { argb: SE_BORDER } };
const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function styleBody(cell, opts = {}) {
  cell.font = {
    name: FONT, size: 10, bold: !!opts.bold,
    color: { argb: opts.fg || (opts.muted ? SE_MUTED : SE_TEXT_DARK) },
  };
  cell.alignment = {
    vertical: 'middle', horizontal: opts.align || 'left',
    indent: opts.align === 'right' ? 1 : (opts.align ? 0 : 1),
    wrapText: !!opts.wrap,
  };
  cell.border = allBorders;
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

// Three-row branded band: title, subtitle, then the caller's header row.
function brandBand(ws, span, title, subtitle) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, span);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, color: { argb: 'FFFFFFFF' } };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 18;
  return 3;
}

function sectionBand(ws, row, span, text) {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 20;
}

function headerRow(ws, row, labels) {
  labels.forEach((label, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = label;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: SE_TEXT_DARK } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_ZEBRA } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', indent: 1, wrapText: true };
    c.border = allBorders;
  });
  ws.getRow(row).height = 28;
}

// Margin cell tint — green at or above the option's target, red below.
const marginTint = (margin, target) => {
  if (typeof margin !== 'number' || !Number.isFinite(margin)) return {};
  if (typeof target !== 'number' || !Number.isFinite(target)) return {};
  return margin >= target ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG };
};

const yearLabels = (n) => Array.from({ length: n }, (_, i) => `Year ${i + 1}`);

export async function downloadPricingMarginWorkbook(p) {
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook || (exceljs.default && exceljs.default.Workbook);
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();

  const generatedAt = p.generatedAt || new Date();
  const dateStr = generatedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const nY = Math.max(1, p.numYears || 1);
  const sub = [
    p.optionName,
    p.fileName,
    `${p.termMonths} month term`,
    `mapped by ${p.mapBy}`,
    dateStr,
  ].filter(Boolean).join('  ·  ');

  // ── Sheet 1: Summary ──────────────────────────────────────────────────
  {
    const SPAN = 6 + nY + 3;
    const ws = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    });
    ws.columns = [
      { width: 34 }, { width: 20 }, { width: 14 }, { width: 11 }, { width: 13 }, { width: 11 },
      ...Array.from({ length: nY }, () => ({ width: 15 })),
      { width: 16 }, { width: 16 }, { width: 11 },
    ];
    let r = brandBand(ws, SPAN, 'Fee Margin Summary', sub);
    r++;

    // Deal terms — the inputs every number below is derived from.
    sectionBand(ws, r, SPAN, 'Deal terms'); r++;
    const kv = (label, value, numFmt) => {
      styleBody(ws.getCell(r, 1), { bold: true });
      ws.getCell(r, 1).value = label;
      const b = ws.getCell(r, 2);
      b.value = value === '' || value == null ? null : value;
      styleBody(b, { align: 'right', numFmt });
      for (let c = 3; c <= SPAN; c++) styleBody(ws.getCell(r, c), {});
      ws.mergeCells(r, 3, r, SPAN);
      r++;
    };
    kv('Term (months)', num(p.termMonths), INT);
    kv('Years billed', nY, INT);
    kv('Annual price escalator', num(p.annualEscalator), PCT1);
    kv('Annual cost escalator', num(p.costEscalator), PCT1);
    kv('Tech depreciation uplift on cost', num(p.techDeprPct), PCT1);
    kv('Target GM% (global)', num(p.globalGmPct), PCT1);
    kv('Costs mapped to fees by', p.mapBy);
    r++;

    // Fee lines.
    sectionBand(ws, r, SPAN, 'Fee lines'); r++;
    headerRow(ws, r, [
      'Fee line item', 'Type', 'Unit', 'Units', 'Fee / unit', 'Fee source',
      ...yearLabels(nY).map(y => `${y} revenue`),
      'Term revenue', 'Term cost', 'Margin',
    ]);
    r++;

    for (const f of p.fees) {
      const cells = [
        [f.name, {}],
        [f.type || '', {}],
        [f.unit || '', { align: 'right' }],
        [num(f.unitCount), { align: 'right', numFmt: INT }],
        [num(f.feePerUnit), { align: 'right', numFmt: MONEY2 }],
        [f.feeSource, { align: 'right', muted: true }],
        ...f.revenueByYear.map(v => [num(v), { align: 'right', numFmt: MONEY }]),
        [num(f.termRevenue), { align: 'right', numFmt: MONEY, bold: true }],
        [num(f.termCost), { align: 'right', numFmt: MONEY }],
        [num(f.margin), { align: 'right', numFmt: PCT1, bold: true, ...marginTint(f.margin, p.globalGmPct) }],
      ];
      cells.forEach(([value, opts], i) => {
        const c = ws.getCell(r, i + 1);
        c.value = value === '' ? null : value;
        styleBody(c, opts);
      });
      r++;
    }

    // Totals across the fee schedule.
    const t = p.totals;
    const totalCells = [
      ['Total fees', { bold: true }],
      ['', {}], ['', {}], ['', {}], ['', {}], ['', {}],
      ...t.revenueByYear.map(v => [num(v), { align: 'right', numFmt: MONEY, bold: true }]),
      [num(t.termRevenue), { align: 'right', numFmt: MONEY, bold: true }],
      [num(t.termCost), { align: 'right', numFmt: MONEY, bold: true }],
      [num(t.margin), { align: 'right', numFmt: PCT1, bold: true, ...marginTint(t.margin, p.globalGmPct) }],
    ];
    totalCells.forEach(([value, opts], i) => {
      const c = ws.getCell(r, i + 1);
      c.value = value === '' ? null : value;
      styleBody(c, { fill: SE_ZEBRA, ...opts });
    });
    r += 2;

    // Costs carrying no fee — the gap between the deal's total cost and
    // the cost the fee lines actually recover.
    sectionBand(ws, r, SPAN, 'Cost coverage'); r++;
    kv('Cost items on this option', num(p.costItemCount), INT);
    kv('… mapped to a fee line', num(p.mappedCostItemCount), INT);
    kv('… not mapped to any fee', num(p.unmapped.costs.length), INT);
    kv('Term cost recovered by fees', num(t.termCost), MONEY);
    kv('Term cost with no fee behind it', num(p.unmapped.termCost), MONEY);
    kv('Term cost, all items', num(t.termCost + p.unmapped.termCost), MONEY);
  }

  // ── Sheet 2: Fee Breakdown ────────────────────────────────────────────
  {
    const SPAN = 8 + nY + 1;
    const ws = wb.addWorksheet('Fee Breakdown', {
      properties: { tabColor: { argb: SE_GREEN_DARK } },
      views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    });
    ws.columns = [
      { width: 40 }, { width: 18 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 9 }, { width: 15 },
      ...Array.from({ length: nY }, () => ({ width: 14 })),
      { width: 15 },
    ];
    let r = brandBand(ws, SPAN, 'Cost → Fee Margin Breakdown', sub);
    r++;

    const costHeader = [
      'Cost line item', 'Type', 'Pass-through', 'CTS', 'Tech depr.', 'Effective cost', 'GM%', 'Marked-up price',
      ...yearLabels(nY).map(y => `${y} cost`),
      'Term cost',
    ];

    // One block per fee: its cost rows, then the three lines that turn
    // those costs into the fee's margin over the term.
    const block = (title, costs, rows) => {
      sectionBand(ws, r, SPAN, title); r++;
      headerRow(ws, r, costHeader); r++;
      if (costs.length === 0) {
        const c = ws.getCell(r, 1);
        c.value = 'No cost items map to this fee.';
        styleBody(c, { muted: true });
        for (let i = 2; i <= SPAN; i++) styleBody(ws.getCell(r, i), {});
        ws.mergeCells(r, 1, r, SPAN);
        r++;
      }
      for (const c of costs) {
        const cells = [
          [c.lineItem, {}],
          [c.type || '', {}],
          [c.passThrough ? 'Yes' : '', { align: 'right', muted: true }],
          [num(c.cts), { align: 'right', numFmt: MONEY }],
          [num(c.techDepr), { align: 'right', numFmt: MONEY }],
          [num(c.effectiveCost), { align: 'right', numFmt: MONEY }],
          [num(c.gmPct), { align: 'right', numFmt: PCT1 }],
          [num(c.price), { align: 'right', numFmt: MONEY }],
          ...c.costByYear.map(v => [num(v), { align: 'right', numFmt: MONEY }]),
          [num(c.termCost), { align: 'right', numFmt: MONEY }],
        ];
        cells.forEach(([value, opts], i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = value === '' ? null : value;
          styleBody(cell, opts);
        });
        r++;
      }
      // Cost / revenue / margin, year by year — the markup over the term.
      const line = (label, values, opts = {}) => {
        const cells = [
          [label, { bold: true }],
          ['', {}], ['', {}], ['', {}], ['', {}], ['', {}], ['', {}], ['', {}],
          ...values.byYear.map(v => [num(v), { align: 'right', numFmt: opts.numFmt || MONEY, bold: true, ...(opts.tintEach ? marginTint(v, p.globalGmPct) : {}) }]),
          [num(values.total), { align: 'right', numFmt: opts.totalFmt || opts.numFmt || MONEY, bold: true, ...(opts.tintTotal ? marginTint(values.total, p.globalGmPct) : {}) }],
        ];
        cells.forEach(([value, o], i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = value === '' ? null : value;
          styleBody(cell, { fill: SE_ZEBRA, ...o });
        });
        r++;
      };
      if (rows) {
        line('Cost', { byYear: rows.costByYear, total: rows.termCost });
        line('Revenue (fee billed)', { byYear: rows.revenueByYear, total: rows.termRevenue });
        line('Margin', { byYear: rows.marginByYear, total: rows.margin }, {
          numFmt: PCT1, tintEach: true, tintTotal: true,
        });
      } else {
        line('Cost', { byYear: costs.reduce((acc, c) => acc.map((v, i) => v + (c.costByYear[i] || 0)), Array.from({ length: nY }, () => 0)), total: costs.reduce((s, c) => s + (c.termCost || 0), 0) });
      }
      r += 2;
    };

    for (const f of p.fees) {
      const feeLabel = `${f.name}  ·  ${f.type || 'no type'}  ·  ${f.feeSource === 'auto' ? 'auto-derived fee' : 'typed fee'}`;
      block(feeLabel, f.costs, {
        costByYear: f.costByYear,
        termCost: f.termCost,
        revenueByYear: f.revenueByYear,
        termRevenue: f.termRevenue,
        marginByYear: f.marginByYear,
        margin: f.margin,
      });
    }

    if (p.unmapped.costs.length > 0) {
      block(
        `Costs with no fee behind them  ·  ${p.unmapped.costs.length} item${p.unmapped.costs.length === 1 ? '' : 's'}  ·  not recovered by any fee line`,
        p.unmapped.costs,
        null,
      );
    }
  }

  sanitizeExcelWorkbook(wb);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = generatedAt.toISOString().slice(0, 10);
  a.href = url;
  a.download = stripDashes(`Fee Margin — ${p.optionName || 'Option'} — ${stamp}.xlsx`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
