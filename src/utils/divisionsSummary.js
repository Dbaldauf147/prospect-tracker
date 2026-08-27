// The Master Analysis "Divisions" tab — the whole workbook read one level
// down from the company.
//
// A portfolio the size these analyses cover is rarely run as one business.
// Every other tab answers "how big is the opportunity / the exposure /
// the data gap for this company"; this one answers it per operating
// division, so the numbers can be handed to the person who actually owns
// that estate. Four sections, in the order a conversation runs:
//
//   1. Energy procurement savings opportunity — deregulated sites, spend
//      and the indicative savings range, by division.
//   2. Energy consumption — electric and gas volume, by division. Every
//      site, not just the deregulated ones section 1 prices: it is how big
//      each division's estate is in energy terms, which is the question a
//      spend figure alone can't answer.
//   3. Compliance — screened sites, mandates that land, and the estimated
//      annual non-reporting exposure, by division.
//   4. Interval data — the share of each division's sites mapped to a
//      known utility and confirmed for interval data. This is the "how
//      good are the numbers above" section, per division.
//   5. Sites by ISO / RTO — a live dropdown that picks a market, with each
//      division's site count in it, over the full division × market matrix.
//
// The aggregation (summarizeDivisions) is pure and takes one flat record
// per site, so it can be tested without a browser. The savings figures come
// in pre-rolled from SitesView: the deregulation status and savings
// percentages are per-state tables that live with the page's market
// classifier, and recomputing them here would let the Divisions tab drift
// from the Summary tab that reports the same money.

import { schneiderLogoPngDataUrl, SE_GREEN_DARK } from './schneiderLogo.js';
import { NONE_SOUTHEAST, NONE_WECC, NONE_NON_INTERCONNECTED } from './isoLookup.js';

const argb = (hex) => 'FF' + String(hex).replace('#', '').toUpperCase();
const SE_DARK = argb(SE_GREEN_DARK);   // FF009530
const SE_LIGHT = 'FFE6F7EC';
const INK = 'FF0F172A';
const SLATE = 'FF475569';
const LINE = 'FFE2E8F0';
const ZEBRA = 'FFFAFCFB';
const FONT = 'Nunito Sans';
const AMBER = 'FF92400E';

export const NO_DIVISION_LABEL = '(No division)';
export const UNKNOWN_ISO_LABEL = 'Unknown';
// Header for the matrix's roll-up column. Also a valid pick in the ISO
// dropdown — selecting it puts every division's whole site count in the
// selected-market table, which is the natural "show me everything" answer.
export const ALL_ISO_LABEL = 'All markets';

// The ISO table's non-ISO answers are full sentences ("None (WECC: no ISO;
// CAISO WEIM participation is not full ISO membership)") — true, and far too
// long for a column header. Shortened for the matrix, with the full text
// restated in a footnote under it so nothing is lost.
const ISO_SHORT = {
  [NONE_SOUTHEAST]: 'Non-ISO (Southeast)',
  [NONE_WECC]: 'Non-ISO (WECC)',
  [NONE_NON_INTERCONNECTED]: 'Non-ISO (islanded)',
};

// A blank division is a real bucket, not a missing one — a portfolio part
// way through being filed still has sites nobody has assigned yet, and they
// carry spend and mandates like any other. One label for it, shared by the
// aggregation here and the per-division savings rollup on the page, so the
// two join on the same key.
export function divisionLabel(raw) {
  const d = String(raw || '').trim();
  return d || NO_DIVISION_LABEL;
}

export function isoLabel(iso) {
  const s = String(iso || '').trim();
  if (!s) return UNKNOWN_ISO_LABEL;
  return ISO_SHORT[s] || s;
}

