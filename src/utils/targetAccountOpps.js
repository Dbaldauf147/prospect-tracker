// Tie the Opps 2 dataset to the Target Accounts list. Powers the Target
// Accounts page's "Active Opps" column (active opps per listed company)
// and the top-of-page warning that flags active opps whose company isn't
// tied to the configured CDM on the target list.
//
// Pure — no React/DOM. Build the index once per (records) change and reuse.

import { matchesCdm, findCdmColumnKey } from './cdmMatch';
import { buildCompanyIndex, findMatchesInIndex, hasMatchInIndex } from './companyIndex';

// The rule lives in ./oppStages.js so the import-free modules can share
// it; it is re-exported here so existing callers keep importing "is this
// opp active" from the module they already do.
import { isActiveOppStage } from './oppStages.js';

export { isActiveOppStage };

// Normalize the Opps 2 rows down to the active ones with an Account name,
// as { account, stage, raw }.
export function collectActiveOpps(records) {
  const out = [];
  for (const r of (records || [])) {
    if (!isActiveOppStage(r?.Stage)) continue;
    const account = String(r?.Account || '').trim();
    if (!account) continue;
    out.push({ account, stage: String(r?.Stage || '').trim(), raw: r });
  }
  return out;
}

// Account names on the target list tied to `cdmName`, across every sheet.
// A sheet with no resolvable CDM column can't be filtered, so all of its
// rows are included (mirrors the Compare tab's behaviour). nameKey is the
// leftmost header, matching this page's own convention.
export function collectCdmTargetNames(targetData, cdmName, targetCdmColumn) {
  const names = [];
  if (!targetData?.sheets) return names;
  for (const sheet of Object.values(targetData.sheets)) {
    const headers = sheet?.headers || [];
    const nameKey = headers[0];
    if (!nameKey || !Array.isArray(sheet.records)) continue;
    const cdmKey = findCdmColumnKey(headers, targetCdmColumn);
    for (const r of sheet.records) {
      const name = String(r[nameKey] || '').trim();
      if (!name) continue;
      if (cdmKey && cdmName) {
        const cdm = String(r[cdmKey] || '').trim();
        if (!matchesCdm(cdm, cdmName)) continue;
      }
      names.push(name);
    }
  }
  return names;
}

// Every account name on the target list (any CDM) mapped to the CDM
// value(s) it's attributed to, plus a company index over those names.
// Used to tell the user WHO an untied opp's company is tied to on the
// list (another rep, or nobody).
export function collectTargetCdmLookup(targetData, targetCdmColumn) {
  const names = [];
  const cdmByName = new Map(); // lowercased name → Set of CDM strings
  if (!targetData?.sheets) return { names, cdmByName, index: buildCompanyIndex([]) };
  for (const sheet of Object.values(targetData.sheets)) {
    const headers = sheet?.headers || [];
    const nameKey = headers[0];
    if (!nameKey || !Array.isArray(sheet.records)) continue;
    const cdmKey = findCdmColumnKey(headers, targetCdmColumn);
    for (const r of sheet.records) {
      const name = String(r[nameKey] || '').trim();
      if (!name) continue;
      names.push(name);
      const k = name.toLowerCase();
      if (!cdmByName.has(k)) cdmByName.set(k, new Set());
      const cdm = cdmKey ? String(r[cdmKey] || '').trim() : '';
      if (cdm) cdmByName.get(k).add(cdm);
    }
  }
  return { names, cdmByName, index: buildCompanyIndex(names) };
}

// Build a reusable index answering "which active opps match this company".
export function buildActiveOppsIndex(records) {
  const active = collectActiveOpps(records);
  const byName = new Map(); // lowercased account → opps[]
  for (const o of active) {
    const k = o.account.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(o);
  }
  const index = buildCompanyIndex([...byName.keys()]);
  return { active, byName, index };
}

// Active opps matching a single company (fuzzy), deduped by opp id.
export function activeOppsForCompany(company, oppsIndex) {
  const c = String(company || '').trim();
  if (!c || !oppsIndex) return [];
  const seen = new Set();
  const out = [];
  for (const name of findMatchesInIndex(oppsIndex.index, c)) {
    for (const o of (oppsIndex.byName.get(String(name).toLowerCase()) || [])) {
      const id = o.raw?._id ?? `${o.account}|${o.stage}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(o);
    }
  }
  return out;
}

// Active opps whose company is NOT tied to `cdmName` on the target list.
// Grouped by account (name + opps + stage list), most opps first. When
// there's no target data or no cdmName, nothing is flagged (we can't say
// what's tied to the CDM, so we don't cry wolf).
export function findUntiedActiveOpps(records, targetData, cdmName, targetCdmColumn) {
  const empty = { groups: [], totalOpps: 0, totalCompanies: 0 };
  if (!cdmName || !targetData?.sheets) return empty;
  const active = collectActiveOpps(records);
  if (active.length === 0) return empty;
  const targetIndex = buildCompanyIndex(collectCdmTargetNames(targetData, cdmName, targetCdmColumn));
  // Full list (any CDM) so we can report who each untied company IS tied
  // to, or that it isn't on the list at all.
  const lookup = collectTargetCdmLookup(targetData, targetCdmColumn);
  const groups = new Map(); // lowercased account → { account, opps[] }
  for (const o of active) {
    if (hasMatchInIndex(targetIndex, o.account)) continue; // tied to the CDM
    const k = o.account.toLowerCase();
    if (!groups.has(k)) groups.set(k, { account: o.account, opps: [] });
    groups.get(k).opps.push(o);
  }
  const list = [...groups.values()]
    .map(g => {
      // Resolve who this company is tied to on the target list.
      const matchedNames = [...findMatchesInIndex(lookup.index, g.account)];
      const onList = matchedNames.length > 0;
      const cdmSet = new Set();
      for (const nm of matchedNames) {
        for (const cdm of (lookup.cdmByName.get(String(nm).toLowerCase()) || [])) cdmSet.add(cdm);
      }
      const cdms = [...cdmSet].sort((a, b) => a.localeCompare(b));
      const owner = !onList
        ? 'Not on list'
        : cdms.length > 0 ? cdms.join(', ') : 'On list · no CDM';
      return {
        account: g.account,
        count: g.opps.length,
        stages: [...new Set(g.opps.map(o => o.stage).filter(Boolean))],
        opps: g.opps,
        onList,
        cdms,
        owner,
      };
    })
    // Only flag companies that are actually on the target list (tied to
    // another CDM, or on the list with no CDM) — companies missing from
    // the list entirely are intentionally ignored here.
    .filter(g => g.onList)
    .sort((a, b) => b.count - a.count || a.account.localeCompare(b.account));
  return {
    groups: list,
    totalOpps: list.reduce((n, g) => n + g.count, 0),
    totalCompanies: list.length,
  };
}
