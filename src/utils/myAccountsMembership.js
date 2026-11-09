// Which companies are on My Accounts, as a pure function of the saved data.
//
// MyAccountsView builds its account list inside one big memo that also
// works out every column. The All Missing History "who joined that day"
// popup needs the same membership for a day in the past, read from the
// nightly backup, so the rules that decide membership live here and the
// view calls them too. Change the rule here and both follow.
//
// The rule, per prospect card (in the order the view applies it):
//   1. Dismissed (settings.dismissedCompanies) -> out.
//   2. A tier: Dan target -> its reporting tier; an explicit Tier 1/2/3 or
//      Not on tier list -> that; '-' or blank -> Tier 3; anything else ->
//      the built-in map below, then the CDM's Targets list by name. Still
//      none: in only with any opp (open or closed), as Tier 3.
//   3. Not the CDM's and not a Dan target -> in only with an OPEN opp,
//      strictly matched.
//   4. Kept for Dan (Dan target, or the CDM's and Tier 1/2, on the Targets
//      list, or a Client) -> in; otherwise in only with an open opp.
// The All Missing History count then leaves out inactive (Old Client /
// Hold Off / Lost - Not Sold, a substatus reading as Hold Off) and
// Qualifying companies: countedMyAccountIds.

import { buildCompanyIndex, findMatchesInIndex, findStrictMatchesInIndex } from './companyIndex.js';
import { matchesCdm, resolveTargetAccountCdm } from './cdmMatch.js';
import { isOwnTarget, reportingTier } from './tierSource.js';
import { normalizeTierText } from './tierText.js';
import { NOT_ON_TIER_LIST } from '../data/enums.js';
import { reportingStatus } from './reportingStatus.js';

// Dan's tiered account names (normalized lowercase for matching)
export const MY_ACCOUNTS = new Map([
  ['blue owl capital', 'Tier 1'],
  ['brookfield asset management', 'Tier 1'],
  ['cbre investment management', 'Tier 1'],
  ['cerberus capital management', 'Tier 1'],
  ['nationwide', 'Tier 1'],
  ['goldman sachs asset management', 'Tier 1'],
  ['hellman & friedman', 'Tier 1'],
  ['jones lang lasalle (jll)', 'Tier 1'],
  ['jp morgan asset management real estate', 'Tier 1'],
  ['nuveen real estate, a tiaa co.', 'Tier 1'],
  ['pnc', 'Tier 1'],
  ['prologis', 'Tier 1'],
  ['simon property group', 'Tier 1'],
  ['thoma bravo', 'Tier 1'],
  ['ventas', 'Tier 1'],
  ['ameriprise financial', 'Tier 2'],['affinius capital, a usaa co.', 'Tier 2'],['affinius capital', 'Tier 2'],
  ['american homes 4 rent', 'Tier 2'],['article student living', 'Tier 2'],['article student living, llc', 'Tier 2'],
  ['bank ozk', 'Tier 2'],['bok financial', 'Tier 2'],['berkeley partners', 'Tier 2'],
  ['chubb, ltd.', 'Tier 2'],['cibc', 'Tier 2'],['eos hospitality', 'Tier 2'],
  ['formerly washreit', 'Tier 2'],['washreit', 'Tier 2'],['invitation homes', 'Tier 2'],
  ['lineage logistics (a bay grove co.)', 'Tier 2'],['lineage logistics', 'Tier 2'],
  ['bluerock residential growth reit', 'Tier 2'],['boxer properties', 'Tier 2'],
  ['cabot properties', 'Tier 2'],['cadillac fairview', 'Tier 2'],['cbre', 'Tier 2'],
  ['lpl financial', 'Tier 2'],['clayton, dubilier & rice (cdr)', 'Tier 2'],
  ['new york life', 'Tier 2'],['community healthcare trust inc.', 'Tier 2'],
  ['costar group, inc.', 'Tier 2'],['deloitte', 'Tier 2'],['northern trust', 'Tier 2'],
  ['park hotels & resorts', 'Tier 2'],['divcowest', 'Tier 2'],['realterm', 'Tier 2'],
  ['diversified healthcare trust', 'Tier 2'],['sofi', 'Tier 2'],
  ['teachers insurance and annuity association of america (tiaa)', 'Tier 2'],['tiaa', 'Tier 2'],
  ['dream industrial (a dream unlimited co.)', 'Tier 2'],['dream industrial', 'Tier 2'],
  ['easterly government properties inc.', 'Tier 2'],['eastgroup properties (egp)', 'Tier 2'],
  ['edens', 'Tier 2'],['education realty trust inc. (a greystar co.)', 'Tier 2'],['education realty trust inc.', 'Tier 2'],
  ['equity lifestyle properties', 'Tier 2'],['ey consulting', 'Tier 2'],['gbx group', 'Tier 2'],
  ['griffis residential', 'Tier 2'],['harrison street', 'Tier 2'],['hines', 'Tier 2'],
  ['hobbs brook real estate', 'Tier 2'],['industrious', 'Tier 2'],
  ['international workplace group (iwg)', 'Tier 2'],['invesco real estate', 'Tier 2'],
  ['jackson financial group', 'Tier 2'],['jamestown properties', 'Tier 2'],
  ['kilroy realty', 'Tier 2'],['kimco realty corporation', 'Tier 2'],
  ['kite realty group trust', 'Tier 2'],['klein enterprises, llc', 'Tier 2'],['klein enterprises', 'Tier 2'],
  ['lennar corp.', 'Tier 2'],['macerich', 'Tier 2'],['merritt properties', 'Tier 2'],
  ["moody's", 'Tier 2'],['piedmont office realty trust inc.', 'Tier 2'],
  ['popular, inc.', 'Tier 2'],['price waterhouse coopers (pwc)', 'Tier 2'],
  ['principal financial group', 'Tier 2'],['pritzker private capital (ppc-pc)', 'Tier 2'],
  ['pulte group', 'Tier 2'],['realty income', 'Tier 2'],['remedy reit', 'Tier 2'],
  ['renew senior living', 'Tier 2'],['rinchem company', 'Tier 2'],['rmr group', 'Tier 2'],
  ["shearer's foods", 'Tier 2'],['silver lake', 'Tier 2'],['south bay development company', 'Tier 2'],
  ['starwood capital group', 'Tier 2'],['store capital', 'Tier 2'],['strategic value partners', 'Tier 2'],
  ['tishman speyer properties inc.', 'Tier 2'],['trammell crow company, (a cbre co.)', 'Tier 2'],
  ['trammell crow company (a cbre co.)', 'Tier 2'],['trammell crow company', 'Tier 2'],
  ['tricon residential', 'Tier 2'],['usaa', 'Tier 2'],['vertiv', 'Tier 2'],
  ['westinghouse (a brookfield co.)', 'Tier 2'],['wework', 'Tier 2'],
  ['whitestone reit', 'Tier 2'],['wilsonart international, inc.', 'Tier 2'],['wsp global', 'Tier 2'],
]);

