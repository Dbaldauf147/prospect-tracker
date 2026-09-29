// Two sheets both fee exports carry (the Pricing tab's Fee Margin Excel and
// the Fee Builder's Export to Excel):
//
//   Fee Summary              the fee lines as a client would read them:
//                            Fee line item, Type, Fee, Unit, Units, Start
//                            Month, one row per schedule row (or, on the
//                            Fee Builder's export, like lines combined).
//   Cost deltas              every cost line on the option, the fee each
//                            side logs it on and its term cost there, with
//                            the option's cost year by year.
//   Fee deltas               the Pricing tab's fees next to the ones the Fee
//                            Builder would build, fee by fee and year by
//                            year, with the delta between them.
//
// Both exports are fed the same two schedules (feeBuilderPlan's `beforeRows`
// and `rows`), so the two files agree with each other. Rows look like
//   { name, type, feePerUnit, unit, unitCount, startMonth, years: [..], term, cost }
// and a side's totals like { feeByYear: [..], costByYear: [..], margin }.

const norm = (s) => String(s ?? '').trim().toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = (v) => Math.round(v * 100) / 100;
const sum = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);

// One side's rows folded by fee name: a fee billed on two rows is one line.
function byFee(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const k = norm(r?.name);
    if (!k) continue;
    if (!out.has(k)) out.set(k, { name: String(r.name).trim(), rows: [] });
    out.get(k).rows.push(r);
  }
  for (const f of out.values()) {
    const one = (field) => {
      const vals = [...new Set(f.rows.map(r => r[field]).filter(v => v != null && v !== ''))];
      return vals.length === 1 ? vals[0] : (vals.length ? vals.join(' / ') : null);
    };
    f.type = one('type') || '';
    f.unit = one('unit') || '';
    f.feePerUnit = one('feePerUnit');
    f.startMonth = one('startMonth');
    f.unitCount = f.rows.reduce((s, r) => s + (Number(r.unitCount) || 0), 0) || null;
    f.term = sum(f.rows.map(r => r.term));
    f.cost = sum(f.rows.map(r => r.cost));
  }
  return out;
}

// The fee-by-fee comparison: every fee on either side, in the Pricing tab's
// order and then the Fee Builder's new ones, with what differs.
export function compareFeeSchedules(pricingRows, builderRows) {
  const a = byFee(pricingRows);
  const b = byFee(builderRows);
  const keys = [...a.keys(), ...[...b.keys()].filter(k => !a.has(k))];
  const same = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 0.005 : String(x ?? '') === String(y ?? ''));
  return keys.map(k => {
    const p = a.get(k) || null;
    const f = b.get(k) || null;
    const diffs = [];
    if (p && f) {
      if (!same(norm(p.type), norm(f.type))) diffs.push('Type');
      if (!same(p.feePerUnit, f.feePerUnit)) diffs.push('Fee');
      if (!same(norm(p.unit), norm(f.unit))) diffs.push('Unit');
      if (!same(p.unitCount, f.unitCount)) diffs.push('Units');
      if (!same(p.startMonth, f.startMonth)) diffs.push('Start Month');
      if (Math.abs(p.term - f.term) >= 0.5) diffs.push('Term fees');
      if (Math.abs(p.cost - f.cost) >= 0.5) diffs.push('Term cost');
    }
    const status = !p ? 'Only in Fee Builder' : (!f ? 'Only on Pricing tab' : (diffs.length ? `Differs: ${diffs.join(', ')}` : 'Match'));
    const fee = (side) => (typeof side?.feePerUnit === 'number' ? side.feePerUnit : null);
    return {
      name: (p || f).name,
      pricing: p, builder: f,
      feeDelta: fee(p) != null && fee(f) != null ? round2(fee(f) - fee(p)) : null,
      termDelta: (f?.term || 0) - (p?.term || 0),
      costDelta: (f?.cost || 0) - (p?.cost || 0),
      status,
      match: status === 'Match',
    };
  });
}

const THIN = { style: 'thin', color: { argb: 'FFD4DDE1' } };
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const FONT = 'Nunito Sans';
const MONEY2 = '$#,##0.00';
const MONEY = '$#,##0';
const INT = '#,##0';
const PCT1 = '0.0%';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function titleRows(ws, span, title, subtitle) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = fill('FF3DCD58');
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, span);
  const s = ws.getCell(2, 1);
  s.value = subtitle || '';
  s.font = { name: FONT, size: 10, color: { argb: 'FFFFFFFF' } };
  s.fill = fill('FF009530');
  s.alignment = { vertical: 'middle', indent: 1 };
  return 4;
}

