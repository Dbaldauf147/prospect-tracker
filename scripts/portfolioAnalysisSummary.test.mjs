// Assertion tests for the portfolio-wide Master Analysis summary: reading
// each saved workbook's Indicative Savings tables back into market rows, and
// rolling those up across companies. Plain Node, no test framework. Run:
//   node scripts/portfolioAnalysisSummary.test.mjs
//
// Round-tripped through exceljs (which writes the workbook in SitesView) and
// SheetJS (which reads it in the popup), because the roll-up rows are told
// apart by their outline level and that only survives a real file.
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { marketsFromWorkbook, summariseMarkets, complianceSummary } from '../src/utils/portfolioAnalysisSummary.js';
import { buildPortfolioAnalysisSummary } from '../src/utils/portfolioAnalysisSummaryXlsx.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

async function roundTrip(build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return XLSX.read(new Uint8Array(buf), { type: 'array', cellStyles: true });
}

const ELECTRIC_HEAD = ['ST / Prov / Country', 'Deregulated Status', 'Total Sites', 'Deregulated Sites', 'Deregulated Consumption kWh/yr', 'Deregulated Spend/yr', 'Savings Status', 'Low %', 'High %', 'Savings %', 'Indicative Annual Savings', '', 'Reg. Rate Savings Sites'];
const GAS_HEAD = ['ST / Prov / Country', 'Deregulated Status', 'Sites', 'Deregulated Sites', 'Deregulated Consumption Dth/yr', 'Deregulated Spend/yr', 'Savings Status', 'Low %', 'High %', 'Savings %', 'Indicative Annual Savings'];

// Writes a section the way writeSection does: band, header, rows, then the
// regulated summary line and the Total row.
function section(ws, start, label, head, rows) {
  let r = start;
  ws.getCell(r, 1).value = label; r++;
  head.forEach((h, i) => { if (h) ws.getCell(r, i + 1).value = h; }); r++;
  for (const row of rows) {
    const x = ws.getRow(r);
    if (row.level) x.outlineLevel = row.level;
    x.getCell(1).value = row.market;
    x.getCell(2).value = row.status || 'Deregulated';
    x.getCell(3).value = row.sites;
    x.getCell(4).value = row.dereg;
    x.getCell(5).value = 1000;
    x.getCell(6).value = row.spend;
    x.getCell(7).value = 'Eligible';
    if (row.low != null) x.getCell(8).value = row.low;
    if (row.high != null) x.getCell(9).value = row.high;
    x.getCell(10).value = { formula: 'H1', result: 0.1 };
    x.getCell(11).value = { formula: `F${r}*J${r}`, result: row.annual };
    r++;
  }
  ws.getCell(r, 1).value = 'Remaining sites in regulated markets (2 states / provinces)';
  ws.getCell(r, 3).value = 9; r++;
  ws.getCell(r, 1).value = 'Total';
  ws.getCell(r, 3).value = { formula: 'SUM(C1:C2)', result: 99 }; r++;
  return r + 2;
}

const countryOf = (label) => (/^(TX|PA|NY|OH)$/.test(label) ? 'United States' : /^(ON|AB)$/.test(label) ? 'Canada' : null);

// --- a US-only portfolio: no roll-up rows -----------------------------------
{
  const wb = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Indicative Savings');
    ws.getCell(1, 1).value = 'Indicative Savings';
    let r = section(ws, 5, 'Electric Power', ELECTRIC_HEAD, [
      { market: 'TX', sites: 10, dereg: 8, spend: 1_000_000, low: 0.05, high: 0.1, annual: 60_000 },
      { market: 'PA', sites: 4, dereg: 4, spend: 200_000, low: 0.04, high: 0.08, annual: 0 },
    ]);
    section(ws, r, 'Natural Gas', GAS_HEAD, [
      { market: 'TX', sites: 6, dereg: 5, spend: 100_000, low: 0.02, high: 0.06, annual: 3_000 },
    ]);
  });
  const m = marketsFromWorkbook(wb, { countryOf });
  eq(m.length, 3, 'one row per market per commodity; regulated and Total lines are not markets');
  eq(m.map(x => [x.commodity, x.market, x.country]), [['electric', 'TX', 'United States'], ['electric', 'PA', 'United States'], ['gas', 'TX', 'United States']],
    'commodity comes from the section band, country from the lookup');
  eq([m[0].deregulatedSites, m[0].totalSites, m[0].low, m[0].high, m[0].indicative], [8, 10, 50_000, 100_000, 60_000],
    'range is spend x Low / High %, indicative is the cached formula result');
  eq(m[2].totalSites, 6, 'the gas table\'s "Sites" header counts as total sites');

  const s = summariseMarkets([{ company: 'Acme', markets: m }]);
  const acme = s.byCompany[0];
  eq([acme.electricDeregulatedSites, acme.gasDeregulatedSites, acme.low, acme.high, acme.indicative], [12, 5, 60_000, 122_000, 63_000],
    'company totals keep electric and gas deregulated sites apart');
  eq(s.byMarket.map(x => x.market), ['TX', 'PA'], 'electric and gas rows for the same market merge, biggest first');
  eq(s.byCountry.map(x => [x.country, x.high]), [['United States', 122_000]], 'country roll-up');
}

