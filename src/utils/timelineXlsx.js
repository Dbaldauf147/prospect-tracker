// Schneider-Electric-formatted Excel export for a timeline.
//
// One sheet, "Timeline": the chart rebuilt out of native cells — one row per
// stage, one column per week / month / quarter, and bars drawn as filled
// cells. Native rather than a pasted picture, so the user can widen it,
// recolour it, or paste the block straight into another workbook. Milestones
// are the one exception: they're floating diamond images, because only a
// picture can sit at the day inside a month column — and can then be dragged.
// The workbook carries the chart and nothing else: no flat stage table.
//
// Browser-only: ExcelJS plus <canvas> for the logo, the same pairing the
// compliance export already uses.

import { schneiderLogoPngDataUrl, SE_GREEN_DARK, SE_GREEN } from './schneiderLogo.js';
import { ownerColor, WORKSTREAM_COLOR, tint } from './timelineGraphic.js';
import { groupStagesByPhase, subRuns } from './timelineTemplatesStore.js';
import {
  getStageRange, isoToMs, daysInMonth, monthLabel,
  placeStages, anchorPlus, todayMonthIndex, stageMonthFraction,
  applyRunUpShift,
  timelineWeekTicks, flattenWeekTicks, resolveMonthWindow, monthWindowBounds,
  stagesOutsideWindow, placementBaseMonth,
} from './timelineDates.js';

const argb = (hex) => 'FF' + String(hex).replace('#', '').toUpperCase();
const SE_DARK = argb(SE_GREEN_DARK);
const INK = 'FF0F172A';
const SLATE = 'FF475569';
const MUTE = 'FF94A3B8';
// The today rule, matching SE_RED in timelineGraphic — the chart's today
// marker and the workbook's have to be the same colour or they read as two
// different things.
const TODAY_RED = 'FFE4002B';
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
// The same, for the monthly axis, where one column is a whole month and has
// to hold the month label that a week column never carries.
const MONTH_COL_CHARS = 10;
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

// Where the logo starts so that it ENDS at the right edge of the sheet
// block: the top-right corner of the band, over the last column — which on
// the implementation sheet is Description, so the lockup sits above that
// header rather than somewhere out in the month grid.
//
// Returned as a fractional 0-based column index, which is what an ExcelJS
// image anchor takes: walk the columns from the right until they cover the
// logo's width, then keep the leftover as the fraction into the column the
// logo starts in.
function logoAnchorCol(ws, ncols, widthPx, marginPx = 8) {
  let need = widthPx + marginPx;
  for (let c = ncols; c >= 1; c -= 1) {
    const w = colWidthPx(ws.getColumn(c).width || 8);
    if (w >= need) return (c - 1) + (w - need) / w;
    need -= w;
  }
  return 0;
}

// Shared brand band across the top of the Timeline sheet: the title on green,
// then a blank spacer row before the table starts on row 3.
function writeBandHeader(wb, ws, template, ncols) {
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
    ws.addImage(id, {
      tl: { col: logoAnchorCol(ws, Math.max(ncols, 6), logo.width), row: 0.14 },
      ext: { width: logo.width, height: logo.height },
    });
  } catch { /* canvas unavailable — skip the logo */ }

  ws.getRow(2).height = 14;
}

// A full-width heading row: the label across the lead columns, its colour
// carried on to every cell right of them.
//
// The label's cells merge but the grid's don't. Merging the whole row would
// be simpler and looks identical — but Excel ignores a border set on any cell
// of a merged range except its master, and the signature rule has to be able
// to cross this row. A run of separately filled cells reads as one bar and
// still takes the rule.
function writeHeadingRow(ws, row, ncols, lead, { label, fill: bg, color, size }) {
  ws.mergeCells(row, 1, row, lead);
  const head = ws.getCell(row, 1);
  head.value = label;
  head.font = { name: FONT, bold: true, size, color: { argb: color } };
  head.fill = fill(bg);
  head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = lead + 1; c <= ncols; c += 1) ws.getCell(row, c).fill = fill(bg);
}

// The column rules the grid pass drew across a heading row, taken back out:
// the row is one bar, and a bar with a rule every three characters reads as
// twenty empty cells that happen to share a colour. Top and bottom stay, so
// the band still closes against the rows around it.
function clearRowRules(ws, row, from, to) {
  for (let c = from; c <= to; c += 1) {
    const cell = ws.getCell(row, c);
    const b = cell.border || {};
    cell.border = { top: b.top, bottom: b.bottom };
  }
}