function emptyDivision(name) {
  return {
    name,
    sites: 0,
    // Interval data / utility mapping.
    mapped: 0, intervalYes: 0, intervalNo: 0, intervalUnknown: 0,
    // Building compliance.
    screened: 0, jurisdiction: 0, bbs: 0, audits: 0, bps: 0, anyMandate: 0,
    penalty: 0, penaltyKnown: false,
    // Energy procurement (filled from savingsByDivision).
    electricDeregSites: 0, electricSpend: 0, electricLow: 0, electricHigh: 0,
    gasDeregSites: 0, gasSpend: 0, gasLow: 0, gasHigh: 0,
    // Energy consumption, over every site rather than the deregulated ones.
    // Carried in the units the page holds natively — kWh and therms — and
    // converted where it is written, so nothing is rounded twice. The
    // "modelled" halves are the part of each total that came from the
    // property-type estimate rather than off the uploaded file.
    kwh: 0, kwhModelled: 0, kwhSites: 0,
    therms: 0, thermsModelled: 0, thermsSites: 0,
    // Sites by market.
    iso: {},
  };
}

// Roll one flat record per site up by division.
//
// `siteFacts` entries:
//   { division, iso, mapped, interval, compliance }
//     interval    true | false | null — null is "the utility's Status column
//                 is blank or the utility isn't in the mapping table", which
//                 is neither confirmed nor ruled out and is counted apart
//                 from a confirmed no.
//     compliance  null when the site is outside the compliance screening's
//                 scope (the screening runs on owned buildings by default),
//                 else { matched, eligible: { bbs, audits, bps }, penalty }.
//                 A site out of scope still counts in `sites` — it is in the
//                 division, it just isn't screened — so the compliance
//                 section reports against `screened`, not the site total.
//     energy      { kwh, therms, kwhModelled, thermsModelled } — annual
//                 consumption, null on either commodity where the site has
//                 no figure at all. The counts of sites that DO carry one
//                 are reported beside the totals: a division whose gas
//                 volume comes from two of its ninety sites has a total
//                 that means something quite different from one whose
//                 ninety all reported.
//
// `savingsByDivision` is keyed by the same divisionLabel(): the per-division
// procurement rollup, computed on the page against its per-state
// deregulation and savings tables.
export function summarizeDivisions(siteFacts = [], savingsByDivision = {}) {
  const byName = new Map();
  const isoTotals = new Map();
  const ensure = (name) => {
    if (!byName.has(name)) byName.set(name, emptyDivision(name));
    return byName.get(name);
  };

  for (const f of (siteFacts || [])) {
    const d = ensure(divisionLabel(f?.division));
    d.sites += 1;

    const market = isoLabel(f?.iso);
    d.iso[market] = (d.iso[market] || 0) + 1;
    isoTotals.set(market, (isoTotals.get(market) || 0) + 1);

    if (f?.mapped) d.mapped += 1;
    if (f?.interval === true) d.intervalYes += 1;
    else if (f?.interval === false) d.intervalNo += 1;
    else d.intervalUnknown += 1;

    const e = f?.energy;
    if (e) {
      if (isNum(e.kwh)) {
        d.kwh += e.kwh;
        d.kwhSites += 1;
        if (e.kwhModelled) d.kwhModelled += e.kwh;
      }
      if (isNum(e.therms)) {
        d.therms += e.therms;
        d.thermsSites += 1;
        if (e.thermsModelled) d.thermsModelled += e.therms;
      }
    }

    const c = f?.compliance;
    if (c) {
      d.screened += 1;
      if (c.matched) d.jurisdiction += 1;
      let any = false;
      for (const k of ['bbs', 'audits', 'bps']) {
        if (c.eligible?.[k]) { d[k] += 1; any = true; }
      }
      if (any) d.anyMandate += 1;
      if (typeof c.penalty === 'number' && Number.isFinite(c.penalty)) {
        d.penalty += c.penalty;
        d.penaltyKnown = true;
      }
    }
  }

  for (const [rawName, s] of Object.entries(savingsByDivision || {})) {
    const d = ensure(divisionLabel(rawName));
    d.electricDeregSites = num(s?.electricDeregSites);
    d.electricSpend = num(s?.electricSpend);
    d.electricLow = num(s?.electricLow);
    d.electricHigh = num(s?.electricHigh);
    d.gasDeregSites = num(s?.gasDeregSites);
    d.gasSpend = num(s?.gasSpend);
    d.gasLow = num(s?.gasLow);
    d.gasHigh = num(s?.gasHigh);
  }

  for (const d of byName.values()) {
    d.deregSpend = d.electricSpend + d.gasSpend;
    d.savingsLow = d.electricLow + d.gasLow;
    d.savingsHigh = d.electricHigh + d.gasHigh;
  }

  // Biggest division first — the reader's first question is which one
  // carries the estate. The unassigned bucket sorts last whatever its size:
  // it isn't a division, and leading with it would bury the ones that are.
  const divisions = [...byName.values()].sort((a, b) => {
    const aNo = a.name === NO_DIVISION_LABEL, bNo = b.name === NO_DIVISION_LABEL;
    if (aNo !== bNo) return aNo ? 1 : -1;
    return b.sites - a.sites || a.name.localeCompare(b.name);
  });

  // Markets, most-sited first, with the unresolved bucket last for the same
  // reason. Only markets the portfolio is actually in become columns.
  const isoLabels = [...isoTotals.entries()]
    .sort((a, b) => {
      const aUnk = a[0] === UNKNOWN_ISO_LABEL, bUnk = b[0] === UNKNOWN_ISO_LABEL;
      if (aUnk !== bUnk) return aUnk ? 1 : -1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([label]) => label);

  const totals = emptyDivision('All divisions');
  for (const d of divisions) {
    for (const k of [
      'sites', 'mapped', 'intervalYes', 'intervalNo', 'intervalUnknown',
      'screened', 'jurisdiction', 'bbs', 'audits', 'bps', 'anyMandate', 'penalty',
      'electricDeregSites', 'electricSpend', 'electricLow', 'electricHigh',
      'gasDeregSites', 'gasSpend', 'gasLow', 'gasHigh',
      'kwh', 'kwhModelled', 'kwhSites', 'therms', 'thermsModelled', 'thermsSites',
    ]) totals[k] += d[k];
    if (d.penaltyKnown) totals.penaltyKnown = true;
    for (const [m, n] of Object.entries(d.iso)) totals.iso[m] = (totals.iso[m] || 0) + n;
  }
  totals.deregSpend = totals.electricSpend + totals.gasSpend;
  totals.savingsLow = totals.electricLow + totals.gasLow;
  totals.savingsHigh = totals.electricHigh + totals.gasHigh;

  return { divisions, isoLabels, totals };
}

function num(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// 1 Dth = 10 therms. Consumption is held in therms — the unit the page
// reads gas in and the unit the rates are per — and reported in Dth, which
// is what the Site Detail and the tier / market roll-ups in this same
// workbook are written in.
const THERMS_PER_DTH = 10;
export const toDth = (therms) => num(therms) / THERMS_PER_DTH;

// 1 -> 'A'. Data-validation and formula refs are A1-style; everything else
// on the sheet is written by column number.
const colLetter = (n) => { let s = ''; let i = n; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// === Divisions sheet =====================================================
// `summary` is what summarizeDivisions returns. Always writes the tab, even
// for a site list with no Division column mapped — the Master Analysis keeps
// a fixed tab set, and a sheet that says why it's empty beats a missing one.
export function buildDivisionsSheet(wb, summary, meta = {}) {
  const { divisions = [], isoLabels = [], totals = emptyDivision('All divisions') } = summary || {};
  const NC = 10;
  // The market matrix runs wider than the tables above it when a portfolio
  // spans a lot of ISOs, so the sheet is as wide as the widest thing on it.
  const matrixCols = 2 + isoLabels.length; // Division + one per market + total
  const width = Math.max(NC, matrixCols);

  const ws = wb.addWorksheet(meta.sheetName || 'Divisions', {
    properties: { tabColor: { argb: SE_DARK } },
    // The Division column stays put as the sections scroll sideways, and the
    // title band stays put as they scroll down — four stacked tables all
    // named by that first column, so losing it loses the sheet.
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3, xSplit: 1 }],
  });
  ws.columns = Array.from({ length: width }, (_, i) => ({ width: i === 0 ? 30 : 17 }));

  titleBand(wb, ws, NC, 'Divisions', meta.companyName);

  const named = divisions.filter(d => d.name !== NO_DIVISION_LABEL);
  ws.mergeCells(2, 1, 2, NC);
  const sub = ws.getCell(2, 1);
  sub.value = [
    named.length
      ? `Every figure in this workbook, one level below the company: ${named.length} division${named.length === 1 ? '' : 's'}`
      : 'No Division column is mapped on the Utility Lookup upload, so every site rolls up as one estate',
    `${totals.sites.toLocaleString()} site${totals.sites === 1 ? '' : 's'}`,
    meta.generatedAt ? `Generated ${meta.generatedAt}` : '',
    meta.scopeNote || '',
  ].filter(Boolean).join('  ·  ');
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
  ws.getRow(2).height = 26;
  ws.getRow(3).height = 6;

  let r = 4;

  // ---- 1. Energy procurement savings opportunity -------------------------
  r = section(ws, r, NC, 'Energy Procurement Savings Opportunity by Division',
    'Deregulated sites, annual deregulated spend and the indicative savings range each division carries. Savings apply to deregulated spend only; a regulated market resolves to $0 rather than being left blank, so the columns still add up.');
  r = table(ws, r, {
    columns: [
      { label: 'Division', key: 'name', align: 'left', width: 30 },
      { label: 'Sites', key: 'sites', numFmt: '#,##0' },
      { label: 'Electric Dereg. Sites', key: 'electricDeregSites', numFmt: '#,##0' },
      { label: 'Electric Dereg. Spend', key: 'electricSpend', numFmt: '"$"#,##0' },
      { label: 'Gas Dereg. Sites', key: 'gasDeregSites', numFmt: '#,##0' },
      { label: 'Gas Dereg. Spend', key: 'gasSpend', numFmt: '"$"#,##0' },
      { label: 'Total Dereg. Spend', key: 'deregSpend', numFmt: '"$"#,##0' },
      { label: 'Indicative Savings Low', key: 'savingsLow', numFmt: '"$"#,##0' },
      { label: 'Indicative Savings High', key: 'savingsHigh', numFmt: '"$"#,##0', emphasis: true },
      { label: '% of Portfolio Savings', key: 'shareOfSavings', numFmt: '0%' },
    ],
    rows: divisions.map(d => ({
      ...d,
      shareOfSavings: totals.savingsHigh ? d.savingsHigh / totals.savingsHigh : 0,
    })),
    totals: { ...totals, name: 'All divisions', shareOfSavings: totals.savingsHigh ? 1 : 0 },
    barColumn: 9,
  });

  // ---- 2. Energy consumption ---------------------------------------------
  // Every site, not just the deregulated ones priced above: this is the size
  // of each division's estate in energy terms, and a division that is mostly
  // regulated still uses power. Which is also why the two sections must not
  // be read across — the spend column above covers a subset of the sites
  // this volume covers, so dividing one by the other is not a rate.
  r = section(ws, r, NC, 'Energy Consumption by Division',
    'Annual electric and gas volume across EVERY site in the division, regulated and deregulated alike — unlike the spend above, which covers deregulated sites only. "Sites with data" is how many sites carry a consumption figure at all; the rest contribute nothing to the total. "Modelled" is the part of the total that came from the property-type estimate rather than off the uploaded file — a total that is largely modelled is an indication of size, not a meter reading. Gas is reported in Dth (1 Dth = 10 therms), as on the Site Detail tab.');
  r = table(ws, r, {
    columns: [
      { label: 'Division', key: 'name', align: 'left', width: 30 },
      { label: 'Sites', key: 'sites', numFmt: '#,##0' },
      { label: 'Sites with Electric Data', key: 'kwhSites', numFmt: '#,##0' },
      { label: 'Annual Electric (kWh)', key: 'kwh', numFmt: '#,##0', emphasis: true },
      { label: 'of which Modelled (kWh)', key: 'kwhModelled', numFmt: '#,##0' },
      { label: '% of Portfolio kWh', key: 'shareKwh', numFmt: '0%' },
      { label: 'Sites with Gas Data', key: 'thermsSites', numFmt: '#,##0' },
      { label: 'Annual Gas (Dth)', key: 'gasDth', numFmt: '#,##0', emphasis: true },
      { label: 'of which Modelled (Dth)', key: 'gasModelledDth', numFmt: '#,##0' },
      { label: '% of Portfolio Dth', key: 'shareDth', numFmt: '0%' },
    ],
    rows: divisions.map(d => ({
      ...d,
      gasDth: toDth(d.therms),
      gasModelledDth: toDth(d.thermsModelled),
      shareKwh: totals.kwh ? d.kwh / totals.kwh : 0,
      shareDth: totals.therms ? d.therms / totals.therms : 0,
    })),
    totals: {
      ...totals,
      name: 'All divisions',
      gasDth: toDth(totals.therms),
      gasModelledDth: toDth(totals.thermsModelled),
      shareKwh: totals.kwh ? 1 : 0,
      shareDth: totals.therms ? 1 : 0,
    },
    barColumn: 4,
  });

  // ---- 3. Compliance -----------------------------------------------------
  r = section(ws, r, NC, 'Building Compliance by Division',
    'Sites screened against the building-performance ordinances, the mandates that land on them, and the estimated annual non-reporting exposure. Screened counts follow the Building Compliance tab\'s Owned / All-sites scope, so a division\'s screened total can be lower than its site count.');
  r = table(ws, r, {
    columns: [
      { label: 'Division', key: 'name', align: 'left', width: 30 },
      { label: 'Sites Screened', key: 'screened', numFmt: '#,##0' },
      { label: 'In a Mandate Jurisdiction', key: 'jurisdiction', numFmt: '#,##0' },
      { label: 'BBS (Benchmarking)', key: 'bbs', numFmt: '#,##0' },
      { label: 'Energy Audits', key: 'audits', numFmt: '#,##0' },
      { label: 'BPS', key: 'bps', numFmt: '#,##0' },
      { label: 'Sites with ≥1 Mandate', key: 'anyMandate', numFmt: '#,##0' },
      { label: '% of Screened Sites', key: 'shareMandated', numFmt: '0%' },
      { label: 'Est. Annual Penalty Exposure', key: 'penaltyCell', numFmt: '"$"#,##0', emphasis: true },
      { label: '% of Portfolio Exposure', key: 'shareOfPenalty', numFmt: '0%' },
    ],
    rows: divisions.map(d => ({
      ...d,
      shareMandated: d.screened ? d.anyMandate / d.screened : 0,
      // No site in this division had a computable fine — a dash, not a $0.
      // The two read very differently to someone sizing exposure.
      penaltyCell: d.penaltyKnown ? d.penalty : '-',
      shareOfPenalty: totals.penalty ? d.penalty / totals.penalty : 0,
    })),
    totals: {
      ...totals,
      name: 'All divisions',
      shareMandated: totals.screened ? totals.anyMandate / totals.screened : 0,
      penaltyCell: totals.penaltyKnown ? totals.penalty : '-',
      shareOfPenalty: totals.penalty ? 1 : 0,
    },
    barColumn: 9,
  });

  // ---- 4. Interval data --------------------------------------------------
  r = section(ws, r, NC, 'Interval Data by Division',
    'How good the numbers above are, per division: the share of sites whose electric utility is mapped to a known utility, and the share confirmed to have utility interval data. "Unknown" is a utility with a blank Status or one absent from the Utility Name Mapping table — neither confirmed nor ruled out.');
  r = table(ws, r, {
    columns: [
      { label: 'Division', key: 'name', align: 'left', width: 30 },
      { label: 'Sites', key: 'sites', numFmt: '#,##0' },
      { label: 'Mapped to a Known Utility', key: 'mapped', numFmt: '#,##0' },
      { label: '% Mapped', key: 'shareMapped', numFmt: '0%' },
      { label: 'Interval Data: Yes', key: 'intervalYes', numFmt: '#,##0', emphasis: true },
      { label: '% with Interval Data', key: 'shareInterval', numFmt: '0%' },
      { label: 'Interval Data: No', key: 'intervalNo', numFmt: '#,##0' },
      { label: 'Interval Data: Unknown', key: 'intervalUnknown', numFmt: '#,##0' },
      { label: '', key: '__blank1', numFmt: null },
      { label: '', key: '__blank2', numFmt: null },
    ],
    rows: divisions.map(d => ({
      ...d,
      shareMapped: d.sites ? d.mapped / d.sites : 0,
      shareInterval: d.sites ? d.intervalYes / d.sites : 0,
    })),
    totals: {
      ...totals,
      name: 'All divisions',
      shareMapped: totals.sites ? totals.mapped / totals.sites : 0,
      shareInterval: totals.sites ? totals.intervalYes / totals.sites : 0,
    },
    barColumn: 5,
  });

  // ---- 5. Sites by ISO / RTO --------------------------------------------
  isoSection(ws, r, NC, divisions, isoLabels, totals);

  return ws;
}

// A market picker over the full division × market matrix.
//
// The picker is a real Excel dropdown (list validation over the matrix's own
// header row) and the table under it is real formulas, so changing the
// selection re-reads the matrix in the sheet — no re-export to look at a
// different market. Cached results are written alongside each formula so the
// table reads correctly in a viewer that doesn't recalculate on open.
function isoSection(ws, startRow, NC, divisions, isoLabels, totals) {
  let r = section(ws, startRow, NC, 'Sites by ISO / RTO Market, by Division',
    'Pick a market from the dropdown: the table under it counts each division\'s sites in that market. The full matrix below is what it reads — every market the portfolio is in, by division. Markets are resolved from each site\'s US ZIP via the EPA eGRID subregion crosswalk; a site outside the US, or on a ZIP the crosswalk doesn\'t carry, counts as Unknown.');

  const headers = [...isoLabels, ALL_ISO_LABEL];
  // Default the picker to the market the most sites sit in, so the sheet
  // opens on the answer rather than on a blank cell.
  const defaultIso = headers[0] || ALL_ISO_LABEL;

  // The matrix is laid out first because the picker's validation list and
  // every formula above point into it — but it is written BELOW the picker,
  // so its rows are worked out here and filled in after.
  const pickerRow = r;
  const selectedHeaderRow = r + 2;
  const selectedFirstRow = selectedHeaderRow + 1;
  const selectedTotalRow = selectedFirstRow + divisions.length;
  const matrixTitleRow = selectedTotalRow + 2;
  const matrixHeaderRow = matrixTitleRow + 1;
  const matrixFirstRow = matrixHeaderRow + 1;
  const matrixTotalRow = matrixFirstRow + divisions.length;
  const lastMatrixCol = 1 + headers.length;
  const matrixRange = `$${colLetter(2)}$${matrixHeaderRow}:$${colLetter(lastMatrixCol)}$${matrixTotalRow}`;
  const headerRange = `$${colLetter(2)}$${matrixHeaderRow}:$${colLetter(lastMatrixCol)}$${matrixHeaderRow}`;

  // ---- the picker ----
  const label = ws.getCell(pickerRow, 1);
  label.value = 'ISO / RTO market';
  label.font = { name: FONT, bold: true, size: 11, color: { argb: INK } };
  label.alignment = { vertical: 'middle', horizontal: 'right' };
  const pick = ws.getCell(pickerRow, 2);
  pick.value = defaultIso;
  pick.font = { name: FONT, bold: true, size: 11, color: { argb: SE_DARK } };
  pick.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
  pick.alignment = { vertical: 'middle', horizontal: 'center' };
  pick.border = {
    top: { style: 'thin', color: { argb: SE_DARK } }, bottom: { style: 'thin', color: { argb: SE_DARK } },
    left: { style: 'thin', color: { argb: SE_DARK } }, right: { style: 'thin', color: { argb: SE_DARK } },
  };
  // Validated against the matrix header row rather than a literal list:
  // Excel caps an inline list at 255 characters, which the market names blow
  // past on any sizeable portfolio, and a range can't fall out of step with
  // the columns it's picking from.
  pick.dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: [headerRange],
    showErrorMessage: true,
    errorTitle: 'Pick a market',
    error: `Choose one of the markets listed in the matrix below, or "${ALL_ISO_LABEL}".`,
  };
  const hint = ws.getCell(pickerRow, 3);
  hint.value = `← dropdown  ·  ${headers.length - 1} market${headers.length - 1 === 1 ? '' : 's'} in this portfolio`;
  hint.font = { name: FONT, italic: true, size: 9, color: { argb: SLATE } };
  hint.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(pickerRow).height = 22;

  // ---- the selected-market table ----
  const selCols = ['Division', 'Sites in Selected Market', "% of Division's Sites"];
  headerRow(ws, selectedHeaderRow, selCols.map((l, i) => ({ label: l, align: i === 0 ? 'left' : 'center' })));

  const countOf = (d, market) => (market === ALL_ISO_LABEL ? d.sites : (d.iso[market] || 0));
  divisions.forEach((d, i) => {
    const rowNo = selectedFirstRow + i;
    const mRow = matrixFirstRow + i;
    // HLOOKUP down the matrix column the picker names. Row 1 of the range is
    // the header, so this division's row inside it is its matrix row minus
    // the header row, plus one.
    const idx = mRow - matrixHeaderRow + 1;
    const count = countOf(d, defaultIso);
    const totalCell = `$${colLetter(lastMatrixCol)}$${mRow}`;
    writeRow(ws, rowNo, i, [
      { v: d.name, align: 'left', bold: true, color: INK },
      {
        v: { formula: `IFERROR(HLOOKUP($B$${pickerRow},${matrixRange},${idx},FALSE),0)`, result: count },
        numFmt: '#,##0', bold: true, color: SE_DARK,
      },
      {
        v: { formula: `IFERROR(${colLetter(2)}${rowNo}/${totalCell},0)`, result: d.sites ? count / d.sites : 0 },
        numFmt: '0%',
      },
    ]);
  });
  totalsRow(ws, selectedTotalRow, [
    { v: 'All divisions', align: 'left' },
    {
      v: {
        formula: `IFERROR(HLOOKUP($B$${pickerRow},${matrixRange},${matrixTotalRow - matrixHeaderRow + 1},FALSE),0)`,
        result: countOf(totals, defaultIso),
      },
      numFmt: '#,##0',
    },
    {
      v: {
        formula: `IFERROR(${colLetter(2)}${selectedTotalRow}/$${colLetter(lastMatrixCol)}$${matrixTotalRow},0)`,
        result: totals.sites ? countOf(totals, defaultIso) / totals.sites : 0,
      },
      numFmt: '0%',
    },
  ]);
  // A live bar down the count column, scaled to the largest division rather
  // than to itself, so the split reads at a glance and stays right when the
  // picker moves.
  if (divisions.length) {
    ws.addConditionalFormatting({
      ref: `${colLetter(2)}${selectedFirstRow}:${colLetter(2)}${selectedTotalRow - 1}`,
      rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: SE_DARK } }],
    });
  }

  // ---- the matrix ----
  const mt = ws.getCell(matrixTitleRow, 1);
  mt.value = 'Division × market matrix';
  mt.font = { name: FONT, bold: true, size: 10, color: { argb: SLATE } };
  mt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  headerRow(ws, matrixHeaderRow, [
    { label: 'Division', align: 'left' },
    ...headers.map(h => ({ label: h, align: 'center' })),
  ]);
  divisions.forEach((d, i) => {
    writeRow(ws, matrixFirstRow + i, i, [
      { v: d.name, align: 'left', bold: true, color: INK },
      ...headers.map(h => ({ v: countOf(d, h), numFmt: '#,##0', bold: h === ALL_ISO_LABEL })),
    ]);
  });
  totalsRow(ws, matrixTotalRow, [
    { v: 'All divisions', align: 'left' },
    ...headers.map(h => ({ v: countOf(totals, h), numFmt: '#,##0' })),
  ]);

  let after = matrixTotalRow + 2;

  // Restate any market name the matrix shortened, so a header nobody can
  // read in full still resolves to the answer the ISO table actually gives.
  const shortened = Object.entries(ISO_SHORT).filter(([, short]) => headers.includes(short));
  if (shortened.length) {
    ws.mergeCells(after, 1, after, NC);
    const note = ws.getCell(after, 1);
    note.value = 'Shortened market names: ' + shortened.map(([full, short]) => `${short} = ${full}`).join('  ·  ');
    note.font = { name: FONT, italic: true, size: 9, color: { argb: 'FF94A3B8' } };
    note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(after).height = 26;
    after += 2;
  }

  return after;
}

