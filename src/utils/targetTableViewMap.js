// Which Table View companies are mapped to each Target Accounts row, for
// the Target Accounts List's "Table View" column and its "% mapped" count.
//
// A company is mapped the way My Accounts maps it: its settings.targetMap
// entry when it has one (an explicit empty array means the user cleared
// it, so it maps to nothing), else the same fuzzy name match My Accounts
// falls back to. The two are kept apart so the page can tell a mapping
// somebody made from one the matcher guessed.

import { buildCompanyIndex, findMatchesInIndex } from './companyIndex.js';
import { nameSimilarity, targetAcceptPatch } from './targetAccountMatch.js';

const key = (s) => String(s || '').toLowerCase().trim();

/**
 * Map of lowercased target name -> [{ id, company, auto, score }], one
 * entry per Table View company mapped to that name. `auto` is true when
 * the link came from the name matcher rather than a saved mapping, and
 * `score` is then how alike the two names are, 0..100 (nameSimilarity,
 * the score the Hubspot Mapping suggestions rank by); null on a saved one.
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
    const score = auto ? Math.round(nameSimilarity(p.company, name) * 100) : null;
    list.push({ id: p.id, company: p.company, auto, score });
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
  // Saved mappings first, then suggestions best match first.
  for (const list of out.values()) {
    list.sort((a, b) => (a.auto - b.auto) || ((b.score ?? 0) - (a.score ?? 0)) || String(a.company).localeCompare(String(b.company)));
  }
  return out;
}

/** The best suggestion's score on a row, null when it has none. */
export function bestSuggestionScore(list) {
  let best = null;
  for (const x of list || []) if (x.auto && (best == null || x.score > best)) best = x.score;
  return best;
}

/** The Match % column's filter buckets. */
export function matchScoreBucket(score) {
  if (score == null) return 'No suggestion';
  if (score >= 100) return '100%';
  if (score >= 90) return '90-99%';
  if (score >= 75) return '75-89%';
  if (score >= 50) return '50-74%';
  return 'Under 50%';
}

/**
 * What mapping a set of suggestions writes. `pairs` is [{ target, entry }]:
 * a target row's name and one of its suggested companies. A company
 * suggested for two rows maps to the closer name only (ties: the first
 * given), and a company with a saved mapping is left alone. Each plan
 * carries the CDM / Tier / Vertical patch accepting it sets on the
 * company (targetAcceptPatch, as the Hubspot Mapping Accept does).
 *
 * rowsByName: Map(lowercased name -> targetAccountRows row).
 * Returns [{ id, company, target, score, patch }].
 */
export function planSuggestionAccepts(pairs, { prospectsById, rowsByName, targetMap, verticalOptions = [], canonicalCdm } = {}) {
  const best = new Map();
  for (const { target, entry } of pairs || []) {
    if (!entry?.auto || entry.id == null) continue;
    if (targetMap && Object.prototype.hasOwnProperty.call(targetMap, entry.id)) continue;
    const row = rowsByName?.get(key(target));
    if (!row) continue;
    const had = best.get(entry.id);
    if (had && had.score >= entry.score) continue;
    best.set(entry.id, { id: entry.id, company: entry.company, target: row.name, score: entry.score, row });
  }
  return [...best.values()].map(({ row, ...pl }) => {
    const card = prospectsById?.get(pl.id) || { company: pl.company };
    return { ...pl, patch: targetAcceptPatch(row, card, { verticalOptions, canonicalCdm }) };
  });
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