// Implementation layout in cells, built to read as the chart does: a heading
// row per group (and per sub-group inside it), one row per step with its name
// in column A, and the month grid to the right. Chips become filled cells
// carrying the step number, so the numbering still lines up with the deck.
function writePhasedSheet(wb, ws, template) {
  const stages = template.stages;
  const baseMonth = placementBaseMonth(template, stages);
  const mode = template?.positionMode === 'months' ? 'months' : 'dates';
  // Same placement the visual uses — including sequencing the steps nobody
  // gave a month to behind what they wait on — so the sheet's grid is the
  // chart's grid.
  const raw = placeStages(stages, baseMonth, mode).map((pos, i) => ({ stage: stages[i], ...pos }));
  // The run-up to the contract takes the first columns and everything after
  // signature shifts right by however many they occupy — the same trick the
  // chart plays to keep an axis that starts at 1. Without it the sheet drew
  // the run-up on top of the engagement.
  // Skipped for a plan that states its own signature month — see
  // applyRunUpShift. The sheet and the chart have to agree on this or the
  // Excel would carry a gap the screen doesn't.
  const statedSignature = Math.floor(Number(template?.signatureMonth) || 0);
  const { preSpan, placed } = applyRunUpShift(raw, statedSignature);
  // Where the contract is signed. A timeline with a run-up derives it — the
  // signature is wherever the pre-signature work ends — but a plan can also
  // state it outright, and the deal rollout does: every band on it is
  // scheduled from the signature date, so the column is known without any
  // step having to imply it. Stated wins; it's the more direct claim.
  const signatureCol = statedSignature > 0 ? statedSignature : (preSpan > 0 ? preSpan + 1 : null);
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
  // `axis: 'months'` collapses each month to a single grid column. The tick
  // helper does the collapsing, so every placement calculation below still
  // reads "which tick does this land in" and needs no second code path.
  const weekly = template?.axis !== 'months';
  // See buildPhasedSvg: opt-in, and only for a plan whose first column is
  // today. A timeline anchored to a past month has steps that really did
  // run before today.
  const clampBars = template?.clampBarsToToday === true;
  const weekTicks = timelineWeekTicks(anchor, monthCount, calendar, weekly);
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

  // Two lead columns, matching the chart: every step names itself in the
  // left one, grouped or not, because a group now announces itself in a
  // heading row of its own rather than in a column merged down the side of
  // its steps.
  const LEAD = 2;                 // Stages | Workstream
  const DESC = LEAD + NW + 1;     // Description, past the right of the grid
  const NCOLS = DESC;
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 20;
  // A month column has to hold "Aug 2026", which a week column never does.
  const gridColChars = weekly ? WEEK_COL_CHARS : MONTH_COL_CHARS;
  for (let i = 0; i < NW; i += 1) ws.getColumn(LEAD + 1 + i).width = gridColChars;
  ws.getColumn(DESC).width = 64;

  writeBandHeader(wb, ws, template, NCOLS);

  // Axis header — row 3, straight under the title band and its spacer: the
  // month band, with the week ticks on the row below it.
  const headRow = 3;
  const weekRow = headRow + 1;
  ['Stages', 'Workstream'].forEach((label, i) => {
    // The lead columns span both header rows, except the last one — the
    // Workstream column keeps its second row free for the caption that names
    // the week numbers. With no week row there's no caption, so it spans too.
    if (i + 1 < LEAD || !weekly) ws.mergeCells(headRow, i + 1, weekRow, i + 1);
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
    // On a monthly axis a month owns one column, so it takes the week row's
    // height instead of leaving an empty strip under the label.
    else if (!weekly) ws.mergeCells(headRow, c0, weekRow, c0);
    const cell = ws.getCell(headRow, c0);
    const cal = calendar ? anchorPlus(anchor, m - 1) : null;
    cell.value = cal ? monthLabel(cal.y, cal.m, m === 1 || cal.m === 1) : m;
    cell.font = { name: FONT, bold: true, size: calendar ? 9 : 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(m === todayCol ? argb('#0E7C36') : argb(SE_GREEN));
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  if (weekly) {
    weekCols.forEach((wcol, i) => {
      const cell = ws.getCell(weekRow, LEAD + 1 + i);
      cell.value = Number(wcol.label);
      cell.font = { name: FONT, bold: true, size: 7.5, color: { argb: 'FFFFFFFF' } };
      cell.fill = fill(LEAD + 1 + i === LEAD + todayWeekCol ? argb('#0E7C36') : argb(SE_GREEN));
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    // Names the week row, so a reader knows whether the numbers are days of
    // the month or weeks counted from kickoff.
    const weekCaption = ws.getCell(weekRow, LEAD);
    weekCaption.value = calendar ? 'Week of' : 'Weeks';
    weekCaption.font = { name: FONT, bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
    weekCaption.fill = fill(argb(SE_GREEN));
    weekCaption.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  const descHead = ws.getCell(headRow, DESC);
  descHead.value = 'Description';
  descHead.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  descHead.fill = fill(argb(SE_GREEN));
  descHead.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.mergeCells(headRow, DESC, weekRow, DESC);
  ws.getRow(headRow).height = 22;
  ws.getRow(weekRow).height = 14;

  // Steps the window leaves out aren't written at all — the same rule the
  // chart follows, so the sheet and the graphic show the same work. The
  // Timelines page is where the user is told what was left out.
  const hidden = new Set(stagesOutsideWindow(template, { baseMonth, mode, monthCount }));

  // The bands, in plan order, from the same grouper the chart and the
  // Services popup read — so all three agree where one group ends and the
  // next begins, and a group is the same colour in every one of them.
  const groups = groupStagesByPhase(stages, template?.phaseColors)
    .map(g => ({ ...g, steps: g.steps.filter(st => !hidden.has(st.stage)) }))
    .filter(g => g.steps.length > 0);

  let r = weekRow + 1;
  // Cells whose border says something the grid pass must not paint over:
  // the workstream cap at a bar's leading edge, and the signature rule.
  // Applied after applyGridBorders, which merges a thin box into every cell.
  const marks = [];
  // Rows that are one solid bar rather than a run of cells — see clearRowRules.
  const headingRows = [];
  const gridColOf = (month) => LEAD + (monthFirst.get(month) ?? 1);

  // The two vertical rules the body carries, both drawn at the head of a
  // column: where the contract is signed, and where today falls. The chart
  // draws both; the workbook drew only the first, so an exported plan gave no
  // clue how much of it has already gone by.
  const signatureRuleCol = (signatureCol && signatureCol <= monthCount) ? gridColOf(signatureCol) : null;
  // Placed on the WEEK today sits in, not just its month, so the rule lands on
  // the date the way the chart's does. Null when the timeline isn't anchored
  // to a calendar, or when today falls outside the window — a plan starting
  // next March shouldn't grow a today line at its left edge.
  let todayRuleCol = todayWeekCol ? LEAD + todayWeekCol : null;
  // Both rules live on a cell's left border, so a shared column can only show
  // one. The signature keeps it: the sheet's whole column layout is built
  // around where the run-up ends, and that divide going missing is worse than
  // today's being. Today's month and week headers are tinted green regardless.
  if (todayRuleCol != null && todayRuleCol === signatureRuleCol) todayRuleCol = null;

  if (signatureRuleCol != null || todayRuleCol != null) {
    if (signatureRuleCol != null) {
      const label = String(template?.signatureLabel || '').trim() || 'Contract signature';
      const cell = ws.getCell(r, signatureRuleCol);
      cell.value = label.toUpperCase();
      cell.font = { name: FONT, bold: true, size: 8, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    // Excel spills a label rightwards across empty cells, so a TODAY sitting
    // just left of the signature label would print through it. The rule reads
    // well enough beside a labelled one, so the label is what gives way.
    const clearOfSignature = signatureRuleCol == null
      || todayRuleCol > signatureRuleCol
      || signatureRuleCol - todayRuleCol >= 3;
    if (todayRuleCol != null && clearOfSignature) {
      const cell = ws.getCell(r, todayRuleCol);
      cell.value = 'TODAY';
      cell.font = { name: FONT, bold: true, size: 8, color: { argb: TODAY_RED } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    ws.getRow(r).height = 13;
    r += 1;
  }

  groups.forEach((group) => {
    const groupColor = group.phase ? group.color : null;
    // A group announces itself in a bar of its own colour running the full
    // width, name in white — the heading over the rows beneath it, exactly
    // as the chart draws it. Its steps then read as ordinary rows.
    if (groupColor) {
      writeHeadingRow(ws, r, NCOLS, LEAD, {
        label: group.phase,
        fill: argb(groupColor),
        color: 'FFFFFFFF',
        size: 11,
      });
      headingRows.push(r);
      ws.getRow(r).height = 20;
      r += 1;
    }
    // No wash under a group's rows here, and no group colour on its bars.
    // The chart can afford both because it's read as a picture; a sheet is
    // read as a grid, and tinting every row of a group turned the whole thing
    // pastel — the bars stopped being the thing your eye lands on, and a run
    // of pale cells beside a pale background stopped reading as a bar at all.
    // The heading rows above carry the grouping on their own, which leaves the
    // cells free to say the one thing only they say: who owns the step.

    subRuns(group.steps).forEach((run) => {
      // A sub-heading is subordinate to the band's own header: its colour on
      // a wash of it rather than white on solid, with a rule down its left
      // edge, so the two levels don't compete for the same weight.
      if (run.sub) {
        const c = run.color || '#475569';
        // The chart puts a rule of the group's colour down the left edge of
        // this bar; here the block's own frame owns column A's left edge, so
        // the wash and the coloured name carry the level on their own.
        writeHeadingRow(ws, r, NCOLS, LEAD, {
          label: run.sub,
          fill: argb(tint(c, 0.84)),
          color: argb(c),
          size: 10,
        });
        headingRows.push(r);
        ws.getRow(r).height = 17;
        r += 1;
      }

      run.steps.forEach(({ stage, index: i }) => {
        const pos = placed[i];
        const nameCell = ws.getCell(r, 1);
        nameCell.value = stage.name || 'Untitled stage';
        nameCell.font = { name: FONT, size: 10, color: { argb: INK } };
        // Top, not middle, for every cell on a step's row. A name long
        // enough to wrap is centred against a row sized for one line, which
        // put half of it above the row's own bar and half below — reading as
        // text belonging to the step above. Anchored at the top, the first
        // line always sits beside its own bar.
        nameCell.alignment = { vertical: 'top', indent: 1, wrapText: true };

        const color = argb(WORKSTREAM_COLOR[stage.owner] || WORKSTREAM_COLOR['Schneider Electric']);
        const wsCell = ws.getCell(r, LEAD);
        wsCell.value = stage.owner || '';
        wsCell.font = { name: FONT, bold: true, size: 9.5, color: { argb: color } };
        wsCell.alignment = { vertical: 'top', indent: 1 };

        const from = Math.min(pos.month, monthCount);
        const to = Math.min(pos.month + pos.span - 1, monthCount);
        let barFrom = monthFirst.get(from) ?? 1;
        const barTo = monthLast.get(to) ?? NW;
        // Same rule the chart follows: on a plan that kicks off today, a bar
        // opening in the current month starts at today's column rather than at
        // the month's first week. On a monthly axis the month is one column, so
        // there is no finer place to start and this changes nothing.
        if (clampBars && !pos.milestone && todayWeekCol && from === todayCol && todayWeekCol > barFrom) {
          barFrom = Math.min(todayWeekCol, barTo);
        }
        // Solid workstream colour with the number in white, in a group or
        // out of one: green for Schneider Electric, blue for the client. It's
        // the only place the sheet says who owns a step, and it's what makes
        // a bar read as a bar against the grid.
        const barFill = color;
        const numberColor = 'FFFFFFFF';
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
          for (let g = first; g <= last; g += 1) spanCols.push({ col: LEAD + g, chars: gridColChars });
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
            cell.alignment = { vertical: 'top', horizontal: 'center' };
            return;
          }
          cell.fill = fill(barFill);
          if (gridCol === barFrom) {
            cell.value = i + 1;
            cell.font = { name: FONT, bold: true, size: 10, color: { argb: numberColor } };
            cell.alignment = { vertical: 'top', horizontal: 'center' };
            // Who owns the step, kept on a group-coloured bar as a rule at its
            // leading edge — the chart's cap. Without it the workstream would
            // be readable only on ungrouped rows, and the legend would name a
            // distinction the sheet had stopped drawing.
            if (groupColor) {
              marks.push({ row: r, col: LEAD + gridCol, border: { left: { style: 'thick', color: { argb: color } } } });
            }
          }
        });
        const descCell = ws.getCell(r, DESC);
        descCell.value = stage.description || '';
        descCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
        descCell.alignment = { vertical: 'top', indent: 1 };

        ws.getRow(r).height = 20;
        r += 1;
      });
    });
  });
  const lastStageRow = r - 1;
  applyGridBorders(ws, headRow, 1, lastStageRow, NCOLS);
  for (const row of headingRows) clearRowRules(ws, row, LEAD + 1, NCOLS);
  // Both rules run the height of the body, at the head of their column —
  // drawn after the grid so the thin box doesn't overwrite them. Solid red
  // for today against the signature's black dashes, so the two never read as
  // the same kind of divide.
  if (signatureRuleCol != null) {
    for (let row = headRow; row <= lastStageRow; row += 1) {
      marks.push({
        row, col: signatureRuleCol,
        border: { left: { style: 'mediumDashed', color: { argb: INK } } },
      });
    }
  }
  if (todayRuleCol != null) {
    for (let row = headRow; row <= lastStageRow; row += 1) {
      marks.push({
        row, col: todayRuleCol,
        border: { left: { style: 'medium', color: { argb: TODAY_RED } } },
      });
    }
  }
  for (const m of marks) {
    const cell = ws.getCell(m.row, m.col);
    cell.border = { ...(cell.border || {}), ...m.border };
  }

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

  frameBlock(ws, 1, 1, lastFramedRow, NCOLS);
}

export async function exportTimelineXlsx(template) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return false;

  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'Prospect Tracker';

  const phased = template?.format === 'phased';
  // A step the window excludes doesn't get a row at all, in either format —
  // the sheet shows exactly the work the chart does.
  const outside = new Set(stagesOutsideWindow(template));
  const rows = stages
    .filter(stage => !outside.has(stage))
    .map(stage => ({ stage, range: getStageRange(stage) }));
  const dated = rows.filter(r => r.range);

  const ws = wb.addWorksheet('Timeline', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false }],
  });

  if (phased) {
    writePhasedSheet(wb, ws, { ...template, stages });
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

  writeBandHeader(wb, ws, template, NCOLS);
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
    timingCell.value = stage.timing || (range ? '' : '(no dates)');
    timingCell.font = { name: FONT, size: 9.5, color: { argb: range ? SLATE : MUTE }, italic: !range };
    timingCell.alignment = { vertical: 'middle', indent: 1 };

    const descCell = ws.getCell(r, DESC_COL);
    descCell.value = stage.description || '';
    descCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
    descCell.alignment = { vertical: 'middle', indent: 1 };

    cols.forEach((col, ci) => {
      const cell = ws.getCell(r, LEAD + 1 + ci);
      if (i % 2 === 1) cell.fill = fill(ZEBRA);
      // Today's rule is NOT drawn here — see after applyGridBorders below.
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
  const lastBodyRow = r - 1;
  applyGridBorders(ws, groupRow, 1, lastBodyRow, DESC_COL);
  // The owner accent on the stage name stays, over the light box.
  rows.forEach((row, i) => {
    const cell = ws.getCell(firstStageRow + i, 1);
    cell.border = { ...(cell.border || {}), left: { style: 'medium', color: { argb: argb(ownerColor(row.stage.owner)) } } };
  });
  // Today, in the same red the implementation sheet and the chart use, down
  // the head of its column. Applied after the grid pass for the same reason
  // the owner accent is: applyGridBorders merges a thin box into every cell,
  // and drawing this inline with the bars — where it used to be — meant the
  // marker was overwritten before the file was ever written. It was a thin
  // dark-green edge then, which on a sheet already full of Schneider green
  // would have read as another grid line rather than as today anyway.
  if (todayCol != null) {
    for (let row = groupRow; row <= lastBodyRow; row += 1) {
      const cell = ws.getCell(row, todayCol);
      cell.border = { ...(cell.border || {}), left: { style: 'medium', color: { argb: TODAY_RED } } };
    }
  }

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

  return downloadWorkbook(wb, template);
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
