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

import { SE_GREEN, SE_GREEN_DARK, schneiderLogoSvg } from './schneiderLogo';
import { TIMELINE_STAGE_OWNERS, DEFAULT_STAGE_OWNER } from './timelineTemplatesStore';
import {
  getStageRange, formatRangeLabel, isoToMs, msToIso, daysInMonth, monthLabel,
} from './timelineDates';

const SE_INK = '#0F172A';
const SE_SLATE = '#475569';
const SE_MUTE = '#94A3B8';
const SE_LINE = '#D8DEE6';
const SE_GREY = '#5F5F5F'; // the grey of the SE email signature — client-owned

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

// One stage callout: the stem from the marker out to its end dot, plus the
// owner caption / title / description / timing stacked beside it.
function stageCallout(stage, index, cx, above) {
  const { axisY, radius, topDotY, botDotY, slot } = LAYOUT;
  const color = ownerColor(stage.owner);
  const textX = cx + 18;
  const textWidth = slot - 46;

  const dotY = above ? topDotY : botDotY;
  const stemFrom = above ? axisY - radius : axisY + radius;
  let out = `<line x1="${cx}" y1="${stemFrom}" x2="${cx}" y2="${dotY}" stroke="${SE_LINE}" stroke-width="1.4"/>`;
  out += `<circle cx="${cx}" cy="${dotY}" r="5.5" fill="#FFFFFF" stroke="${color}" stroke-width="1.6"/>`;

  const ownerY = above ? topDotY + 28 : axisY + radius + 34;
  const titleLines = wrapText(stage.name || 'Untitled stage', textWidth, 19, 2);
  const titleTop = ownerY + 24;
  const descTop = titleTop + titleLines.length * 24 + 6;
  const descLines = wrapText(stage.description, textWidth, 14.5, 3);
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

function legend(width) {
  const { legendY } = LAYOUT;
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
  const services = (template?.services || []).join(' · ');
  if (services) {
    out += `<text x="${LAYOUT.padX}" y="${LAYOUT.headerY + 21}" font-size="12.5" font-weight="600" fill="${SE_MUTE}">${esc(services)}</text>`;
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
  maxTickW: 150,
};

const DAY_MS = 86400000;

// Whole-month domain covering every dated stage, plus the tick series to draw
// across it. Falls back to quarter ticks once a monthly axis would be too
// dense to label.
function ganttAxis(ranges) {
  const startMs = Math.min(...ranges.map(r => isoToMs(r.start)));
  const endMs = Math.max(...ranges.map(r => isoToMs(r.end)));
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

function ganttRow(stage, range, index, y, px, chartRight) {
  const color = ownerColor(stage.owner);
  const label = stage.timing?.trim() || formatRangeLabel(range);
  let out = '';

  if (index % 2 === 0) {
    out += `<rect x="${GANTT.padX}" y="${y - 20}" width="${chartRight - GANTT.padX}" height="${GANTT.rowH - 8}" rx="5" fill="#FAFBFC"/>`;
  }
  const nameLines = wrapText(stage.name || 'Untitled stage', GANTT.labelW - 16, 14.5, 1);
  out += `<text x="${GANTT.padX}" y="${y}" font-size="14.5" font-weight="800" fill="${SE_INK}">${esc(nameLines[0] || '')}</text>`;
  out += `<text x="${GANTT.padX}" y="${y + 17}" font-size="10.5" font-weight="800" letter-spacing="0.7" fill="${color}">${esc(String(stage.owner || '').toUpperCase())}</text>`;

  const x0 = px(isoToMs(range.start));
  // Bars run to the END of their last day, so a one-week task reads as seven
  // days wide rather than six.
  const x1 = px(isoToMs(range.end) + DAY_MS);
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

  const dated = [];
  const undated = [];
  stages.forEach(stage => {
    const range = getStageRange(stage);
    if (range) dated.push({ stage, range });
    else undated.push(stage);
  });
  if (!dated.length) return null;

  const { domainStart, domainEnd, ticks, byQuarter } = ganttAxis(dated.map(d => d.range));
  const tickW = Math.min(GANTT.maxTickW, Math.max(GANTT.minTickW, 1100 / Math.max(1, ticks.length)));
  const chartW = Math.max(620, ticks.length * tickW);
  const X0 = GANTT.padX + GANTT.labelW;
  const width = X0 + chartW + GANTT.padX;
  const chartRight = X0 + chartW;

  const px = (ms) => X0 + ((ms - domainStart) / (domainEnd - domainStart)) * chartW;

  // Unbranded (inside the report, which draws its own green band) there's no
  // header to clear, so the rows start near the top instead of leaving a gap.
  const rowsTop = branded ? GANTT.topY : 76;
  const gridBottom = rowsTop + dated.length * GANTT.rowH - 12;
  const noteY = gridBottom + 40;
  const height = noteY + (undated.length ? 40 : 16);

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
    body += ganttRow(stage, range, i, rowsTop + i * GANTT.rowH, px, chartRight);
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

  // Never drop a stage silently: anything the parser couldn't place is named.
  if (undated.length) {
    const names = undated.map(s => s.name || 'Untitled stage').join(', ');
    body += `<text x="${GANTT.padX}" y="${noteY + 26}" font-size="11.5" fill="${SE_MUTE}">Not shown — no readable dates: ${esc(names)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(template?.name || 'Timeline')}" font-family="'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`
    + (branded ? brandedHeader(template, width) : '')
    + body
    + `</svg>`;
}

// --- Milestone (the alternating-callout format) -------------------------

// Build the timeline as an SVG string.
//   template  — { name, services, format, stages: [...] }
//   options   — { branded } draws the title + Schneider lockup header band.
// Returns null when there's nothing to draw.
export function buildMilestoneSvg(template, { branded = true } = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return null;

  const { padX, slot, height, axisY } = LAYOUT;
  const width = padX * 2 + slot * stages.length;

  let body = '';
  // Axis first so the white-filled markers mask it where they sit.
  body += `<line x1="${padX - 20}" y1="${axisY}" x2="${width - padX + 20}" y2="${axisY}" stroke="${SE_LINE}" stroke-width="1.6"/>`;
  body += `<circle cx="${padX - 20}" cy="${axisY}" r="6" fill="#FFFFFF" stroke="${SE_GREEN}" stroke-width="1.6"/>`;
  body += `<circle cx="${width - padX + 20}" cy="${axisY}" r="6" fill="#FFFFFF" stroke="${SE_GREEN}" stroke-width="1.6"/>`;

  stages.forEach((stage, i) => {
    const cx = padX + slot * (i + 0.5);
    body += stageCallout(stage, i, cx, i % 2 === 0);
  });
  stages.forEach((stage, i) => {
    const cx = padX + slot * (i + 0.5);
    body += `<circle cx="${cx}" cy="${axisY}" r="${LAYOUT.radius}" fill="#FFFFFF"/>`;
    body += markerRing(cx, axisY, LAYOUT.radius, stage.owner);
    body += markerIcon(cx, axisY, stage, i);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(template?.name || 'Timeline')}" font-family="'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`
    + (branded ? brandedHeader(template, width) : '')
    + body + legend(width)
    + `</svg>`;
}

// --- Dispatch -----------------------------------------------------------

// The layouts a timeline can render in. `format` on the template picks one;
// every consumer (preview, SVG, PNG, report) goes through buildTimelineSvg so
// they can never disagree about which one is current.
export const TIMELINE_FORMATS = [
  { key: 'gantt', label: 'Gantt', hint: 'Calendar-scaled — shows duration and overlap' },
  { key: 'milestone', label: 'Milestone', hint: 'Evenly spaced markers above and below one line' },
];

export const DEFAULT_TIMELINE_FORMAT = 'gantt';

export function buildTimelineSvg(template, opts = {}) {
  const format = template?.format === 'milestone' ? 'milestone' : DEFAULT_TIMELINE_FORMAT;
  if (format === 'milestone') return buildMilestoneSvg(template, opts);
  // A Gantt with nothing datable would render as an empty grid; fall back to
  // the milestone layout so the user still sees their stages.
  return buildGanttSvg(template, opts) || buildMilestoneSvg(template, opts);
}
