// Schneider-Electric-formatted Excel export for a timeline.
//
// Two sheets:
//   Timeline — the Gantt rebuilt out of native cells: one row per stage, one
//              column per week / month / quarter, bars drawn as filled cells
//              and milestones as a diamond glyph. Native rather than a pasted
//              picture, so the user can widen it, recolour it, or paste the
//              block straight into another workbook.
//   Stages   — the flat table behind it, with real date cells and an
//              autofilter, for sorting and formulas.
//
// Browser-only: ExcelJS plus <canvas> for the logo, the same pairing the
// compliance export already uses.

import { schneiderLogoPngDataUrl, SE_GREEN_DARK } from './schneiderLogo.js';
import { ownerColor } from './timelineGraphic.js';
import { getStageRange, isoToMs, daysInMonth, monthLabel } from './timelineDates.js';

const argb = (hex) => 'FF' + String(hex).replace('#', '').toUpperCase();
const SE_DARK = argb(SE_GREEN_DARK);
const INK = 'FF0F172A';
const SLATE = 'FF475569';
const MUTE = 'FF94A3B8';
const LINE = 'FFE2E8F0';
const ZEBRA = 'FFFAFBFC';
const BAND = 'FFF1F5F9';
const FONT = 'Nunito Sans';
const DAY_MS = 86400000;

const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
// Excel reads a JS Date in local time; anchoring at UTC noon keeps a date from
// sliding to the previous day west of Greenwich.
const excelDate = (isoStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoStr || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
};
const fileSlug = (template) => {
  const base = String(template?.name || 'timeline').trim() || 'timeline';
  return base.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 60);
};

// Build the time axis: the column series covering every dated stage, at a
// granularity that keeps the sheet readable — weeks for a short engagement,
// months for a normal one, quarters for a multi-year programme.
function buildColumns(ranges) {
  const startMs = Math.min(...ranges.map(r => isoToMs(r.start)));
  const endMs = Math.max(...ranges.map(r => isoToMs(r.end)));
  const spanDays = (endMs - startMs) / DAY_MS;

  const cols = [];
  if (spanDays <= 150) {
    // Weekly, aligned to the Monday on or before the first stage.
    const first = new Date(startMs);
    const dow = (first.getUTCDay() + 6) % 7; // Monday = 0
    let cur = startMs - dow * DAY_MS;
    while (cur <= endMs && cols.length < 80) {
      const d = new Date(cur);
      cols.push({
        startMs: cur,
        endMs: cur + 6 * DAY_MS,
        label: String(d.getUTCDate()),
        group: monthLabel(d.getUTCFullYear(), d.getUTCMonth() + 1, true),
      });
      cur += 7 * DAY_MS;
    }
    return { cols, unit: 'week' };
  }

  const s = new Date(startMs), e = new Date(endMs);
  let y = s.getUTCFullYear(), m = s.getUTCMonth() + 1;
  const yEnd = e.getUTCFullYear(), mEnd = e.getUTCMonth() + 1;
  const months = [];
  while (months.length < 400) {
    months.push({ y, m });
    if (y === yEnd && m === mEnd) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }

  if (months.length <= 36) {
    months.forEach(({ y: yy, m: mm }) => {
      cols.push({
        startMs: Date.UTC(yy, mm - 1, 1),
        endMs: Date.UTC(yy, mm - 1, daysInMonth(yy, mm)),
        label: monthLabel(yy, mm, false),
        group: String(yy),
      });
    });
    return { cols, unit: 'month' };
  }

  const seen = new Set();
  months.forEach(({ y: yy, m: mm }) => {
    const q = Math.floor((mm - 1) / 3) + 1;
    const key = `${yy}Q${q}`;
    if (seen.has(key)) return;
    seen.add(key);
    const sm = (q - 1) * 3 + 1, em = sm + 2;
    cols.push({
      startMs: Date.UTC(yy, sm - 1, 1),
      endMs: Date.UTC(yy, em - 1, daysInMonth(yy, em)),
      label: `Q${q}`,
      group: String(yy),
    });
  });
  return { cols, unit: 'quarter' };
}