function writeRow(ws, r, cells, { header = false, bold = false, shade = null } = {}) {
  cells.forEach((cell, i) => {
    const [value, fmt, align] = Array.isArray(cell) ? cell : [cell];
    const c = ws.getCell(r, i + 1);
    c.value = value === '' || value === undefined ? null : value;
    c.font = { name: FONT, size: 10, bold: header || bold, color: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle', horizontal: align || (i === 0 || typeof value === 'string' ? 'left' : 'right'), wrapText: header, indent: 1 };
    c.border = BORDERS;
    if (header) c.fill = fill('FFF1F5F9');
    else if (shade) c.fill = fill(shade);
    if (fmt) c.numFmt = fmt;
  });
}

// Fee lines that bill the same way folded into one: same name, type, unit,
// unit count and start month, with the per-unit fees added together. The
// Fee Builder often writes one fee from several services (three "Program
// monthly" lines, each Fixed x 1 from month 1), which a client should read
// as the one fee it is. Lines that differ in any of those keep their own
// row, so a fee that starts in month 4 on one line and month 1 on another
// still shows both. First appearance sets the order.
export function condenseFeeRows(rows) {
  const out = new Map();
  for (const row of rows || []) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const units = num(Number(row.unitCount));
    const start = num(Number(row.startMonth)) ?? 1;
    const k = [norm(name), norm(row.type), norm(row.unit), units ?? '', start].join('|');
    const fee = num(row.feePerUnit);
    const prev = out.get(k);
    if (!prev) {
      out.set(k, { ...row, name, unitCount: units, startMonth: start, feePerUnit: fee });
      continue;
    }
    if (fee != null) prev.feePerUnit = round2((prev.feePerUnit ?? 0) + fee);
    for (const f of ['term', 'cost']) {
      if (typeof row[f] === 'number' || typeof prev[f] === 'number') prev[f] = (Number(prev[f]) || 0) + (Number(row[f]) || 0);
    }
    if (Array.isArray(row.years) || Array.isArray(prev.years)) {
      const a = prev.years || [];
      const b = row.years || [];
      prev.years = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (Number(a[i]) || 0) + (Number(b[i]) || 0));
    }
  }
  return [...out.values()];
}

// Fee Summary: Fee line item, Type, Fee, Unit, Units, Start Month.
// `condense` folds like fee lines into one (see condenseFeeRows).
export function addFeeSummarySheet(wb, { rows: given = [], subtitle = '', title = 'Fee Summary', condense = false } = {}) {
  const rows = condense ? condenseFeeRows(given) : given;
  const ws = wb.addWorksheet('Fee Summary', {
    properties: { tabColor: { argb: 'FF3DCD58' } },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
  });
  ws.columns = [{ width: 36 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 10 }];
  let r = titleRows(ws, 6, title, subtitle) - 1;
  writeRow(ws, r++, ['Fee line item', 'Type', 'Fee', 'Unit', 'Units', 'Start Month'].map((h, i) => [h, null, i < 2 ? 'left' : 'right']), { header: true });
  for (const row of rows) {
    if (!String(row?.name || '').trim()) continue;
    writeRow(ws, r++, [
      [String(row.name).trim()],
      [row.type || '', null, 'left'],
      [num(row.feePerUnit), MONEY2],
      [row.unit || '', null, 'right'],
      [num(Number(row.unitCount)), INT],
      [num(Number(row.startMonth)) ?? 1, INT],
    ]);
  }
  if (!rows.length) writeRow(ws, r++, [['No fee lines.'], '', '', '', '', '']);
  return ws;
}

// A cost line on each side: the fee it is logged on, or null when no fee
// on that side carries it (so its cost is not counted there). A cost is
// logged on the fee named for it (its Fee Name / Automated Fee Name), the
// way the Deal margin counts cost. `pricedInto` is the Fee Builder fee
// whose standard fee was priced from the cost, which can be a fee the cost
// is not logged on (a structure fee named differently from the SIA's).
//   costLines  [{ lineItem, type, pricingFee, builderFee, pricedInto, byYear: [..] }]
export function compareCostLines(costLines = []) {
  return costLines.map(c => {
    const total = sum(c.byYear);
    const pricing = c.pricingFee ? total : 0;
    const builder = c.builderFee ? total : 0;
    let status = 'Match';
    if (c.pricingFee && !c.builderFee) status = 'Only on Pricing tab';
    else if (!c.pricingFee && c.builderFee) status = 'Only in Fee Builder';
    else if (!c.pricingFee && !c.builderFee) status = 'On no fee in either';
    if (!c.builderFee && c.pricedInto) status = `${status}; priced into "${c.pricedInto}" but not logged on it`;
    else if (norm(c.pricingFee) !== norm(c.builderFee)) status = 'On a different fee';
    return { ...c, pricing, builder, delta: builder - pricing, status, match: status === 'Match' || status === 'On no fee in either' };
  });
}

