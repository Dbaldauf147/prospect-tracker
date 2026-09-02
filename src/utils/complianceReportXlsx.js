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
import { loadWholeBuildingLookup, withWholeBuildingUtilities } from './wholeBuildingLookup.js';
import { schneiderLogoPngDataUrl, SE_GREEN_DARK } from './schneiderLogo.js';
import { isCaliforniaSite } from './siteRegion.js';

const argb = (hex) => 'FF' + String(hex).replace('#', '').toUpperCase();
const SE_DARK = argb(SE_GREEN_DARK);          // FF009530
const SE_LIGHT = 'FFE6F7EC';
const INK = 'FF0F172A';
const SLATE = 'FF475569';
const LINE = 'FFE2E8F0';
const ZEBRA = 'FFFAFCFB';
const FONT = 'Nunito Sans';
// A jurisdiction the revenue screen has ruled out, and the rows it moots.
// Same red the Corporate Compliance card tints those rows with, so a
// printed sheet and the screen say the same thing at a glance.
const RULED_OUT = 'FF991B1B';
const RULED_OUT_FILL = 'FFFEE2E2';

// The reference link and findings a user typed against a screening row.
// Their own work, so it travels with the row it explains rather than being
// dropped on export.
function refText(row) {
  return [
    row?.reference ? `Ref: ${row.reference}` : '',
    row?.findings ? `Findings: ${row.findings}` : '',
  ].filter(Boolean).join('  ·  ');
}

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
  // Utilities named from the Whole Building Data file, the same as the panels
  // on screen — the workbook decides which utility serves a zip, and the site
  // list's own name only stands where it doesn't list the zip. Failing to load
  // the reference leaves the uploaded names rather than losing the section.
  const feedResults = withWholeBuildingUtilities(results, await loadWholeBuildingLookup().catch(() => null));
  // Rows ordered by eligible-site count, high to low (ties alphabetical).
  const feedData = (commodity) => {
    const f = utilityFeedEligibility(feedResults, commodity);
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
  const NC = 16;
  ws.columns = [
    { width: 26 }, { width: 14 }, { width: 7 }, { width: 20 }, { width: 14 }, { width: 10 }, { width: 11 },
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

  // Ownership sits with Sq Ft — both are attributes of the building rather
  // than of where it is — and ahead of the mandates, since who owns the
  // building is the first question asked of an obligation that falls on
  // the owner.
  const headers = ['Site', 'City', 'State', 'Jurisdiction', 'Gov ID', 'Sq Ft', 'Owned / Leased',
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
    const base = [r.siteName || '', r.city || '', r.state || '', r.matched ? (r.government || '') : 'no match', r.govId || '', sqft,
      r.ownership || ''];
    base.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = (v === '' || v == null) ? null : v;
      if (i === 5 && typeof v === 'number') c.numFmt = '#,##0';
      c.font = { name: FONT, size: 9.5, bold: i === 0, color: { argb: i === 0 ? INK : SLATE } };
      c.alignment = {
        vertical: 'middle',
        horizontal: i === 5 ? 'right' : i === 6 ? 'center' : 'left',
        indent: i === 6 ? 0 : 1,
      };
    });
    CATEGORIES.forEach((cat, ci) => {
      const e = r[cat];
      const applicable = !!(e && e.active && e.eligible === true);
      const c0 = 8 + ci * 3;
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

// Shared branded title band + floated logo, used by the Corporate Compliance
// and Methodology sheets so they read as part of the same report as the
// Compliance Report / Site Detail tabs above.
function titleBand(wb, ws, ncols, titleText, companyName, { logoWidth = 170 } = {}) {
  ws.mergeCells(1, 1, 1, ncols);
  const title = ws.getCell(1, 1);
  const titleFont = { name: FONT, bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  const co = String(companyName || '').trim();
  if (co) {
    title.value = {
      richText: [
        { font: { name: FONT, bold: true, size: 10, color: { argb: 'FFD1FADF' } }, text: `${co}\n` },
        { font: titleFont, text: titleText },
      ],
    };
  } else {
    title.value = titleText;
    title.font = titleFont;
  }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(1).height = co ? 44 : 34;
  try {
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: logoWidth });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: ncols - 1.9, row: 0.14 }, ext: { width: logo.width, height: logo.height } });
  } catch { /* canvas unavailable — skip logo */ }
}

