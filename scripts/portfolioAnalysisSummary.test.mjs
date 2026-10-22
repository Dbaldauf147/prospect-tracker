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
import { marketsFromWorkbook, summariseMarkets, complianceSummary, siteEstimatesFromWorkbook, applySiteEstimates } from '../src/utils/portfolioAnalysisSummary.js';
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

// --- usage and cost, and how much of it is estimated ------------------------
{
  // Indicative Savings carries the market's deregulated usage and spend.
  const wb = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Indicative Savings');
    section(ws, 3, 'Electric Power', ELECTRIC_HEAD, [
      { market: 'TX', sites: 3, dereg: 3, spend: 900, low: 0.05, high: 0.1, annual: 60 },
      { market: 'Germany', sites: 1, dereg: 1, spend: 100, low: 0.05, high: 0.1, annual: 5 },
    ]);
  });
  const markets = marketsFromWorkbook(wb, { countryOf });
  eq([markets[0].usage, markets[0].cost], [1000, 900], 'usage is Deregulated Consumption, cost is Deregulated Spend');

  // Site Detail marks estimated values in italic, read back with ExcelJS.
  const xw = new ExcelJS.Workbook();
  const sd = xw.addWorksheet('Site Detail');
  sd.addRow(['Site Name', 'ST / Prov', 'Country', 'Electric Market', 'Annual Electric (kWh) †', 'Total Electric Cost †', 'Gas Market', 'Annual Gas (Dth) †', 'Total Natural Gas Cost †']);
  const site = (name, st, country, market, kwh, kwhEst, cost, costEst) => {
    const r = sd.addRow([name, st, country, market, kwh, cost, 'Regulated', null, null]);
    if (kwhEst) r.getCell(5).font = { italic: true, color: { argb: 'FFB45309' } };
    if (costEst) r.getCell(6).font = { italic: true, color: { argb: 'FFB45309' } };
  };
  site('A', 'TX', 'United States', 'Deregulated', 300, true, 300, true);
  site('B', 'TX', 'United States', 'Deregulated', 700, false, 600, false);
  site('C', 'TX', 'United States', 'Regulated', 5000, true, 5000, true);
  site('D', '', 'Germany', 'Deregulated', 50, false, 100, true);
  sd.addRow(['† Columns that can contain estimated data...']);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await xw.xlsx.writeBuffer());
  const sites = siteEstimatesFromWorkbook(loaded);
  eq(sites.length, 4, 'one entry per site; the legend line is not a site');
  eq([sites[0].electric.usageEst, sites[1].electric.usageEst, sites[3].electric.costEst], [true, false, true], 'italic means estimated');

  const est = applySiteEstimates(markets, sites);
  eq([est[0].estKnown, est[0].usageEst, est[0].costEst], [true, 300, 300],
    'TX: estimated share weighted by value over its deregulated sites only (30% of usage, 33% of cost)');
  eq([est[1].usageEst, est[1].costEst], [0, 100], 'a country market matches sites on Country');
  eq(applySiteEstimates(markets, [])[0].estKnown, false, 'no Site Detail: the share is unknown, not zero');
  const uk = [{ commodity: 'electric', market: 'United Kingdom', country: 'United Kingdom', usage: 100, cost: 50, deregulatedSites: 1 }];
  const ukSite = [{ state: 'London', country: 'UK', electric: { deregulated: true, usage: 10, usageEst: true, cost: 5, costEst: false } }];
  eq(applySiteEstimates(uk, ukSite)[0].estKnown, false, 'an upload spelling of the country does not match on its own');
  eq(applySiteEstimates(uk, ukSite, { normalizeCountry: (c) => (c === 'UK' ? 'United Kingdom' : c) })[0].usageEst, 100,
    'the country normalizer lines the two sheets up');
  const partial = summariseMarkets([{ company: 'Acme', markets: [...applySiteEstimates(markets, sites).slice(0, 1), { ...markets[1], estKnown: false, usageEst: 0, costEst: 0 }] }]).byCompany[0];
  eq([partial.estKnown, partial.estUnknown], [1, 1], 'a total remembers how many of its markets were and were not matched');

  const s = summariseMarkets([{ company: 'Acme', markets: est }]);
  const acme = s.byCompany[0];
  eq([acme.electricUsage, acme.electricUsageEst, acme.electricCost, acme.electricCostEst], [2000, 300, 1000, 400], 'company totals carry usage, cost and the estimated part of each');
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
    { company: 'Acme', markets: [{ commodity: 'electric', market: 'TX', country: 'United States', totalSites: 4, deregulatedSites: 4, spend: 100_000, usage: 2_000_000, usageEst: 500_000, cost: 100_000, costEst: 0, estKnown: true, lowPct: 0.05, highPct: 0.1, low: 5000, high: 10_000, indicative: 7000 }] },
  ]);
  const compliance = {
    rows: [
      { company: 'Acme', source: 'card', sitesScreened: 4, sitesWithMandate: 1, jurisdictions: 1, jurisdictionIds: ['NYC'], exposure: 2000, categories: { bbs: { sites: 1, penalty: 2000 }, audits: { sites: 0, penalty: 0 }, bps: { sites: 0, penalty: 0 } } },
      { company: 'Beta', none: true },
    ],
    byJurisdiction: [{ government: 'New York City', sites: 1, penalty: 2000, companies: ['Acme'], bbs: { sites: 1, penalty: 2000 }, audits: { sites: 0, penalty: 0 }, bps: { sites: 0, penalty: 0 } }],
  };
  const wb = await buildPortfolioAnalysisSummary({
    firmName: 'SVP', savings, compliance,
    categories: [{ key: 'bbs', label: 'BBS' }, { key: 'audits', label: 'Energy Audits' }, { key: 'bps', label: 'BPS' }],
  });
  eq(wb.worksheets.map(w => w.name), ['Summary', 'Savings by Company', 'Compliance Summary'], 'three sheets');
  const read = XLSX.read(new Uint8Array(await wb.xlsx.writeBuffer()), { type: 'array' });
  const rows = (name) => XLSX.utils.sheet_to_json(read.Sheets[name], { header: 1, defval: null });
  const ss = rows('Summary');
  const acme = ss.find(r => r[0] === 'Acme');
  eq([acme[1], acme[3], acme[10], acme[11], acme[12]], [4, 4, 5000, 10_000, 7000], 'company row writes sites, total deregulated sites and the range as numbers');
  eq([acme[4], acme[5], acme[8], acme[9]], [2000, 0.25, 100_000, 0], 'usage in MWh with its estimated share, spend with its own');
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  const sheet = back.getWorksheet('Summary');
  let acmeRow = null;
  sheet.eachRow((row) => { if (row.getCell(1).value === 'Acme' && !acmeRow) acmeRow = row; });
  eq([!!acmeRow.getCell(5).font.italic, acmeRow.getCell(5).font.color.argb, !!acmeRow.getCell(9).font.italic], [true, 'FFB45309', false],
    'estimated usage is italic amber; spend from uploaded data is not');
  eq([acmeRow.getCell(2).alignment.horizontal, sheet.getRow(acmeRow.number - 1).getCell(2).alignment.horizontal], ['left', 'left'], 'figures and their headers are left-aligned');
  eq(ss.some(r => String(r[0] || '').startsWith('Master Analysis Summary') || String(r[0] || '').startsWith('Savings Low')), false, 'no subtitle or note rows');
  eq(ss.some(r => r.includes('Analysis Saved')), false, 'no Analysis Saved column');
  eq(ss.some(r => r[0] === 'United States' || r[0] === 'TX'), false, 'no country / state table on the Summary tab');
  const fines = ss.filter(r => r[0] === 'Acme')[1];
  eq([fines[1], fines[2], fines[4], fines[7]], [4, 1, 2000, 2000], 'compliance fines by company under the savings table');
  eq(ss.find(r => r[0] === 'Beta')[1], 'No site list to screen', 'a company with nothing to screen says so on the Summary');
  eq(ss.filter(r => r[0] === 'Total (1)').at(-1)[7], 2000, 'fines total');
  const cs = rows('Compliance Summary');
  eq(cs.find(r => r[0] === 'Beta')[1], 'No site list to screen', 'a company with nothing to screen says so');
  eq(cs.some(r => r.includes('Sites Screened From')), false, 'no Sites Screened From column');
  const csSheet = back.getWorksheet('Compliance Summary');
  let namesHeader = null;
  csSheet.eachRow((row) => { row.eachCell((cell) => { if (cell.value === 'Portfolio Company Names') namesHeader = cell; }); });
  const namesCell = csSheet.getRow(namesHeader.row + 1).getCell(namesHeader.col);
  eq([namesCell.value, !!namesCell.alignment.wrapText], ['Acme', false], 'company names on one line, unwrapped');
  const widths = Array.from({ length: 11 }, (_, i) => csSheet.getColumn(i + 1).width);
  eq(widths.every(w => w >= 10), true, 'every column has a readable width');
  eq(csSheet.getColumn(1).width >= 'Portfolio Company'.length, true, 'the first column fits its header');
  eq(cs.find(r => r[0] === 'New York City')[1], 1, 'jurisdiction table');
  const text = JSON.stringify([ss, rows('Savings by Company'), cs]);
  eq(text.includes('—'), false, 'no em dashes in the export');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
