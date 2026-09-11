// Who does the Target Accounts workbook say covers this account?
//
// The company popup's Coverage → CDM field is free to say anything; the
// Target Accounts tab is the shared source of record for who an account
// is assigned to. When the two disagree the popup shows a warning beside
// the CDM, so a rep editing a company sees that the targets list has it
// under somebody else before working it.
//
// Sources, in the order they're consulted (mirrors utils/targetTier.js so
// the tier warning and this one resolve the SAME target account rows):
//   1. settings.targetMap[prospect.id] — the explicit prospect → target
//      account name(s) mapping the user sets on My Accounts. An empty
//      array means the user cleared it, so nothing is matched at all.
//   2. A fuzzy name match of the company against the target list, used
//      only when the user never explicitly set/cleared a mapping.
//
// Pure — no React/DOM. Build the resolver once per (targetAccountsData,
// settings) change and reuse it.

import { matchesCdm, resolveTargetAccountCdm } from './cdmMatch.js';
import { buildCompanyIndex, findStrictMatchesInIndex } from './companyIndex.js';

const COMPANY_KEYWORDS = ['Account', 'Company', 'Account Name', 'Client', 'Name'];

function findCol(record, keywords) {
  for (const key of Object.keys(record)) {
    const lower = String(key || '').toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return String(record[key] || '').trim();
    }
  }
  return '';
}

// Every CDM / rep value a single workbook row names, deduped
// case-insensitively. Both mapped columns are read — settings.targetCdmColumn
// (who covers it now) and settings.targetRepColumn (the "New Sales rep"
// column, where the workbook carries one) — because either naming someone
// else is a coverage clash worth surfacing. When the row carries neither
// mapped column, resolveTargetAccountCdm's keyword scan finds the rep, so
// sheets the user never mapped still resolve one.
export function rowTargetCdms(record, { cdmColumn = '', repColumn = '' } = {}) {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (out.some(o => o.toLowerCase() === s.toLowerCase())) return;
    out.push(s);
  };
  let sawMappedColumn = false;
  for (const col of [cdmColumn, repColumn]) {
    const key = String(col || '').trim();
    if (!key || !Object.prototype.hasOwnProperty.call(record, key)) continue;
    sawMappedColumn = true;
    push(record[key]);
  }
  if (!sawMappedColumn) push(resolveTargetAccountCdm(record, ''));
  return out;
}

// Pull { company, cdms } out of a Target Accounts workbook, every rep's
// rows included — the warning has to find the row whoever it belongs to.
// Rows for the same account name across sheets are merged so an account
// listed twice under two reps reports both.
export function parseTargetAccountCdms(targetAccountsData, { cdmColumn = '', repColumn = '' } = {}) {
  const data = targetAccountsData;
  if (!data?.sheets) return [];
  const byName = new Map(); // lowercased name → { company, cdms: [] }
  const sheetNames = data.sheetNames?.length ? data.sheetNames : Object.keys(data.sheets);
  for (const sheetName of sheetNames) {
    const sheet = data.sheets[sheetName];
    if (!Array.isArray(sheet?.records)) continue;
    for (const record of sheet.records) {
      if (!record) continue;
      const company = findCol(record, COMPANY_KEYWORDS);
      if (!company) continue;
      const key = company.toLowerCase();
      if (!byName.has(key)) byName.set(key, { company, cdms: [] });
      const entry = byName.get(key);
      for (const cdm of rowTargetCdms(record, { cdmColumn, repColumn })) {
        if (!entry.cdms.some(c => c.toLowerCase() === cdm.toLowerCase())) entry.cdms.push(cdm);
      }
    }
  }
  return [...byName.values()];
}

