// Formatted Excel version of the Building Compliance report — mirrors the
// printable HTML report (Schneider-branded header + logo, KPI tiles, the
// eligibility cards, a combined penalty-and-site-count table by jurisdiction,
// and the utility-feed bar charts).
//
// The eligibility-by-requirement cards are built from native cells with Excel
// data-bar conditional formatting, so those bars stay live and editable in the
// sheet. The utility-feed charts still rasterize to PNG via <canvas>.
//
// Browser-only: uses <canvas> to rasterize the feed charts + logo and ExcelJS
// to build the workbook. Mirrors the ExcelJS + canvas-image pattern already
// used by the ISO / NAM exports in SitesView.

import {
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  eligibilityByOrdinance, totalEligible,
  penaltyByOrdinance, totalPenalty, utilityFeedEligibility,
  bpsPrioritization,
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
// 1 -> 'A', 2 -> 'B', ... for building conditional-formatting ranges.
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// --- workbook builders ---------------------------------------------------

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
  // Columns 3 and 6 are the narrow gutters between the three Eligibility
  // cards (and Utility-feed panels); the rest are the wide card / table
  // columns. Keeping the gutters thin makes the cards read as wide tiles with
  // only a small white gap between them.
  // The eligibility-card bar columns (2/5/8) and the two utility-feed bar
  // columns (4 for EP, 8 for NG) are all the same width (34) so every data
  // bar — cards and feeds alike — is symmetric. The outer card name columns
  // (1/7) stay narrow so short jurisdiction names sit close to their bars;
  // column 4 doubles as the middle card's name and the EP feed bar, so it
  // matches the other bar columns. Columns 3 and 6 are the thin gutters
  // between cards; the penalty and BPS tables span across them (see their
  // *_SPANS arrays) so wide values aren't clipped by a gutter.
  ws.columns = [
    { width: 20 }, { width: 34 }, { width: 8 }, { width: 34 },
    { width: 34 }, { width: 8 }, { width: 20 }, { width: 34 },
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
  // Values are stored as real numbers (with a numFmt) rather than pre-formatted
  // strings, so Excel doesn't flag them with the green "number stored as text"
  // error triangle. The coloured top bar is thick to read as a header accent.
  const kpis = [
    { v: siteCount, l: 'Sites screened', c: SE_DARK },
    { v: withMandate, l: 'Sites with a mandate', c: argb('#3DCD58') },
    { v: jurisdictions, l: 'Jurisdictions matched', c: argb('#29ABE2') },
    { v: grandPenalty, l: 'Est. max yearly exposure', c: argb('#F7941E'), money: true },
  ];
  const numRow = ws.getRow(r), lblRow = ws.getRow(r + 1);
  kpis.forEach((k, i) => {
    const c0 = i * 2 + 1;
    ws.mergeCells(r, c0, r, c0 + 1);
    ws.mergeCells(r + 1, c0, r + 1, c0 + 1);
    const num = numRow.getCell(c0);
    num.value = k.v;
    num.numFmt = k.money ? '"$"#,##0' : '#,##0';
    num.ignoredErrors = { numberStoredAsText: true };
    num.font = { name: FONT, bold: true, size: 22, color: { argb: INK } };
    num.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    num.border = { top: { style: 'thick', color: { argb: k.c } }, left: { style: 'thin', color: { argb: LINE } }, right: { style: 'thin', color: { argb: LINE } } };
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
    // Blank white spacer row so consecutive tables read as separated blocks.
    ws.getRow(r).height = 12;
    r += 1;
    ws.mergeCells(r, 1, r, NCOLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: FONT, bold: true, size: 12, color: { argb: SE_DARK } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 22;
    r += 1;
  };

  // --- Section: Eligibility by Requirement (native data-bar cards) ---
  // Three cards side by side (BBS · Energy Audits · BPS), mirroring the
  // on-page Compliance Screening dashboard but built from native cells: a
  // coloured header, Applicable Sites + Max Yearly Penalty callouts, and a
  // per-jurisdiction list whose count column carries an Excel data-bar
  // conditional format. The bars therefore stay live and editable in the
  // sheet instead of being flattened to an image.
  sectionTitle('Eligibility by Requirement');
  // Each card is a 2-column pair; columns 3 and 6 stay empty as gutters so the
  // three cards read as separated tiles (matching the screenshot).
  const CARD_COLS = [1, 4, 7];
  const cards = CATEGORIES.map((c, i) => ({
    color: argb(CATEGORY_COLOR[c]),
    label: CATEGORY_LABEL[c],
    applicable: totalEligible(results, c),
    penalty: totalPenalty(results, c),
    items: eligibilityByOrdinance(results, c), // [{ government, count }], desc
    c0: CARD_COLS[i],
  }));
  const cardTop = r;                          // 1-indexed first row of the block
  const maxCityRows = Math.max(1, ...cards.map(d => d.items.length));

  // Coloured header band per card.
  const hRow = ws.getRow(cardTop);
  cards.forEach(d => {
    ws.mergeCells(cardTop, d.c0, cardTop, d.c0 + 1);
    const cell = hRow.getCell(d.c0);
    cell.value = `${d.label} Eligibility`;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: d.color } };
    cell.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  hRow.height = 22;

  // KPI callouts: Applicable Sites (left col) · Max Yearly Penalty (right col),
  // with small uppercase labels underneath — mirroring the on-page cards.
  const kNum = ws.getRow(cardTop + 1);
  const kLbl = ws.getRow(cardTop + 2);
  cards.forEach(d => {
    const nApp = kNum.getCell(d.c0);
    nApp.value = d.applicable;
    nApp.font = { name: FONT, bold: true, size: 18, color: { argb: d.color } };
    nApp.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    const nPen = kNum.getCell(d.c0 + 1);
    nPen.value = d.penalty || 0;
    nPen.numFmt = '"$"#,##0';
    nPen.font = { name: FONT, bold: true, size: 16, color: { argb: d.color } };
    nPen.alignment = { vertical: 'middle', horizontal: 'left' };
    const lApp = kLbl.getCell(d.c0);
    lApp.value = 'APPLICABLE SITES';
    lApp.font = { name: FONT, bold: true, size: 8, color: { argb: SLATE } };
    lApp.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    const lPen = kLbl.getCell(d.c0 + 1);
    lPen.value = 'MAX YEARLY PENALTY';
    lPen.font = { name: FONT, bold: true, size: 8, color: { argb: SLATE } };
    lPen.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  kNum.height = 24; kLbl.height = 14;

  // Per-jurisdiction rows: label (right-aligned, against the bar) + count.
  const cityTop = cardTop + 3;
  for (let ri = 0; ri < maxCityRows; ri++) {
    const row = ws.getRow(cityTop + ri);
    cards.forEach(d => {
      const item = d.items[ri];
      if (item) {
        const nameCell = row.getCell(d.c0);
        nameCell.value = item.government;
        nameCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
        nameCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        const valCell = row.getCell(d.c0 + 1);
        valCell.value = item.count;
        valCell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
        valCell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else if (ri === 0 && !d.items.length) {
        const noneCell = row.getCell(d.c0);
        noneCell.value = 'No eligible sites';
        noneCell.font = { name: FONT, italic: true, size: 10, color: { argb: 'FF94A3B8' } };
        noneCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
    });
    row.height = 17;
  }

  // Live data bar down each card's count column, scaled from 0 so a count of
  // 1 vs 2 reads proportionally. The count stays visible inside the cell.
  cards.forEach(d => {
    if (!d.items.length) return;
    const col = colLetter(d.c0 + 1);
    ws.addConditionalFormatting({
      ref: `${col}${cityTop}:${col}${cityTop + d.items.length - 1}`,
      rules: [{
        type: 'dataBar',
        gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
        color: { argb: d.color },
      }],
    });
  });

  r = cityTop + maxCityRows + 1;

  // --- Section: Combined compliance exposure by jurisdiction ---
  // Merges the former "Compliance Roadmap" (site counts) and "Penalty
  // Exposure" ($/yr) tables into one jurisdiction-keyed table. Each category
  // cell shows the estimated max yearly penalty with the number of eligible
  // sites in parentheses, e.g. "$2,000 (1)".
  sectionTitle('Penalty Exposure by Jurisdiction (Est. Max / Year · site count in parentheses)');
  const exposure = (() => {
    const map = new Map();
    const bump = (gov) => {
      if (!map.has(gov)) map.set(gov, { bbsP: 0, bbsN: 0, auditsP: 0, auditsN: 0, bpsP: 0, bpsN: 0, uniqueN: 0 });
      return map.get(gov);
    };
    for (const c of CATEGORIES) {
      for (const { government, penalty } of penaltyByOrdinance(results, c)) bump(government)[`${c}P`] = penalty;
      for (const { government, count } of eligibilityByOrdinance(results, c)) bump(government)[`${c}N`] = count;
    }
    // Total-column count = the number of UNIQUE sites in the jurisdiction (a
    // site with two mandates counts once), not the sum of the per-category
    // counts. A site belongs to a single government, so summing these gives
    // the true portfolio-wide unique total on the footer row.
    for (const rr of results) {
      if (!rr.matched) continue;
      if (!CATEGORIES.some(c => rr[c] && rr[c].eligible === true)) continue;
      bump(rr.government).uniqueN += 1;
    }
    return [...map.entries()].map(([government, v]) => ({
      government, ...v,
      totalP: v.bbsP + v.auditsP + v.bpsP,
      totalN: v.uniqueN,
    })).sort((a, b) => b.totalP - a.totalP || b.totalN - a.totalN || a.government.localeCompare(b.government));
  })();
  // Cell text: penalty with the eligible-site count in parentheses; blank
  // when a jurisdiction has neither a penalty nor an eligible site here.
  const cellPN = (penalty, count) => (count === 0 && penalty === 0) ? '' : `${usd(penalty)} (${count})`;
  // Each of the five logical columns spans one or two sheet columns so it
  // absorbs the narrow card-gutter columns (3 and 6) — keeping the values
  // (e.g. "$1,825,000 (1)") from being cut off.
  const PEN_SPANS = [[1, 1], [2, 3], [4, 4], [5, 6], [7, 8]];
  const writePenRow = (rowNum, values, { header = false, total = false, zebra = false } = {}) => {
    const rw = ws.getRow(rowNum);
    PEN_SPANS.forEach(([a, b], ci) => {
      if (b > a) ws.mergeCells(rowNum, a, rowNum, b);
      const cell = rw.getCell(a);
      cell.value = values[ci];
      // The "$… (n)" values are text; suppress Excel's number-stored-as-text
      // green error triangle.
      cell.ignoredErrors = { numberStoredAsText: true };
      if (header) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
        cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = { top: { style: 'thin', color: { argb: LINE } }, bottom: { style: 'thin', color: { argb: LINE } } };
      } else if (total) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
        cell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = { top: { style: 'medium', color: { argb: argb('#3DCD58') } } };
      } else {
        cell.font = { name: FONT, size: 10, bold: ci === 0 || ci === 4, color: { argb: ci === 0 || ci === 4 ? INK : SLATE } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      }
    });
    return rw;
  };
  writePenRow(r, ['Jurisdiction', 'BBS', 'Energy Audits', 'BPS', 'Total / yr'], { header: true }).height = 20;
  r += 1;
  exposure.forEach((row, i) => {
    writePenRow(r, [
      row.government,
      cellPN(row.bbsP, row.bbsN),
      cellPN(row.auditsP, row.auditsN),
      cellPN(row.bpsP, row.bpsN),
      cellPN(row.totalP, row.totalN),
    ], { zebra: i % 2 === 1 }).height = 18;
    r += 1;
  });
  // Total row.
  if (exposure.length) {
    const tot = exposure.reduce((s, x) => ({
      bbsP: s.bbsP + x.bbsP, bbsN: s.bbsN + x.bbsN,
      auditsP: s.auditsP + x.auditsP, auditsN: s.auditsN + x.auditsN,
      bpsP: s.bpsP + x.bpsP, bpsN: s.bpsN + x.bpsN,
      totalP: s.totalP + x.totalP, totalN: s.totalN + x.totalN,
    }), { bbsP: 0, bbsN: 0, auditsP: 0, auditsN: 0, bpsP: 0, bpsN: 0, totalP: 0, totalN: 0 });
    writePenRow(r, [
      'All jurisdictions',
      cellPN(tot.bbsP, tot.bbsN),
      cellPN(tot.auditsP, tot.auditsN),
      cellPN(tot.bpsP, tot.bpsN),
      cellPN(tot.totalP, tot.totalN),
    ], { total: true }).height = 19;
    r += 2;
  }

  // --- Section: BPS prioritization table ---
  // One row per (deadline, jurisdiction) over BPS-eligible sites: the
  // exceed-limit fine, eligible-site count, and summed estimated
  // non-reporting penalty. Mirrors the on-page table + Master Analysis
  // overview.
  sectionTitle('BPS Prioritization');
  const bpsRows = bpsPrioritization(results);
  // Each logical column spans one or two sheet columns so wide values (the
  // fine label, the "$…" penalty, the long fee note) clear the narrow card
  // gutters (cols 3 and 6) instead of being clipped. Fee sits at the far
  // right and its header fills that last column.
  const BPS_SPANS = [[1, 1], [2, 2], [3, 4], [5, 5], [6, 7], [8, 8]];
  const bpsHeaders = [
    'Upcoming Deadline', 'Compliance Government', 'BPS Fines for Exceeding Limits',
    'Number of eligible sites', 'Sum of Est. Penalty for non-reporting on BPS', 'Fee for exceeding limits',
  ];
  const bpsHdrRow = ws.getRow(r);
  BPS_SPANS.forEach(([a, b], ci) => {
    if (b > a) ws.mergeCells(r, a, r, b);
    const cell = bpsHdrRow.getCell(a);
    cell.value = bpsHeaders[ci];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    // The fee header fits on one line in the wide last column; the rest wrap.
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: ci !== 5 };
    cell.border = { top: { style: 'thin', color: { argb: LINE } }, bottom: { style: 'thin', color: { argb: LINE } } };
  });
  bpsHdrRow.height = 30;
  r += 1;
  if (!bpsRows.length) {
    ws.mergeCells(r, 1, r, NCOLS);
    const c = ws.getCell(r, 1);
    c.value = 'No BPS-eligible sites across the screened portfolio.';
    c.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    r += 2;
  } else {
    bpsRows.forEach((g, i) => {
      const rr2 = ws.getRow(r);
      const vals = [
        g.deadline ? mdY(g.deadline) : '',
        g.government || '',
        g.fine,
        g.sites,
        g.penaltyKnown ? g.penalty : '',
        g.feeExceeding,
      ];
      BPS_SPANS.forEach(([a, b], ci) => {
        if (b > a) ws.mergeCells(r, a, r, b);
        const cell = rr2.getCell(a);
        cell.value = vals[ci];
        if (ci === 4 && g.penaltyKnown) cell.numFmt = '"$"#,##0';
        cell.ignoredErrors = { numberStoredAsText: true };
        cell.font = { name: FONT, size: 10, bold: ci === 0 || ci === 1, italic: ci === 5, color: { argb: ci === 0 || ci === 1 ? INK : SLATE } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      });
      rr2.height = 18;
      r += 1;
    });
    r += 1;
  }

  // --- Section: Utility feeds (native data-bar panels) ---
  // Two panels (Electric Power · Natural Gas), built the same way as the
  // Eligibility cards above — a coloured header, a Total callout, and a
  // per-utility list whose count column carries a live Excel data bar —
  // instead of being flattened to an image. Each panel's utility names span
  // the wide gutter/card columns (merged) so long provider names fit.
  sectionTitle('Eligibility per Data Stream for Utility Feeds');
  // Rows ordered by eligible-site count, high to low (ties alphabetical).
  const feedData = (commodity) => {
    const f = utilityFeedEligibility(results, commodity);
    return { total: f.total, rows: [...f.rows].sort((a, b) => b.count - a.count || a.utility.localeCompare(b.utility)) };
  };
  const feeds = [
    { color: argb('#F2B705'), label: 'Electric Power (EP)', nameCols: [1, 3], barCol: 4, ...feedData('electric') },
    { color: argb('#B5179E'), label: 'Natural Gas (NG)', nameCols: [5, 7], barCol: 8, ...feedData('gas') },
  ];
  const feedTop = r;
  const maxFeedRows = Math.max(1, ...feeds.map(f => f.rows.length));

  // Coloured header band per panel (spans the panel's full width).
  const fHdr = ws.getRow(feedTop);
  feeds.forEach(f => {
    ws.mergeCells(feedTop, f.nameCols[0], feedTop, f.barCol);
    const cell = fHdr.getCell(f.nameCols[0]);
    cell.value = f.label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.color } };
    cell.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  fHdr.height = 22;

  // Total eligible-sites callout with a small uppercase label underneath.
  const fNum = ws.getRow(feedTop + 1);
  const fLbl = ws.getRow(feedTop + 2);
  feeds.forEach(f => {
    ws.mergeCells(feedTop + 1, f.nameCols[0], feedTop + 1, f.barCol);
    const n = fNum.getCell(f.nameCols[0]);
    n.value = f.total;
    n.font = { name: FONT, bold: true, size: 18, color: { argb: f.color } };
    n.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.mergeCells(feedTop + 2, f.nameCols[0], feedTop + 2, f.barCol);
    const l = fLbl.getCell(f.nameCols[0]);
    l.value = 'TOTAL ELIGIBLE SITES';
    l.font = { name: FONT, bold: true, size: 8, color: { argb: SLATE } };
    l.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  fNum.height = 24; fLbl.height = 14;

  // Per-utility rows: name (merged across the panel's label columns, right-
  // aligned against the bar) + count (with the data bar).
  const feedRowTop = feedTop + 3;
  for (let ri = 0; ri < maxFeedRows; ri++) {
    const row = ws.getRow(feedRowTop + ri);
    feeds.forEach(f => {
      const item = f.rows[ri];
      if (item) {
        ws.mergeCells(feedRowTop + ri, f.nameCols[0], feedRowTop + ri, f.nameCols[1]);
        const nameCell = row.getCell(f.nameCols[0]);
        nameCell.value = item.utility;
        nameCell.font = { name: FONT, size: 10, color: { argb: SLATE } };
        nameCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        const valCell = row.getCell(f.barCol);
        valCell.value = item.count;
        valCell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
        valCell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else if (ri === 0 && !f.rows.length) {
        ws.mergeCells(feedRowTop + ri, f.nameCols[0], feedRowTop + ri, f.barCol);
        const noneCell = row.getCell(f.nameCols[0]);
        noneCell.value = 'No eligible sites';
        noneCell.font = { name: FONT, italic: true, size: 10, color: { argb: 'FF94A3B8' } };
        noneCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
    });
    row.height = 17;
  }

  // Live data bar down each panel's count column, scaled from 0.
  feeds.forEach(f => {
    if (!f.rows.length) return;
    const col = colLetter(f.barCol);
    ws.addConditionalFormatting({
      ref: `${col}${feedRowTop}:${col}${feedRowTop + f.rows.length - 1}`,
      rules: [{
        type: 'dataBar',
        gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
        color: { argb: f.color },
      }],
    });
  });
  r = feedRowTop + maxFeedRows + 1;

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
      appCell.value = applicable ? 'Yes' : (r.matched ? 'No' : '');
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
