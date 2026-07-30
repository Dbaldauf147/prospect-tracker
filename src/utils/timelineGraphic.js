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

// Build the timeline as an SVG string.
//   template  — { name, services, stages: [{ name, owner, timing, description, icon }] }
//   options   — { branded } draws the title + Schneider lockup header band.
// Returns null when the timeline has no stages to draw.
export function buildTimelineSvg(template, { branded = true } = {}) {
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

  let header = '';
  if (branded) {
    const title = template?.name?.trim() || 'Timeline';
    header += `<text x="${padX}" y="${LAYOUT.headerY}" font-size="24" font-weight="800" fill="${SE_INK}">${esc(title)}</text>`;
    const services = (template?.services || []).join(' · ');
    if (services) {
      header += `<text x="${padX}" y="${LAYOUT.headerY + 21}" font-size="12.5" font-weight="600" fill="${SE_MUTE}">${esc(services)}</text>`;
    }
    header += `<g transform="translate(${width - padX - 172} 14)">${schneiderLogoSvg({ width: 172 })}</g>`;
    header += `<line x1="${padX}" y1="${LAYOUT.headerY + 34}" x2="${width - padX}" y2="${LAYOUT.headerY + 34}" stroke="${SE_LINE}" stroke-width="1"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(template?.name || 'Timeline')}" font-family="'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`
    + header + body + legend(width)
    + `</svg>`;
}
