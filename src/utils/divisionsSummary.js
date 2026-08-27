// The Master Analysis "Divisions" tab — the whole workbook read one level
// down from the company.
//
// A portfolio the size these analyses cover is rarely run as one business.
// Every other tab answers "how big is the opportunity / the exposure /
// the data gap for this company"; this one answers it per operating
// division, so the numbers can be handed to the person who actually owns
// that estate. Six sections, in the order a conversation runs:
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
//   6. Consumption by state — a live dropdown that picks a division, with
//      its electric and gas volume in every state, over the full
//      state × division matrices. Section 2 read the other way round: that
//      one asks how big each division is, this one asks where its load is.
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
// Excel's "show nothing" number format: positive, negative and zero
// sections all empty. The cell keeps its value — which is what the data bar
// is drawn from — and displays none of it.
const HIDDEN_NUM = ';;;';

export const NO_DIVISION_LABEL = '(No division)';
export const UNKNOWN_ISO_LABEL = 'Unknown';
// Header for the matrix's roll-up column. Also a valid pick in the ISO
// dropdown — selecting it puts every division's whole site count in the
// selected-market table, which is the natural "show me everything" answer.
export const ALL_ISO_LABEL = 'All markets';
// The same idea for the consumption-by-state section's roll-up column, and a
// valid pick in its division dropdown: every division's load, added up.
export const ALL_DIVISIONS_LABEL = 'All divisions';
// A site whose State / Province column is blank and whose country didn't
// resolve either. Same treatment as an unresolved market: a real bucket that
// sorts last, never a blank row label.
export const UNKNOWN_STATE_LABEL = 'Unknown';

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

// The state / province / country a site's consumption files under — the
// same 'ST / Prov / Country' spelling the Indicative Savings tabs bucket by,
// which already falls back to the country name outside the US and Canada.
export function stateLabel(raw) {
  const s = String(raw || '').trim();
  return s || UNKNOWN_STATE_LABEL;
}

export function isoLabel(iso) {
  const s = String(iso || '').trim();
  if (!s) return UNKNOWN_ISO_LABEL;
  return ISO_SHORT[s] || s;
}

