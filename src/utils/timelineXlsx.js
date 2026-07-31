// Schneider-Electric-formatted Excel export for a timeline.
//
// Two sheets:
//   Timeline — the Gantt rebuilt out of native cells: one row per stage, one
//              column per week / month / quarter, and bars drawn as filled
//              cells. Native rather than a pasted picture, so the user can
//              widen it, recolour it, or paste the block straight into another
//              workbook. Milestones are the one exception: they're floating
//              diamond images, because only a picture can sit at the day
//              inside a month column — and can then be dragged.
//   Stages   — the flat table behind it, with real date cells and an
//              autofilter, for sorting and formulas.
//
// Browser-only: ExcelJS plus <canvas> for the logo, the same pairing the
// compliance export already uses.

import { schneiderLogoPngDataUrl, SE_GREEN_DARK, SE_GREEN } from './schneiderLogo.js';
import { ownerColor, WORKSTREAM_COLOR } from './timelineGraphic.js';
import {
  getStageRange, isoToMs, daysInMonth, monthLabel,
  timelineBaseMonth, getStageMonths, anchorPlus, todayMonthIndex, stageMonthFraction,
  timelineWeekTicks, flattenWeekTicks, resolveMonthWindow, monthWindowBounds,
} from './timelineDates.js';

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

// Light rule on all four sides, so the grid reads as a table rather than
// floating bars. Applied to the whole block including empty cells.
const THIN = { style: 'thin', color: { argb: LINE } };
const BOXED = { top: THIN, left: THIN, bottom: THIN, right: THIN };
function applyGridBorders(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getCell(r, c);
      cell.border = { ...(cell.border || {}), ...BOXED };
    }
  }
}

// Green rule around the outside of the whole export block — title band down
// through the legend — so the sheet reads as one framed deliverable rather
// than a table that happens to sit near a heading.
function frameBlock(ws, r1, c1, r2, c2) {
  const edge = { style: 'medium', color: { argb: argb(SE_GREEN) } };
  for (let c = c1; c <= c2; c += 1) {
    const top = ws.getCell(r1, c);
    top.border = { ...(top.border || {}), top: edge };
    const bottom = ws.getCell(r2, c);
    bottom.border = { ...(bottom.border || {}), bottom: edge };
  }
  for (let r = r1; r <= r2; r += 1) {
    const left = ws.getCell(r, c1);
    left.border = { ...(left.border || {}), left: edge };
    const right = ws.getCell(r, c2);
    right.border = { ...(right.border || {}), right: edge };
  }
}
// --- Milestone diamonds as floating pictures ----------------------------
// A milestone happens on a day, but a column is a whole month, so a cell can
// only ever put the mark at the left, middle or right of it — text indent is
// measured in characters and starts the glyph rather than centring it, which
// is what pushed the old diamonds right of where the chart drew them. A
// picture can be anchored at an exact offset inside the cell, so it lands on
// the same day the website does. It's also an ordinary Excel shape, so it can
// be dragged somewhere else.

const EMU_PER_PX = 9525;
// Excel's column width is in characters of the default font; this is the
// standard conversion to pixels at 96 DPI (7px per character plus padding).
const colWidthPx = (chars) => Math.round(chars * 7 + 5);
// Width of one week column on the Implementation grid, shared by the column
// setup and the milestone placement so the two can't drift apart.
const WEEK_COL_CHARS = 3.4;
// Row heights are points.
const rowHeightPx = (points) => Math.round((points * 4) / 3);

