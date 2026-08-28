// Renders a timeline template as a Schneider-Electric-formatted SVG: a
// horizontal axis with one marker per stage and callouts alternating above
// and below the line, in the house style used for engagement timelines.
//
// One renderer feeds every surface — the on-screen preview in the Timelines
// subtab, the standalone .svg export, the .png raster, and the branded HTML
// report — so what the user sees on the page is exactly what ships. Pure
// <text> only (no foreignObject) so the SVG rasterizes cleanly to canvas.
//
// Stage ownership is carried three ways so it survives a black-and-white
// print: the marker ring color, the uppercase owner caption above each
// title, and the legend. A "Both" stage rings half green / half grey.

import { SE_GREEN, SE_GREEN_DARK, schneiderLogoSvg } from './schneiderLogo.js';
import {
  TIMELINE_STAGE_OWNERS, DEFAULT_STAGE_OWNER, groupStagesByPhase, subRuns,
} from './timelineTemplatesStore.js';
import {
  getStageRange, formatRangeLabel, isoToMs, msToIso, daysInMonth, monthLabel,
  placeStages, anchorPlus, todayMonthIndex, todayMonthOffset,
  applyRunUpShift,
  stageMonthFraction, timelineWeekTicks, resolveMonthWindow, monthWindowBounds,
  stagesOutsideWindow, placementBaseMonth,
} from './timelineDates.js';

const SE_INK = '#0F172A';
const SE_SLATE = '#475569';
const SE_MUTE = '#94A3B8';
const SE_LINE = '#D8DEE6';
const SE_GREY = '#5F5F5F'; // the grey of the SE email signature — client-owned
const SE_RED = '#E4002B';  // today marker — the one warm colour on the deck

export const OWNER_COLOR = {
  'Schneider Electric': SE_GREEN_DARK,
  'Client': SE_GREY,
  'Both': SE_GREEN,
};

export function ownerColor(owner) {
  return OWNER_COLOR[owner] || OWNER_COLOR[DEFAULT_STAGE_OWNER];
}

// --- Marker icons -------------------------------------------------------
// Stroke-only paths on a 24×24 grid, scaled into the marker circle. Keyed by
// the value stored on the stage; 'number' is the default and draws the stage
// position instead of artwork.

export const STAGE_ICONS = [
  { key: 'number', label: 'Number' },
  { key: 'turbine', label: 'Wind turbine' },
  { key: 'handshake', label: 'Handshake' },
  { key: 'laptop', label: 'Laptop' },
  { key: 'chart', label: 'Bar chart' },
  { key: 'leaf', label: 'Leaf' },
  { key: 'document', label: 'Document' },
  { key: 'signed', label: 'Signed document' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'check', label: 'Checkmark' },
  { key: 'target', label: 'Target' },
  { key: 'dollar', label: 'Dollar' },
  { key: 'people', label: 'People' },
  { key: 'bolt', label: 'Energy bolt' },
  { key: 'clock', label: 'Clock' },
];

const ICON_PATHS = {
  turbine: 'M12 13.6v7.9 M8.5 21.5h7 M12 11.6V3.2 M13 12.4l7.5-4.3 M11 12.4L3.5 8.1 M12 11.1a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z',
  // Two forearms meeting at a clasp — a stylized handshake rather than an
  // anatomical one; the SE icon library isn't bundled in the repo.
  handshake: 'M2.8 16.4l4.6-4.6 M21.2 16.4l-4.6-4.6 M12 6.4l5.2 5.2-5.2 5.2-5.2-5.2z M9.6 13.6l2.4 2.4',
  laptop: 'M4.5 6.2h15v9.4h-15z M2 18.6h20',
  chart: 'M4 20.4h16 M7.5 20.4V12 M12 20.4V5.6 M16.5 20.4v-5.6',
  leaf: 'M20.4 3.6C10.8 3.6 4.6 8 4.6 14.4c0 3.3 2.2 5.6 5.4 5.6 7 0 10.4-6.4 10.4-16.4z M8.6 19.2C10.6 13.8 14.4 9.4 19 6.6',
  document: 'M6.4 2.8h7.8l4 4v14.4H6.4z M14.2 2.8v4h4 M9 12h6 M9 15.6h6',
  signed: 'M6.4 2.8h7.8l4 4v6.6 M14.2 2.8v4h4 M9 11h4 M5.4 20.4c2-3.2 3.6-1.2 5.4-3.4 1.6-2 3 .8 5 .2 M17 20.4h3',
  calendar: 'M4.2 5.6h15.6v15.2H4.2z M4.2 10.2h15.6 M8.6 3v4.4 M15.4 3v4.4',
  check: 'M12 3a9 9 0 100 18 9 9 0 000-18z M7.8 12.2l2.9 2.9 5.5-5.9',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7.6a4.4 4.4 0 100 8.8 4.4 4.4 0 000-8.8z M12 11.2a.8.8 0 100 1.6.8.8 0 000-1.6z',
  dollar: 'M12 2.8v18.4 M16.6 7.4C16 5.9 14.3 5 12 5 9.5 5 8 6.4 8 8.3c0 4.6 8.6 2.3 8.6 7.1 0 2-1.9 3.6-4.6 3.6-2.6 0-4.4-1.1-5-2.7',
  people: 'M9.2 11.2a3.3 3.3 0 100-6.6 3.3 3.3 0 000 6.6z M2.8 20.4c0-3.5 2.9-5.8 6.4-5.8s6.4 2.3 6.4 5.8 M16.8 11.4a2.9 2.9 0 100-5.8 M17.4 14.6c2.2.4 3.8 2.3 3.8 4.6',
  bolt: 'M13.4 2.4L4.8 13.6h6L10 21.6l8.8-11.4h-6.2z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5.4l3.6 2.2',
};

// --- Text helpers -------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Greedy word wrap. Widths are estimated from the font size (no text
// measurement available while building a string), which is close enough for
// the sans stack we render in and keeps the builder synchronous.
function wrapText(text, maxWidth, fontSize, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const perChar = fontSize * 0.52;
  const maxChars = Math.max(6, Math.floor(maxWidth / perChar));
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Anything that didn't fit gets an ellipsis on the last line rather than
  // silently disappearing.
  const consumed = lines.join(' ').split(/\s+/).length;
  if (consumed < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.length + 1 >= maxChars ? `${last.slice(0, Math.max(1, maxChars - 1))}…` : `${last}…`;
  }
  return lines;
}

// --- Layout -------------------------------------------------------------

// How many lines a callout will draw of a step's name and of its description
// before it gives up and ellipses. Generous because the canvas grows to fit
// them (see milestoneGeometry) — the caps are only there so a paragraph
// pasted into a step can't stretch the drawing to a page and a half. Two
// lines of title used to cut names like "Establish portfolio baseline &
// counterparty framework" mid-word.
const MAX_TITLE_LINES = 3;
const MAX_DESC_LINES = 8;

