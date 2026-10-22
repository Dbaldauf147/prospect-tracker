// A PE firm's portfolio, summarised across the Master Analyses saved
// against its portfolio companies: the "Master Analysis Summary" button on
// the company popup's Portfolio Companies table.
//
// Two halves, both pure:
//
//   - marketsFromWorkbook() reads one saved workbook's Indicative Savings
//     sheet back into rows, one per market (state / province / country) and
//     commodity: how many sites are in the market, how many are deregulated,
//     the spend the savings are taken off, and the Low / High % band the
//     analysis priced it at. Like analysisWorkbookFigures, this reads what
//     the analysis already wrote and does not re-run the savings model.
//
//   - complianceSummary() rolls one company's screened sites (the output of
//     complianceMandates.screenSites) up into the figures the Compliance
//     Report leads with, plus a per-jurisdiction breakdown.
//
// The aggregation across companies (summariseMarkets) lives here too so the
// rules for what is counted where can be tested without a browser.

// The first column header of both commodity tables on the Indicative
// Savings sheet. Everything else on the row is found by its header text.
const MARKET_HEADER = /^st\s*\/\s*prov\s*\/\s*country$/i;

function colName(n) {
  let s = '';
  let i = n;
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function usedRange(sheet) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(sheet?.['!ref'] || ''));
  if (!m) return null;
  return { minCol: colIndex(m[1]), minRow: Number(m[2]) - 1, maxCol: colIndex(m[3]), maxRow: Number(m[4]) - 1 };
}

const cellAt = (sheet, row, col) => sheet?.[`${colName(col)}${row + 1}`] || null;

function textAt(sheet, row, col) {
  const c = cellAt(sheet, row, col);
  return c ? String(c.w ?? c.v ?? '').trim() : '';
}

// A number from a cell, or null. Formula cells carry their cached result in
// `v`, which is what the savings columns are.
function numAt(sheet, row, col) {
  if (col == null || col < 0) return null;
  const c = cellAt(sheet, row, col);
  if (!c) return null;
  const v = c.t === 'n' ? c.v : Number(c.v);
  return Number.isFinite(v) ? v : null;
}

// The commodity a table belongs to, from the section band written on the
// row above its header ("Electric Power", "Natural Gas").
function commodityOf(label) {
  if (/gas/i.test(label)) return 'gas';
  if (/electric|power/i.test(label)) return 'electric';
  return null;
}

/**
 * Every market row on a saved workbook's Indicative Savings sheet.
 *
 * Read with `cellStyles: true` so SheetJS keeps each row's outline level:
 * on a portfolio with sites outside the US, the United States and Canada
 * rows are roll-ups of the states / provinces grouped under them, and the
 * outline level is the only thing on the sheet that says so. Those roll-up
 * rows are dropped (their children carry the detail) and their name becomes
 * the children's country.
 *
 * `countryOf(label)` names the country of a market that sits under no
 * roll-up row ("TX" on a US-only portfolio); when it returns nothing the
 * market is taken to be a country itself, which is how the sheet lists
 * markets outside North America.
 *
 * Returns [{ commodity, market, country, status, totalSites, deregulatedSites,
 * spend, lowPct, highPct, low, high, indicative }], or [] when the sheet
 * isn't there. `low` / `high` are the market's spend at its Low and High %:
 * the run-rate band once every supply agreement is open. `indicative` is
 * the sheet's own Indicative Annual Savings, the Year 1 figure, which only
 * counts spend already out of contract.
 */