// --- a global portfolio: United States rolls up the states under it ------
{
  const wb = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Indicative Savings');
    section(ws, 3, 'Electric Power', ELECTRIC_HEAD, [
      { market: 'Germany', sites: 3, dereg: 3, spend: 500_000, low: 0.03, high: 0.05, annual: 20_000 },
      { market: 'United States', sites: 12, dereg: 11, spend: 900_000, annual: 50_000 },
      { market: 'TX', sites: 7, dereg: 7, spend: 600_000, low: 0.05, high: 0.1, annual: 40_000, level: 1 },
      { market: 'NY', sites: 5, dereg: 4, spend: 300_000, low: 0.02, high: 0.04, annual: 10_000, level: 1 },
      { market: 'France', sites: 2, dereg: 2, spend: 100_000, annual: 0 },
    ]);
  });
  const m = marketsFromWorkbook(wb, { countryOf: () => null });
  eq(m.map(x => [x.market, x.country]), [['Germany', 'Germany'], ['TX', 'United States'], ['NY', 'United States'], ['France', 'France']],
    'the roll-up row is dropped and names its children\'s country; a later top-level row is its own country');
  eq([m[3].low, m[3].high], [null, null], 'a market with no Low / High % has no range');

  const s = summariseMarkets([
    { company: 'Acme', markets: m },
    { company: 'Beta', markets: [{ commodity: 'electric', market: 'TX', country: 'United States', totalSites: 1, deregulatedSites: 1, spend: 10_000, lowPct: 0.05, highPct: 0.1, low: 500, high: 1000, indicative: 0 }] },
  ]);
  const us = s.byCountry.find(x => x.country === 'United States');
  eq([us.electricDeregulatedSites, us.companies], [12, ['Acme', 'Beta']], 'country totals add across companies and list them');
  eq(s.byCompany.find(x => x.company === 'Acme').unpriced, 1, 'a deregulated market with no range is counted as unpriced');
}

// --- no Indicative Savings sheet ------------------------------------------
eq(marketsFromWorkbook({ SheetNames: ['Summary'], Sheets: { Summary: {} } }), [], 'a workbook without the sheet has no markets');

// --- compliance roll-up ------------------------------------------------------
{
  const CATEGORIES = ['bbs', 'audits', 'bps'];
  const isEl = (r, c) => r.matched && r[c] && r[c].eligible === true;
  const mandates = {
    CATEGORIES,
    totalEligible: (rs, c) => rs.filter(r => isEl(r, c)).length,
    totalPenalty: (rs, c) => rs.filter(r => isEl(r, c)).reduce((s, r) => s + (r[c].penalty || 0), 0),
    sitesWithMandate: (rs) => rs.filter(r => CATEGORIES.some(c => isEl(r, c))).length,
    eligibilityByOrdinance: (rs, c) => {
      const m = new Map();
      for (const r of rs) if (isEl(r, c)) m.set(r.government, (m.get(r.government) || 0) + 1);
      return [...m].map(([government, count]) => ({ government, count }));
    },
    penaltyByOrdinance: (rs, c) => {
      const m = new Map();
      for (const r of rs) if (isEl(r, c)) m.set(r.government, (m.get(r.government) || 0) + r[c].penalty);
      return [...m].map(([government, penalty]) => ({ government, penalty }));
    },
  };
  const results = [
    { matched: true, govId: 'NYC', government: 'New York City', bbs: { eligible: true, penalty: 2000 }, bps: { eligible: true, penalty: 50000 } },
    { matched: true, govId: 'NYC', government: 'New York City', bbs: { eligible: true, penalty: 2000 } },
    { matched: true, govId: 'DEN', government: 'Denver', audits: { eligible: false } },
    { matched: false },
  ];
  const c = complianceSummary(results, mandates);
  eq([c.sitesScreened, c.sitesMatched, c.sitesWithMandate, c.jurisdictions], [4, 3, 2, 2], 'headline counts');
  eq([c.categories.bbs, c.categories.bps, c.exposure], [{ sites: 2, penalty: 4000 }, { sites: 1, penalty: 50000 }, 54000], 'per-category sites and fines');
  eq(c.byJurisdiction.map(j => [j.government, j.sites, j.penalty]), [['New York City', 2, 54000]],
    'a site with two mandates counts once; jurisdictions with nothing owed are left out');
}