const LAYOUT = {
  padX: 44,
  slot: 292,
  height: 646,
  axisY: 322,
  radius: 36,
  topDotY: 98,
  botDotY: 554,
  legendY: 606,
  headerY: 42,
};

function markerRing(cx, cy, r, owner) {
  // "Both" splits the ring so a jointly-owned stage reads as both parties at
  // a glance: green on the left half, client grey on the right.
  if (owner === 'Both') {
    const se = OWNER_COLOR['Schneider Electric'];
    const client = OWNER_COLOR['Client'];
    return (
      `<path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r}" fill="none" stroke="${se}" stroke-width="2.2"/>` +
      `<path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r}" fill="none" stroke="${client}" stroke-width="2.2"/>`
    );
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ownerColor(owner)}" stroke-width="2.2"/>`;
}

function markerIcon(cx, cy, stage, index) {
  const color = ownerColor(stage.owner);
  const path = ICON_PATHS[stage.icon];
  if (!path) {
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="24" font-weight="800" fill="${color}">${index + 1}</text>`;
  }
  const scale = 1.5;
  const offset = 12 * scale;
  return `<g transform="translate(${(cx - offset).toFixed(2)} ${(cy - offset).toFixed(2)}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g>`;
}

// How much room a callout's text needs, and the wrapped lines to draw in it.
//
// Measured before anything is drawn so the canvas can be sized to the text
// rather than the text clipped to the canvas: these callouts carry the
// paragraph a slide would print under each milestone, and a description cut
// off at three lines with an ellipsis is a sentence the reader doesn't get.
// The deep description is what grows — the rest of the block is fixed.
function calloutText(stage, textWidth) {
  const titleLines = wrapText(stage.name || 'Untitled stage', textWidth, 19, MAX_TITLE_LINES);
  const descLines = wrapText(stage.description, textWidth, 14.5, MAX_DESC_LINES);
  // From the owner caption's baseline down to the last thing drawn.
  const height = 24 + titleLines.length * 24 + 6 + descLines.length * 20
    + (descLines.length ? 6 : 0) + (stage.timing ? 18 : 0);
  return { titleLines, descLines, height };
}

// One stage callout: the stem from the marker out to its end dot, plus the
// owner caption / title / description / timing stacked beside it. `geom` is
// the sized-to-the-text geometry from milestoneGeometry.
function stageCallout(stage, index, cx, above, geom) {
  const { axisY, radius, topDotY, botDotY, textWidth } = geom;
  const color = ownerColor(stage.owner);
  const textX = cx + 18;

  const dotY = above ? topDotY : botDotY;
  const stemFrom = above ? axisY - radius : axisY + radius;
  let out = `<line x1="${cx}" y1="${stemFrom}" x2="${cx}" y2="${dotY}" stroke="${SE_LINE}" stroke-width="1.4"/>`;
  out += `<circle cx="${cx}" cy="${dotY}" r="5.5" fill="#FFFFFF" stroke="${color}" stroke-width="1.6"/>`;

  const { titleLines, descLines } = calloutText(stage, textWidth);
  const ownerY = above ? topDotY + 28 : axisY + radius + 34;
  const titleTop = ownerY + 24;
  const descTop = titleTop + titleLines.length * 24 + 6;
  const timingY = descTop + descLines.length * 20 + (descLines.length ? 6 : 0);

  out += `<text x="${textX}" y="${ownerY}" font-size="10.5" font-weight="800" letter-spacing="0.9" fill="${color}">${esc(String(stage.owner || '').toUpperCase())}</text>`;
  titleLines.forEach((line, i) => {
    out += `<text x="${textX}" y="${titleTop + i * 24}" font-size="19" font-weight="700" fill="${SE_GREEN_DARK}">${esc(line)}</text>`;
  });
  descLines.forEach((line, i) => {
    out += `<text x="${textX}" y="${descTop + i * 20}" font-size="14.5" fill="${SE_SLATE}">${esc(line)}</text>`;
  });
  if (stage.timing) {
    out += `<text x="${textX}" y="${timingY}" font-size="15" font-weight="800" fill="${SE_INK}">${esc(stage.timing)}</text>`;
  }
  return out;
}

// The canvas this set of stages needs: where the axis sits, where the two
// rows of callout dots sit, and how tall the drawing ends up.
//
// The stored LAYOUT numbers are the FLOOR, not the answer — a timeline whose
// callouts fit inside them is drawn exactly as it always was, and only one
// carrying more text than that pushes the axis down and the canvas taller.
// The two rows are measured separately because they grow in opposite
// directions: the row above the line is pinned to its dots and grows down
// toward the axis, the row below hangs off the axis and grows toward the
// legend.
function milestoneGeometry(stages) {
  const { padX, slot, radius, topDotY, legendY, height, axisY } = LAYOUT;
  const textWidth = slot - 46;
  // Every callout writes its text to the RIGHT of its marker, so the last
  // one needs a column of its own past the end of the axis — a slot's width
  // of markers is not the width of the drawing. Without this the final step's
  // description and its month window ran off the edge of the canvas, which on
  // a five-step timeline is the step that says what the client has to have
  // ready.
  const width = Math.max(
    padX * 2 + slot * stages.length,
    padX + slot * (stages.length - 0.5) + 18 + textWidth + padX,
  );
  let above = 0;
  let below = 0;
  stages.forEach((stage, i) => {
    const need = calloutText(stage, textWidth).height;
    if (i % 2 === 0) above = Math.max(above, need);
    else below = Math.max(below, need);
  });
  // Above: dot, 28px to the owner caption, the block, then clear air before
  // the marker ring.
  const axis = Math.max(axisY, topDotY + 28 + above + 18 + radius);
  // Below: the marker ring, 34px to the owner caption, the block, then the
  // stem's end dot and the legend under it.
  const belowEnd = axis + radius + 34 + below;
  const botDot = Math.max(LAYOUT.botDotY + (axis - axisY), belowEnd + 18);
  const legend = Math.max(legendY + (axis - axisY), botDot + 24);
  return {
    padX, slot, radius, topDotY, textWidth, width,
    axisY: axis,
    botDotY: botDot,
    legendY: legend,
    height: Math.max(height + (axis - axisY), legend + 40),
  };
}

function legend(width, legendY = LAYOUT.legendY) {
  let x = LAYOUT.padX;
  let out = '';
  for (const owner of TIMELINE_STAGE_OWNERS) {
    out += markerRing(x + 7, legendY - 4, 7, owner);
    out += `<text x="${x + 20}" y="${legendY}" font-size="12" font-weight="700" fill="${SE_SLATE}">${esc(owner)}</text>`;
    x += 30 + owner.length * 7.2;
  }
  out += `<text x="${width - LAYOUT.padX}" y="${legendY}" text-anchor="end" font-size="11" fill="${SE_MUTE}">Stage owner shown above each milestone</text>`;
  return out;
}

// Header band shared by both formats: title, attached services, lockup, rule.
function brandedHeader(template, width) {
  const title = template?.name?.trim() || 'Timeline';
  let out = `<text x="${LAYOUT.padX}" y="${LAYOUT.headerY}" font-size="24" font-weight="800" fill="${SE_INK}">${esc(title)}</text>`;
  // The subtitle and the attached services share the line under the title:
  // the header band's height is fixed and the milestone callouts start just
  // below it, so a second line would land on top of the first one's dots.
  const sub = [String(template?.subtitle ?? '').trim(), (template?.services || []).join(' · ')]
    .filter(Boolean).join(' · ');
  if (sub) {
    out += `<text x="${LAYOUT.padX}" y="${LAYOUT.headerY + 21}" font-size="12.5" font-weight="600" fill="${SE_MUTE}">${esc(sub)}</text>`;
  }
  out += `<g transform="translate(${width - LAYOUT.padX - 172} 14)">${schneiderLogoSvg({ width: 172 })}</g>`;
  out += `<line x1="${LAYOUT.padX}" y1="${LAYOUT.headerY + 34}" x2="${width - LAYOUT.padX}" y2="${LAYOUT.headerY + 34}" stroke="${SE_LINE}" stroke-width="1"/>`;
  return out;
}

// --- Gantt --------------------------------------------------------------

const GANTT = {
  padX: 44,
  labelW: 268,   // stage name + owner column
  rowH: 56,
  topY: 150,     // first row baseline area starts here
  minTickW: 96,
  chartW: 1100,  // the plot width the ticks are always fitted to
};

const DAY_MS = 86400000;

// Whole-month domain covering every dated stage, plus the tick series to draw
// across it. Falls back to quarter ticks once a monthly axis would be too
// dense to label.
//
// `bounds` is the timeline's declared date range. When present it replaces the
// stage-derived extent, so the axis covers exactly the months the user asked
// for — including empty ones at either end — rather than shrink-wrapping the
// work. Stages outside it are clamped by the caller, not dropped.
function ganttAxis(ranges, bounds) {
  const startMs = bounds ? bounds.startMs : Math.min(...ranges.map(r => isoToMs(r.start)));
  const endMs = bounds ? bounds.endMs - DAY_MS : Math.max(...ranges.map(r => isoToMs(r.end)));
  const s = new Date(startMs), e = new Date(endMs);
  const y0 = s.getUTCFullYear(), m0 = s.getUTCMonth() + 1;
  const y1 = e.getUTCFullYear(), m1 = e.getUTCMonth() + 1;

  const months = [];
  let y = y0, m = m0;
  // Cap the span so a stray typo'd year can't generate thousands of ticks.
  for (let guard = 0; guard < 600; guard += 1) {
    months.push({ y, m });
    if (y === y1 && m === m1) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const domainStart = Date.UTC(y0, m0 - 1, 1);
  const last = months[months.length - 1];
  const domainEnd = Date.UTC(last.y, last.m - 1, daysInMonth(last.y, last.m)) + DAY_MS;

  const byQuarter = months.length > 20;
  const ticks = byQuarter
    ? months.filter(t => (t.m - 1) % 3 === 0)
    : months;
  return { domainStart, domainEnd, ticks, byQuarter };
}

function ganttRow(stage, range, index, y, px, chartRight, chartLeft) {
  const color = ownerColor(stage.owner);
  const label = stage.timing?.trim() || formatRangeLabel(range);
  let out = '';

  if (index % 2 === 0) {
    out += `<rect x="${GANTT.padX}" y="${y - 20}" width="${chartRight - GANTT.padX}" height="${GANTT.rowH - 8}" rx="5" fill="#FAFBFC"/>`;
  }
  const nameLines = wrapText(stage.name || 'Untitled stage', GANTT.labelW - 16, 14.5, 1);
  out += `<text x="${GANTT.padX}" y="${y}" font-size="14.5" font-weight="800" fill="${SE_INK}">${esc(nameLines[0] || '')}</text>`;
  out += `<text x="${GANTT.padX}" y="${y + 17}" font-size="10.5" font-weight="800" letter-spacing="0.7" fill="${color}">${esc(String(stage.owner || '').toUpperCase())}</text>`;

  // Clamped to the chart: with a declared range a stage can sit outside the
  // window, and an unclamped bar would be drawn over the stage-name column or
  // off the canvas entirely. The out-of-range note names them.
  const clamp = (x) => Math.max(chartLeft, Math.min(chartRight, x));
  const x0 = clamp(px(isoToMs(range.start)));
  // Bars run to the END of their last day, so a one-week task reads as seven
  // days wide rather than six.
  const x1 = clamp(px(isoToMs(range.end) + DAY_MS));
  const isMilestone = x1 - x0 < 14;

  let labelX, anchor;
  if (isMilestone) {
    const cx = x0 + (x1 - x0) / 2;
    out += `<path d="M${cx.toFixed(1)} ${y - 13}L${(cx + 12).toFixed(1)} ${y + 1}L${cx.toFixed(1)} ${y + 15}L${(cx - 12).toFixed(1)} ${y + 1}z" fill="${color}"/>`;
    labelX = cx + 20; anchor = 'start';
    if (labelX + label.length * 6.6 > chartRight) { labelX = cx - 20; anchor = 'end'; }
  } else {
    out += `<rect x="${x0.toFixed(1)}" y="${y - 11}" width="${(x1 - x0).toFixed(1)}" height="24" rx="5" fill="${color}" opacity="0.92"/>`;
    labelX = x1 + 10; anchor = 'start';
    if (labelX + label.length * 6.6 > chartRight) { labelX = x0 - 10; anchor = 'end'; }
  }
  if (label) {
    out += `<text x="${labelX.toFixed(1)}" y="${y + 5}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="${SE_SLATE}">${esc(label)}</text>`;
  }
  return out;
}

// Calendar-scaled view: one row per stage, bars for work with duration and
// diamonds for point-in-time milestones, positioned on a real month axis.
// Stages keep their table order rather than being sorted by date, so the
// graphic always matches the rows above it.
export function buildGanttSvg(template, { branded = true } = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return null;

  // Anything the declared range excludes is dropped rather than clamped to an
  // edge — the page carries the warning instead. Same rule the implementation
  // format uses, from the same helper.
  const hidden = new Set(stagesOutsideWindow(template));
  const dated = [];
  const undated = [];
  stages.forEach(stage => {
    if (hidden.has(stage)) return;
    const range = getStageRange(stage);
    if (range) dated.push({ stage, range });
    else undated.push(stage);
  });
  if (!dated.length) return null;

  // A declared date range fixes the axis; without one it shrink-wraps the
  // dated stages, exactly as before.
  const ganttWindow = resolveMonthWindow(template, null);
  const bounds = ganttWindow.fromRange
    ? monthWindowBounds(ganttWindow.anchor, ganttWindow.monthCount)
    : null;
  const { domainStart, domainEnd, ticks, byQuarter } = ganttAxis(dated.map(d => d.range), bounds);
  // Ticks are fitted to a fixed plot width, the same way the implementation
  // format fits its months: a short range spreads out rather than drawing a
  // small chart adrift in white space. The floor is what lets a long range
  // grow past the target instead of crushing its ticks together.
  const tickW = Math.max(GANTT.minTickW, GANTT.chartW / Math.max(1, ticks.length));
  const chartW = ticks.length * tickW;
  const X0 = GANTT.padX + GANTT.labelW;
  const width = X0 + chartW + GANTT.padX;
  const chartRight = X0 + chartW;

  const px = (ms) => X0 + ((ms - domainStart) / (domainEnd - domainStart)) * chartW;

  // Unbranded (inside the report, which draws its own green band) there's no
  // header to clear, so the rows start near the top instead of leaving a gap.
  const rowsTop = branded ? GANTT.topY : 76;
  const gridBottom = rowsTop + dated.length * GANTT.rowH - 12;
  const noteY = gridBottom + 40;
  // Room for the "not shown" / "outside the range" notes under the legend.
  const noteLines = (undated.length ? 1 : 0) + 1;
  const height = noteY + 16 + noteLines * 16;

  let body = '';
  // Axis ticks first, so the bars sit on top of the gridlines.
  ticks.forEach((t, i) => {
    const x = px(Date.UTC(t.y, t.m - 1, 1));
    body += `<line x1="${x.toFixed(1)}" y1="${rowsTop - 34}" x2="${x.toFixed(1)}" y2="${gridBottom}" stroke="${SE_LINE}" stroke-width="1" stroke-dasharray="3 4"/>`;
    const showYear = i === 0 || t.m === 1 || byQuarter;
    const text = byQuarter
      ? `Q${Math.floor((t.m - 1) / 3) + 1} ${t.y}`
      : monthLabel(t.y, t.m, showYear);
    body += `<text x="${(x + 8).toFixed(1)}" y="${rowsTop - 40}" font-size="11.5" font-weight="800" fill="${SE_MUTE}">${esc(text)}</text>`;
  });
  body += `<line x1="${GANTT.padX}" y1="${rowsTop - 30}" x2="${chartRight}" y2="${rowsTop - 30}" stroke="${SE_LINE}" stroke-width="1"/>`;

  dated.forEach(({ stage, range }, i) => {
    body += ganttRow(stage, range, i, rowsTop + i * GANTT.rowH, px, chartRight, X0);
  });

  // "Today" only when it lands inside the charted window — a marker pinned to
  // an edge would imply the timeline starts or ends now.
  const todayMs = isoToMs(msToIso(Date.now()));
  if (todayMs != null && todayMs >= domainStart && todayMs <= domainEnd) {
    const x = px(todayMs);
    body += `<line x1="${x.toFixed(1)}" y1="${rowsTop - 34}" x2="${x.toFixed(1)}" y2="${gridBottom}" stroke="${SE_GREEN}" stroke-width="1.6"/>`;
    body += `<text x="${(x + 6).toFixed(1)}" y="${gridBottom + 14}" font-size="10.5" font-weight="800" fill="${SE_GREEN}">TODAY</text>`;
  }

  // Legend
  let lx = GANTT.padX;
  let legendSvg = '';
  for (const owner of TIMELINE_STAGE_OWNERS) {
    legendSvg += `<rect x="${lx}" y="${noteY - 9}" width="16" height="11" rx="3" fill="${ownerColor(owner)}"/>`;
    legendSvg += `<text x="${lx + 22}" y="${noteY}" font-size="12" font-weight="700" fill="${SE_SLATE}">${esc(owner)}</text>`;
    lx += 34 + owner.length * 7.2;
  }
  legendSvg += `<text x="${width - GANTT.padX}" y="${noteY}" text-anchor="end" font-size="11" fill="${SE_MUTE}">Bars show duration · diamonds are point-in-time milestones</text>`;
  body += legendSvg;

  // A stage the parser couldn't place is still named here: it isn't the
  // window's doing, so the page's out-of-range warning wouldn't cover it.
  const notes = [];
  if (undated.length) {
    notes.push(`Not shown: no readable dates: ${undated.map(s => s.name || 'Untitled stage').join(', ')}`);
  }
  notes.forEach((line, i) => {
    body += `<text x="${GANTT.padX}" y="${noteY + 26 + i * 16}" font-size="11.5" fill="${SE_MUTE}">${esc(line)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(template?.name || 'Timeline')}" font-family="'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`
    + (branded ? brandedHeader(template, width) : '')
    + body
    + `</svg>`;
}

// --- Implementation (phased workstream) ---------------------------------
//
// The proposal-deck layout: months counted from kickoff rather than dated,
// stages grouped into phase bands down the left, and each step drawn as a
// numbered chip in its workstream's colour with the step text beside it. The
// numbers run straight through the timeline so they can be referenced from a
// following slide.
//
// This format uses a workstream palette rather than the ring colours of the
// other two — blue for the client, green for Schneider Electric — because
// that's the convention these decks are read in. The legend names both.

export const WORKSTREAM_COLOR = {
  'Client': '#29ABE2',
  'Schneider Electric': '#3DCD58',
  'Both': '#1FA9A0',
};

function workstreamColor(owner) {
  return WORKSTREAM_COLOR[owner] || WORKSTREAM_COLOR[DEFAULT_STAGE_OWNER];
}

// Lighten a hex toward white. Used for the fill of a step that belongs to a
// group: the bar takes its group's colour, but at full strength a row of them
// would fight the solid header above and swamp the grid, so the fill is the
// pale version and the header keeps the strong one.
export function tint(hex, amount) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const up = (c) => {
    const n = parseInt(c, 16);
    return Math.round(n + (255 - n) * amount).toString(16).padStart(2, '0');
  };
  return `#${up(m[1])}${up(m[2])}${up(m[3])}`;
}

const PHASED = {
  headH: 152,       // green band: note box, title, legend
  monthsRowH: 34,   // the "1 2 3 …" row, still inside the band
  weeksRowH: 17,    // the week ticks, directly under the months
  labelW: 258,      // phase-name column
  minColW: 62,
  gridW: 1000,      // the grid width the columns are always fitted to
  rowStep: 30,      // one step line
  groupHeadH: 26,   // the full-width bar naming a group
  subHeadH: 20,     // the lighter bar naming a group WITHIN a band
  phasePad: 18,
  footH: 26,
};

// Consecutive stages sharing a phase name form one band; a stage with no
// phase stands alone. Order is the table's, never re-sorted.
//
// A band with no phase name of its own borrows its single step's name, so the
// Stages column is never blank — a timeline that hasn't been organised into
// phases still reads as one row per stage. `borrowed` tells the renderer to
// drop the label beside the chip, which would otherwise repeat it.
// How many sub-headings a band draws — each one costs a row of height.
function subHeadCount(steps) {
  return subRuns(steps).filter(r => r.sub).length;
}

// The runs and their colours come from the shared grouper, so the bands drawn
// here are the ones the Services popup's step list shows. This adds only what
// the drawing needs on top: the label to print beside the band.
function groupPhases(stages, phaseColors) {
  return groupStagesByPhase(stages, phaseColors).map(g => ({
    ...g,
    borrowed: !g.phase,
    label: g.phase || (g.steps[0]?.stage?.name || ''),
  }));
}

export function buildPhasedSvg(template, { branded = true } = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return null;

  const baseMonth = placementBaseMonth(template, stages);
  const mode = template?.positionMode === 'months' ? 'months' : 'dates';
  // Positions come from placeStages rather than a per-stage read, so a step
  // that only says what it waits on lands after that step instead of at
  // kickoff. That sequencing is the only place a dependency shows on this
  // chart — nothing is drawn between the steps.
  const raw = placeStages(stages, baseMonth, mode).map((pos, i) => ({ stage: stages[i], ...pos }));
  // The run-up to the contract sits before the engagement starts, so it needs
  // months the axis doesn't have — everything here is numbered from 1, which
  // is kickoff. Rather than renumber the axis into negatives (which would
  // reach the Excel grid, the deal composer and the calendar anchor alike),
  // the pre-signature steps take the first columns and everything after
  // signature is pushed right by however many they occupy. The axis stays
  // 1…n; where the contract is signed is drawn on it.
  //
  // Skipped entirely for a plan that states its own signature month — see
  // applyRunUpShift. That plan has already placed every step where it means
  // them, so shifting would invent a gap rather than make room for one.
  const statedSignature = Math.floor(Number(template?.signatureMonth) || 0);
  const { preSpan, placed } = applyRunUpShift(raw, statedSignature, mode);
  const needed = Math.max(...placed.map(p => p.month + p.span - 1), 1);
  // The column the contract is signed at the head of. Null when nothing
  // happens before it, which is every timeline that hasn't been given a
  // run-up — and those draw exactly as they did.
  // Where the contract is signed. A timeline with a run-up derives it — the
  // signature is wherever the pre-signature work ends — but a plan can also
  // state it outright, and the deal rollout does: every band on it is
  // scheduled from the signature date, so the column is known without any
  // step having to imply it. Stated wins; it's the more direct claim.
  const signatureCol = statedSignature > 0 ? statedSignature : (preSpan > 0 ? preSpan + 1 : null);
  // The window the whole chart is drawn against: the timeline's declared date
  // range when it has one, otherwise its anchor-month / month-count settings.
  const monthWindow = resolveMonthWindow(template, needed);
  const monthCount = monthWindow.monthCount;

  // Columns are fitted to a fixed grid width rather than given a fixed size,
  // so narrowing the window widens the months instead of shrinking the whole
  // graphic — a 4-month timeline fills the same canvas a 12-month one does,
  // and the week ticks keep a wide month readable. Only the floor bites, on a
  // window long enough that even 1000px can't hold it.
  const colW = Math.max(PHASED.minColW, PHASED.gridW / monthCount);
  const gridW = colW * monthCount;
  const width = PHASED.labelW + gridW + 40;

  // Steps the window leaves out are dropped, not clamped to the last column:
  // a bar pinned to the edge reads as work happening there. The Timelines page
  // warns about what it left out; the graphic just doesn't carry it. A band
  // whose every step is out goes with them.
  const hidden = new Set(stagesOutsideWindow(template, { baseMonth, mode, monthCount }));
  const groups = groupPhases(stages, template?.phaseColors)
    .map(g => ({ ...g, steps: g.steps.filter(s => !hidden.has(s.stage)) }))
    .filter(g => g.steps.length > 0);
  // A named group carries a header bar above its steps; an ungrouped step is
  // just its own row. The old 62px floor existed to give the group name room
  // to sit centred beside the steps — it has its own bar now, and the step
  // names moved into the left column, so the body only has to fit its rows.
  const bandH = groups.map(g => (g.phase ? PHASED.groupHeadH : 0)
    + subHeadCount(g.steps) * PHASED.subHeadH
    + Math.max(44, g.steps.length * PHASED.rowStep + PHASED.phasePad));
  const monthsBottom = PHASED.headH + PHASED.monthsRowH;
  // `axis: 'months'` drops the week ticks and reads month by month. A long
  // engagement doesn't need day-of-week precision, and at 12+ columns the
  // week labels are too tight to print anyway — so the row costs height and
  // gives nothing back.
  const weekly = template?.axis !== 'months';
  const gridTop = monthsBottom + (weekly ? PHASED.weeksRowH : 0);
  // Opt-in, and only meaningful for a plan whose first column IS today: a
  // timeline anchored to a past month has steps that genuinely ran before
  // today, and clamping those would redate real history.
  const clampBars = template?.clampBarsToToday === true;
  const gridH = bandH.reduce((a, b) => a + b, 0);
  const height = gridTop + gridH + PHASED.footH + 8;

  const clientName = String(template?.clientName || '').trim() || 'Client';
  const x0 = PHASED.labelW;
  const colX = (m) => x0 + (m - 1) * colW;

  // Anchored mode swaps the 1…12 headings for real calendar months and marks
  // the one we're in. Unanchored, the timeline stays relative to kickoff. A
  // declared date range is always anchored — picking dates is what asks for
  // calendar headings.
  const calendar = monthWindow.calendar;
  const anchor = monthWindow.anchor;
  const todayCol = calendar ? todayMonthIndex(anchor, monthCount) : null;
  // Today's exact position, in fractional months — half way through the month
  // puts the line half way across its column. Drawn last so it stays visible
  // over the step chips.
  const todayOffset = calendar ? todayMonthOffset(anchor, monthCount) : null;
  const todayX = todayOffset == null ? null : x0 + todayOffset * colW;

  let s = `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`;
  // Green header band, carrying the title and the month numbers.
  s += `<rect x="0" y="0" width="${width}" height="${gridTop}" fill="${SE_GREEN}"/>`;

  // Optional caveat box, top-left, in a deeper green so it reads as an aside.
  const note = String(template?.note || '').trim();
  if (note) {
    const lines = wrapText(note, 268, 11.5, 3);
    const boxH = 14 + lines.length * 15;
    s += `<rect x="8" y="8" width="292" height="${boxH}" fill="#2FB350"/>`;
    lines.forEach((ln, i) => {
      s += `<text x="18" y="${26 + i * 15}" font-size="11.5" font-weight="700" fill="#FFFFFF">${esc(ln)}</text>`;
    });
  }

  // Legend, top-right: one dot per workstream plus the numbering note.
  const legendW = 236, legendX = width - legendW - 8;
  s += `<rect x="${legendX}" y="8" width="${legendW}" height="126" fill="#FFFFFF"/>`;
  [[clientName, 'Client'], ['SE', 'Schneider Electric']].forEach(([label, owner], i) => {
    const cy = 32 + i * 28;
    s += `<circle cx="${legendX + 22}" cy="${cy}" r="9" fill="${workstreamColor(owner)}"/>`;
    s += `<text x="${legendX + 40}" y="${cy + 5}" font-size="12.5" font-weight="700" fill="${SE_INK}">${esc(String(label).toUpperCase())} WORKSTREAM</text>`;
  });
  wrapText('*Numbering on the timeline corresponds to a step in the process on the next slide', legendW - 28, 11, 4)
    .forEach((ln, i) => {
      s += `<text x="${legendX + 14}" y="${84 + i * 13}" font-size="11" font-weight="700" fill="${SE_SLATE}">${esc(ln)}</text>`;
    });

  const title = template?.name?.trim() || 'Implementation Timeline';
  s += `<text x="40" y="${PHASED.headH - 26}" font-size="27" fill="#FFFFFF">${esc(title)}</text>`;

  // "Stages" / "Months" captions and the month numbers, all on the band.
  s += `<text x="40" y="${monthsBottom - 9}" font-size="17" font-weight="700" fill="#FFFFFF">Stages</text>`;
  s += `<text x="${x0 + 8}" y="${PHASED.headH - 4}" font-size="15" font-weight="700" fill="#FFFFFF">${calendar ? 'Timeline' : 'Months'}</text>`;
  // The today column gets a deeper green header and a line down the grid, so
  // an anchored timeline shows where it currently stands.
  if (todayCol) {
    s += `<rect x="${colX(todayCol)}" y="${PHASED.headH + 2}" width="${colW}" height="${gridTop - PHASED.headH - 2}" fill="#0E7C36"/>`;
  }
  for (let m = 1; m <= monthCount; m += 1) {
    s += `<line x1="${colX(m)}" y1="${PHASED.headH + 2}" x2="${colX(m)}" y2="${gridTop}" stroke="#FFFFFF" stroke-width="1"/>`;
    let label = String(m);
    if (calendar) {
      const cal = anchorPlus(anchor, m - 1);
      label = cal ? monthLabel(cal.y, cal.m, m === 1 || cal.m === 1) : String(m);
    }
    const size = calendar ? (colW < 74 ? 10.5 : 12.5) : 15;
    s += `<text x="${colX(m) + 7}" y="${monthsBottom - 9}" font-size="${size}" font-weight="700" fill="#FFFFFF">${esc(label)}</text>`;
  }

  // Week row, directly under the months: a tick at each week start with its
  // label — the day the week begins on a calendar timeline, the running week
  // number on a relative one. Steps are still placed by month, so this is a
  // scale to read against rather than a finer grid to snap to.
  const weekTicks = timelineWeekTicks(anchor, monthCount, calendar, weekly);
  const weekX = (m, frac) => colX(m) + frac * colW;
  if (weekly) {
    s += `<line x1="${x0}" y1="${monthsBottom}" x2="${x0 + gridW}" y2="${monthsBottom}" stroke="#FFFFFF" stroke-width="1" opacity="0.55"/>`;
    s += `<text x="${x0 - 10}" y="${gridTop - 5}" text-anchor="end" font-size="10.5" font-weight="700" fill="#FFFFFF" opacity="0.9">${calendar ? 'Week of' : 'Weeks'}</text>`;
    weekTicks.forEach(({ month, weeks }) => {
      weeks.forEach((week, i) => {
        const wx = weekX(month, week.from);
        const wWidth = (week.to - week.from) * colW;
        // The month's own rule already sits at its first week's edge.
        if (i > 0) {
          s += `<line x1="${wx.toFixed(1)}" y1="${monthsBottom}" x2="${wx.toFixed(1)}" y2="${gridTop}" stroke="#FFFFFF" stroke-width="1" opacity="0.4"/>`;
        }
        // Below ~11px a two-digit label collides with its neighbour, so the
        // tick stays and the number drops rather than printing over itself.
        if (wWidth >= 11) {
          s += `<text x="${(wx + wWidth / 2).toFixed(1)}" y="${gridTop - 5}" text-anchor="middle" font-size="9" font-weight="700" fill="#FFFFFF" opacity="0.92">${esc(week.label)}</text>`;
        }
      });
    });
  }

  // Group washes go down first, under the grid: a named group is a heading
  // over a run of steps, so its colour has to read across the whole band
  // rather than only beside the title. Faint, because the month rules are
  // drawn over it and the step chips sit on top — and a chip's colour answers
  // a different question (who owns the step), which this must not compete
  // with. Drawn here rather than in the band loop below so the column rules
  // land on top of it instead of underneath.
  let y = gridTop;
  groups.forEach((group, gi) => {
    if (group.phase) {
      s += `<rect x="0" y="${y}" width="${width}" height="${bandH[gi]}" fill="${group.color}" opacity="0.07"/>`;
    }
    y += bandH[gi];
  });

  // Grid: column rules the full height, then a rule under each phase band.
  y = gridTop;
  for (let m = 1; m <= monthCount + 1; m += 1) {
    s += `<line x1="${colX(m)}" y1="${gridTop}" x2="${colX(m)}" y2="${gridTop + gridH}" stroke="${SE_LINE}" stroke-width="1"/>`;
  }
  // Week rules inside the grid, lighter than the month rules so the months
  // still read as the primary columns. Dropped when they'd be too tight to
  // tell apart from the month edges.
  weekTicks.forEach(({ month, weeks }) => {
    weeks.forEach((week, i) => {
      if (i === 0 || (week.to - week.from) * colW < 9) return;
      const wx = weekX(month, week.from);
      s += `<line x1="${wx.toFixed(1)}" y1="${gridTop}" x2="${wx.toFixed(1)}" y2="${gridTop + gridH}" stroke="#EDF1F5" stroke-width="1"/>`;
    });
  });
  // The current month keeps its tint; the red line below is what pins the
  // actual day, so the column no longer needs an edge rule of its own.
  if (todayCol) {
    s += `<rect x="${colX(todayCol)}" y="${gridTop}" width="${colW}" height="${gridH}" fill="${SE_GREEN}" opacity="0.09"/>`;
  }
  groups.forEach((group, gi) => {
    const h = bandH[gi];
    // A group is announced by a bar of its own colour running the full width,
    // with its name in white — the heading over the rows beneath it. Its steps
    // then read as ordinary rows with their names in the left column, the same
    // as an ungrouped step, so the only thing marking them out as a group is
    // the header and the colour they're filled in.
    if (group.phase) {
      s += `<rect x="0" y="${y}" width="${width}" height="${PHASED.groupHeadH}" fill="${group.color}"/>`;
      const head = wrapText(group.label, width - 40, 14, 1);
      s += `<text x="14" y="${y + 18}" font-size="14" font-weight="800" fill="#FFFFFF">${esc(head[0] || '')}</text>`;
    }
    s += `<line x1="0" y1="${y + h}" x2="${width}" y2="${y + h}" stroke="#9AA5B1" stroke-width="1"/>`;

    // Rows and sub-headings interleave, so the vertical position walks rather
    // than being computed from the step's index.
    let rowTop = y + (group.phase ? PHASED.groupHeadH : 0) + PHASED.phasePad / 2;
    subRuns(group.steps).forEach((run) => {
      // A sub-heading is subordinate to the band's own header: shorter, and
      // written in its colour on a wash of it rather than white on solid, so
      // the two levels don't compete for the same weight.
      if (run.sub) {
        const c = run.color || SE_SLATE;
        s += `<rect x="0" y="${rowTop}" width="${width}" height="${PHASED.subHeadH}" fill="${tint(c, 0.84)}"/>`;
        s += `<rect x="0" y="${rowTop}" width="4" height="${PHASED.subHeadH}" fill="${c}"/>`;
        const sub = wrapText(run.sub, width - 60, 11.5, 1);
        s += `<text x="24" y="${rowTop + 14}" font-size="11.5" font-weight="800" fill="${c}">${esc(sub[0] || '')}</text>`;
        rowTop += PHASED.subHeadH;
      }
      run.steps.forEach((step) => {
      const pos = placed[step.index];
      const rowY = rowTop + 4;
      rowTop += PHASED.rowStep;
      // Every step names itself in the left column now, grouped or not. It
      // used to sit beside its bar, which put it inside the grid and pushed it
      // around whenever the bar was wide or ran to the last month.
      const nameLines = wrapText(step.stage.name || '', PHASED.labelW - 28, 12.5, 2);
      nameLines.forEach((ln, li) => {
        s += `<text x="14" y="${rowY + 16 - (nameLines.length - 1) * 7 + li * 14}" font-size="12.5" fill="${SE_INK}">${esc(ln)}</text>`;
      });
      let chipX = colX(Math.min(pos.month, monthCount)) + 3;
      const spanCols = Math.min(pos.span, monthCount - Math.min(pos.month, monthCount) + 1);
      let chipW = Math.max(30, spanCols * colW - 6);
      // On a plan that kicks off today, work can't have started already. A
      // bar opening in the current month otherwise draws from the month's
      // left edge — a fortnight of delivery shown as done before the plan
      // begins. Only bars: a milestone is placed by its own day, and moving
      // its column would move the marker off the date it happened on.
      if (clampBars && !pos.milestone && todayX != null && pos.month === todayCol && todayX > chipX) {
        const right = chipX + chipW;
        // Never clamp a bar out of existence — a month-long step starting
        // on the 28th still has to be visible and clickable.
        chipX = Math.min(todayX, right - 24);
        chipW = right - chipX;
      }
      // In a group the bar is the group's colour, washed out so the header
      // above stays the strong one; ungrouped, it keeps the workstream colour
      // it always had. Either way the owner is still on the bar — see the cap
      // drawn at its leading edge — so the legend stays true.
      const color = group.color ? tint(group.color, 0.78) : workstreamColor(step.stage.owner);
      const numberFill = group.color ? group.color : '#FFFFFF';

      // A milestone is a moment, not a duration: draw it as a diamond
      // centred in its month rather than a bar across months, so the two
      // read apart at a glance. getStageMonths already pinned its span to
      // one month, so chipW is a single column here.
      if (pos.milestone) {
        const cy = rowY + 12;
        const rx = Math.min(15, chipW / 2);
        // Sit at the point of the month the date actually falls on — the 31st
        // hugs the right edge of its column, the 1st the left — so a
        // month-wide column still reads to the day. Without a date (a
        // timeline written in month numbers) it stays centred.
        const frac = stageMonthFraction(step.stage);
        const cx = frac == null
          ? chipX + chipW / 2
          : chipX + Math.min(Math.max(frac * chipW, rx), chipW - rx);
        const diamond = (fillColor, clipHalf) => {
          const pts = `${cx},${cy - 13} ${cx + rx},${cy} ${cx},${cy + 13} ${cx - rx},${cy}`;
          if (!clipHalf) return `<polygon points="${pts}" fill="${fillColor}"/>`;
          // 'Both' splits the diamond down the middle, matching the bar.
          const x = clipHalf === 'left' ? cx - rx : cx;
          return `<g><clipPath id="mcl${step.index}${clipHalf}">`
            + `<rect x="${x}" y="${cy - 14}" width="${rx}" height="28"/></clipPath>`
            + `<polygon points="${pts}" fill="${fillColor}" clip-path="url(#mcl${step.index}${clipHalf})"/></g>`;
        };
        if (step.stage.owner === 'Both') {
          s += diamond(workstreamColor('Client'), 'left');
          s += diamond(workstreamColor('Schneider Electric'), 'right');
        } else {
          s += diamond(color);
        }
        s += `<text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#FFFFFF">${step.index + 1}</text>`;
      } else if (!group.color && step.stage.owner === 'Both') {
        // Split chip: both workstreams own the step.
        s += `<rect x="${chipX}" y="${rowY}" width="${chipW / 2}" height="24" fill="${workstreamColor('Client')}"/>`;
        s += `<rect x="${chipX + chipW / 2}" y="${rowY}" width="${chipW / 2}" height="24" fill="${workstreamColor('Schneider Electric')}"/>`;
        s += `<text x="${chipX + (chipW > 60 ? 10 : chipW / 2)}" y="${rowY + 17}" text-anchor="${chipW > 60 ? 'start' : 'middle'}" font-size="13.5" font-weight="800" fill="#FFFFFF">${step.index + 1}</text>`;
      } else {
        s += `<rect x="${chipX}" y="${rowY}" width="${chipW}" height="24" fill="${color}"/>`;
        // Who owns the step, kept on a group-coloured bar as a cap at its
        // leading edge. Without it the workstream would be readable only on
        // ungrouped rows, and the legend would be naming a distinction the
        // chart had stopped drawing.
        if (group.color) {
          s += `<rect x="${chipX}" y="${rowY}" width="5" height="24" fill="${workstreamColor(step.stage.owner)}"/>`;
        }
        s += `<text x="${chipX + (chipW > 60 ? 12 : chipW / 2)}" y="${rowY + 17}" text-anchor="${chipW > 60 ? 'start' : 'middle'}" font-size="13.5" font-weight="800" fill="${numberFill}">${step.index + 1}</text>`;
      }
      });
    });
    y += h;
  });

  // No dependency connectors. What a step waits on is what PLACES it — see
  // placeStages — so the sequence is already in the chart: each step starts
  // where the last one it waits on finished. Drawing the elbows on top of
  // that said the same thing a second time, in dashed lines that crossed
  // half the grid on a plan of any length. The order is the picture; the
  // list of what each step waits on is in the Timelines table.

  // Where the contract is signed: a rule the full height of the grid, with
  // everything to its left the run-up to the deal and everything to its right
  // the engagement. Drawn over the chips — it's the structural divide of the
  // plan, not a decoration behind it — but under the today marker, which has
  // to stay the most legible line on the chart.
  if (signatureCol && signatureCol <= monthCount) {
    const sx = colX(signatureCol);
    const label = String(template?.signatureLabel || '').trim() || 'Contract signature';
    s += `<line x1="${sx}" y1="${gridTop}" x2="${sx}" y2="${gridTop + gridH}" stroke="${SE_INK}" stroke-width="2" stroke-dasharray="6 4"/>`;
    // The label sits to whichever side has room, so a signature near the
    // right edge doesn't print its caption off the chart.
    const w = Math.max(96, label.length * 6.2 + 16);
    const right = sx + 6 + w <= x0 + gridW;
    const lx = right ? sx + 6 : sx - 6 - w;
    s += `<rect x="${lx}" y="${gridTop + 4}" width="${w}" height="18" rx="9" fill="${SE_INK}"/>`;
    s += `<text x="${lx + w / 2}" y="${gridTop + 16.5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#FFFFFF">${esc(label.toUpperCase())}</text>`;
  }

  // Today: one red rule from the month headings down through the grid, placed
  // proportionally inside the month (the 15th of a 30-day month sits at the
  // column's midpoint). Last in the draw order so no step chip covers it.
  if (todayX != null) {
    s += `<line x1="${todayX.toFixed(1)}" y1="${PHASED.headH + 2}" x2="${todayX.toFixed(1)}" y2="${gridTop + gridH}" stroke="${SE_RED}" stroke-width="2"/>`;
    s += `<circle cx="${todayX.toFixed(1)}" cy="${gridTop + gridH}" r="3.5" fill="${SE_RED}"/>`;
  }

  // Footer band.
  const footY = gridTop + gridH + 8;
  s += `<rect x="0" y="${footY}" width="${width}" height="${PHASED.footH}" fill="${SE_GREEN}"/>`;
  s += `<text x="20" y="${footY + 17}" font-size="10.5" font-weight="700" fill="#FFFFFF">Confidential Property of Schneider Electric</text>`;
  if (branded) {
    // White lockup, sized to sit inside the 26px band rather than overflow it.
    s += `<g transform="translate(${width - 132} ${footY + 1})">${schneiderLogoSvg({ onDark: true, width: 108 })}</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}" font-family="'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif">${s}</svg>`;
}

// --- Milestone (the alternating-callout format) -------------------------

// Build the timeline as an SVG string.
//   template  — { name, services, format, stages: [...] }
//   options   — { branded } draws the title + Schneider lockup header band.
// Returns null when there's nothing to draw.
export function buildMilestoneSvg(template, { branded = true } = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return null;

  const geom = milestoneGeometry(stages);
  const { padX, slot, width, height, axisY, radius } = geom;

  let body = '';
  // Axis first so the white-filled markers mask it where they sit.
  body += `<line x1="${padX - 20}" y1="${axisY}" x2="${width - padX + 20}" y2="${axisY}" stroke="${SE_LINE}" stroke-width="1.6"/>`;
  body += `<circle cx="${padX - 20}" cy="${axisY}" r="6" fill="#FFFFFF" stroke="${SE_GREEN}" stroke-width="1.6"/>`;
  body += `<circle cx="${width - padX + 20}" cy="${axisY}" r="6" fill="#FFFFFF" stroke="${SE_GREEN}" stroke-width="1.6"/>`;

  stages.forEach((stage, i) => {
    const cx = padX + slot * (i + 0.5);
    body += stageCallout(stage, i, cx, i % 2 === 0, geom);
  });
  stages.forEach((stage, i) => {
    const cx = padX + slot * (i + 0.5);
    body += `<circle cx="${cx}" cy="${axisY}" r="${radius}" fill="#FFFFFF"/>`;
    body += markerRing(cx, axisY, radius, stage.owner);
    body += markerIcon(cx, axisY, stage, i);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(template?.name || 'Timeline')}" font-family="'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`
    + (branded ? brandedHeader(template, width) : '')
    + body + legend(width, geom.legendY)
    + `</svg>`;
}

// --- Dispatch -----------------------------------------------------------

// The layouts a timeline can render in. `format` on the template picks one;
// every consumer (preview, SVG, PNG, report) goes through buildTimelineSvg so
// they can never disagree about which one is current.
export const TIMELINE_FORMATS = [
  { key: 'gantt', label: 'Gantt', hint: 'Calendar-scaled: shows duration and overlap' },
  { key: 'phased', label: 'Implementation', hint: 'Months from kickoff, phase bands, numbered workstream steps' },
  { key: 'milestone', label: 'Milestone', hint: 'Evenly spaced markers above and below one line' },
];

export const DEFAULT_TIMELINE_FORMAT = 'gantt';

const FORMAT_KEYS = TIMELINE_FORMATS.map(f => f.key);

export function buildTimelineSvg(template, opts = {}) {
  const format = FORMAT_KEYS.includes(template?.format) ? template.format : DEFAULT_TIMELINE_FORMAT;
  if (format === 'milestone') return buildMilestoneSvg(template, opts);
  if (format === 'phased') return buildPhasedSvg(template, opts);
  // A Gantt with nothing datable would render as an empty grid; fall back to
  // the milestone layout so the user still sees their stages.
  return buildGanttSvg(template, opts) || buildMilestoneSvg(template, opts);
}