function emptyStateBucket() {
  return { sites: 0, kwh: 0, therms: 0, kwhDereg: 0, thermsDereg: 0 };
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
    // The part of that volume sitting in a competitive market, on the same
    // per-site verdict the procurement section counts its Deregulated Sites
    // on — so the two sections can't disagree about which sites those are.
    // Volume the classifier couldn't place (a competitive state with no
    // utility and no supplier on file) is not counted here: unconfirmed is
    // not deregulated, and the note under the section says so.
    kwhDereg: 0, thermsDereg: 0,
    // Sites by market.
    iso: {},
    // The same consumption again, split by state: label -> { sites, kwh,
    // therms, kwhDereg, thermsDereg }. Held in the page's native units like
    // the totals above it and converted where it is written, so the two
    // can't round differently.
    byState: {},
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
//     energy      { kwh, therms, kwhModelled, thermsModelled,
//                 electricDeregulated, gasDeregulated } — annual
//                 consumption, null on either commodity where the site has
//                 no figure at all. The counts of sites that DO carry one
//                 are reported beside the totals: a division whose gas
//                 volume comes from two of its ninety sites has a total
//                 that means something quite different from one whose
//                 ninety all reported.
//                 The two deregulated flags are the page's own market
//                 classifier, tri-state: true, false, or null where a
//                 competitive state has no utility or supplier on file to
//                 confirm the site either way. Only a true counts volume as
//                 deregulated — the same rule the Deregulated Sites column
//                 in the procurement section counts on.
//     state       'ST / Prov / Country' the site's consumption files under,
//                 blank where neither a state nor a country resolved.
//
// `savingsByDivision` is keyed by the same divisionLabel(): the per-division
// procurement rollup, computed on the page against its per-state
// deregulation and savings tables.
export function summarizeDivisions(siteFacts = [], savingsByDivision = {}) {
  const byName = new Map();
  const isoTotals = new Map();
  const stateTotals = new Map();
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
        if (e.electricDeregulated === true) d.kwhDereg += e.kwh;
      }
      if (isNum(e.therms)) {
        d.therms += e.therms;
        d.thermsSites += 1;
        if (e.thermsModelled) d.thermsModelled += e.therms;
        if (e.gasDeregulated === true) d.thermsDereg += e.therms;
      }
    }

    // The same consumption again, filed by state. Every site opens a bucket,
    // including one carrying no consumption at all — a state the division
    // has sites in but no figures for is a gap worth seeing, not a row to
    // drop.
    const st = stateLabel(f?.state);
    const kwh = num(e?.kwh);
    const therms = num(e?.therms);
    const kwhDereg = e?.electricDeregulated === true ? kwh : 0;
    const thermsDereg = e?.gasDeregulated === true ? therms : 0;
    const bucket = d.byState[st] || (d.byState[st] = emptyStateBucket());
    bucket.sites += 1; bucket.kwh += kwh; bucket.therms += therms;
    bucket.kwhDereg += kwhDereg; bucket.thermsDereg += thermsDereg;
    const stTotal = stateTotals.get(st) || emptyStateBucket();
    stTotal.sites += 1; stTotal.kwh += kwh; stTotal.therms += therms;
    stTotal.kwhDereg += kwhDereg; stTotal.thermsDereg += thermsDereg;
    stateTotals.set(st, stTotal);

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

  // States, heaviest electric load first — the question this section answers
  // is where the load is, so the answer leads. Gas breaks a tie between two
  // states with no electric figures at all; the unresolved bucket sorts last
  // whatever it carries, for the same reason the unassigned division does.
  const stateLabels = [...stateTotals.entries()]
    .sort((a, b) => {
      const aUnk = a[0] === UNKNOWN_STATE_LABEL, bUnk = b[0] === UNKNOWN_STATE_LABEL;
      if (aUnk !== bUnk) return aUnk ? 1 : -1;
      return b[1].kwh - a[1].kwh || b[1].therms - a[1].therms || b[1].sites - a[1].sites
        || a[0].localeCompare(b[0]);
    })
    .map(([label]) => label);

  const totals = emptyDivision(ALL_DIVISIONS_LABEL);
  for (const d of divisions) {
    for (const k of [
      'sites', 'mapped', 'intervalYes', 'intervalNo', 'intervalUnknown',
      'screened', 'jurisdiction', 'bbs', 'audits', 'bps', 'anyMandate', 'penalty',
      'electricDeregSites', 'electricSpend', 'electricLow', 'electricHigh',
      'gasDeregSites', 'gasSpend', 'gasLow', 'gasHigh',
      'kwh', 'kwhModelled', 'kwhSites', 'therms', 'thermsModelled', 'thermsSites',
      'kwhDereg', 'thermsDereg',
    ]) totals[k] += d[k];
    if (d.penaltyKnown) totals.penaltyKnown = true;
    for (const [m, n] of Object.entries(d.iso)) totals.iso[m] = (totals.iso[m] || 0) + n;
    for (const [st, b] of Object.entries(d.byState)) {
      const t = totals.byState[st] || (totals.byState[st] = emptyStateBucket());
      t.sites += b.sites; t.kwh += b.kwh; t.therms += b.therms;
      t.kwhDereg += b.kwhDereg; t.thermsDereg += b.thermsDereg;
    }
  }
  totals.deregSpend = totals.electricSpend + totals.gasSpend;
  totals.savingsLow = totals.electricLow + totals.gasLow;
  totals.savingsHigh = totals.electricHigh + totals.gasHigh;

  return { divisions, isoLabels, stateLabels, totals };
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
  const {
    divisions = [], isoLabels = [], stateLabels = [],
    totals = emptyDivision(ALL_DIVISIONS_LABEL),
  } = summary || {};
  // As wide as the widest table on the tab — the consumption section, which
  // runs both commodities out across volume, how much of it is modelled, how
  // much sits in a competitive market, and the portfolio share, plus the bar
  // column that charts one of them. The narrower tables pad to it so every
  // header band ends where the section banner above it does.
  const NC = 15;
  // The two matrices run wider than the tables above them when a portfolio
  // spans a lot of ISOs — or is split into a lot of divisions — so the sheet
  // is as wide as the widest thing on it.
  const matrixCols = 2 + isoLabels.length;      // Division + one per market + total
  const stateMatrixCols = 2 + divisions.length; // State + one per division + total
  const width = Math.max(NC, matrixCols, stateMatrixCols);

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
      { label: 'Savings Scale', key: 'savingsHigh', bar: true },
      { label: '% of Portfolio Savings', key: 'shareOfSavings', numFmt: '0%' },
      ...padColumns(4),
    ],
    rows: divisions.map(d => ({
      ...d,
      shareOfSavings: totals.savingsHigh ? d.savingsHigh / totals.savingsHigh : 0,
    })),
    totals: { ...totals, name: 'All divisions', shareOfSavings: totals.savingsHigh ? 1 : 0 },
  });

  // ---- 2. Energy consumption ---------------------------------------------
  // Every site, not just the deregulated ones priced above: this is the size
  // of each division's estate in energy terms, and a division that is mostly
  // regulated still uses power. Which is also why the two sections must not
  // be read across — the spend column above covers a subset of the sites
  // this volume covers, so dividing one by the other is not a rate.
  r = section(ws, r, NC, 'Energy Consumption by Division',
    'Annual electric and gas volume across EVERY site in the division, regulated and deregulated alike — unlike the spend above, which covers deregulated sites only. "Sites with data" is how many sites carry a consumption figure at all; the rest contribute nothing to the total. "Modelled" is the part of the total that came from the property-type estimate rather than off the uploaded file — a total that is largely modelled is an indication of size, not a meter reading. "Deregulated" is the volume at sites the market classifier places in a competitive market, the same per-site verdict the Deregulated Sites column above counts on: a site in a competitive state with no utility and no supplier on file can\'t be confirmed either way and is NOT counted, so this reads as a floor rather than an estimate. Gas is reported in Dth (1 Dth = 10 therms), as on the Site Detail tab.');
  r = table(ws, r, {
    columns: [
      { label: 'Division', key: 'name', align: 'left', width: 30 },
      { label: 'Sites', key: 'sites', numFmt: '#,##0' },
      { label: 'Sites with Electric Data', key: 'kwhSites', numFmt: '#,##0' },
      { label: 'Annual Electric (kWh)', key: 'kwh', numFmt: '#,##0', emphasis: true },
      { label: 'kWh Scale', key: 'kwh', bar: true },
      { label: 'of which Modelled (kWh)', key: 'kwhModelled', numFmt: '#,##0' },
      { label: 'Deregulated (kWh)', key: 'kwhDereg', numFmt: '#,##0' },
      { label: '% of kWh Deregulated', key: 'shareKwhDereg', numFmt: '0%' },
      { label: '% of Portfolio kWh', key: 'shareKwh', numFmt: '0%' },
      { label: 'Sites with Gas Data', key: 'thermsSites', numFmt: '#,##0' },
      { label: 'Annual Gas (Dth)', key: 'gasDth', numFmt: '#,##0', emphasis: true },
      { label: 'of which Modelled (Dth)', key: 'gasModelledDth', numFmt: '#,##0' },
      { label: 'Deregulated (Dth)', key: 'gasDeregDth', numFmt: '#,##0' },
      { label: '% of Dth Deregulated', key: 'shareDthDereg', numFmt: '0%' },
      { label: '% of Portfolio Dth', key: 'shareDth', numFmt: '0%' },
    ],
    rows: divisions.map(d => ({
      ...d,
      gasDth: toDth(d.therms),
      gasModelledDth: toDth(d.thermsModelled),
      gasDeregDth: toDth(d.thermsDereg),
      shareKwhDereg: d.kwh ? d.kwhDereg / d.kwh : 0,
      shareDthDereg: d.therms ? d.thermsDereg / d.therms : 0,
      shareKwh: totals.kwh ? d.kwh / totals.kwh : 0,
      shareDth: totals.therms ? d.therms / totals.therms : 0,
    })),
    totals: {
      ...totals,
      name: 'All divisions',
      gasDth: toDth(totals.therms),
      gasModelledDth: toDth(totals.thermsModelled),
      gasDeregDth: toDth(totals.thermsDereg),
      shareKwhDereg: totals.kwh ? totals.kwhDereg / totals.kwh : 0,
      shareDthDereg: totals.therms ? totals.thermsDereg / totals.therms : 0,
      shareKwh: totals.kwh ? 1 : 0,
      shareDth: totals.therms ? 1 : 0,
    },
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
      { label: 'Exposure Scale', key: 'penalty', bar: true },
      { label: '% of Portfolio Exposure', key: 'shareOfPenalty', numFmt: '0%' },
      ...padColumns(4),
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
      { label: 'Interval Scale', key: 'intervalYes', bar: true },
      { label: '% with Interval Data', key: 'shareInterval', numFmt: '0%' },
      { label: 'Interval Data: No', key: 'intervalNo', numFmt: '#,##0' },
      { label: 'Interval Data: Unknown', key: 'intervalUnknown', numFmt: '#,##0' },
      ...padColumns(6),
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
  });

  // ---- 5. Sites by ISO / RTO --------------------------------------------
  r = isoSection(ws, r, NC, divisions, isoLabels, totals);

  // ---- 6. Consumption by state -------------------------------------------
  consumptionByStateSection(ws, r, NC, divisions, stateLabels, totals);

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
  // Same shape as the tables above: the count is read, the bar beside it is
  // looked at, and neither is drawn on top of the other.
  const selCols = ['Division', 'Sites in Selected Market', 'Sites Scale', "% of Division's Sites"];
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
      // The bar's own cell mirrors the count so it moves with the picker,
      // and hides the repeat behind the bar.
      {
        v: { formula: `${colLetter(2)}${rowNo}`, result: count },
        numFmt: HIDDEN_NUM,
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
    // Outside the bar's range, like every other totals row on the sheet.
    { v: null, numFmt: HIDDEN_NUM },
    {
      v: {
        formula: `IFERROR(${colLetter(2)}${selectedTotalRow}/$${colLetter(lastMatrixCol)}$${matrixTotalRow},0)`,
        result: totals.sites ? countOf(totals, defaultIso) / totals.sites : 0,
      },
      numFmt: '0%',
    },
  ]);
  // A live bar beside the count column, scaled to the largest division
  // rather than to itself, so the split reads at a glance and stays right
  // when the picker moves.
  if (divisions.length) {
    ws.addConditionalFormatting({
      ref: `${colLetter(3)}${selectedFirstRow}:${colLetter(3)}${selectedTotalRow - 1}`,
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

// A division picker over the two state × division consumption matrices.
//
// Section 2 asks how big each division is; this asks where that division's
// load actually sits. Same shape as the market picker above, turned the
// other way round: there the dropdown named a column of one matrix, here it
// names a column of both, and the rows are states, so the answer reads
// straight down. Formulas rather than a re-export, with cached results
// written alongside so the table reads right in a viewer that doesn't
// recalculate on open.
function consumptionByStateSection(ws, startRow, NC, divisions, stateLabels, totals) {
  let r = section(ws, startRow, NC, 'Consumption by State, by Division',
    'Pick a division from the dropdown: the table under it reports that division\'s annual electric and gas volume in every state the portfolio touches, and how much of each sits in a competitive market. Same figures as the Energy Consumption section above, split by state instead of totalled — every site, regulated and deregulated alike, so the volume columns read higher than the deregulated spend the savings run on. "Deregulated" counts only sites the market classifier confirms, so a competitive state with no utility or supplier on file reads low rather than assumed. The four matrices below are what the table reads. Electric is kWh/yr and gas is Dth/yr, as on the Site Detail tab.');

  if (!divisions.length || !stateLabels.length) {
    ws.mergeCells(r, 1, r, NC);
    const c = ws.getCell(r, 1);
    c.value = 'No sites in scope.';
    c.font = { name: FONT, italic: true, size: 10, color: { argb: SLATE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    return r + 2;
  }

  // One column per division plus the roll-up, and the source each reads.
  const headers = [...divisions.map(d => d.name), ALL_DIVISIONS_LABEL];
  const sources = [...divisions, totals];
  // Rounded once, here, and reused by every matrix cell and every cached
  // formula result — a formula whose cache disagreed with the cell it reads
  // would show one number before a recalculation and another after. Gas
  // converts to Dth at this one point, like every other gas figure on the
  // sheet, so nothing is rounded twice.
  // Every gas key — the volume and the deregulated part of it — converts to
  // Dth here, the one place, like every other gas figure on the sheet.
  const inSheetUnits = (key, raw) => (key.startsWith('therms') ? toDth(raw) : num(raw));
  const cellValue = (src, state, key) =>
    Math.round(inSheetUnits(key, src?.byState?.[state]?.[key]));
  const columnTotal = (src, key) => Math.round(stateLabels.reduce(
    (sum, st) => sum + inSheetUnits(key, src?.byState?.[st]?.[key]), 0));
  // Opens on the largest named division so the picker is visibly doing
  // something; a portfolio with nothing but unassigned sites opens on the
  // roll-up, which is the only reading that means anything there.
  const named = divisions.find(d => d.name !== NO_DIVISION_LABEL);
  const defaultDivision = named ? named.name : ALL_DIVISIONS_LABEL;
  const defaultSource = named || totals;

  // Both matrices are written below the picker and the table that reads
  // them, so their rows are worked out here and filled in after.
  const pickerRow = r;
  const selectedHeaderRow = r + 2;
  const selectedFirstRow = selectedHeaderRow + 1;
  const selectedTotalRow = selectedFirstRow + stateLabels.length;
  // Four matrices, stacked: each is a header row, one row per state and a
  // totals row, with a title above and a blank line between. Laid out from
  // one description so the ranges and the row indexes the table's formulas
  // use can't drift apart as they did when they were spelled out twice.
  const MATRICES = [
    { key: 'kwh', title: 'State × division matrix — electric consumption (kWh/yr)' },
    { key: 'kwhDereg', title: 'State × division matrix — deregulated electric consumption (kWh/yr)' },
    { key: 'therms', title: 'State × division matrix — gas consumption (Dth/yr)' },
    { key: 'thermsDereg', title: 'State × division matrix — deregulated gas consumption (Dth/yr)' },
  ];
  let cursor = selectedTotalRow + 2;
  for (const m of MATRICES) {
    m.titleRow = cursor;
    m.headerRow = cursor + 1;
    m.firstRow = cursor + 2;
    m.totalRow = m.firstRow + stateLabels.length;
    cursor = m.totalRow + 2;
  }
  const lastMatrixRow = cursor - 2;
  const lastCol = 1 + headers.length;
  const L = colLetter(lastCol);
  const rangeOf = (m) => `$${colLetter(2)}$${m.headerRow}:$${L}$${m.totalRow}`;
  const [elec, elecDereg, gas, gasDereg] = MATRICES;
  const elecRange = rangeOf(elec);
  const elecDeregRange = rangeOf(elecDereg);
  const gasRange = rangeOf(gas);
  const gasDeregRange = rangeOf(gasDereg);
  // The four matrices carry identical headers, so one of them is the whole
  // dropdown. Validated against the range rather than an inline list for the
  // same two reasons as the market picker: Excel caps an inline list at 255
  // characters, which division names blow past on a sizeable portfolio, and
  // a range can't fall out of step with the columns it picks from.
  const headerRange = `$${colLetter(2)}$${elec.headerRow}:$${L}$${elec.headerRow}`;

  // ---- the picker ----
  const label = ws.getCell(pickerRow, 1);
  label.value = 'Division';
  label.font = { name: FONT, bold: true, size: 11, color: { argb: INK } };
  label.alignment = { vertical: 'middle', horizontal: 'right' };
  const pick = ws.getCell(pickerRow, 2);
  pick.value = defaultDivision;
  pick.font = { name: FONT, bold: true, size: 11, color: { argb: SE_DARK } };
  pick.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_LIGHT } };
  pick.alignment = { vertical: 'middle', horizontal: 'center' };
  pick.border = {
    top: { style: 'thin', color: { argb: SE_DARK } }, bottom: { style: 'thin', color: { argb: SE_DARK } },
    left: { style: 'thin', color: { argb: SE_DARK } }, right: { style: 'thin', color: { argb: SE_DARK } },
  };
  pick.dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: [headerRange],
    showErrorMessage: true,
    errorTitle: 'Pick a division',
    error: `Choose one of the divisions listed in the matrices below, or "${ALL_DIVISIONS_LABEL}".`,
  };
  const hint = ws.getCell(pickerRow, 3);
  hint.value = `← dropdown  ·  ${divisions.length} division${divisions.length === 1 ? '' : 's'}  ·  ${stateLabels.length} state${stateLabels.length === 1 ? '' : 's'} in this portfolio`;
  hint.font = { name: FONT, italic: true, size: 9, color: { argb: SLATE } };
  hint.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(pickerRow).height = 22;

  // ---- the selected-division table ----
  // Same shape as the tables above: the figure is read, the bar beside it is
  // looked at, and neither is drawn on top of the other.
  headerRow(ws, selectedHeaderRow, [
    { label: 'ST / Prov / Country', align: 'left' },
    { label: 'Electric kWh/yr', align: 'center' },
    { label: 'kWh Scale', align: 'center' },
    { label: 'Deregulated kWh/yr', align: 'center' },
    { label: '% of kWh Deregulated', align: 'center' },
    { label: '% of Division kWh', align: 'center' },
    { label: 'Gas Dth/yr', align: 'center' },
    { label: 'Deregulated Dth/yr', align: 'center' },
    { label: '% of Dth Deregulated', align: 'center' },
    { label: '% of Division Dth', align: 'center' },
  ]);

  const elecTotalCached = columnTotal(defaultSource, 'kwh');
  const elecDeregTotalCached = columnTotal(defaultSource, 'kwhDereg');
  const gasTotalCached = columnTotal(defaultSource, 'therms');
  const gasDeregTotalCached = columnTotal(defaultSource, 'thermsDereg');
  // The columns the formulas point at, by letter, so a column added to the
  // table doesn't leave a formula reading its neighbour.
  const KWH = colLetter(2), KWH_DEREG = colLetter(4);
  const DTH = colLetter(7), DTH_DEREG = colLetter(8);
  stateLabels.forEach((st, i) => {
    const rowNo = selectedFirstRow + i;
    // Row 1 of each range is the header, so this state's row inside it is
    // its matrix row minus the header row, plus one. The matrices are laid
    // out in step, so one index serves all four.
    const idx = i + 2;
    const kwh = cellValue(defaultSource, st, 'kwh');
    const kwhDereg = cellValue(defaultSource, st, 'kwhDereg');
    const dth = cellValue(defaultSource, st, 'therms');
    const dthDereg = cellValue(defaultSource, st, 'thermsDereg');
    const lookup = (range) => `IFERROR(HLOOKUP($B$${pickerRow},${range},${idx},FALSE),0)`;
    writeRow(ws, rowNo, i, [
      { v: st, align: 'left', bold: true, color: INK },
      { v: { formula: lookup(elecRange), result: kwh }, numFmt: '#,##0', bold: true, color: SE_DARK },
      // The bar's own cell mirrors the figure so it moves with the picker,
      // and hides the repeat behind the bar.
      { v: { formula: `${KWH}${rowNo}`, result: kwh }, numFmt: HIDDEN_NUM },
      { v: { formula: lookup(elecDeregRange), result: kwhDereg }, numFmt: '#,##0' },
      {
        v: { formula: `IFERROR(${KWH_DEREG}${rowNo}/${KWH}${rowNo},0)`, result: kwh ? kwhDereg / kwh : 0 },
        numFmt: '0%',
      },
      {
        v: { formula: `IFERROR(${KWH}${rowNo}/$${KWH}$${selectedTotalRow},0)`, result: elecTotalCached ? kwh / elecTotalCached : 0 },
        numFmt: '0%',
      },
      { v: { formula: lookup(gasRange), result: dth }, numFmt: '#,##0', bold: true, color: SE_DARK },
      { v: { formula: lookup(gasDeregRange), result: dthDereg }, numFmt: '#,##0' },
      {
        v: { formula: `IFERROR(${DTH_DEREG}${rowNo}/${DTH}${rowNo},0)`, result: dth ? dthDereg / dth : 0 },
        numFmt: '0%',
      },
      {
        v: { formula: `IFERROR(${DTH}${rowNo}/$${DTH}$${selectedTotalRow},0)`, result: gasTotalCached ? dth / gasTotalCached : 0 },
        numFmt: '0%',
      },
    ]);
  });
  const totalIdx = stateLabels.length + 2;
  const totalLookup = (range) => `IFERROR(HLOOKUP($B$${pickerRow},${range},${totalIdx},FALSE),0)`;
  totalsRow(ws, selectedTotalRow, [
    { v: 'All states', align: 'left' },
    { v: { formula: totalLookup(elecRange), result: elecTotalCached }, numFmt: '#,##0' },
    // Outside the bar's range, like every other totals row on the sheet.
    { v: null, numFmt: HIDDEN_NUM },
    { v: { formula: totalLookup(elecDeregRange), result: elecDeregTotalCached }, numFmt: '#,##0' },
    {
      v: {
        formula: `IFERROR(${KWH_DEREG}${selectedTotalRow}/${KWH}${selectedTotalRow},0)`,
        result: elecTotalCached ? elecDeregTotalCached / elecTotalCached : 0,
      },
      numFmt: '0%',
    },
    { v: elecTotalCached ? 1 : 0, numFmt: '0%' },
    { v: { formula: totalLookup(gasRange), result: gasTotalCached }, numFmt: '#,##0' },
    { v: { formula: totalLookup(gasDeregRange), result: gasDeregTotalCached }, numFmt: '#,##0' },
    {
      v: {
        formula: `IFERROR(${DTH_DEREG}${selectedTotalRow}/${DTH}${selectedTotalRow},0)`,
        result: gasTotalCached ? gasDeregTotalCached / gasTotalCached : 0,
      },
      numFmt: '0%',
    },
    { v: gasTotalCached ? 1 : 0, numFmt: '0%' },
  ]);
  // A live bar beside the electric column, scaled to the heaviest state
  // rather than to itself, so the shape of the load reads at a glance and
  // stays right when the picker moves.
  ws.addConditionalFormatting({
    ref: `${colLetter(3)}${selectedFirstRow}:${colLetter(3)}${selectedTotalRow - 1}`,
    rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: SE_DARK } }],
  });

  // ---- the matrices ----
  const writeMatrix = ({ titleRow, headerRow: hdrRow, firstRow, totalRow, key, title }) => {
    const t = ws.getCell(titleRow, 1);
    t.value = title;
    t.font = { name: FONT, bold: true, size: 10, color: { argb: SLATE } };
    t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    headerRow(ws, hdrRow, [
      { label: 'ST / Prov / Country', align: 'left' },
      ...headers.map(h => ({ label: h, align: 'center' })),
    ]);
    stateLabels.forEach((st, i) => {
      writeRow(ws, firstRow + i, i, [
        { v: st, align: 'left', bold: true, color: INK },
        ...sources.map((src, ci) => ({
          v: cellValue(src, st, key), numFmt: '#,##0', bold: ci === sources.length - 1,
        })),
      ]);
    });
    totalsRow(ws, totalRow, [
      { v: 'All states', align: 'left' },
      ...sources.map(src => ({ v: columnTotal(src, key), numFmt: '#,##0' })),
    ]);
  };
  MATRICES.forEach(writeMatrix);

  const after = lastMatrixRow + 2;
  ws.mergeCells(after, 1, after, NC);
  const note = ws.getCell(after, 1);
  note.value = `A state a division has sites in but no consumption figures for reads as a zero rather than dropping out — the "Sites with data" columns in the Energy Consumption section say how much of each total is measured at all. The deregulated matrices count only sites the market classifier confirms as competitive, so a state can carry load with none of it deregulated either because it is a regulated market or because no utility or supplier is on file to place its sites. A site whose State / Province and Country both came through blank files under "${UNKNOWN_STATE_LABEL}".`;
  note.font = { name: FONT, italic: true, size: 9, color: { argb: 'FF94A3B8' } };
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(after).height = 26;

  return after + 2;
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