// --- small shared writers ------------------------------------------------

function section(ws, row, NC, title, note) {
  ws.mergeCells(row, 1, row, NC);
  const h = ws.getCell(row, 1);
  h.value = title;
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
  h.font = { name: FONT, bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 24;

  ws.mergeCells(row + 1, 1, row + 1, NC);
  const n = ws.getCell(row + 1, 1);
  n.value = note;
  n.font = { name: FONT, italic: true, size: 9, color: { argb: SLATE } };
  n.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(row + 1).height = 28;
  return row + 2;
}

function headerRow(ws, row, columns) {
  const hr = ws.getRow(row);
  columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.label || null;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_DARK } };
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.alignment = {
      vertical: 'middle', horizontal: c.align || 'center',
      indent: c.align === 'left' ? 1 : 0, wrapText: true,
    };
    cell.border = { bottom: { style: 'thin', color: { argb: LINE } }, right: { style: 'hair', color: { argb: 'FFFFFFFF' } } };
  });
  hr.height = 30;
}

function writeRow(ws, row, zebraIndex, cells) {
  const rr = ws.getRow(row);
  cells.forEach((spec, i) => {
    const cell = rr.getCell(i + 1);
    cell.value = (spec.v === '' || spec.v == null) ? null : spec.v;
    if (spec.numFmt) cell.numFmt = spec.numFmt;
    cell.font = {
      name: FONT, size: 10, bold: !!spec.bold,
      color: { argb: spec.color || SLATE },
    };
    cell.alignment = {
      vertical: 'middle', horizontal: spec.align || 'center',
      indent: spec.align === 'left' ? 1 : 0,
    };
    if (zebraIndex % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
  });
  rr.height = 18;
}

function totalsRow(ws, row, cells) {
  const rr = ws.getRow(row);
  cells.forEach((spec, i) => {
    const cell = rr.getCell(i + 1);
    cell.value = (spec.v === '' || spec.v == null) ? null : spec.v;
    if (spec.numFmt) cell.numFmt = spec.numFmt;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: INK } };
    cell.alignment = {
      vertical: 'middle', horizontal: spec.align || 'center',
      indent: spec.align === 'left' ? 1 : 0,
    };
    cell.border = { top: { style: 'medium', color: { argb: argb('#3DCD58') } } };
  });
  rr.height = 19;
}