const DIFF = 'FFFEF3C7';

function sheetFor(wb, name, span, title, subtitle, widths) {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: 'FF009530' } },
    views: [{ showGridLines: false }],
  });
  ws.columns = widths.map(width => ({ width }));
  const box = { r: titleRows(ws, span, title, subtitle) };
  box.band = (text) => {
    ws.mergeCells(box.r, 1, box.r, span);
    const c = ws.getCell(box.r, 1);
    c.value = text;
    c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill('FF009530');
    c.alignment = { vertical: 'middle', indent: 1 };
    box.r++;
  };
  box.groups = (groups) => {
    for (const [label, from, to] of groups) {
      if (to > from) ws.mergeCells(box.r, from, box.r, to);
      const c = ws.getCell(box.r, from);
      c.value = label;
      c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF1E293B' } };
      c.alignment = { horizontal: 'center' };
      c.fill = fill('FFE2E8F0');
    }
    box.r++;
  };
  return { ws, box };
}

// Pricing tab, Fee Builder and delta, year by year, for one figure.
function yearlyBlock(ws, box, nY, label, pVals, bVals, extra = null) {
  const yrs = Array.from({ length: nY }, (_, i) => i);
  writeRow(ws, box.r++, ['', ...yrs.map(i => `Y${i + 1}`), 'Term', ...(extra ? [extra.header] : [])].map(h => [h, null, h ? 'right' : 'left']), { header: true });
  const row = (name, vals, ex, opts) => writeRow(ws, box.r++, [
    [name], ...yrs.map(i => [num(vals[i]) ?? 0, MONEY]), [sum(vals.slice(0, nY)), MONEY], ...(extra ? [[ex, extra.fmt]] : []),
  ], opts);
  const delta = yrs.map(i => (bVals[i] || 0) - (pVals[i] || 0));
  row(`${label}, Pricing tab`, pVals, extra?.pricing ?? null);
  row(`${label}, Fee Builder`, bVals, extra?.builder ?? null);
  row(`${label}, delta`, delta, extra && extra.pricing != null && extra.builder != null ? extra.builder - extra.pricing : null,
    { bold: true, shade: delta.some(v => Math.abs(v) >= 0.5) ? DIFF : null });
}

// Cost deltas: every cost line on the option, the fee each side logs it on,
// and what it costs over the term on each side. A cost only counts on a
// side where a fee carries it, the same way the Deal margin counts it.
export function addCostDeltaSheet(wb, { costLines = [], pricing, builder, numYears = 1, subtitle = '' } = {}) {
  const nY = Math.max(1, numYears);
  const SPAN = 9;
  const { ws, box } = sheetFor(wb, 'Cost deltas', SPAN, 'Cost deltas: Pricing tab vs Fee Builder', subtitle,
    [44, 20, 30, 14, 30, 14, 30, 14, 40]);
  box.band('Option cost');
  yearlyBlock(ws, box, nY, 'Cost', pricing?.totals?.costByYear || [], builder?.totals?.costByYear || []);
  box.r++;

  const cmp = compareCostLines(costLines);
  const differ = cmp.filter(c => !c.match);
  box.band(`Cost lines  ·  ${cmp.length} line${cmp.length === 1 ? '' : 's'}, ${differ.length} with a delta`);
  box.groups([['Pricing tab', 3, 4], ['Fee Builder', 5, 7]]);
  writeRow(ws, box.r++, ['Cost line item', 'Type', 'Logged on fee', 'Term cost', 'Logged on fee', 'Term cost', 'Priced into fee', 'Delta', 'Status']
    .map((h, i) => [h, null, i === 3 || i === 5 || i === 7 ? 'right' : 'left']), { header: true });
  // Lines with a delta first, biggest first, then the rest in their order.
  const ordered = [...differ.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)), ...cmp.filter(c => c.match)];
  for (const c of ordered) {
    writeRow(ws, box.r++, [
      [c.lineItem || '(unnamed line item)'],
      [c.type || '', null, 'left'],
      [c.pricingFee || 'No fee', null, 'left'],
      [c.pricing, MONEY],
      [c.builderFee || 'No fee', null, 'left'],
      [c.builder, MONEY],
      [c.pricedInto || '', null, 'left'],
      [c.delta, MONEY],
      [c.status, null, 'left'],
    ], { shade: c.match ? null : DIFF });
  }
  const tp = sum(cmp.map(c => c.pricing));
  const tb = sum(cmp.map(c => c.builder));
  writeRow(ws, box.r++, [['Total'], '', '', [tp, MONEY], '', [tb, MONEY], '', [tb - tp, MONEY], ''], { bold: true, shade: 'FFF6F9F4' });
  return ws;
}