// Build a resolver: (prospect, cdm) → conflict | null. `cdm` is the CDM
// being checked — the popup passes its unsaved draft value so the warning
// clears the moment the field is corrected; it defaults to the record's
// saved cdm. A conflict is
//   { cdms, accounts, source }
// where `cdms` are the OTHER names the targets list carries for this
// account (never one that matches the CDM passed in), `accounts` is
// [{ company, cdms }] naming the target rows they came from, and `source`
// is 'mapped' or 'fuzzy' per the lookup that found them.
export function buildTargetCdmResolver({ targetAccountsData, settings } = {}) {
  const rows = parseTargetAccountCdms(targetAccountsData, {
    cdmColumn: settings?.targetCdmColumn,
    repColumn: settings?.targetRepColumn,
  });
  const targetMap = settings?.targetMap || {};
  const byName = new Map();
  for (const r of rows) byName.set(r.company.toLowerCase().trim(), r);
  // Strict matching on purpose: a warning that fires because "Blackstone"
  // looks like "Blackstone GP Stakes" teaches the user to ignore it.
  const index = buildCompanyIndex(rows.map(r => r.company));

  return function resolveTargetCdmConflict(prospect, cdm) {
    if (!prospect || rows.length === 0) return null;
    const mine = String(cdm === undefined ? (prospect.cdm || '') : cdm).trim();
    const rawMap = targetMap[prospect.id];
    const hasExplicit = rawMap !== undefined; // explicit empty array = user cleared it
    const mappedNames = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);

    const matched = [];
    let source = '';
    if (mappedNames.length > 0) {
      source = 'mapped';
      for (const nm of mappedNames) {
        const entry = byName.get(String(nm || '').toLowerCase().trim());
        if (entry && !matched.includes(entry)) matched.push(entry);
      }
    } else if (!hasExplicit) {
      source = 'fuzzy';
      for (const name of findStrictMatchesInIndex(index, prospect.company || '')) {
        const entry = byName.get(String(name || '').toLowerCase().trim());
        if (entry && !matched.includes(entry)) matched.push(entry);
      }
    }
    if (matched.length === 0) return null;

    const cdms = [];
    const accounts = [];
    for (const entry of matched) {
      // A differently-spelled version of the same person is not another
      // CDM: matchesCdm is what the rest of the app uses to decide that
      // "Baldauf, Dan" and "Dan Baldauf" are one rep.
      const others = entry.cdms.filter(c => !(mine && matchesCdm(c, mine)));
      if (others.length === 0) continue;
      accounts.push({ company: entry.company, cdms: others });
      for (const c of others) {
        if (!cdms.some(o => o.toLowerCase() === c.toLowerCase())) cdms.push(c);
      }
    }
    if (cdms.length === 0) return null;
    return { cdms, accounts, source };
  };
}

// Short badge text for the popup — the one other name, or a count when the
// targets list carries several.
export function targetCdmConflictLabel(conflict) {
  const cdms = conflict?.cdms || [];
  if (cdms.length === 0) return '';
  if (cdms.length === 1) return cdms[0];
  return `${cdms.length} other CDMs`;
}

// The badge's tooltip: who the targets list says covers the account, which
// target row(s) say so, and what that means for the CDM on this record.
export function describeTargetCdmConflict(conflict, cdm) {
  const cdms = conflict?.cdms || [];
  if (cdms.length === 0) return '';
  const accounts = conflict?.accounts || [];
  const names = accounts.map(a => `"${a.company}"`);
  const where = names.length === 0 ? 'the Target Accounts tab'
    : names.length === 1 ? `${names[0]} on the Target Accounts tab`
    : `${names.join(', ')} on the Target Accounts tab`;
  const who = cdms.length === 1 ? cdms[0]
    : `${cdms.slice(0, -1).join(', ')} and ${cdms[cdms.length - 1]}`;
  const mine = String(cdm || '').trim();
  const tail = mine
    ? `The CDM here is ${mine} — check who covers this account.`
    : 'No CDM is set here — check who covers this account.';
  const matchNote = conflict?.source === 'fuzzy'
    ? ' Matched by company name; map the target account on My Accounts to pin it.'
    : '';
  return `${where} ${accounts.length > 1 ? 'are' : 'is'} assigned to ${who}. ${tail}${matchNote}`;
}