// Blank columns that carry a table out to the sheet's full width, so its
// header band ends where the section banner above it does rather than
// stopping short. They hold no key, so every row writes them empty.
function padColumns(n) {
  return Array.from({ length: n }, (_, i) => ({ label: '', key: `__pad${i}`, numFmt: null }));
}

// One section's table: header, a row per division, a totals row, and a live
// data bar in a column of its own. Returns the next free row, two below the
// table.
//
// The bar gets its own column because a data bar is painted BEHIND the cell
// it is applied to: put it on the figure and the bar runs straight through
// the digits, which on a portfolio whose largest division sets the scale
// left the big numbers — the ones the reader came for — unreadable behind a
// block of green.
//
// A bar column is `{ bar: true }` and carries the same value as the figure
// it sits beside, formatted ';;;' so the cell shows the bar and nothing
// else. The value has to be there: the bar is scaled from it.
function table(ws, startRow, { columns, rows, totals }) {
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
      // A bar column's figure is drawn, not read: a dash would leave the
      // cell with text in it that the ';;;' format then hides, and a bar
      // scaled off nothing. Non-numbers chart as zero.
      v: col.bar ? (typeof d[col.key] === 'number' ? d[col.key] : 0) : d[col.key],
      numFmt: col.bar ? HIDDEN_NUM : col.numFmt,
      align: col.align,
      bold: ci === 0 || col.emphasis,
      // A dash where a figure couldn't be worked out reads as a caveat, not
      // as a number — amber rather than the column's own colour.
      color: ci === 0 ? INK : (d[col.key] === '-' ? AMBER : (col.emphasis ? SE_DARK : SLATE)),
    })));
  });

  const totalRow = first + rows.length;
  totalsRow(ws, totalRow, columns.map(col => ({
    // The totals row is outside the bar's range — every division bar would
    // otherwise be scaled against the total and read as a sliver — so its
    // bar cell is left empty rather than carrying a value nothing draws.
    v: col.bar ? null : (col.key === 'name' ? totals.name : totals[col.key]),
    numFmt: col.bar ? HIDDEN_NUM : col.numFmt,
    align: col.align,
  })));

  columns.forEach((col, ci) => {
    if (!col.bar) return;
    const L = colLetter(ci + 1);
    ws.addConditionalFormatting({
      ref: `${L}${first}:${L}${totalRow - 1}`,
      rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: SE_DARK } }],
    });
  });
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