// Fee deltas: the option's fees year by year, then fee by fee.
export function addFeeDeltaSheet(wb, { pricing, builder, numYears = 1, subtitle = '' } = {}) {
  const nY = Math.max(1, numYears);
  const SPAN = 16;
  const { ws, box } = sheetFor(wb, 'Fee deltas', SPAN, 'Fee deltas: Pricing tab vs Fee Builder', subtitle,
    [34, 20, 12, 13, 8, 8, 13, 20, 12, 13, 8, 8, 13, 12, 13, 30]);
  const marginOf = (t) => (typeof t?.margin?.finalMargin === 'number' ? t.margin.finalMargin : (typeof t?.margin === 'number' ? t.margin : null));
  box.band('Option fees');
  yearlyBlock(ws, box, nY, 'Fees', pricing?.totals?.feeByYear || [], builder?.totals?.feeByYear || [],
    { header: 'Deal margin', fmt: PCT1, pricing: marginOf(pricing?.totals), builder: marginOf(builder?.totals) });
  box.r++;

  const cmp = compareFeeSchedules(pricing?.rows, builder?.rows).map(c => {
    // Fees only here: a difference in the cost behind a fee is on the
    // Cost deltas sheet.
    const reasons = c.pricing && c.builder ? c.status.replace(/^Differs: /, '').split(', ').filter(x => x !== 'Term cost') : [];
    const status = c.pricing && c.builder ? (reasons.length ? `Differs: ${reasons.join(', ')}` : 'Match') : c.status;
    return { ...c, status, match: status === 'Match' };
  });
  const differ = cmp.filter(c => !c.match).length;
  box.band(`Fee lines  ·  ${cmp.length} fee${cmp.length === 1 ? '' : 's'}, ${differ} with a delta`);
  box.groups([['Pricing tab', 2, 7], ['Fee Builder', 8, 13], ['Delta', 14, 15]]);
  const side = ['Type', 'Fee', 'Unit', 'Units', 'Start Month', 'Term fees'];
  writeRow(ws, box.r++, [['Fee line item'], ...[...side, ...side, 'Fee', 'Term fees', 'Status']
    .map(h => [h, null, h === 'Type' || h === 'Status' ? 'left' : 'right'])], { header: true });
  const cellsOf = (x) => (x
    ? [[x.type || '', null, 'left'], [typeof x.feePerUnit === 'number' ? x.feePerUnit : (x.feePerUnit ?? null), MONEY2, 'right'], [x.unit || '', null, 'right'], [num(x.unitCount), INT], [x.startMonth ?? null, INT, 'right'], [x.term, MONEY]]
    : Array.from({ length: 6 }, () => ['']));
  for (const c of cmp) {
    writeRow(ws, box.r++, [
      [c.name], ...cellsOf(c.pricing), ...cellsOf(c.builder),
      [c.feeDelta, MONEY2], [c.termDelta, MONEY], [c.status, null, 'left'],
    ], { shade: c.match ? null : DIFF });
  }
  const tp = sum((pricing?.rows || []).map(x => x.term));
  const tb = sum((builder?.rows || []).map(x => x.term));
  writeRow(ws, box.r++, [
    ['Total'], '', '', '', '', '', [tp, MONEY], '', '', '', '', '', [tb, MONEY], '', [tb - tp, MONEY], '',
  ], { bold: true, shade: 'FFF6F9F4' });
  return ws;
}

// Both comparison sheets, costs then fees.
export function addFeeComparisonSheet(wb, opts = {}) {
  addCostDeltaSheet(wb, opts);
  addFeeDeltaSheet(wb, opts);
}