// === Corporate Compliance sheet ==========================================
// Company-level portfolio view mirroring the on-page Corporate Compliance
// tab: one row per company with its total site footprint, California site
// count (the state that drives most corporate-disclosure obligations), and
// the California site locations. `sites` is the complianceSites list
// ({ company, siteName, city, state, ... }).
export function buildCorporateComplianceSheet(wb, sites, meta = {}) {
  const ws = wb.addWorksheet(meta.sheetName || 'Corporate Compliance', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false, state: 'frozen', ySplit: 4, xSplit: 1 }],
  });
  const NC = 5;
  // Columns 2 and 3 are wider than the overview table alone needs: the
  // screening detail below reuses them for the question text and the
  // researched rationale, which are prose rather than counts.
  ws.columns = [
    { width: 30 }, { width: 34 }, { width: 42 }, { width: 13 }, { width: 60 },
  ];

  const byCompany = new Map();
  for (const site of (sites || [])) {
    const name = String(site.company || '').trim() || '(Unnamed company)';
    if (!byCompany.has(name)) byCompany.set(name, { name, total: 0, california: 0, caSites: [] });
    const e = byCompany.get(name);
    e.total += 1;
    // Shared with the Corporate Compliance page: a California State plus
    // a US (or absent) country, so a "CA" that's really Canada or Cádiz
    // doesn't inflate the exported count.
    if (isCaliforniaSite(site)) {
      e.california += 1;
      const label = [site.siteName, site.city].filter(Boolean).join(': ');
      if (label) e.caSites.push(label);
    }
  }
  const companies = [...byCompany.values()].sort(
    (a, b) => b.california - a.california || b.total - a.total || a.name.localeCompare(b.name)
  );
  const totalSites = companies.reduce((s, c) => s + c.total, 0);
  const totalCA = companies.reduce((s, c) => s + c.california, 0);
  const generatedAt = meta.generatedAt || '';
  const CA_GREEN = argb('#166534');

  titleBand(wb, ws, NC, 'Corporate Compliance', meta.companyName);

  ws.mergeCells(2, 1, 2, NC);
  const sub = ws.getCell(2, 1);
  sub.value = `Company-level portfolio view: total site footprint and California site operations.  Generated ${generatedAt}  ·  ${companies.length} ${companies.length === 1 ? 'company' : 'companies'} · ${totalSites} sites · ${totalCA} California sites`;
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 6;

  const headers = ['Company', 'Total Sites', 'California Sites', '% California', 'California Site Locations'];
  const hr = ws.getRow(4);
  headers.forEach((label, i) => {
    const c = hr.getCell(i + 1);
    c.value = label;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    c.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 4 ? 'left' : 'center', indent: i === 0 || i === 4 ? 1 : 0, wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  });
  hr.height = 24;

  let rr = 5;
  const firstDataRow = rr;
  if (!companies.length) {
    ws.mergeCells(rr, 1, rr, NC);
    const c = ws.getCell(rr, 1);
    c.value = 'No sites loaded: upload sites on the Utility Lookup tab to populate companies here.';
    c.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    rr += 1;
  } else {
    companies.forEach((co, idx) => {
      const zebra = idx % 2 === 1;
      const row = ws.getRow(rr);
      const MAX_LABELS = 15;
      const shown = co.caSites.slice(0, MAX_LABELS).join('; ');
      const caText = co.caSites.length > MAX_LABELS
        ? `${shown}; +${co.caSites.length - MAX_LABELS} more`
        : shown;
      const cells = [
        { v: co.name, align: 'left' },
        { v: co.total, align: 'center', num: '#,##0' },
        { v: co.california, align: 'center', num: '#,##0', green: co.california > 0 },
        { v: co.total ? co.california / co.total : 0, align: 'center', num: '0%' },
        { v: caText || (co.california ? '' : '-'), align: 'left', wrap: true },
      ];
      cells.forEach((spec, i) => {
        const c = row.getCell(i + 1);
        c.value = (spec.v === '' ) ? null : spec.v;
        if (spec.num) c.numFmt = spec.num;
        c.font = {
          name: FONT, size: 10,
          bold: i === 0 || (i === 2 && spec.green),
          color: { argb: i === 0 ? INK : (spec.green ? CA_GREEN : SLATE) },
        };
        c.alignment = { vertical: 'middle', horizontal: spec.align, indent: spec.align === 'left' ? 1 : 0, wrapText: !!spec.wrap };
        if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      });
      rr += 1;
    });

    // Totals row.
    const trow = ws.getRow(rr);
    const totals = ['All companies', totalSites, totalCA, totalSites ? totalCA / totalSites : 0, ''];
    totals.forEach((v, i) => {
      const c = trow.getCell(i + 1);
      c.value = (v === '') ? null : v;
      if (i === 1 || i === 2) c.numFmt = '#,##0';
      if (i === 3) c.numFmt = '0%';
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
      c.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 4 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
      c.border = { top: { style: 'medium', color: { argb: argb('#3DCD58') } } };
    });
    trow.height = 19;

    // Live green data bar down the California Sites column.
    const lastDataRow = firstDataRow + companies.length - 1;
    const col = colLetter(3);
    ws.addConditionalFormatting({
      ref: `${col}${firstDataRow}:${col}${lastDataRow}`,
      rules: [{
        type: 'dataBar', gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
        color: { argb: CA_GREEN },
      }],
    });
    rr += 2;
  }

  ws.mergeCells(rr, 1, rr, NC);
  const note = ws.getCell(rr, 1);
  note.value = 'Company revenue and sustainability-framework matches (CDP, GRESB, SBT, Ecovadis, …) are surfaced on the Corporate Compliance page, which fuzzy-matches each company against your uploaded Lists.';
  note.font = { name: FONT, italic: true, size: 9, color: { argb: 'FF94A3B8' } };
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(rr).height = 26;
  rr += 2;

  // ---- Per-company screening detail -------------------------------------
  // The jurisdiction-by-jurisdiction analysis from each Corporate Compliance
  // card: the six gating questions with their researched rationale, the
  // regulations each answer triggers with their Applies? verdicts, and the
  // company narrative + sources behind the run. Only rendered for companies
  // that have actually been screened — an unscreened company would just be
  // six blank rows.
  // A company counts as screened once anything on its card has been filled
  // in — not just a jurisdiction answer. Researched CSRD figures, a
  // resolved criterion, an HQ or a reference note are all work worth
  // carrying, and gating on the answers alone dropped cards that had
  // plenty on them.
  const screened = (meta.screening || []).filter(c =>
    c.jurisdictions?.some(j =>
      j.answer
      || j.reference || j.findings
      || j.criteriaGroups?.some(g => g.rows?.some(r => r.verdict || r.reference || r.findings))
      || j.regulations?.some(r => r.verdict || r.reference || r.findings)
    )
    || c.summary
    || c.hq?.location
  );
  if (screened.length) {
    ws.mergeCells(rr, 1, rr, NC);
    const dh = ws.getCell(rr, 1);
    dh.value = 'Screening Detail by Company';
    dh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    dh.font = { name: FONT, bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    dh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(rr).height = 24;
    rr += 2;

    for (const co of screened) {
      // Company banner: name + the headline facts from the card.
      ws.mergeCells(rr, 1, rr, NC);
      const nameCell = ws.getCell(rr, 1);
      const bits = [
        `${co.total} ${co.total === 1 ? 'site' : 'sites'}`,
        co.california ? `${co.california} in CA` : '',
        co.revenueLabel ? `Revenue ${co.revenueLabel}${co.revenueFiscalYear ? ` (${co.revenueFiscalYear})` : ''}` : '',
        co.employees ? `${Number(co.employees).toLocaleString()} employees` : '',
        // HQ earns its place on the banner: it's the first thing that
        // decides which regimes are even in play.
        co.hq?.location ? `HQ ${co.hq.location}${co.hq.region ? ` (${co.hq.region})` : ''}` : '',
      ].filter(Boolean).join('  ·  ');
      nameCell.value = `${co.name}    ${bits}`;
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
      nameCell.font = { name: FONT, bold: true, size: 11, color: { argb: INK } };
      nameCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(rr).height = 20;
      rr += 1;

      // Column headers mirroring the card's table. The last column doubles
      // as the card's "Reference & Findings" — a derivation's basis and the
      // user's own note both belong to the row they explain.
      const hdrs = ['Jurisdiction', 'Question / Regulation', 'Screening', 'Applies?', 'Thresholds / Basis / Findings'];
      const hrow = ws.getRow(rr);
      hdrs.forEach((label, i) => {
        const c = hrow.getCell(i + 1);
        c.value = label;
        c.font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
      });
      hrow.height = 18;
      rr += 1;

      for (const j of co.jurisdictions || []) {
        const jrow = ws.getRow(rr);
        const jCells = [
          { v: j.jurisdiction, bold: true, red: j.ruledOut },
          { v: j.question },
          {
            v: [
              j.jurisdiction === 'California' && co.california ? `${co.california} ${co.california === 1 ? 'site' : 'sites'}` : '',
              j.note,
            ].filter(Boolean).join(': ') || '-',
            wrap: true,
          },
          // A jurisdiction its revenue screen has ruled out reads No — the
          // same verdict the card's collapsed row shows, rather than the
          // operate/sell question's own answer, which would headline Yes
          // over a column of ruled-out mandates. The stored answer isn't
          // lost: the card keeps it in the tooltip, the sheet keeps it here.
          {
            v: j.ruledOut
              ? (j.answer ? `No (answer on file: ${j.answer})` : 'No')
              : (j.answer || '-'),
            center: true,
            green: !j.ruledOut && j.answer === 'Yes',
            red: j.ruledOut,
            wrap: true,
          },
          { v: [j.ruledOutWhy, refText(j)].filter(Boolean).join('  ·  '), wrap: true },
        ];
        jCells.forEach((spec, i) => {
          const c = jrow.getCell(i + 1);
          c.value = spec.v === '' ? null : spec.v;
          c.font = {
            name: FONT, size: 9.5, bold: !!spec.bold,
            color: { argb: spec.red ? RULED_OUT : (spec.green ? CA_GREEN : (spec.bold ? INK : SLATE)) },
          };
          c.alignment = {
            vertical: 'top', horizontal: spec.center ? 'center' : 'left',
            indent: spec.center ? 0 : 1, wrapText: !!spec.wrap,
          };
          if (j.ruledOut) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RULED_OUT_FILL } };
          c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
        });
        jrow.height = j.note ? 30 : 16;
        rr += 1;

        // The workings behind the answer, indented under the jurisdiction:
        // California's revenue thresholds and doing-business test, the EU's
        // CSRD screening figures. A group the revenue screen has mooted
        // renders N/A with the reason, the way the card does.
        for (const group of j.criteriaGroups || []) {
          const grow = ws.getRow(rr);
          const gCells = [
            { v: group.label, bold: true, indent: 2, red: group.na },
            { v: group.note || '', wrap: true, span: true },
          ];
          const gLabel = grow.getCell(1);
          gLabel.value = gCells[0].v;
          gLabel.font = { name: FONT, bold: true, size: 9, color: { argb: group.na ? RULED_OUT : INK } };
          gLabel.alignment = { vertical: 'top', horizontal: 'left', indent: 2 };
          ws.mergeCells(rr, 2, rr, NC);
          const gNote = ws.getCell(rr, 2);
          gNote.value = group.note || null;
          gNote.font = { name: FONT, italic: true, size: 9, color: { argb: group.na ? RULED_OUT : SLATE } };
          gNote.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
          grow.height = group.note && group.note.length > 90 ? 26 : 15;
          rr += 1;

          for (const row of group.rows || []) {
            const crow = ws.getRow(rr);
            const cCells = [
              { v: '' },
              { v: row.label, wrap: true },
              { v: row.screening || '-', wrap: true },
              { v: row.verdict || '-', center: true, green: row.verdict === 'Yes', red: row.na },
              {
                v: [
                  row.basis,
                  row.auto ? '(auto)' : '',
                  refText(row),
                ].filter(Boolean).join('  ·  '),
                wrap: true,
              },
            ];
            cCells.forEach((spec, i) => {
              const c = crow.getCell(i + 1);
              c.value = spec.v === '' ? null : spec.v;
              c.font = {
                name: FONT, size: 9, italic: i === 4,
                color: { argb: spec.red ? RULED_OUT : (spec.green ? CA_GREEN : SLATE) },
              };
              c.alignment = {
                vertical: 'top', horizontal: spec.center ? 'center' : 'left',
                indent: spec.center ? 0 : (i === 1 ? 3 : 1), wrapText: !!spec.wrap,
              };
              c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
            });
            crow.height = (row.basis || '').length > 90 || (row.label || '').length > 46 ? 26 : 15;
            rr += 1;
          }
        }

        // Each regulation this jurisdiction triggers, indented under it.
        for (const reg of j.regulations || []) {
          const rrow = ws.getRow(rr);
          const rCells = [
            { v: '' },
            { v: `${reg.regulation} · ${reg.timeline}`, bold: true },
            { v: '' },
            { v: reg.verdict || '-', center: true, green: reg.verdict === 'Yes', red: reg.ruledOut },
            {
              v: [
                reg.thresholds || reg.description,
                reg.basis,
                reg.auto ? '(auto)' : '',
                refText(reg),
              ].filter(Boolean).join('  ·  '),
              wrap: true,
            },
          ];
          rCells.forEach((spec, i) => {
            const c = rrow.getCell(i + 1);
            c.value = spec.v === '' ? null : spec.v;
            c.font = {
              name: FONT, size: 9, bold: !!spec.bold, italic: i === 4,
              color: { argb: spec.red && !spec.green ? RULED_OUT : (spec.green ? CA_GREEN : SLATE) },
            };
            c.alignment = {
              vertical: 'top', horizontal: spec.center ? 'center' : 'left',
              indent: spec.center ? 0 : (i === 1 ? 2 : 1), wrapText: !!spec.wrap,
            };
            c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
          });
          rrow.height = (reg.basis || '').length > 90 ? 26 : 16;
          rr += 1;
        }
      }

      // Narrative + sources + CA site list behind the run.
      const trailing = [];
      // The parent comes before HQ: every regime on this sheet tests its
      // thresholds at the consolidated group, so which entity was screened
      // is the first thing a reader has to be able to check. Its revenue
      // travels with it — a verdict reached on the parent's numbers reads
      // as unsupported when only the subsidiary's figure is on the page.
      if (co.parent) {
        // Say outright which figure the thresholds were tested against, and
        // carry the other one alongside. A reader checking a Yes against a
        // subsidiary that turns over a fraction of the quoted revenue has to
        // be able to see why that is not an error — and a reader checking a
        // Yes reached on the subsidiary's own larger figure has to be able to
        // see that the parent's smaller one didn't decide it.
        const screenedAtParent = !!co.revenueEntity;
        trailing.push({
          label: 'Parent',
          text: [
            co.parent,
            co.parentRevenueLabel
              ? `revenue ${co.parentRevenueLabel}${co.parentRevenueFiscalYear ? ` (${co.parentRevenueFiscalYear})` : ''}`
              : 'revenue not researched',
            screenedAtParent
              ? `thresholds below tested at the parent, the larger figure${co.ownRevenueLabel ? `; ${co.name}'s own revenue ${co.ownRevenueLabel}` : ''}`
              : co.parentRevenueLabel
                ? `thresholds below tested at ${co.name}${co.ownRevenueLabel ? `, whose own revenue ${co.ownRevenueLabel} is the larger figure` : ', the larger figure'}`
                : 'thresholds below tested at this company (no parent revenue researched)',
          ].filter(Boolean).join('  ·  '),
        });
      }
      if (co.hq?.location) {
        trailing.push({
          label: 'HQ',
          text: [co.hq.location, co.hq.region, co.hq.source ? `via ${co.hq.source}` : '']
            .filter(Boolean).join('  ·  '),
        });
      }
      // Only worth stating once California has actually been screened —
      // it's the second leg every California mandate turns on.
      if (co.doingBusinessInCA) {
        trailing.push({
          label: 'Doing business in CA',
          text: co.caRuledOut ? `${co.doingBusinessInCA} · ${co.caRuledOutWhy}` : co.doingBusinessInCA,
        });
      }
      if (co.summary) trailing.push({ label: 'Summary', text: co.summary });
      if (co.sources?.length) {
        trailing.push({
          label: 'Sources',
          text: co.sources.map(s => s?.title || s?.url).filter(Boolean).join('  ·  '),
        });
      }
      if (co.caSites?.length) {
        const MAX = 15;
        const shown = co.caSites.slice(0, MAX).join('; ');
        trailing.push({
          label: 'CA sites',
          text: co.caSites.length > MAX ? `${shown}; +${co.caSites.length - MAX} more` : shown,
        });
      }
      for (const t of trailing) {
        const lab = ws.getCell(rr, 1);
        lab.value = t.label;
        lab.font = { name: FONT, bold: true, size: 9, color: { argb: SLATE } };
        lab.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
        ws.mergeCells(rr, 2, rr, NC);
        const val = ws.getCell(rr, 2);
        val.value = t.text;
        val.font = { name: FONT, italic: true, size: 9, color: { argb: SLATE } };
        val.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
        ws.getRow(rr).height = Math.min(60, 14 + Math.ceil(t.text.length / 110) * 12);
        rr += 1;
      }
      rr += 1; // gap before the next company
    }
  }
}

