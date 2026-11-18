// My Accounts > Name Matcher: a pasted list of company names, each lined up
// with the Table company it most likely is, so its CDM and Tier can be read
// off without looking every name up by hand.
//
// A name matches in one of two ways, best first:
//   - exactly: normalizeCompany (case, punctuation and Inc / LLC / Group
//     ignored) equals the company's name or one it also goes by (Goes By,
//     Also Known As, HubSpot / BFO / Zoom company names);
//   - nearly: the HubSpot Mapping tab's own name likeness (nameSimilarity),
//     at least SUGGEST_MIN_SCORE, the best few offered.

import { normalizeCompany } from './companyNorm.js';
import { prepareCompanyName, preparedNameSimilarity, SUGGEST_MIN_SCORE, splitNameList } from './hubspotMapping.js';

/**
 * The names out of a paste, one per line, in the order pasted. A line copied
 * from a spreadsheet keeps its first non-blank cell; blank lines and repeats
 * (same normalized name) drop out.
 */
export function parsePastedNames(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const cell = line.split('\t').map(c => c.trim().replace(/^"(.*)"$/, '$1').trim()).find(Boolean);
    if (!cell) continue;
    const key = normalizeCompany(cell) || cell.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

// Every name a company answers to, the first being its own.
function companyNames(p) {
  return [
    p.company, p.goesBy,
    ...(Array.isArray(p.aliases) ? p.aliases : splitNameList(p.aliases)),
    ...splitNameList(p.hubspotCompanyNames),
    p.bfoCompanyName, p.zoomCompanyName,
  ].map(n => String(n || '').trim()).filter(Boolean);
}

/**
 * Build once per prospect list; returns name => { exact, suggestions } where
 * suggestions is [{ prospect, score, via }] best first (score 100 and via
 * 'exact' / 'alias' for an exact hit, via 'similar' otherwise).
 */
export function makePasteMatcher(prospects, { limit = 3 } = {}) {
  const pool = [];
  const byNorm = new Map();
  for (const p of prospects || []) {
    const names = companyNames(p);
    if (!names.length) continue;
    names.forEach((n, i) => {
      const k = normalizeCompany(n);
      if (!k) return;
      const list = byNorm.get(k) || [];
      if (!list.some(e => e.prospect === p)) list.push({ prospect: p, via: i === 0 ? 'exact' : 'alias' });
      byNorm.set(k, list);
    });
    pool.push({ prospect: p, prepared: [...new Set(names.map(normalizeCompany).filter(Boolean))].map(prepareCompanyName) });
  }

  return (name) => {
    const key = normalizeCompany(name);
    if (!key) return { exact: false, suggestions: [] };
    const hits = byNorm.get(key);
    if (hits && hits.length) {
      // Own-name hits ahead of alias hits.
      const sorted = [...hits].sort((a, b) => (a.via === 'exact' ? 0 : 1) - (b.via === 'exact' ? 0 : 1));
      return { exact: true, suggestions: sorted.slice(0, limit).map(h => ({ ...h, score: 100 })) };
    }
    const q = prepareCompanyName(name);
    const scored = [];
    for (const item of pool) {
      let score = 0;
      for (const m of item.prepared) score = Math.max(score, preparedNameSimilarity(q, m));
      if (score >= SUGGEST_MIN_SCORE) scored.push({ prospect: item.prospect, score, via: 'similar' });
    }
    scored.sort((a, b) => b.score - a.score || String(a.prospect.company).localeCompare(String(b.prospect.company)));
    return { exact: false, suggestions: scored.slice(0, limit) };
  };
}