export function findTier(companyName) {
  const key = (companyName || '').toLowerCase().trim();
  if (MY_ACCOUNTS.has(key)) return MY_ACCOUNTS.get(key);
  for (const [k, tier] of MY_ACCOUNTS) {
    if (k.startsWith(key) || key.startsWith(k)) return tier;
  }
  return null;
}

function findCol(r, keywords) {
  for (const key of Object.keys(r)) {
    const lower = key.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
    }
  }
  return '';
}

/**
 * The CDM's Tier 1/2/3 rows on the Targets workbook ({ sheets, sheetNames }).
 * { accounts: [{ company, tier, ...row }], skipped: [{ company, reason }] }.
 */
export function parseTargetAccounts(data, cdmName, targetCdmColumn) {
  const accounts = [];
  const skipped = [];
  if (!data?.sheets) return { accounts, skipped };
  const cdmLastName = (cdmName || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
  for (const sheetName of data.sheetNames || []) {
    const sheet = data.sheets[sheetName];
    if (!sheet?.records) continue;
    for (const r of sheet.records) {
      const companyForLog = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
      let cdm = resolveTargetAccountCdm(r, targetCdmColumn).toLowerCase();
      if (!cdm && cdmLastName) {
        cdm = Object.values(r).find(v => String(v || '').toLowerCase().includes(cdmLastName)) || '';
        cdm = String(cdm).toLowerCase();
      }
      if (!matchesCdm(cdm, cdmName)) {
        if (companyForLog) skipped.push({ company: companyForLog, reason: `CDM="${cdm}" (not ${cdmName || 'configured CDM'})` });
        continue;
      }
      let tier = normalizeTierText(findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']));
      if (!tier) {
        tier = Object.values(r).map(normalizeTierText).find(v => /Tier\s*[1-3]/i.test(v)) || '';
      }
      // Tier 3 belongs to the book too. Prefer an explicit "Tier N" over a
      // bare digit so a cell like "2025 Tier 1" still reads as Tier 1.
      const tierDigit = (tier.match(/Tier\s*([1-3])/i) || tier.match(/([1-3])/) || [])[1];
      if (!tierDigit) {
        if (companyForLog) skipped.push({ company: companyForLog, reason: `Tier="${tier}" (not Tier 1/2/3)` });
        continue;
      }
      const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
      if (!company) continue;
      accounts.push({ company: company.trim(), tier: `Tier ${tierDigit}`, ...r });
    }
  }
  return { accounts, skipped };
}

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

/** Opp counts per lower-cased Account: { total, open } (as the view counts them). */
export function oppCountsByAccount(records) {
  const total = {};
  const open = {};
  for (const r of records || []) {
    const account = String(r?.Account || '').trim().toLowerCase();
    if (!account) continue;
    const stage = String(r?.Stage || '').trim();
    if (!INVALID_STAGES.has(stage)) total[account] = (total[account] || 0) + 1;
    if (!CLOSED_STAGES.has(stage) && !INVALID_STAGES.has(stage)) open[account] = (open[account] || 0) + 1;
  }
  return { total, open };
}

const INACTIVE = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

/**
 * The My Accounts rows backed by a prospect card, before any status filter:
 * [{ prospect, tier, why }], `why` saying what keeps it on the page.
 */
export function myAccountsMembers({ prospects, cdmName, targetMap = {}, dismissedCompanies = [], divisionsMap = {}, targetAccounts = [], oppsRecords = [] }) {
  const { total: totalOpps, open: openOpps } = oppCountsByAccount(oppsRecords);
  const oppsIndex = buildCompanyIndex(Object.keys(totalOpps));
  const openOppsIndex = buildCompanyIndex(Object.keys(openOpps));
  const targetAccountsIndex = buildCompanyIndex(targetAccounts.map(t => t.company || ''));
  const targetByName = new Map();
  for (const t of targetAccounts) {
    const k = (t.company || '').toLowerCase().trim();
    if (k && !targetByName.has(k)) targetByName.set(k, t);
  }
  const dismissed = new Set((dismissedCompanies || []).map(d => String(d || '').toLowerCase().trim()).filter(Boolean));
  const out = [];
  for (const p of prospects || []) {
    const lower = (p?.company || '').toLowerCase().trim();
    if (lower && dismissed.has(lower)) continue;
    let tier;
    if (isOwnTarget(p)) tier = reportingTier(p);
    else if (p.tier === 'Tier 1' || p.tier === 'Tier 2' || p.tier === 'Tier 3' || p.tier === NOT_ON_TIER_LIST) tier = p.tier;
    else if (p.tier === '-' || p.tier === '') tier = 'Tier 3';
    else {
      tier = findTier(p.company);
      if (!tier) {
        for (const tName of findMatchesInIndex(targetAccountsIndex, p.company)) {
          const t = targetByName.get((tName || '').toLowerCase().trim());
          if (t) { tier = t.tier; break; }
        }
      }
    }
    let tierFromOpps = false;
    if (!tier) {
      const companyLower = (p.company || '').toLowerCase();
      let hasAnyOpp = false;
      for (const oc of findMatchesInIndex(oppsIndex, companyLower)) {
        if ((totalOpps[oc] || 0) > 0) { hasAnyOpp = true; break; }
      }
      if (!hasAnyOpp) continue;
      tier = 'Tier 3';
      tierFromOpps = true;
    }
    const isMine = matchesCdm(p.cdm, cdmName);
    const ownTarget = isOwnTarget(p);
    if (!isMine && !ownTarget) {
      const compLower = (p.company || '').toLowerCase();
      let hasOpenOpp = false;
      for (const oc of findStrictMatchesInIndex(openOppsIndex, compLower)) {
        if ((openOpps[oc] || 0) > 0) { hasOpenOpp = true; break; }
      }
      if (!hasOpenOpp) continue;
    }
    const names = [(p.company || '').toLowerCase(), ...((divisionsMap?.[p.id]) || []).map(d => (d?.company || '').toLowerCase())];
    let oppsCount = 0;
    for (const name of names) {
      oppsCount += openOpps[name] || 0;
      for (const oc of findMatchesInIndex(openOppsIndex, name)) {
        if (oc !== name) { oppsCount += openOpps[oc] || 0; break; }
      }
    }
    const rawMap = targetMap?.[p.id];
    let onTargetList = Array.isArray(rawMap) ? rawMap.length > 0 : !!rawMap;
    if (rawMap === undefined) {
      for (const tName of findMatchesInIndex(targetAccountsIndex, p.company)) {
        if (targetByName.get((tName || '').toLowerCase().trim())) { onTargetList = true; break; }
      }
    }
    const strategic = tier === 'Tier 1' || tier === 'Tier 2';
    const keep = ownTarget || (isMine && (strategic || onTargetList || p.status === 'Client'));
    if (!keep && !oppsCount) continue;
    let why;
    if (ownTarget) why = 'Dan target';
    else if (!isMine) why = 'Open opp (other CDM)';
    else if (strategic && !tierFromOpps) why = tier;
    else if (onTargetList) why = 'On Targets list';
    else if (p.status === 'Client') why = 'Client';
    else why = 'Open opp';
    out.push({ prospect: p, tier, why });
  }
  return out;
}

/** Whether a My Accounts row is counted on All Missing History. */
export function countedOnHistory(p) {
  const status = reportingStatus(p);
  if (INACTIVE.has(status)) return false;
  return String(p?.status || '').trim().toLowerCase() !== 'qualifying';
}

/** Map of prospect id -> { prospect, tier, why } for the counted members. */
export function countedMyAccounts(inputs) {
  const out = new Map();
  for (const m of myAccountsMembers(inputs)) if (countedOnHistory(m.prospect)) out.set(m.prospect.id, m);
  return out;
}
