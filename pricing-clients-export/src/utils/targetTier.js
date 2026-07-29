// Resolve the Tier a prospect inherits from the Target Accounts list it's
// mapped to. This mirrors the tier resolution My Accounts does, factored
// out so the Clients page can show the same "tier from the mapped target
// account" without duplicating the parse.
//
// Sources, in the order they're consulted:
//   1. settings.targetMap[prospect.id] — the explicit prospect → target
//      account name(s) mapping the user sets on My Accounts.
//   2. A fuzzy name match of the prospect's company against the target
//      list (only when the user never explicitly set/cleared a mapping).

import { matchesCdm, resolveTargetAccountCdm } from './cdmMatch';
import { buildCompanyIndex, findMatchesInIndex } from './companyIndex';

// Pull the company + tier out of a Target Accounts workbook, keeping every
// tier (1–9), not just Tier 1/2. When `scopeToCdm` is true the rows are
// filtered to the configured CDM (matching My Accounts' CDM-scoped parse);
// when false, every rep's rows are kept — used as a fallback so a mapped
// account tiered under another rep / a blank owner cell still resolves.
export function parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm = true } = {}) {
  const data = targetAccountsData;
  if (!data?.sheets) return [];
  const findCol = (r, keywords) => {
    for (const key of Object.keys(r)) {
      const lower = key.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
      }
    }
    return '';
  };
  const cdmLastName = (cdmName || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
  const out = [];
  for (const sheetName of data.sheetNames || []) {
    const sheet = data.sheets[sheetName];
    if (!sheet?.records) continue;
    for (const r of sheet.records) {
      if (scopeToCdm) {
        let cdm = resolveTargetAccountCdm(r, targetCdmColumn).toLowerCase();
        if (!cdm && cdmLastName) {
          cdm = String(Object.values(r).find(v => String(v || '').toLowerCase().includes(cdmLastName)) || '').toLowerCase();
        }
        if (!matchesCdm(cdm, cdmName)) continue;
      }
      const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
      if (!company) continue;
      let tierRaw = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
      if (!tierRaw) tierRaw = String(Object.values(r).find(v => /Tier\s*[1-9]/i.test(String(v || ''))) || '');
      const m = tierRaw.match(/(?:Tier\s*)?([1-9])/i);
      if (!m) continue;
      out.push({ company: company.trim(), tier: `Tier ${m[1]}` });
    }
  }
  return out;
}

// Build a resolver: prospect → { tier, name, source }. `tier` is '' when
// nothing maps. `name` is the target account the tier came from; `source`
// is 'mapped' (explicit targetMap) or 'fuzzy' (name match). Build once per
// (targetAccountsData, cdmName, settings) change and reuse for every row.
export function buildTargetTierResolver({ targetAccountsData, cdmName, settings }) {
  const targetCdmColumn = settings?.targetCdmColumn;
  const cdmScoped = parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm: true });
  const allReps = parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm: false });
  const targetMap = settings?.targetMap || {};

  const byNameCdm = new Map();
  for (const t of cdmScoped) {
    const k = t.company.toLowerCase().trim();
    if (k && !byNameCdm.has(k)) byNameCdm.set(k, t.tier);
  }
  const byNameAll = new Map();
  for (const t of allReps) {
    const k = t.company.toLowerCase().trim();
    if (k && !byNameAll.has(k)) byNameAll.set(k, t.tier);
  }
  const cdmIndex = buildCompanyIndex(cdmScoped.map(t => t.company));

  const lookupName = (nm) => {
    const k = (nm || '').toLowerCase().trim();
    return byNameCdm.get(k) || byNameAll.get(k) || '';
  };

  return function resolveTargetTier(prospect) {
    if (!prospect) return { tier: '', name: '', source: '' };
    const rawMap = targetMap[prospect.id];
    const hasExplicit = rawMap !== undefined; // explicit empty array = user cleared it
    const names = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);
    if (names.length > 0) {
      for (const nm of names) {
        const t = lookupName(nm);
        if (t) return { tier: t, name: nm, source: 'mapped' };
      }
      // Mapped, but the name isn't on the target list (or has no tier).
      return { tier: '', name: names[0] || '', source: 'mapped' };
    }
    if (!hasExplicit) {
      for (const tName of findMatchesInIndex(cdmIndex, prospect.company || '')) {
        const t = byNameCdm.get((tName || '').toLowerCase().trim());
        if (t) return { tier: t, name: tName, source: 'fuzzy' };
      }
    }
    return { tier: '', name: '', source: '' };
  };
}