export function marketsFromWorkbook(wb, { countryOf = () => null } = {}) {
  const sheet = wb?.Sheets?.['Indicative Savings'];
  const range = usedRange(sheet);
  if (!range) return [];
  const levels = sheet['!rows'] || [];
  const levelOf = (r) => Number(levels[r]?.level) || 0;
  const out = [];

  for (let r = range.minRow; r <= range.maxRow; r++) {
    if (!MARKET_HEADER.test(textAt(sheet, r, range.minCol))) continue;
    const commodity = commodityOf(r > 0 ? textAt(sheet, r - 1, range.minCol) : '') || (out.some(m => m.commodity === 'electric') ? 'gas' : 'electric');
    const cols = {};
    for (let c = range.minCol; c <= range.maxCol; c++) {
      const h = textAt(sheet, r, c).toLowerCase();
      if (!h) continue;
      // First match wins: the reg-rate block to the right repeats words
      // like "Sites" and "Savings", and the deregulated block comes first.
      const set = (key) => { if (cols[key] == null) cols[key] = c; };
      if (h === 'deregulated status') set('status');
      else if (h === 'total sites' || h === 'sites') set('totalSites');
      else if (h === 'deregulated sites') set('deregulatedSites');
      else if (h === 'deregulated spend/yr') set('spend');
      else if (h === 'savings-eligible spend/yr') set('eligibleSpend');
      else if (h === 'low %') set('lowPct');
      else if (h === 'high %') set('highPct');
      else if (h === 'indicative annual savings') set('indicative');
    }

    let parentCountry = '';
    for (let d = r + 1; d <= range.maxRow; d++) {
      const label = textAt(sheet, d, range.minCol);
      // The table ends at its Total row, or at the grey line that sums the
      // regulated markets the table leaves out. Either way, a blank first
      // cell means the next block has started.
      if (!label || /^total$/i.test(label) || /^remaining sites in regulated markets/i.test(label)) break;
      const level = levelOf(d);
      const isParent = level === 0 && d < range.maxRow && levelOf(d + 1) > 0;
      if (isParent) { parentCountry = label; continue; }
      if (level === 0) parentCountry = '';
      const spendFull = numAt(sheet, d, cols.spend);
      const spendEligible = numAt(sheet, d, cols.eligibleSpend);
      const spend = spendEligible ?? spendFull ?? 0;
      const lowPct = numAt(sheet, d, cols.lowPct);
      const highPct = numAt(sheet, d, cols.highPct);
      out.push({
        commodity,
        market: label,
        country: parentCountry || countryOf(label) || label,
        status: textAt(sheet, d, cols.status ?? -1),
        totalSites: numAt(sheet, d, cols.totalSites) || 0,
        deregulatedSites: numAt(sheet, d, cols.deregulatedSites) || 0,
        spend,
        lowPct,
        highPct,
        low: lowPct != null ? Math.round(spend * lowPct) : null,
        high: highPct != null ? Math.round(spend * highPct) : null,
        indicative: Math.round(numAt(sheet, d, cols.indicative) || 0),
      });
    }
  }
  return out;
}

// Adds a market row's figures onto a running total. A null Low / High
// (a market priced "TBD") adds nothing but is remembered, so a total that
// left one out can say so.
function addInto(t, m) {
  if (m.commodity === 'gas') t.gasDeregulatedSites += m.deregulatedSites;
  else t.electricDeregulatedSites += m.deregulatedSites;
  if (m.commodity === 'gas') t.gasSites += m.totalSites;
  else t.electricSites += m.totalSites;
  t.spend += m.spend;
  if (m.low != null) t.low += m.low;
  if (m.high != null) t.high += m.high;
  if ((m.low == null || m.high == null) && m.deregulatedSites > 0) t.unpriced += 1;
  t.indicative += m.indicative;
  return t;
}

const emptyTotals = () => ({
  electricSites: 0, gasSites: 0,
  electricDeregulatedSites: 0, gasDeregulatedSites: 0,
  spend: 0, low: 0, high: 0, indicative: 0, unpriced: 0,
});

/**
 * Roll each company's markets up three ways:
 *
 *   byCompany  [{ company, ...totals, markets }]       one row per company
 *   byCountry  [{ country, ...totals, companies }]      across the portfolio
 *   byMarket   [{ country, market, ...totals, companies }]
 *
 * Electric and gas rows for the same market merge into one, keeping the two
 * deregulated site counts apart: the same building usually shows up in
 * both, so adding them would count it twice.
 *
 * `entries` is [{ company, markets }] with markets from marketsFromWorkbook.
 */