// --- markets with nothing in them are left out ------------------------------
{
  const mk = (market, dereg, high, indicative = 0) => ({ commodity: 'electric', market, country: 'United States', totalSites: 3, deregulatedSites: dereg, spend: 0, lowPct: null, highPct: null, low: high ? high / 2 : null, high: high || null, indicative });
  const s = summariseMarkets([{ company: 'Acme', markets: [mk('TX', 2, 1000), mk('AL', 0, 0), mk('FL', 0, 0, 50), mk('UK', 3, 0)] }]);
  eq(s.byCompany[0].markets.map(m => m.market).sort(), ['FL', 'TX', 'UK'], 'a market with no deregulated site and no savings is dropped');
  eq(s.byMarket.some(m => m.market === 'AL'), false, 'and is not in the portfolio roll-up either');
}

// --- the Excel export --------------------------------------------------------
{
  const savings = summariseMarkets([
    { company: 'Acme', markets: [{ commodity: 'electric', market: 'TX', country: 'United States', totalSites: 4, deregulatedSites: 4, spend: 100_000, lowPct: 0.05, highPct: 0.1, low: 5000, high: 10_000, indicative: 7000 }] },
  ]);
  const compliance = {
    rows: [
      { company: 'Acme', source: 'card', sitesScreened: 4, sitesWithMandate: 1, jurisdictions: 1, jurisdictionIds: ['NYC'], exposure: 2000, categories: { bbs: { sites: 1, penalty: 2000 }, audits: { sites: 0, penalty: 0 }, bps: { sites: 0, penalty: 0 } } },
      { company: 'Beta', none: true },
    ],
    byJurisdiction: [{ government: 'New York City', sites: 1, penalty: 2000, companies: ['Acme'], bbs: { sites: 1, penalty: 2000 }, audits: { sites: 0, penalty: 0 }, bps: { sites: 0, penalty: 0 } }],
  };
  const wb = await buildPortfolioAnalysisSummary({
    firmName: 'SVP', savings, compliance, analysed: 2, totalCompanies: 5,
    savedAt: new Map([['Acme', '2026-08-31']]),
    categories: [{ key: 'bbs', label: 'BBS' }, { key: 'audits', label: 'Energy Audits' }, { key: 'bps', label: 'BPS' }],
  });
  eq(wb.worksheets.map(w => w.name), ['Savings Summary', 'Savings by Company', 'Compliance Summary'], 'three sheets');
  const read = XLSX.read(new Uint8Array(await wb.xlsx.writeBuffer()), { type: 'array' });
  const rows = (name) => XLSX.utils.sheet_to_json(read.Sheets[name], { header: 1, defval: null });
  const ss = rows('Savings Summary');
  const acme = ss.find(r => r[0] === 'Acme');
  eq([acme[2], acme[5], acme[6], acme[7]], [4, 5000, 10_000, 7000], 'company row writes sites and the range as numbers');
  eq(ss.some(r => r[0] === 'United States') && ss.some(r => r[0] === 'TX'), true, 'country heading with its states under it');
  const cs = rows('Compliance Summary');
  eq(cs.find(r => r[0] === 'Beta').at(-1), 'No site list to screen', 'a company with nothing to screen says so');
  eq(cs.find(r => r[0] === 'New York City')[1], 1, 'jurisdiction table');
  const text = JSON.stringify([ss, rows('Savings by Company'), cs]);
  eq(text.includes('—'), false, 'no em dashes in the export');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
