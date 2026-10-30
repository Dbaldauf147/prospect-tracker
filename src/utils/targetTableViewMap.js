// Which Table View companies are mapped to each Target Accounts row, for
// the Target Accounts List's "Table View" column and its "% mapped" count.
//
// A company is mapped the way My Accounts maps it: its settings.targetMap
// entry when it has one (an explicit empty array means the user cleared
// it, so it maps to nothing), else the same fuzzy name match My Accounts
// falls back to. The two are kept apart so the page can tell a mapping
// somebody made from one the matcher guessed.

import { buildCompanyIndex, findMatchesInIndex } from './companyIndex.js';

const key = (s) => String(s || '').toLowerCase().trim();

/**
 * Map of lowercased target name -> [{ id, company, auto }], one entry per
 * Table View company mapped to that name. `auto` is true when the link
 * came from the name matcher rather than a saved mapping.
 */
export function tableViewCompaniesByTarget(prospects, targetNames, targetMap) {
  const out = new Map();
  const names = [...new Set((targetNames || []).map(n => String(n || '').trim()).filter(Boolean))];
  if (names.length === 0) return out;
  const onList = new Set(names.map(key));
  const index = buildCompanyIndex(names);
  const add = (name, p, auto) => {
    const k = key(name);
    if (!onList.has(k)) return;
    const list = out.get(k) || [];
    if (list.some(x => x.id === p.id)) return;
    list.push({ id: p.id, company: p.company, auto });
    out.set(k, list);
  };
  for (const p of prospects || []) {
    if (!p || !String(p.company || '').trim()) continue;
    const raw = targetMap?.[p.id];
    if (raw !== undefined) {
      for (const n of (Array.isArray(raw) ? raw : (raw ? [raw] : []))) add(n, p, false);
      continue;
    }
    for (const n of findMatchesInIndex(index, p.company)) add(n, p, true);
  }
  for (const list of out.values()) list.sort((a, b) => String(a.company).localeCompare(String(b.company)));
  return out;
}

/**
 * How many of the named target rows have at least one Table View company,
 * counting each distinct name once: { mapped, manual, total, pct }.
 * `manual` is the share of `mapped` with at least one saved mapping.
 */
export function tableViewMappingCoverage(targetNames, byTarget) {
  const names = new Set((targetNames || []).map(key).filter(Boolean));
  let mapped = 0;
  let manual = 0;
  for (const n of names) {
    const list = byTarget?.get(n);
    if (!list || list.length === 0) continue;
    mapped += 1;
    if (list.some(x => !x.auto)) manual += 1;
  }
  const total = names.size;
  return { mapped, manual, total, pct: total ? Math.round((mapped / total) * 100) : 0 };
}