// The diamond itself, rasterized on a canvas — ExcelJS only takes raster
// formats. Matches the chart's marker: workstream colour, white step number,
// and a "Both" diamond split down the middle. Browser-only, like the logo.
function milestoneDiamondPng({ size, owner, label, scale = 4 }) {
  const canvas = document.createElement('canvas');
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const mid = size / 2;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(mid, 0.5);
    ctx.lineTo(size - 0.5, mid);
    ctx.lineTo(mid, size - 0.5);
    ctx.lineTo(0.5, mid);
    ctx.closePath();
  };
  if (owner === 'Both') {
    ctx.save();
    outline();
    ctx.clip();
    ctx.fillStyle = WORKSTREAM_COLOR['Client'];
    ctx.fillRect(0, 0, mid, size);
    ctx.fillStyle = WORKSTREAM_COLOR['Schneider Electric'];
    ctx.fillRect(mid, 0, mid, size);
    ctx.restore();
  } else {
    ctx.fillStyle = WORKSTREAM_COLOR[owner] || WORKSTREAM_COLOR['Schneider Electric'];
    outline();
    ctx.fill();
  }
  if (label != null && label !== '') {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${Math.round(size * 0.44)}px "Nunito Sans", "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(label), mid, mid + 0.5);
  }
  return canvas.toDataURL('image/png');
}

// Drop a milestone diamond `frac` of the way across a run of columns (0 = the
// 1st of the month, 1 = the last day; null centres it). `cols` is the columns
// the month covers — one wide month column on the Gantt sheet, four week
// columns on the Implementation sheet — so the diamond lands on the day
// itself rather than snapping to whichever column happens to contain it.
// Placement mirrors the chart: a 3px inset each side, and the diamond kept
// fully inside the month so an end-of-month milestone doesn't bleed into the
// next one.
//
// The offsets go in as raw EMU rather than through ExcelJS's fractional
// `col` / `row` setters — those scale by `width * 10000`, which is not the
// column's real width, and would land the picture in the wrong place.
//
// Returns false when the canvas isn't available, so the caller can fall back
// to a text glyph rather than exporting a milestone-shaped hole.
function addMilestoneImage(wb, ws, { cols, row, rowPoints, frac, owner, label }) {
  const widths = cols.map(c => colWidthPx(c.chars));
  const total = widths.reduce((a, b) => a + b, 0);
  const rowPx = rowHeightPx(rowPoints);
  const size = Math.max(12, Math.min(26, total - 2, rowPx - 4));
  const pad = Math.min(3, Math.max(0, (total - size) / 2));
  const usable = Math.max(size, total - pad * 2);
  const centerX = pad + (frac == null
    ? usable / 2
    : Math.min(Math.max(frac * usable, size / 2), usable - size / 2));
  // An anchor offset has to be measured from a real column, so walk the run to
  // find which one the picture's left edge lands in and what's left over.
  let left = Math.max(0, centerX - size / 2);
  let idx = 0;
  while (idx < widths.length - 1 && left >= widths[idx]) {
    left -= widths[idx];
    idx += 1;
  }
  try {
    const dataUrl = milestoneDiamondPng({ size, owner, label });
    const id = wb.addImage({ base64: dataUrl, extension: 'png' });
    ws.addImage(id, {
      tl: {
        nativeCol: cols[idx].col - 1,
        nativeColOff: Math.round(left * EMU_PER_PX),
        nativeRow: row - 1,
        nativeRowOff: Math.round(Math.max(0, (rowPx - size) / 2) * EMU_PER_PX),
      },
      ext: { width: size, height: size },
      // Moves with its cell when rows/columns shift, keeps its size, and stays
      // draggable.
      editAs: 'oneCell',
    });
    return true;
  } catch {
    return false; // canvas unavailable — caller falls back to the glyph
  }
}

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
// `bounds` is the timeline's declared date range. Given one, the columns
// cover exactly those months instead of shrink-wrapping the dated stages, so
// the sheet lines up with the visual column for column.
function buildColumns(ranges, bounds) {
  const startMs = bounds ? bounds.startMs : Math.min(...ranges.map(r => isoToMs(r.start)));
  const endMs = bounds ? bounds.endMs - DAY_MS : Math.max(...ranges.map(r => isoToMs(r.end)));
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

// Shared brand band across the top of the Timeline sheet: the title on green,
// then a blank spacer row before the table starts on row 3.
function writeBandHeader(wb, ws, template, ncols, logoCol) {
  ws.mergeCells(1, 1, 1, Math.max(ncols, 6));
  const title = ws.getCell(1, 1);
  title.value = template?.name?.trim() || 'Timeline';
  title.font = { name: FONT, bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  title.fill = fill(SE_DARK);
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 38;
  try {
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: 175 });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: logoCol, row: 0.14 }, ext: { width: logo.width, height: logo.height } });
  } catch { /* canvas unavailable — skip the logo */ }

  ws.getRow(2).height = 14;
}

