// Formatted Excel version of the Building Compliance report — mirrors the
// printable HTML report (Schneider-branded header + logo, KPI tiles, the
// Compliance Roadmap table, penalty-by-jurisdiction table, and the same
// eligibility / penalty / utility-feed bar charts embedded as images).
//
// Browser-only: uses <canvas> to rasterize the charts + logo and ExcelJS to
// build the workbook. Mirrors the ExcelJS + canvas-image pattern already used
// by the ISO / NAM exports in SitesView.

import {
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  eligibilityByOrdinance, totalEligible, deadlinesByDate,
  penaltyByOrdinance, totalPenalty, utilityFeedEligibility,
} from './complianceMandates.js';
import { schneiderLogoPngDataUrl, SE_GREEN_DARK } from './schneiderLogo.js';

const argb = (hex) => 'FF' + String(hex).replace('#', '').toUpperCase();
const SE_DARK = argb(SE_GREEN_DARK);          // FF009530
const SE_LIGHT = 'FFE6F7EC';
const INK = 'FF0F172A';
const SLATE = 'FF475569';
const LINE = 'FFE2E8F0';
const ZEBRA = 'FFFAFCFB';
const FONT = 'Nunito Sans';

// Full comma-grouped dollars — matches the on-page cards (e.g. $1,845,310)
// rather than an abbreviated $1.8M.
const usd = (n) => (n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US'));
const mdY = (iso) => { const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

// Draw a horizontal-bar chart to a PNG data URL, matching the report's bars
// (scale track + rounded ends + value labels). Returns { dataUrl, width, height }.
function drawHBarsPng(items, { color, valueFmt = String, title = '', width = 540, labelW = 176 }) {
  const rowH = 22, gap = 10, valW = 88, padT = title ? 30 : 10, padB = 10;
  const barMax = width - labelW - valW;
  const max = Math.max(1, ...items.map(i => i.value));
  const height = padT + Math.max(1, items.length) * (rowH + gap) + padB;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';
  if (title) {
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0F172A';
    ctx.font = `800 13px "${FONT}", Arial, sans-serif`;
    ctx.fillText(title, 0, 18);
    ctx.textBaseline = 'middle';
  }
  const rr = (x, y, w, h, r) => { // rounded rect
    const rad = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  if (!items.length) {
    ctx.fillStyle = '#94A3B8'; ctx.font = `12px "${FONT}", Arial, sans-serif`;
    ctx.fillText('No eligible sites', labelW, padT + 12);
  }
  items.forEach((it, i) => {
    const y = padT + i * (rowH + gap);
    const w = it.value > 0 ? Math.max(3, (it.value / max) * barMax) : 0;
    ctx.fillStyle = '#475569';
    ctx.font = `12px "${FONT}", Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(String(it.label), labelW - 10, y + rowH / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(226,232,240,0.55)';
    rr(labelW, y + 1, barMax, rowH - 2, 5); ctx.fill();
    ctx.fillStyle = color;
    rr(labelW, y + 1, w, rowH - 2, 5); ctx.fill();
    ctx.fillStyle = '#0F172A';
    ctx.font = `800 12.5px "${FONT}", Arial, sans-serif`;
    ctx.fillText(valueFmt(it.value), labelW + barMax + 10, y + rowH / 2);
  });
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

// Draw one eligibility "card" — a coloured header bar ("BBS Eligibility"),
// the Applicable Sites + Max Yearly Penalty stat callouts, and the same
// per-jurisdiction bars — to a PNG, mirroring the on-page Compliance
// Screening cards. Returns { dataUrl, width, height }.
function drawEligibilityCardPng({ label, color, applicableSites, maxPenalty, items, width = 330 }) {
  const scale = 2;
  const headerH = 32, statsH = 56;
  const rowH = 20, gap = 8, barsPadT = 8, barsPadB = 12;
  const labelW = 116, valW = 34;
  const nBars = Math.max(1, items.length);
  const barsH = barsPadT + nBars * (rowH + gap) + barsPadB;
  const height = headerH + statsH + barsH;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);

  // Coloured header bar.
  ctx.fillStyle = color; ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 13px "${FONT}", Arial, sans-serif`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(`${label} Eligibility`, 12, headerH / 2 + 1);

  // Stat callouts: Applicable Sites (left) · Max Yearly Penalty (right).
  const col2X = Math.round(width * 0.42);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = color; ctx.font = `800 20px "${FONT}", Arial, sans-serif`;
  ctx.fillText(String(applicableSites), 12, headerH + 26);
  ctx.fillText(usd(maxPenalty), col2X, headerH + 26);
  ctx.fillStyle = '#64748B'; ctx.font = `700 9px "${FONT}", Arial, sans-serif`;
  ctx.fillText('APPLICABLE SITES', 12, headerH + 42);
  ctx.fillText('MAX YEARLY PENALTY', col2X, headerH + 42);

  const rr = (x, y, w, h, rad0) => {
    const rad = Math.min(rad0, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  const barsTop = headerH + statsH;
  const barMax = width - labelW - valW - 12;
  const maxV = Math.max(1, ...items.map(i => i.value));
  ctx.textBaseline = 'middle';
  if (!items.length) {
    ctx.fillStyle = '#94A3B8'; ctx.font = `12px "${FONT}", Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('No eligible sites', 12, barsTop + barsPadT + 10);
  }
  items.forEach((it, i) => {
    const y = barsTop + barsPadT + i * (rowH + gap);
    const w = it.value > 0 ? Math.max(3, (it.value / maxV) * barMax) : 0;
    ctx.fillStyle = '#475569'; ctx.font = `12px "${FONT}", Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(String(it.label), labelW - 8, y + rowH / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(226,232,240,0.55)'; rr(labelW, y + 1, barMax, rowH - 2, 5); ctx.fill();
    ctx.fillStyle = color; rr(labelW, y + 1, w, rowH - 2, 5); ctx.fill();
    ctx.fillStyle = '#0F172A'; ctx.font = `800 12px "${FONT}", Arial, sans-serif`;
    ctx.fillText(String(it.value), labelW + barMax + 8, y + rowH / 2);
  });

  // Card border.
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

// --- workbook builders ---------------------------------------------------

function styleHeaderRow(row, labels) {
  labels.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
    cell.border = { top: { style: 'thin', color: { argb: LINE } }, bottom: { style: 'thin', color: { argb: LINE } } };
  });
  row.height = 20;
}

function placeImage(ws, wb, png, { col, row, maxW }) {
  const scale = maxW && png.width > maxW ? maxW / png.width : 1;
  const id = wb.addImage({ base64: png.dataUrl, extension: 'png' });
  ws.addImage(id, { tl: { col, row }, ext: { width: png.width * scale, height: png.height * scale } });
  return Math.ceil((png.height * scale) / 19); // rows consumed (≈19px/row)
}

export async function exportComplianceReportXlsx(results, meta = {}) {
  const { Workbook } = await import('exceljs');
  // Combined-export mode passes a shared workbook so this report's sheets
  // land in one master file alongside the other exports.
  const wb = meta.targetWb || new Workbook();
  const ws = wb.addWorksheet(meta.reportSheetName || 'Compliance Report', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false }],
  });

  const NCOLS = 8;
  // Widened from the original tight set (26/14/16/14…) so the KPI tiles,
  // tables and charts spread across the sheet instead of crowding into the
  // left third. Chart images below anchor to whole columns (see the *_COLS
  // arrays) and are sized to the resulting gaps, so they stay non-overlapping
  // against these widths.
  ws.columns = [
    { width: 30 }, { width: 24 }, { width: 24 }, { width: 24 },
    { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 },
  ];

  const matched = results.filter(r => r.matched);
  const jurisdictions = new Set(matched.map(r => r.govId)).size;
  const withMandate = results.filter(r => CATEGORIES.some(c => r[c]?.eligible === true)).length;
  const grandPenalty = CATEGORIES.reduce((s, c) => s + totalPenalty(results, c), 0);
  const siteCount = meta.siteCount ?? results.length;
  const generatedAt = meta.generatedAt || '';

  let r = 1;

  // --- Branded title band --- (company name over the title, matching the
  // on-page Compliance Screening header).
  const companyName = String(meta.companyName || '').trim();
  ws.mergeCells(r, 1, r, NCOLS);
  const title = ws.getCell(r, 1);
  const titleFont = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  if (companyName) {
    title.value = {
      richText: [
        { font: { name: FONT, bold: true, size: 10, color: { argb: 'FFD1FADF' } }, text: `${companyName}\n` },
        { font: titleFont, text: 'Building Compliance Screening & Roadmap' },
      ],
    };
  } else {
    title.value = 'Building Compliance Screening & Roadmap';
    title.font = titleFont;
  }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(r).height = companyName ? 48 : 40;
  // Logo (white) floated over the right of the title band.
  try {
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: 190 });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: 6, row: r - 1 + 0.16 }, ext: { width: logo.width, height: logo.height } });
  } catch { /* canvas unavailable — skip logo */ }
  r += 1;

  ws.mergeCells(r, 1, r, NCOLS);
  const sub = ws.getCell(r, 1);
  sub.value = `Preliminary BBS / energy-audit / BPS applicability across the portfolio.  Generated ${generatedAt}  ·  ${siteCount} sites · ${matched.length} matched · ${jurisdictions} jurisdictions`;
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 20;
  r += 2;

  // --- KPI tiles (4 across, 2 cols each) ---
  const kpis = [
    { v: String(siteCount), l: 'Sites screened', c: SE_DARK },
    { v: String(withMandate), l: 'Sites with a mandate', c: argb('#3DCD58') },
    { v: String(jurisdictions), l: 'Jurisdictions matched', c: argb('#29ABE2') },
    { v: usd(grandPenalty), l: 'Est. max yearly exposure', c: argb('#F7941E') },
  ];
  const numRow = ws.getRow(r), lblRow = ws.getRow(r + 1);
  kpis.forEach((k, i) => {
    const c0 = i * 2 + 1;
    ws.mergeCells(r, c0, r, c0 + 1);
    ws.mergeCells(r + 1, c0, r + 1, c0 + 1);
    const num = numRow.getCell(c0);
    num.value = k.v;
    num.font = { name: FONT, bold: true, size: 22, color: { argb: INK } };
    num.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    num.border = { top: { style: 'medium', color: { argb: k.c } }, left: { style: 'thin', color: { argb: LINE } }, right: { style: 'thin', color: { argb: LINE } } };
    const lbl = lblRow.getCell(c0);
    lbl.value = k.l.toUpperCase();
    lbl.font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
    lbl.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    lbl.border = { bottom: { style: 'thin', color: { argb: LINE } }, left: { style: 'thin', color: { argb: LINE } }, right: { style: 'thin', color: { argb: LINE } } };
  });
  numRow.height = 30; lblRow.height = 16;
  r += 3;

  // --- Section: Compliance Roadmap table ---
  const sectionTitle = (text) => {
    ws.mergeCells(r, 1, r, NCOLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: FONT, bold: true, size: 12, color: { argb: SE_DARK } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 22;
    r += 1;
  };

  sectionTitle('Compliance Roadmap — Upcoming Deadlines');
  const roadmap = (() => {
    const map = new Map();
    for (const c of CATEGORIES) for (const { date, count } of deadlinesByDate(results, c)) {
      if (!map.has(date)) map.set(date, { bbs: 0, audits: 0, bps: 0 });
      map.get(date)[c] = count;
    }
    return [...map.entries()].map(([date, v]) => ({ date, ...v, total: v.bbs + v.audits + v.bps })).sort((a, b) => a.date.localeCompare(b.date));
  })();
  styleHeaderRow(ws.getRow(r), ['Compliance deadline', 'BBS', 'Energy Audits', 'BPS', 'Total sites', '', '', '']);
  r += 1;
  roadmap.forEach((row, i) => {
    const rr2 = ws.getRow(r);
    const vals = [mdY(row.date), row.bbs || '—', row.audits || '—', row.bps || '—', row.total];
    vals.forEach((v, ci) => {
      const cell = rr2.getCell(ci + 1);
      cell.value = v;
      cell.font = { name: FONT, size: 10, bold: ci === 0 || ci === 4, color: { argb: ci === 0 || ci === 4 ? INK : SLATE } };
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'center', indent: ci === 0 ? 1 : 0 };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
    rr2.height = 18;
    r += 1;
  });
  r += 1;

  // --- Section: Eligibility cards (images) ---
  // One card per requirement — coloured header, Applicable Sites + Max
  // Yearly Penalty callouts, and per-jurisdiction bars — matching the
  // on-page Compliance Screening cards.
  sectionTitle('Eligibility by Requirement');
  const imgTopRow = r - 1; // 0-indexed anchor
  let maxRows = 0;
  // Spread the three category cards across the full width — anchored at
  // columns A, D and G so the row fills the sheet instead of the left third.
  const EL_COLS = [0, 3, 6];
  CATEGORIES.forEach((c, i) => {
    const png = drawEligibilityCardPng({
      label: CATEGORY_LABEL[c],
      color: CATEGORY_COLOR[c],
      applicableSites: totalEligible(results, c),
      maxPenalty: totalPenalty(results, c),
      items: eligibilityByOrdinance(results, c).map(x => ({ label: x.government, value: x.count })),
      width: 330,
    });
    const used = placeImage(ws, wb, png, { col: EL_COLS[i] ?? i * 3, row: imgTopRow, maxW: 330 });
    maxRows = Math.max(maxRows, used);
  });
  r += maxRows + 1;

  // --- Section: Penalty exposure by jurisdiction table ---
  sectionTitle('Penalty Exposure by Jurisdiction (Est. Max / Year)');
  const penRows = (() => {
    const map = new Map();
    for (const c of CATEGORIES) for (const { government, penalty } of penaltyByOrdinance(results, c)) {
      if (!map.has(government)) map.set(government, { bbs: 0, audits: 0, bps: 0 });
      map.get(government)[c] = penalty;
    }
    return [...map.entries()].map(([government, v]) => ({ government, ...v, total: v.bbs + v.audits + v.bps })).sort((a, b) => b.total - a.total);
  })();
  styleHeaderRow(ws.getRow(r), ['Jurisdiction', 'BBS', 'Energy Audits', 'BPS', 'Total / yr', '', '', '']);
  r += 1;
  penRows.forEach((row, i) => {
    const rr2 = ws.getRow(r);
    const vals = [row.government, row.bbs || 0, row.audits || 0, row.bps || 0, row.total];
    vals.forEach((v, ci) => {
      const cell = rr2.getCell(ci + 1);
      cell.value = v;
      if (ci > 0) cell.numFmt = '"$"#,##0';
      cell.font = { name: FONT, size: 10, bold: ci === 0 || ci === 4, color: { argb: ci === 0 || ci === 4 ? INK : SLATE } };
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right', indent: 1 };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
    rr2.height = 18;
    r += 1;
  });
  // Total row.
  if (penRows.length) {
    const tot = penRows.reduce((s, x) => ({ bbs: s.bbs + x.bbs, audits: s.audits + x.audits, bps: s.bps + x.bps, total: s.total + x.total }), { bbs: 0, audits: 0, bps: 0, total: 0 });
    const tr = ws.getRow(r);
    ['All jurisdictions', tot.bbs, tot.audits, tot.bps, tot.total].forEach((v, ci) => {
      const cell = tr.getCell(ci + 1);
      cell.value = v;
      if (ci > 0) cell.numFmt = '"$"#,##0';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right', indent: 1 };
      cell.border = { top: { style: 'medium', color: { argb: argb('#3DCD58') } } };
    });
    tr.height = 19;
    r += 2;
  }

  // --- Section: Utility feeds (images) ---
  sectionTitle('Eligibility per Data Stream for Utility Feeds');
  const feedTop = r - 1;
  // Two feed charts, each ~half the sheet: anchored at columns A and E.
  const epPng = drawHBarsPng(utilityFeedEligibility(results, 'electric').rows.map(x => ({ label: x.utility, value: x.count })), { color: '#F2B705', title: 'Electric Power (EP)', width: 660, labelW: 200 });
  const ngPng = drawHBarsPng(utilityFeedEligibility(results, 'gas').rows.map(x => ({ label: x.utility, value: x.count })), { color: '#B5179E', title: 'Natural Gas (NG)', width: 660, labelW: 200 });
  const u1 = placeImage(ws, wb, epPng, { col: 0, row: feedTop, maxW: 660 });
  const u2 = placeImage(ws, wb, ngPng, { col: 4, row: feedTop, maxW: 660 });
  r += Math.max(u1, u2) + 1;

  // Footer.
  ws.mergeCells(r, 1, r, NCOLS);
  const foot = ws.getCell(r, 1);
  foot.value = `Schneider Electric · Generated ${generatedAt} · ${matched.length} of ${siteCount} sites matched a jurisdiction · Public`;
  foot.font = { name: FONT, size: 9, color: { argb: 'FF94A3B8' } };
  foot.alignment = { horizontal: 'center' };

  // === Sheet 2 — Site-by-Site Mandate Detail =============================
  buildSiteDetailSheet(wb, results, { generatedAt, siteCount, matched, sheetName: meta.siteDetailSheetName });

  // Combined-export mode: the sheets were added to the caller's shared
  // workbook, which writes and downloads the merged file itself.
  if (meta.targetWb) return null;

  const buf = await wb.xlsx.writeBuffer();
  if (meta.returnBuffer) return buf;
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Building-Compliance-Report.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return buf;
}

// Second sheet: one row per screened site with its applicable BBS / Energy
// Audits / BPS mandates, each mandate's deadline and estimated max yearly
// penalty. Green branded header, frozen header + Site column, autofilter,
// zebra rows; "Applicable" cells are coloured in each category's hue.
function buildSiteDetailSheet(wb, results, meta) {
  const ws = wb.addWorksheet(meta.sheetName || 'Site Detail', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false, state: 'frozen', ySplit: 4, xSplit: 1 }],
  });
  const NC = 15;
  ws.columns = [
    { width: 26 }, { width: 14 }, { width: 7 }, { width: 20 }, { width: 14 }, { width: 10 },
    { width: 11 }, { width: 13 }, { width: 14 },
    { width: 11 }, { width: 13 }, { width: 14 },
    { width: 11 }, { width: 13 }, { width: 14 },
  ];

  // Branded title band + logo.
  ws.mergeCells(1, 1, 1, NC);
  const t = ws.getCell(1, 1);
  t.value = 'Site-by-Site Mandate Detail';
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
  t.font = { name: FONT, bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 34;
  try {
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: 170 });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: NC - 1.9, row: 0.14 }, ext: { width: logo.width, height: logo.height } });
  } catch { /* canvas unavailable — skip logo */ }

  ws.mergeCells(2, 1, 2, NC);
  const s = ws.getCell(2, 1);
  s.value = `Each screened site with its applicable BBS / Energy Audits / BPS mandates, deadlines, and estimated max yearly penalties.  Generated ${meta.generatedAt}`;
  s.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const headers = ['Site', 'City', 'State', 'Jurisdiction', 'Gov ID', 'Sq Ft',
    'BBS', 'BBS Deadline', 'BBS Penalty/yr',
    'Energy Audits', 'Audits Deadline', 'Audits Penalty/yr',
    'BPS', 'BPS Deadline', 'BPS Penalty/yr'];
  const hr = ws.getRow(4);
  headers.forEach((label, i) => {
    const c = hr.getCell(i + 1);
    c.value = label;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    c.font = { name: FONT, bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0, wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  });
  hr.height = 26;

  const appCount = (r) => CATEGORIES.filter(c => r[c]?.eligible === true).length;
  const rows = [...results].sort((a, b) =>
    appCount(b) - appCount(a)
    || String(a.government || '~').localeCompare(String(b.government || '~'))
    || String(a.siteName || '').localeCompare(String(b.siteName || '')));

  let rr = 5;
  rows.forEach((r, idx) => {
    const zebra = idx % 2 === 1;
    const row = ws.getRow(rr);
    const sqft = (r.sqft != null && Number.isFinite(Number(r.sqft))) ? Number(r.sqft) : null;
    const base = [r.siteName || '', r.city || '', r.state || '', r.matched ? (r.government || '') : 'no match', r.govId || '', sqft];
    base.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = (v === '' || v == null) ? null : v;
      if (i === 5 && typeof v === 'number') c.numFmt = '#,##0';
      c.font = { name: FONT, size: 9.5, bold: i === 0, color: { argb: i === 0 ? INK : SLATE } };
      c.alignment = { vertical: 'middle', horizontal: i === 5 ? 'right' : 'left', indent: 1 };
    });
    CATEGORIES.forEach((cat, ci) => {
      const e = r[cat];
      const applicable = !!(e && e.active && e.eligible === true);
      const c0 = 7 + ci * 3;
      const appCell = row.getCell(c0);
      appCell.value = applicable ? 'Yes' : (r.matched ? 'No' : '—');
      appCell.font = { name: FONT, size: 9.5, bold: applicable, color: { argb: applicable ? argb(CATEGORY_COLOR[cat]) : 'FF94A3B8' } };
      appCell.alignment = { vertical: 'middle', horizontal: 'center' };
      const dlCell = row.getCell(c0 + 1);
      dlCell.value = applicable ? (e.deadline ? mdY(e.deadline) : (e.deadlineRaw || '')) : null;
      dlCell.font = { name: FONT, size: 9.5, color: { argb: SLATE } };
      dlCell.alignment = { vertical: 'middle', horizontal: 'center' };
      const penCell = row.getCell(c0 + 2);
      if (applicable && e.penalty != null) { penCell.value = e.penalty; penCell.numFmt = '"$"#,##0'; }
      else penCell.value = null;
      penCell.font = { name: FONT, size: 9.5, color: { argb: SLATE } };
      penCell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    });
    for (let ci = 1; ci <= NC; ci++) {
      const c = row.getCell(ci);
      if (zebra && !c.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    }
    row.height = 16;
    rr += 1;
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: NC } };
}