// One section's table: header, a row per division, a totals row, and a live
// data bar down the column the section is really about. Returns the next
// free row, two below the table.
function table(ws, startRow, { columns, rows, totals, barColumn }) {
  headerRow(ws, startRow, columns);
  const first = startRow + 1;

  if (!rows.length) {
    ws.mergeCells(first, 1, first, columns.length);
    const c = ws.getCell(first, 1);
    c.value = 'No sites in scope.';
    c.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    return first + 2;
  }

  rows.forEach((d, i) => {
    writeRow(ws, first + i, i, columns.map((col, ci) => ({
      v: d[col.key],
      numFmt: col.numFmt,
      align: col.align,
      bold: ci === 0 || col.emphasis,
      // A dash where a figure couldn't be worked out reads as a caveat, not
      // as a number — amber rather than the column's own colour.
      color: ci === 0 ? INK : (d[col.key] === '-' ? AMBER : (col.emphasis ? SE_DARK : SLATE)),
    })));
  });

  const totalRow = first + rows.length;
  totalsRow(ws, totalRow, columns.map(col => ({
    v: col.key === 'name' ? totals.name : totals[col.key],
    numFmt: col.numFmt,
    align: col.align,
  })));

  if (barColumn) {
    const L = colLetter(barColumn);
    ws.addConditionalFormatting({
      ref: `${L}${first}:${L}${totalRow - 1}`,
      rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: SE_DARK } }],
    });
  }
  return totalRow + 2;
}

// Branded header band, matching the other Master Analysis sheets. The logo
// rasterizes through <canvas>, so it is skipped rather than fatal wherever
// that isn't available (Node, tests).
function titleBand(wb, ws, ncols, titleText, companyName) {
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
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: 170 });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: ncols - 1.9, row: 0.14 }, ext: { width: logo.width, height: logo.height } });
  } catch { /* canvas unavailable — skip logo */ }
}
