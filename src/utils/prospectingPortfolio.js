// The rows behind the Prospecting page's "My Prospects" and "PCs" subtabs:
// one line per company with how many sites it has, how many utility
// accounts sit behind them, and how much energy they use.
//
// The figures are the ones the Utility Lookup page writes onto a company
// when its Master Analysis is saved (numberOfSites, numberOfAccounts,
// totalEnergyMwh), so a company reads the same here as on its own popup.
// Where that hasn't happened yet the next-best source fills in and says so:
//
//   Sites   the saved site list on the company's popup, by row count.
//   Energy  the Electric MWh typed on the popup (electric only).
//
// A portfolio company with no tracker record of its own falls back to the
// estimates on its PE firm's Portfolio Companies table, marked as estimates,
// because "-" beside a company the firm's table already sized would throw
// away the only number there is.
//
// Imported with extensions so this loads under plain Node for the tests.
import { matchesCdm } from './cdmMatch.js';
import { buildProspectPcIndex, lookupProspectByPc, topPcCompanyKey } from './topPortfolioCompany.js';
import { siteCountNumber } from './portfolioCompaniesWorkbook.js';

// Same slug ProspectModal keys a company's saved site list by.
export function siteListSlug(company) {
  return String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function positiveNumber(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Sites / accounts / energy for one tracker record, each with where it came
 * from: 'analysis' (written by a Master Analysis save or typed on the popup),
 * 'siteList' (counted off the saved list), 'electric' (Electric MWh only).
 */
export function companyFigures(prospect, siteLists) {
  const out = {
    sites: null, sitesFrom: null,
    accounts: null, accountsFrom: null,
    energyMwh: null, energyFrom: null,
    hasSiteList: false,
    hasAnalysis: !!prospect?.indicativeAnalysisMeta,
  };
  if (!prospect) return out;
  const list = (siteLists || {})[siteListSlug(prospect.company)];
  const listRows = Array.isArray(list?.rows) ? list.rows.length : 0;
  out.hasSiteList = listRows > 0;

  const sites = positiveNumber(prospect.numberOfSites);
  if (sites != null) { out.sites = sites; out.sitesFrom = 'analysis'; }
  else if (listRows > 0) { out.sites = listRows; out.sitesFrom = 'siteList'; }

  const accounts = positiveNumber(prospect.numberOfAccounts);
  if (accounts != null) { out.accounts = accounts; out.accountsFrom = 'analysis'; }

  const total = positiveNumber(prospect.totalEnergyMwh);
  const electric = positiveNumber(prospect.annualMwh);
  if (total != null) { out.energyMwh = total; out.energyFrom = 'analysis'; }
  else if (electric != null) { out.energyMwh = electric; out.energyFrom = 'electric'; }
  return out;
}

// Statuses that mean there is nothing to prospect: the account has said no,
// been parked, or already been a client and moved on. Both subtabs leave
// these companies out (and so do their totals).
export const CLOSED_STATUSES = ['Old Client', 'Lost - Not Sold', 'Hold Off'];
const CLOSED_SET = new Set(CLOSED_STATUSES.map(s => s.toLowerCase()));
export function isClosedStatus(status) {
  return CLOSED_SET.has(String(status || '').trim().toLowerCase());
}

/** Every tracker company whose CDM is this user, A to Z, minus closed ones. */
export function myProspectRows(prospects, cdmName, siteLists) {
  return (prospects || [])
    .filter(p => p?.company && matchesCdm(p.cdm, cdmName) && !isClosedStatus(p.status))
    .map(p => ({
      key: p.id || p.company,
      company: String(p.company).trim(),
      status: p.status || '',
      type: String(p.type || '').trim(),
      prospect: p,
      peFirms: [],
      ...companyFigures(p, siteLists),
    }))
    .sort((a, b) => a.company.localeCompare(b.company));
}

/**
 * Every portfolio company mapped on any PE firm's Portfolio Companies
 * table, once each. A company two firms both list (a co-investment, or the
 * same row pasted twice) is one line naming both firms, with the figures
 * of whichever row carries them.
 */
export function allPcRows(prospects, siteLists) {
  const index = buildProspectPcIndex(prospects);
  const byKey = new Map();
  for (const firm of (prospects || [])) {
    const pcs = firm?.portfolioCompanies;
    if (!Array.isArray(pcs) || pcs.length === 0) continue;
    const firmName = String(firm.company || '').trim();
    for (const pc of pcs) {
      const name = String(pc?.companyName || '').trim();
      if (!name) continue;
      const key = topPcCompanyKey(name) || name.toLowerCase();
      let row = byKey.get(key);
      if (!row) {
        row = { key, company: name, peFirms: [], estSites: null, estEnergyMwh: null, rowStatus: '' };
        byKey.set(key, row);
      }
      if (firmName && !row.peFirms.includes(firmName)) row.peFirms.push(firmName);
      if (row.estSites == null) row.estSites = siteCountNumber(pc.siteCount) || null;
      // The firm's table sizes energy in GWh.
      if (row.estEnergyMwh == null) {
        const gwh = positiveNumber(pc.energyGwh);
        if (gwh != null) row.estEnergyMwh = gwh * 1000;
      }
      if (!row.rowStatus && pc.status) row.rowStatus = String(pc.status).trim();
    }
  }
  const rows = [];
  for (const row of byKey.values()) {
    const prospect = lookupProspectByPc(index, row.company);
    if (isClosedStatus(prospect?.status || row.rowStatus)) continue;
    const figs = companyFigures(prospect, siteLists);
    if (figs.sites == null && row.estSites != null) { figs.sites = row.estSites; figs.sitesFrom = 'estimate'; }
    if (figs.energyMwh == null && row.estEnergyMwh != null) { figs.energyMwh = row.estEnergyMwh; figs.energyFrom = 'estimate'; }
    rows.push({
      key: row.key,
      company: prospect?.company ? String(prospect.company).trim() : row.company,
      status: prospect?.status || row.rowStatus || '',
      prospect: prospect || null,
      peFirms: row.peFirms.sort((a, b) => a.localeCompare(b)),
      ...figs,
    });
  }
  return rows.sort((a, b) => a.company.localeCompare(b.company));
}

/** Column totals over whatever rows are on screen. */
export function sumFigures(rows) {
  const t = { sites: 0, accounts: 0, energyMwh: 0, count: rows.length };
  for (const r of rows) {
    if (r.sites != null) t.sites += r.sites;
    if (r.accounts != null) t.accounts += r.accounts;
    if (r.energyMwh != null) t.energyMwh += r.energyMwh;
  }
  return t;
}

// The Prospects list's "Hide types" control. A company with no Type set is
// filed under NO_TYPE so it can be hidden like any other.
export const NO_TYPE = '(No type)';

// Type spellings that mean the same thing, filed under one label. "PE Firm"
// is what the Blue Owl GP-stakes backfill wrote (utils/peOwnerBackfill.js);
// everything else uses the standard "Private Equity" - so hiding one and
// still seeing Thoma Bravo under the other read as the filter not working.
const TYPE_ALIASES = new Map([
  ['pe firm', 'Private Equity'],
  ['pe', 'Private Equity'],
  ['private equity', 'Private Equity'],
  ['private equity firm', 'Private Equity'],
]);

// The label a Type is listed and hidden under. Also used on saved hidden
// labels, so a "PE Firm" ticked before the two were merged still hides both.
export function typeLabel(type) {
  const t = String(type || '').trim();
  if (!t) return NO_TYPE;
  return TYPE_ALIASES.get(t.toLowerCase()) || t;
}

export function rowTypeLabel(row) {
  return typeLabel(row?.type);
}

// The types on these rows, for the control's checklist: alphabetical, with
// NO_TYPE last.
export function typesOnRows(rows) {
  const set = new Set((rows || []).map(rowTypeLabel));
  const named = [...set].filter(t => t !== NO_TYPE).sort((a, b) => a.localeCompare(b));
  return set.has(NO_TYPE) ? [...named, NO_TYPE] : named;
}

// The rows left once the hidden types come out. `hidden` is a list of
// labels as rowTypeLabel gives them.
export function withoutTypes(rows, hidden) {
  const h = new Set((hidden || []).map(x => typeLabel(x)));
  return h.size ? (rows || []).filter(r => !h.has(rowTypeLabel(r))) : (rows || []);
}
