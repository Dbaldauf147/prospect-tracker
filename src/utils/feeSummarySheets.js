// Two sheets both fee exports carry (the Pricing tab's Fee Margin Excel and
// the Fee Builder's Export to Excel):
//
//   Fee Summary              the fee lines as a client would read them:
//                            Fee line item, Type, Fee, Unit, Units, Start
//                            Month, one row per schedule row.
//   Pricing vs Fee Builder   the Pricing tab's schedule next to the one the
//                            Fee Builder would build, fee by fee and year by
//                            year, with the delta between them, so a
//                            difference in fees or costs shows up.
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

// Fee Summary: Fee line item, Type, Fee, Unit, Units, Start Month.
export function addFeeSummarySheet(wb, { rows = [], subtitle = '', title = 'Fee Summary' } = {}) {
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

// Pricing vs Fee Builder: totals by year, then fee by fee.
export function addFeeComparisonSheet(wb, { pricing, builder, numYears = 1, subtitle = '' } = {}) {
  const nY = Math.max(1, numYears);
  const yrs = Array.from({ length: nY }, (_, i) => i);
  const ws = wb.addWorksheet('Pricing vs Fee Builder', {
    properties: { tabColor: { argb: 'FF009530' } },
    views: [{ showGridLines: false }],
  });
  const SPAN = 19;
  ws.columns = [{ width: 34 }, ...Array.from({ length: SPAN - 1 }, () => ({ width: 13 }))];
  let r = titleRows(ws, SPAN, 'Pricing tab vs Fee Builder', subtitle);

  const band = (text) => {
    ws.mergeCells(r, 1, r, SPAN);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill('FF009530');
    c.alignment = { vertical: 'middle', indent: 1 };
    r++;
  };
  const DIFF = 'FFFEF3C7';

  // Totals, year by year.
  band('Option totals');
  writeRow(ws, r++, ['', ...yrs.map(i => `Y${i + 1}`), 'Term', 'Deal margin'].map(h => [h, null, h ? 'right' : 'left']), { header: true });
  const pSide = pricing?.totals || { feeByYear: [], costByYear: [] };
  const bSide = builder?.totals || { feeByYear: [], costByYear: [] };
  const line = (label, vals, fmt, extra = [], opts = {}) => writeRow(ws, r++, [
    [label], ...yrs.map(i => [num(vals[i]) ?? 0, fmt]), [sum(vals.slice(0, nY)), fmt], ...extra,
  ], opts);
  const marginOf = (t) => (typeof t?.margin?.finalMargin === 'number' ? t.margin.finalMargin : (typeof t?.margin === 'number' ? t.margin : null));
  const deltaFee = yrs.map(i => (bSide.feeByYear[i] || 0) - (pSide.feeByYear[i] || 0));
  const deltaCost = yrs.map(i => (bSide.costByYear[i] || 0) - (pSide.costByYear[i] || 0));
  const pm = marginOf(pSide);
  const bm = marginOf(bSide);
  line('Fees, Pricing tab', pSide.feeByYear, MONEY, [[pm, PCT1]]);
  line('Fees, Fee Builder', bSide.feeByYear, MONEY, [[bm, PCT1]]);
  line('Fees, delta', deltaFee, MONEY, [[pm != null && bm != null ? bm - pm : null, PCT1]], { bold: true, shade: deltaFee.some(v => Math.abs(v) >= 0.5) ? DIFF : null });
  line('Cost, Pricing tab', pSide.costByYear, MONEY, [['']]);
  line('Cost, Fee Builder', bSide.costByYear, MONEY, [['']]);
  line('Cost, delta', deltaCost, MONEY, [['']], { bold: true, shade: deltaCost.some(v => Math.abs(v) >= 0.5) ? DIFF : null });
  const carried = (side) => sum((side?.rows || []).map(x => x.cost));
  const pNoFee = sum(pSide.costByYear.slice(0, nY)) - carried(pricing);
  const bNoFee = sum(bSide.costByYear.slice(0, nY)) - carried(builder);
  r++;
  writeRow(ws, r++, [['Term cost with no fee behind it'], ['Pricing tab', null, 'right'], [pNoFee, MONEY], ['Fee Builder', null, 'right'], [bNoFee, MONEY], ['Delta', null, 'right'], [bNoFee - pNoFee, MONEY]],
    { shade: Math.abs(bNoFee - pNoFee) >= 0.5 ? DIFF : null });
  r++;

  // Fee by fee.
  const cmp = compareFeeSchedules(pricing?.rows, builder?.rows);
  const differ = cmp.filter(c => !c.match).length;
  band(`Fee lines  ·  ${cmp.length} fee${cmp.length === 1 ? '' : 's'}, ${differ} with a delta`);
  // Group labels over the three blocks.
  const groups = [['Pricing tab', 2, 8], ['Fee Builder', 9, 15], ['Delta', 16, 18]];
  for (const [label, from, to] of groups) {
    ws.mergeCells(r, from, r, to);
    const c = ws.getCell(r, from);
    c.value = label;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF1E293B' } };
    c.alignment = { horizontal: 'center' };
    c.fill = fill('FFE2E8F0');
  }
  r++;
  const side = ['Type', 'Fee', 'Unit', 'Units', 'Start Month', 'Term fees', 'Term cost'];
  writeRow(ws, r++, [['Fee line item'], ...[...side, ...side, 'Fee', 'Term fees', 'Term cost', 'Status'].map(h => [h, null, 'right'])], { header: true });
  const cellsOf = (s) => (s
    ? [[s.type || '', null, 'right'], [typeof s.feePerUnit === 'number' ? s.feePerUnit : (s.feePerUnit ?? null), MONEY2], [s.unit || '', null, 'right'], [num(s.unitCount), INT], [s.startMonth ?? null, INT], [s.term, MONEY], [s.cost, MONEY]]
    : Array.from({ length: 7 }, () => ['']));
  for (const c of cmp) {
    writeRow(ws, r++, [
      [c.name],
      ...cellsOf(c.pricing),
      ...cellsOf(c.builder),
      [c.feeDelta, MONEY2], [c.termDelta, MONEY], [c.costDelta, MONEY],
      [c.status, null, 'left'],
    ], { shade: c.match ? null : DIFF });
  }
  const tp = sum((pricing?.rows || []).map(x => x.term));
  const tb = sum((builder?.rows || []).map(x => x.term));
  const cp = carried(pricing);
  const cb = carried(builder);
  writeRow(ws, r++, [
    ['Total'], '', '', '', '', '', [tp, MONEY], [cp, MONEY], '', '', '', '', '', [tb, MONEY], [cb, MONEY], '', [tb - tp, MONEY], [cb - cp, MONEY], '',
  ], { bold: true, shade: 'FFF6F9F4' });
  ws.getColumn(SPAN).width = 34;
  return ws;
}