// Implementation layout in cells: phase names merged down column A, one row
// per step, and the month grid to the right. Chips become filled cells
// carrying the step number, so the numbering still lines up with the deck.
function writePhasedSheet(wb, ws, template) {
  const stages = template.stages;
  const baseMonth = timelineBaseMonth(stages);
  const mode = template?.positionMode === 'months' ? 'months' : 'dates';
  const placed = stages.map(stage => ({ stage, ...getStageMonths(stage, baseMonth, mode) }));
  const needed = Math.max(...placed.map(p => p.month + p.span - 1), 1);
  // Same resolver the on-screen visual uses, so the sheet's columns are the
  // visual's columns — a declared date range drives both.
  const monthWindow = resolveMonthWindow(template, needed);
  const monthCount = monthWindow.monthCount;
  const calendar = monthWindow.calendar;
  const anchor = monthWindow.anchor;
  const todayCol = calendar ? todayMonthIndex(anchor, monthCount) : null;

  // Each month is split into its week columns, so the grid carries a month
  // band over a week row — the same two-level axis the graphic draws. Steps
  // are still placed by month, so a bar fills every week column of the months
  // it spans.
  const weekTicks = timelineWeekTicks(anchor, monthCount, calendar);
  const weekCols = flattenWeekTicks(weekTicks);
  const NW = weekCols.length;
  const monthFirst = new Map();
  const monthLast = new Map();
  weekCols.forEach((c, i) => {
    if (!monthFirst.has(c.month)) monthFirst.set(c.month, i + 1);
    monthLast.set(c.month, i + 1);
  });
  // Which week column of a month a 0–1 position across that month lands in —
  // the last week that has started by then. Used for the today marker and for
  // placing a milestone on its day.
  const weekColumnFor = (month, frac) => {
    const first = monthFirst.get(month) ?? 1;
    const weeks = weekTicks[month - 1]?.weeks || [];
    if (frac == null || !weeks.length) return first;
    let idx = 0;
    weeks.forEach((w, i) => { if (frac >= w.from) idx = i; });
    return first + idx;
  };
  // The week the current day sits in, on a calendar timeline.
  let todayWeekCol = null;
  if (todayCol) {
    const cal = anchorPlus(anchor, todayCol - 1);
    const now = new Date();
    todayWeekCol = weekColumnFor(
      todayCol,
      cal ? (now.getDate() - 1) / daysInMonth(cal.y, cal.m) : null,
    );
  }

  // With no phases set, every band borrows its own step's name — so a Step
  // column would just repeat column A down the sheet. Drop it and let Stages
  // carry the names. Once phases exist the two say different things (the band
  // vs the step inside it) and both are worth the width.
  const anyPhase = stages.some(st => String(st?.phase || '').trim());
  const LEAD = anyPhase ? 3 : 2;  // Stages [| Step] | Workstream
  const DESC = LEAD + NW + 1;     // Description, past the right of the grid
  const NCOLS = DESC;
  ws.getColumn(1).width = anyPhase ? 32 : 46;
  ws.getColumn(2).width = anyPhase ? 46 : 20;
  if (anyPhase) ws.getColumn(3).width = 20;
  for (let i = 0; i < NW; i += 1) ws.getColumn(LEAD + 1 + i).width = WEEK_COL_CHARS;
  ws.getColumn(DESC).width = 64;

  writeBandHeader(wb, ws, template, NCOLS, Math.max(3.2, NCOLS - 16));

  // Axis header — row 3, straight under the title band and its spacer: the
  // month band, with the week ticks on the row below it.
  const headRow = 3;
  const weekRow = headRow + 1;
  (anyPhase ? ['Stages', 'Step', 'Workstream'] : ['Stages', 'Workstream']).forEach((label, i) => {
    // The lead columns span both header rows, except the last one — the
    // Workstream column keeps its second row free for the caption that names
    // the week numbers.
    if (i + 1 < LEAD) ws.mergeCells(headRow, i + 1, weekRow, i + 1);
    const cell = ws.getCell(headRow, i + 1);
    cell.value = label;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(argb(SE_GREEN));
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  for (let m = 1; m <= monthCount; m += 1) {
    const c0 = LEAD + monthFirst.get(m);
    const c1 = LEAD + monthLast.get(m);
    if (c1 > c0) ws.mergeCells(headRow, c0, headRow, c1);
    const cell = ws.getCell(headRow, c0);
    const cal = calendar ? anchorPlus(anchor, m - 1) : null;
    cell.value = cal ? monthLabel(cal.y, cal.m, m === 1 || cal.m === 1) : m;
    cell.font = { name: FONT, bold: true, size: calendar ? 9 : 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(m === todayCol ? argb('#0E7C36') : argb(SE_GREEN));
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  weekCols.forEach((wcol, i) => {
    const cell = ws.getCell(weekRow, LEAD + 1 + i);
    cell.value = Number(wcol.label);
    cell.font = { name: FONT, bold: true, size: 7.5, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(LEAD + 1 + i === LEAD + todayWeekCol ? argb('#0E7C36') : argb(SE_GREEN));
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  // Names the week row, so a reader knows whether the numbers are days of the
  // month or weeks counted from kickoff.
  const weekCaption = ws.getCell(weekRow, LEAD);
  weekCaption.value = calendar ? 'Week of' : 'Weeks';
  weekCaption.font = { name: FONT, bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
  weekCaption.fill = fill(argb(SE_GREEN));
  weekCaption.alignment = { vertical: 'middle', horizontal: 'right' };
  const descHead = ws.getCell(headRow, DESC);
  descHead.value = 'Description';
  descHead.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  descHead.fill = fill(argb(SE_GREEN));
  descHead.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.mergeCells(headRow, DESC, weekRow, DESC);
  ws.getRow(headRow).height = 22;
  ws.getRow(weekRow).height = 14;

  // One row per step; phase names merge down column A over their band.
  let r = weekRow + 1;
  const bandStart = r;
  let runPhase = null, runFrom = r;
  const closeBand = (toRow) => {
    if (runFrom <= toRow) {
      if (toRow > runFrom) ws.mergeCells(runFrom, 1, toRow, 1);
      const cell = ws.getCell(runFrom, 1);
      cell.font = { name: FONT, bold: true, size: 11, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      // Keep the light box, darken only the rule that separates bands.
      cell.border = { ...BOXED, ...(cell.border || {}), top: { style: 'thin', color: { argb: 'FF9AA5B1' } } };
    }
  };

  stages.forEach((stage, i) => {
    const pos = placed[i];
    const phase = String(stage.phase || '').trim();
    // Same grouping rule as the graphic: a step with no phase stands alone
    // and borrows its own name, so column A is never blank.
    const bandLabel = phase || stage.name || 'Untitled stage';
    const sameBand = phase && phase === runPhase;
    if (!sameBand) {
      if (r > bandStart) closeBand(r - 1);
      runPhase = phase || null;
      runFrom = r;
      ws.getCell(r, 1).value = bandLabel;
    }

    if (anyPhase) {
      const stepCell = ws.getCell(r, 2);
      stepCell.value = stage.name || 'Untitled stage';
      stepCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
      stepCell.alignment = { vertical: 'middle', indent: 1 };
    }

    const color = argb(WORKSTREAM_COLOR[stage.owner] || WORKSTREAM_COLOR['Schneider Electric']);
    const wsCell = ws.getCell(r, LEAD);
    wsCell.value = stage.owner || '';
    wsCell.font = { name: FONT, bold: true, size: 9.5, color: { argb: color } };
    wsCell.alignment = { vertical: 'middle', indent: 1 };

    const from = Math.min(pos.month, monthCount);
    const to = Math.min(pos.month + pos.span - 1, monthCount);
    const barFrom = monthFirst.get(from) ?? 1;
    const barTo = monthLast.get(to) ?? NW;
    // A milestone is a moment: a diamond sitting on its day, exactly as the
    // chart draws it, rather than a filled block. It goes in as a floating
    // picture spanning its month's week columns, so it lands on the day
    // itself rather than snapping to a week boundary — and can be dragged.
    const frac = pos.milestone ? stageMonthFraction(stage) : null;
    let milestoneDrawn = false;
    if (pos.milestone) {
      const first = monthFirst.get(from) ?? 1;
      const last = monthLast.get(from) ?? first;
      const spanCols = [];
      for (let g = first; g <= last; g += 1) spanCols.push({ col: LEAD + g, chars: WEEK_COL_CHARS });
      milestoneDrawn = addMilestoneImage(wb, ws, {
        cols: spanCols, row: r, rowPoints: 20, frac, owner: stage.owner, label: i + 1,
      });
    }
    // Without a canvas there's no picture, so fall back to the glyph in the
    // week column the date falls in.
    const milestoneCol = pos.milestone && !milestoneDrawn
      ? weekColumnFor(from, frac)
      : null;

    weekCols.forEach((wcol, wi) => {
      const gridCol = wi + 1;
      const cell = ws.getCell(r, LEAD + gridCol);
      if (wcol.month === todayCol) cell.fill = fill('FFEAF7EE');
      if (gridCol < barFrom || gridCol > barTo) return;
      if (pos.milestone) {
        if (gridCol !== milestoneCol) return;
        cell.value = `◆${i + 1}`;
        cell.font = { name: FONT, bold: true, size: 10, color: { argb: color } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        return;
      }
      cell.fill = fill(color);
      if (gridCol === barFrom) {
        cell.value = i + 1;
        cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
    const descCell = ws.getCell(r, DESC);
    descCell.value = stage.description || '';
    descCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
    descCell.alignment = { vertical: 'middle', indent: 1 };

    ws.getRow(r).height = 20;
    r += 1;
  });
  const lastStageRow = r - 1;
  // Borders before the merges: a merged range draws its master cell's box, so
  // the band still gets an outline.
  applyGridBorders(ws, headRow, 1, lastStageRow, NCOLS);
  closeBand(lastStageRow);

  ws.views = [{ state: 'frozen', xSplit: LEAD, ySplit: weekRow, showGridLines: false }];

  // Legend, naming the client workstream the way the graphic does. The two
  // swatches stack down column A — one per row, the width of the Stages
  // column — rather than running across the sheet, so the key stays under
  // the labels it explains instead of drifting over the month grid.
  r += 1;
  const clientName = String(template?.clientName || '').trim() || 'Client';
  ws.getCell(r, 1).value = 'Legend';
  ws.getCell(r, 1).font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
  r += 1;
  [[`${clientName.toUpperCase()} WORKSTREAM`, 'Client'], ['SE WORKSTREAM', 'Schneider Electric']].forEach(([label, owner], i) => {
    const cell = ws.getCell(r + i, 1);
    cell.value = label;
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(argb(WORKSTREAM_COLOR[owner]));
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(r + i).height = 16;
  });
  r += 1;
  const lastFramedRow = r;

  // Below the frame, only the warning that data didn't fit. The sheet carries
  // no explanatory footnotes — the grid is meant to be read as-is.
  const overflow = placed.filter(p => p.month + p.span - 1 > monthCount);
  if (overflow.length) {
    r += 2;
    ws.getCell(r, 1).value = `Runs past month ${monthCount}, shown clamped to the last column: `
      + overflow.map(p => p.stage.name || 'Untitled step').join(', ');
    ws.getCell(r, 1).font = { name: FONT, italic: true, size: 9, color: { argb: 'FF92400E' } };
  }

  frameBlock(ws, 1, 1, lastFramedRow, NCOLS);
}

export async function exportTimelineXlsx(template) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return false;

  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'Prospect Tracker';

  const phased = template?.format === 'phased';
  const rows = stages.map(stage => ({ stage, range: getStageRange(stage) }));
  const dated = rows.filter(r => r.range);

  const ws = wb.addWorksheet('Timeline', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false }],
  });

  if (phased) {
    writePhasedSheet(wb, ws, { ...template, stages });
    writeStagesSheet(wb, rows, {
      phased,
      baseMonth: timelineBaseMonth(stages),
      mode: template?.positionMode === 'months' ? 'months' : 'dates',
    });
    return downloadWorkbook(wb, template);
  }

  const LEAD = 3; // Stage | Owner | Timing
  const ganttWindow = resolveMonthWindow(template, null);
  const bounds = ganttWindow.fromRange
    ? monthWindowBounds(ganttWindow.anchor, ganttWindow.monthCount)
    : null;
  const { cols, unit } = dated.length || bounds
    ? buildColumns(dated.map(r => r.range), bounds)
    : { cols: [], unit: 'month' };
  // Narrow rotated headers once there are too many columns to label flat.
  const rotate = cols.length > 14;
  const timeWidth = unit === 'week' ? (rotate ? 4.2 : 6) : (rotate ? 4.6 : 11);
  const DESC_COL = LEAD + cols.length + 1;
  const NCOLS = DESC_COL;

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 17;
  cols.forEach((_, i) => { ws.getColumn(LEAD + 1 + i).width = timeWidth; });
  ws.getColumn(DESC_COL).width = 64;

  writeBandHeader(wb, ws, template, NCOLS, Math.max(3.2, NCOLS - (unit === 'week' ? 9 : 5)));
  let r = 3;

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
  const descHead = ws.getCell(groupRow, DESC_COL);
  descHead.value = 'DESCRIPTION';
  descHead.font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
  descHead.fill = fill(BAND);
  descHead.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.mergeCells(groupRow, DESC_COL, labelRow, DESC_COL);
  ws.getRow(groupRow).height = 18;
  ws.getRow(labelRow).height = rotate ? 42 : 18;
  r = labelRow + 1;
  const firstStageRow = r;

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

    const descCell = ws.getCell(r, DESC_COL);
    descCell.value = stage.description || '';
    descCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
    descCell.alignment = { vertical: 'middle', indent: 1 };

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
        // Where in this column's span the date falls, so the diamond lands on
        // the day rather than in the middle of a month / quarter.
        const span = col.endMs - col.startMs;
        const frac = span > 0 ? Math.min(1, Math.max(0, (rs - col.startMs) / span)) : null;
        const drawn = addMilestoneImage(wb, ws, {
          cols: [{ col: LEAD + 1 + ci, chars: timeWidth }],
          row: r, rowPoints: 20, frac, owner: stage.owner, label: i + 1,
        });
        if (!drawn) {
          cell.value = '◆';
          cell.font = { name: FONT, size: 12, bold: true, color: { argb: color } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      } else {
        cell.fill = fill(color);
      }
    });
    r += 1;
  });
  applyGridBorders(ws, groupRow, 1, r - 1, DESC_COL);
  // The owner accent on the stage name stays, over the light box.
  rows.forEach((row, i) => {
    const cell = ws.getCell(firstStageRow + i, 1);
    cell.border = { ...(cell.border || {}), left: { style: 'medium', color: { argb: argb(ownerColor(row.stage.owner)) } } };
  });

  // Freeze the stage labels and the axis so a wide chart stays navigable.
  ws.views = [{
    state: 'frozen', xSplit: LEAD, ySplit: labelRow, showGridLines: false,
  }];

  // --- legend + notes ---
  // Swatches stack down column A, one owner per row, matching the phased sheet.
  r += 1;
  ws.getCell(r, 1).value = 'Legend';
  ws.getCell(r, 1).font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
  r += 1;
  ['Schneider Electric', 'Client', 'Both'].forEach((owner, i) => {
    const cell = ws.getCell(r + i, 1);
    cell.value = owner;
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(argb(ownerColor(owner)));
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(r + i).height = 16;
  });
  r += 2;
  const lastFramedRow = r;

  // Never let a stage vanish because its dates couldn't be read. That warning
  // is the only thing below the frame — no explanatory footnotes.
  const undated = rows.filter(x => !x.range).map(x => x.stage.name || 'Untitled stage');
  if (undated.length) {
    r += 2;
    ws.getCell(r, 1).value = `No readable dates, so not plotted: ${undated.join(', ')}`;
    ws.getCell(r, 1).font = { name: FONT, italic: true, size: 9, color: { argb: 'FF92400E' } };
  }
  frameBlock(ws, 1, 1, lastFramedRow, DESC_COL);

  writeStagesSheet(wb, rows, { phased: false });
  return downloadWorkbook(wb, template);
}

// Sheet 2: the flat table. Phased timelines get the Phase / Month / Span
// columns that drive their layout instead of a raw day count.
// "3. Budget build" for a declared dependency, blank when there isn't one.
function dependsLabel(stage, rows) {
  const id = String(stage?.dependsOn || '');
  if (!id) return '';
  const i = rows.findIndex(r => r.stage.id === id);
  if (i < 0) return '';
  return `${i + 1}. ${rows[i].stage.name || 'Untitled step'}`;
}

function writeStagesSheet(wb, rows, { phased, baseMonth, mode }) {
  const ds = wb.addWorksheet('Stages', { views: [{ showGridLines: false }] });
  // Same rule as the Timeline sheet: a Phase column nobody filled in is a
  // column of blanks, so it only appears once a phase exists.
  const anyPhase = rows.some(({ stage }) => String(stage?.phase || '').trim());
  ds.columns = phased ? [
    { header: '#', key: 'n', width: 5 },
    ...(anyPhase ? [{ header: 'Phase', key: 'phase', width: 30 }] : []),
    { header: anyPhase ? 'Step' : 'Stage', key: 'stage', width: 42 },
    { header: 'Workstream', key: 'owner', width: 20 },
    { header: 'Type', key: 'kind', width: 11 },
    { header: 'Month', key: 'month', width: 9 },
    { header: 'Span', key: 'span', width: 9 },
    { header: 'Weeks', key: 'weeks', width: 8 },
    { header: 'Start', key: 'start', width: 13 },
    { header: 'End', key: 'end', width: 13 },
    { header: 'Depends on', key: 'depends', width: 26 },
    { header: 'Description', key: 'desc', width: 52 },
  ] : [
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
    const months = phased ? getStageMonths(stage, baseMonth, mode) : null;
    const row = ds.addRow(phased ? {
      n: i + 1,
      ...(anyPhase ? { phase: stage.phase || '' } : {}),
      stage: stage.name || 'Untitled stage',
      owner: stage.owner || '',
      month: months.month,
      kind: stage.kind === 'milestone' ? 'Milestone' : 'Timeline',
      span: months.span,
      // Whole weeks the dates cover, rounded up — the grid is drawn in
      // months, so this is the finer duration the week row is read against.
      weeks: range
        ? Math.max(1, Math.ceil(((isoToMs(range.end) - isoToMs(range.start)) / DAY_MS + 1) / 7))
        : null,
      start: range ? excelDate(range.start) : null,
      end: range ? excelDate(range.end) : null,
      depends: dependsLabel(stage, rows),
      desc: stage.description || '',
    } : {
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
    const ownerArgb = argb(phased
      ? (WORKSTREAM_COLOR[stage.owner] || WORKSTREAM_COLOR['Schneider Electric'])
      : ownerColor(stage.owner));
    row.getCell('owner').font = { name: FONT, bold: true, size: 10, color: { argb: ownerArgb } };
    if (phased) {
      row.getCell('month').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('span').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('weeks').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('start').numFmt = 'm/d/yyyy';
      row.getCell('end').numFmt = 'm/d/yyyy';
    } else {
      row.getCell('start').numFmt = 'm/d/yyyy';
      row.getCell('start').numFmt = 'm/d/yyyy';
      row.getCell('end').numFmt = 'm/d/yyyy';
      row.getCell('days').alignment = { vertical: 'middle', horizontal: 'center' };
    }
  });
  ds.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: ds.columns.length } };
  ds.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
}

async function downloadWorkbook(wb, template) {
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