export function summariseMarkets(entries) {
  const byCompany = [];
  const countries = new Map();
  const markets = new Map();
  for (const { company, markets: rows = [] } of entries || []) {
    const totals = emptyTotals();
    const own = new Map();
    for (const m of rows) {
      addInto(totals, m);
      const key = `${m.country}\u0000${m.market}`;
      if (!own.has(key)) own.set(key, { country: m.country, market: m.market, ...emptyTotals() });
      addInto(own.get(key), m);

      if (!countries.has(m.country)) countries.set(m.country, { country: m.country, ...emptyTotals(), companies: new Set() });
      const c = countries.get(m.country);
      addInto(c, m);
      if (m.deregulatedSites > 0) c.companies.add(company);

      if (!markets.has(key)) markets.set(key, { country: m.country, market: m.market, ...emptyTotals(), companies: new Set() });
      const mk = markets.get(key);
      addInto(mk, m);
      if (m.deregulatedSites > 0) mk.companies.add(company);
    }
    byCompany.push({
      company,
      ...totals,
      markets: [...own.values()].sort(byOpportunity),
    });
  }
  const finish = (x) => ({ ...x, companies: [...x.companies].sort((a, b) => a.localeCompare(b)) });
  return {
    byCompany: byCompany.sort(byOpportunity),
    byCountry: [...countries.values()].map(finish).sort(byOpportunity),
    byMarket: [...markets.values()].map(finish).sort(byOpportunity),
  };
}

// Biggest opportunity first: the top of the range, then deregulated sites,
// then the name so equal rows keep a stable order.
function byOpportunity(a, b) {
  return (b.high - a.high)
    || ((b.electricDeregulatedSites + b.gasDeregulatedSites) - (a.electricDeregulatedSites + a.gasDeregulatedSites))
    || String(a.company || a.market || a.country || '').localeCompare(String(b.company || b.market || b.country || ''));
}

/**
 * One company's screened sites as the Compliance Report's headline figures,
 * per category and per jurisdiction.
 *
 * `mandates` is the complianceMandates module (passed in, because its
 * ordinance tables are hundreds of kilobytes and the popup only loads them
 * when the summary is opened).
 */
export function complianceSummary(results, mandates) {
  const { CATEGORIES, totalEligible, totalPenalty, sitesWithMandate, eligibilityByOrdinance, penaltyByOrdinance } = mandates;
  const list = results || [];
  const matched = list.filter(r => r.matched);
  const categories = {};
  for (const c of CATEGORIES) categories[c] = { sites: totalEligible(list, c), penalty: Math.round(totalPenalty(list, c)) };

  const jur = new Map();
  const bump = (gov) => {
    if (!jur.has(gov)) {
      const blank = { government: gov, sites: 0, penalty: 0 };
      for (const c of CATEGORIES) blank[c] = { sites: 0, penalty: 0 };
      jur.set(gov, blank);
    }
    return jur.get(gov);
  };
  for (const c of CATEGORIES) {
    for (const { government, count } of eligibilityByOrdinance(list, c)) bump(government)[c].sites = count;
    for (const { government, penalty } of penaltyByOrdinance(list, c)) {
      const j = bump(government);
      j[c].penalty = Math.round(penalty);
      j.penalty += Math.round(penalty);
    }
  }
  // A site owing two mandates is one site, the same rule the report's
  // Total column follows.
  for (const r of matched) {
    if (CATEGORIES.some(c => r[c] && r[c].eligible === true)) bump(r.government).sites += 1;
  }

  return {
    sitesScreened: list.length,
    sitesMatched: matched.length,
    sitesWithMandate: sitesWithMandate(list),
    jurisdictions: new Set(matched.map(r => r.govId)).size,
    // So a portfolio total can count a jurisdiction two companies share once.
    jurisdictionIds: [...new Set(matched.map(r => r.govId))],
    categories,
    exposure: CATEGORIES.reduce((s, c) => s + categories[c].penalty, 0),
    byJurisdiction: [...jur.values()].sort((a, b) => b.penalty - a.penalty || b.sites - a.sites || a.government.localeCompare(b.government)),
  };
}