// === Compliance Report Methodology sheet =================================
// A written explanation of how the estimated fines were derived, broken out
// by mandate (BBS / Energy Audits / BPS), plus a concrete per-jurisdiction
// penalty reference so the numbers on the Compliance Report tab can be traced
// back to their inputs. `results` is the output of screenSites().
export function buildComplianceMethodologySheet(wb, results, meta = {}) {
  const ws = wb.addWorksheet(meta.sheetName || 'Compliance Report Methodology', {
    properties: { tabColor: { argb: SE_DARK } },
    views: [{ showGridLines: false }],
  });
  const NC = 5;
  ws.columns = [
    { width: 30 }, { width: 16 }, { width: 22 }, { width: 14 }, { width: 22 },
  ];
  const generatedAt = meta.generatedAt || '';

  titleBand(wb, ws, NC, 'Compliance Report Methodology', meta.companyName);

  ws.mergeCells(2, 1, 2, NC);
  const sub = ws.getCell(2, 1);
  sub.value = `How the estimated compliance fines on the Compliance Report were derived, by mandate.  Generated ${generatedAt}`;
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  let r = 4;

  // Neutral (green) section header spanning the sheet.
  const section = (text, color = SE_DARK, fill = SE_LIGHT, textColor = SE_DARK) => {
    ws.getRow(r).height = 8; r += 1;
    ws.mergeCells(r, 1, r, NC);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    c.font = { name: FONT, bold: true, size: 12, color: { argb: textColor } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 22; r += 1;
  };
  // Coloured mandate banner (white text on the category hue).
  const mandateBanner = (text, color) => {
    ws.getRow(r).height = 8; r += 1;
    ws.mergeCells(r, 1, r, NC);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    c.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 20; r += 1;
  };
  // Wrapped body paragraph. `label` bolds a lead-in; `text` is the body.
  const para = (label, text, { lines = 2 } = {}) => {
    ws.mergeCells(r, 1, r, NC);
    const c = ws.getCell(r, 1);
    c.value = label
      ? { richText: [
          { font: { name: FONT, bold: true, size: 10, color: { argb: INK } }, text: `${label}  ` },
          { font: { name: FONT, size: 10, color: { argb: SLATE } }, text },
        ] }
      : text;
    if (!label) c.font = { name: FONT, size: 10, color: { argb: SLATE } };
    c.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(r).height = 15 * lines;
    r += 1;
  };

  // --- Overview -----------------------------------------------------------
  section('Overview');
  para('Two-step lookup.', 'Every site is resolved city + state → Government ID (City Lookup), then Government ID → the jurisdiction\'s BBS, Energy-Audit, and BPS mandates (Master Ordinances). Sites whose city/state don\'t resolve to a jurisdiction are reported as "no match" and carry no estimated fine.', { lines: 3 });
  para('Applicability.', 'A mandate applies to a site when that jurisdiction\'s ordinance is Active AND the building meets the ordinance\'s square-footage threshold for its property type. A building under the threshold is not counted as needing to report and carries no estimated fine. Where an ordinance publishes no threshold, an active ordinance is enough. A site with no square footage cannot be measured against a threshold, so it is taken to meet it and is counted as needing to report; supply the square footage to screen it against the ordinance for real.', { lines: 4 });
  para('Estimates only.', 'All figures are preliminary maximum-exposure estimates for prioritization, not a legal determination of liability. Actual penalties depend on each jurisdiction\'s enforcement, compliance pathway, and the site\'s reported performance.', { lines: 2 });

  // --- Per-mandate calculation --------------------------------------------
  section('Fine Calculation by Mandate');

  mandateBanner('BBS: Building Benchmarking & Disclosure', argb(CATEGORY_COLOR.bbs));
  para('Applies when', 'the site\'s jurisdiction has an active BBS benchmarking / disclosure ordinance and the building meets that ordinance\'s ft² threshold for its property type.', { lines: 2 });
  para('Estimated max yearly penalty', '= the jurisdiction\'s maximum annual BBS penalty (from the Master Ordinances), charged once per applicable site per year.', { lines: 2 });

  mandateBanner('Energy Audits', argb(CATEGORY_COLOR.audits));
  para('Applies when', 'the site\'s jurisdiction has an active energy-audit / tune-up ordinance and the building meets that ordinance\'s ft² threshold for its property type.', { lines: 2 });
  para('Estimated max yearly penalty', '= the jurisdiction\'s maximum annual energy-audit penalty (from the Master Ordinances), charged once per applicable site per year.', { lines: 2 });

  mandateBanner('BPS: Building Performance Standards', argb(CATEGORY_COLOR.bps));
  para('Applies when', 'the site\'s jurisdiction has an active BPS ordinance and the building meets that ordinance\'s ft² threshold for its property type.', { lines: 2 });
  para('Estimated non-reporting penalty', '= the jurisdiction\'s BPS penalty. When the penalty UOM is "$ per SqFt / Year" it scales by the building\'s square footage (rate × ft²); otherwise it is a flat annual amount. A size-based penalty on a site with no square footage is left blank ("-") rather than guessed.', { lines: 3 });
  para('Fee for exceeding limits', 'is the jurisdiction\'s enforcement cost for exceeding performance targets. It is shown as its own labelled figure on the Compliance Report\'s BPS Prioritization table and is NOT added into the estimated exposure totals.', { lines: 2 });

  // --- Roll-ups -----------------------------------------------------------
  section('Portfolio Roll-ups');
  para('Applicable sites (per mandate)', '= the number of applicable sites for that mandate across the portfolio.', { lines: 1 });
  para('Max yearly penalty (per mandate)', '= the per-site penalty summed over every applicable site for that mandate.', { lines: 1 });
  para('Penalty exposure by jurisdiction', '= for each jurisdiction and mandate, the per-site penalty × the number of applicable sites in that jurisdiction. A jurisdiction\'s total counts each site once even when it carries more than one mandate.', { lines: 2 });
  para('Est. max yearly exposure (grand total)', '= BBS + Energy Audits + BPS estimated penalties summed across every jurisdiction.', { lines: 1 });
  para('Deadlines', 'Each applicable mandate carries the jurisdiction\'s compliance deadline where one is published; mandates that are active but have no published deadline are still counted in the exposure but are reported as undated.', { lines: 2 });

  // --- Concrete per-jurisdiction penalty inputs ---------------------------
  // One row per (jurisdiction, mandate) present in this portfolio, tracing the
  // exposure back to its inputs: est. per-site penalty, applicable sites, and
  // the resulting category exposure.
  section('Penalty Inputs Used in This Report');
  const refHeaders = ['Jurisdiction', 'Mandate', 'Est. Penalty / Site / Yr', 'Applicable Sites', 'Category Exposure / Yr'];
  const rhr = ws.getRow(r);
  refHeaders.forEach((label, i) => {
    const c = rhr.getCell(i + 1);
    c.value = label;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    c.font = { name: FONT, bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 || i === 1 ? 'left' : 'center', indent: i === 0 || i === 1 ? 1 : 0, wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  });
  rhr.height = 26;
  r += 1;

  // Build rows from penaltyByOrdinance (summed exposure) + eligibilityByOrdinance
  // (applicable-site counts); est. per-site = exposure / count.
  const refRows = [];
  for (const c of CATEGORIES) {
    const counts = new Map(eligibilityByOrdinance(results, c).map(x => [x.government, x.count]));
    for (const { government, penalty } of penaltyByOrdinance(results, c)) {
      const count = counts.get(government) || 0;
      if (!count) continue;
      refRows.push({
        government,
        mandate: CATEGORY_LABEL[c],
        perSite: penalty / count,
        count,
        exposure: penalty,
        color: argb(CATEGORY_COLOR[c]),
      });
    }
  }
  refRows.sort((a, b) => b.exposure - a.exposure || a.government.localeCompare(b.government) || a.mandate.localeCompare(b.mandate));

  if (!refRows.length) {
    ws.mergeCells(r, 1, r, NC);
    const c = ws.getCell(r, 1);
    c.value = 'No jurisdiction in the screened portfolio carries a mandate with a defined penalty.';
    c.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    r += 1;
  } else {
    refRows.forEach((row, idx) => {
      const zebra = idx % 2 === 1;
      const rw = ws.getRow(r);
      const vals = [
        { v: row.government, align: 'left' },
        { v: row.mandate, align: 'left', color: row.color, bold: true },
        { v: row.perSite, align: 'center', num: '"$"#,##0' },
        { v: row.count, align: 'center', num: '#,##0' },
        { v: row.exposure, align: 'center', num: '"$"#,##0' },
      ];
      vals.forEach((spec, i) => {
        const c = rw.getCell(i + 1);
        c.value = spec.v;
        if (spec.num) c.numFmt = spec.num;
        c.font = { name: FONT, size: 10, bold: i === 0 || spec.bold, color: { argb: spec.color || (i === 0 ? INK : SLATE) } };
        c.alignment = { vertical: 'middle', horizontal: spec.align, indent: spec.align === 'left' ? 1 : 0 };
        if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      });
      rw.height = 17;
      r += 1;
    });
    // Grand-total row.
    const grand = CATEGORIES.reduce((s, c) => s + totalPenalty(results, c), 0);
    const trow = ws.getRow(r);
    const tvals = ['All jurisdictions', '', null, null, grand];
    tvals.forEach((v, i) => {
      const c = trow.getCell(i + 1);
      if (i === 4) { c.value = v; c.numFmt = '"$"#,##0'; }
      else c.value = (v === '' || v == null) ? null : v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
      c.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
      c.border = { top: { style: 'medium', color: { argb: argb('#3DCD58') } } };
    });
    trow.height = 19;
    r += 1;
  }

  r += 1;
  ws.mergeCells(r, 1, r, NC);
  const foot = ws.getCell(r, 1);
  foot.value = `Schneider Electric · Preliminary compliance estimates · Generated ${generatedAt} · Public`;
  foot.font = { name: FONT, size: 9, color: { argb: 'FF94A3B8' } };
  foot.alignment = { horizontal: 'center' };
}