export async function exportTimelineXlsx(template, meta = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return false;

  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'Prospect Tracker';

  const rows = stages.map(stage => ({ stage, range: getStageRange(stage) }));
  const dated = rows.filter(r => r.range);

  const ws = wb.addWorksheet('Timeline', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false }],
  });

  const LEAD = 3; // Stage | Owner | Timing
  const { cols, unit } = dated.length
    ? buildColumns(dated.map(r => r.range))
    : { cols: [], unit: 'month' };
  // Narrow rotated headers once there are too many columns to label flat.
  const rotate = cols.length > 14;
  const timeWidth = unit === 'week' ? (rotate ? 4.2 : 6) : (rotate ? 4.6 : 11);
  const NCOLS = LEAD + cols.length;

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 17;
  cols.forEach((_, i) => { ws.getColumn(LEAD + 1 + i).width = timeWidth; });

  let r = 1;

  // --- brand band ---
  ws.mergeCells(r, 1, r, Math.max(NCOLS, 6));
  const title = ws.getCell(r, 1);
  title.value = template?.name?.trim() || 'Timeline';
  title.font = { name: FONT, bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  title.fill = fill(SE_DARK);
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 38;
  try {
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: 175 });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    // Anchored a couple of columns in from the right edge of the band.
    ws.addImage(id, {
      tl: { col: Math.max(3.2, NCOLS - (unit === 'week' ? 9 : 5)), row: r - 1 + 0.14 },
      ext: { width: logo.width, height: logo.height },
    });
  } catch { /* canvas unavailable — skip the logo */ }
  r += 1;

  ws.mergeCells(r, 1, r, Math.max(NCOLS, 6));
  const sub = ws.getCell(r, 1);
  const services = (template?.services || []).filter(Boolean).join(' · ');
  sub.value = `Engagement timeline${services ? ` — ${services}` : ''}${meta.generatedAt ? `   ·   Generated ${meta.generatedAt}` : ''}`;
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 18;
  r += 2;

  // --- axis header: group band over unit labels ---
  const groupRow = r, labelRow = r + 1;
  ws.getCell(groupRow, 1).value = 'STAGE';
  ws.getCell(groupRow, 2).value = 'OWNER';
  ws.getCell(groupRow, 3).value = 'TIMING';
  for (let c = 1; c <= LEAD; c += 1) {
    ws.mergeCells(groupRow, c, labelRow, c);
    const cell = ws.getCell(groupRow, c);
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
    cell.fill = fill(BAND);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  }

  // Merge runs of columns that share a group (month name over its weeks, year
  // over its months) so the axis reads at two levels.
  let runStart = 0;
  const todayMs = Date.UTC(
    new Date().getFullYear(), new Date().getMonth(), new Date().getDate(),
  );
  let todayCol = null;
  cols.forEach((col, i) => {
    const last = i === cols.length - 1;
    if (last || cols[i + 1].group !== col.group) {
      const c0 = LEAD + 1 + runStart, c1 = LEAD + 1 + i;
      if (c1 > c0) ws.mergeCells(groupRow, c0, groupRow, c1);
      const cell = ws.getCell(groupRow, c0);
      cell.value = col.group;
      cell.font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
      cell.fill = fill(BAND);
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      runStart = i + 1;
    }
    const lc = ws.getCell(labelRow, LEAD + 1 + i);
    lc.value = col.label;
    lc.font = { name: FONT, bold: true, size: 8.5, color: { argb: MUTE } };
    lc.fill = fill(BAND);
    lc.alignment = rotate
      ? { vertical: 'bottom', horizontal: 'center', textRotation: 90 }
      : { vertical: 'middle', horizontal: 'center' };
    lc.border = { bottom: { style: 'thin', color: { argb: LINE } } };
    if (todayMs >= col.startMs && todayMs <= col.endMs) todayCol = LEAD + 1 + i;
  });
  ws.getRow(groupRow).height = 18;
  ws.getRow(labelRow).height = rotate ? 42 : 18;
  r = labelRow + 1;

  // --- one row per stage ---
  rows.forEach(({ stage, range }, i) => {
    const color = argb(ownerColor(stage.owner));
    const row = ws.getRow(r);
    row.height = 20;

    const nameCell = ws.getCell(r, 1);
    nameCell.value = `${i + 1}.  ${stage.name || 'Untitled stage'}`;
    nameCell.font = { name: FONT, bold: true, size: 10.5, color: { argb: INK } };
    nameCell.alignment = { vertical: 'middle', indent: 1 };
    nameCell.border = { left: { style: 'medium', color: { argb: color } } };

    const ownerCell = ws.getCell(r, 2);
    ownerCell.value = stage.owner || '';
    ownerCell.font = { name: FONT, bold: true, size: 9, color: { argb: color } };
    ownerCell.alignment = { vertical: 'middle', indent: 1 };

    const timingCell = ws.getCell(r, 3);
    timingCell.value = stage.timing || (range ? '' : '— no dates —');
    timingCell.font = { name: FONT, size: 9.5, color: { argb: range ? SLATE : MUTE }, italic: !range };
    timingCell.alignment = { vertical: 'middle', indent: 1 };

    cols.forEach((col, ci) => {
      const cell = ws.getCell(r, LEAD + 1 + ci);
      if (i % 2 === 1) cell.fill = fill(ZEBRA);
      if (todayCol === LEAD + 1 + ci) {
        cell.border = { ...(cell.border || {}), left: { style: 'thin', color: { argb: SE_DARK } } };
      }
      if (!range) return;
      const rs = isoToMs(range.start), re = isoToMs(range.end);
      if (re < col.startMs || rs > col.endMs) return;
      if (range.milestone) {
        cell.value = '◆';
        cell.font = { name: FONT, size: 12, bold: true, color: { argb: color } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.fill = fill(color);
      }
    });
    r += 1;
  });

  // Freeze the stage labels and the axis so a wide chart stays navigable.
  ws.views = [{
    state: 'frozen', xSplit: LEAD, ySplit: labelRow, showGridLines: false,
  }];

  // --- legend + notes ---
  r += 1;
  const legendRow = r;
  ws.getCell(r, 1).value = 'Legend';
  ws.getCell(r, 1).font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
  ['Schneider Electric', 'Client', 'Both'].forEach((owner, i) => {
    const c = 2 + i;
    const cell = ws.getCell(legendRow, c);
    cell.value = owner;
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(argb(ownerColor(owner)));
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  r += 1;
  ws.getCell(r, 1).value = 'Filled cells show duration · ◆ marks a point-in-time milestone'
    + (todayCol ? ' · the green line marks today' : '');
  ws.getCell(r, 1).font = { name: FONT, italic: true, size: 9, color: { argb: MUTE } };
  r += 1;

  // Never let a stage vanish because its dates couldn't be read.
  const undated = rows.filter(x => !x.range).map(x => x.stage.name || 'Untitled stage');
  if (undated.length) {
    ws.getCell(r, 1).value = `No readable dates, so not plotted: ${undated.join(', ')}`;
    ws.getCell(r, 1).font = { name: FONT, italic: true, size: 9, color: { argb: 'FF92400E' } };
  }

  // --- sheet 2: the flat table ---
  const ds = wb.addWorksheet('Stages', { views: [{ showGridLines: false }] });
  ds.columns = [
    { header: '#', key: 'n', width: 5 },
    { header: 'Stage', key: 'stage', width: 30 },
    { header: 'Owner', key: 'owner', width: 20 },
    { header: 'Timing', key: 'timing', width: 18 },
    { header: 'Start', key: 'start', width: 13 },
    { header: 'End', key: 'end', width: 13 },
    { header: 'Days', key: 'days', width: 8 },
    { header: 'Description', key: 'desc', width: 62 },
  ];
  const head = ds.getRow(1);
  head.height = 22;
  head.eachCell(cell => {
    cell.font = { name: FONT, bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(SE_DARK);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  rows.forEach(({ stage, range }, i) => {
    const row = ds.addRow({
      n: i + 1,
      stage: stage.name || 'Untitled stage',
      owner: stage.owner || '',
      timing: stage.timing || '',
      start: range ? excelDate(range.start) : null,
      end: range ? excelDate(range.end) : null,
      days: range ? Math.round((isoToMs(range.end) - isoToMs(range.start)) / DAY_MS) + 1 : null,
      desc: stage.description || '',
    });
    row.height = 18;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: FONT, size: 10, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', indent: 1, wrapText: false };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (i % 2 === 1) cell.fill = fill(ZEBRA);
    });
    row.getCell('owner').font = { name: FONT, bold: true, size: 10, color: { argb: argb(ownerColor(stage.owner)) } };
    row.getCell('start').numFmt = 'm/d/yyyy';
    row.getCell('end').numFmt = 'm/d/yyyy';
    row.getCell('days').alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ds.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: 8 } };
  ds.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileSlug(template)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
