// The company popup's "Targets list" box: suggest which Target Accounts row
// a company is, let the user map it, and once mapped read that row's CDM,
// Tier and Vertical so the card can be checked against it.
//
// Suggestions are looser than the fuzzy matcher the tier/CDM resolvers use
// (companyIndex), on purpose: they are only offered, never applied, so a
// near miss like "Vibrantz Technology" / "Vibrantz Technologies" is worth
// showing. The mapping itself is the same settings.targetMap entry My
// Accounts writes, so every page that reads the mapping agrees.

import { normalizeCompanyName } from './companyKey.js';
import { resolveTargetAccountCdm, matchesCdm } from './cdmMatch.js';
import { resolveTargetAccountVertical, tierMismatch, targetRowCompany as rowCompany, targetRowTier as rowTier } from './targetTier.js';

/**
 * Every account on the Target Accounts list, once each (first row wins),
 * with what the popup shows for it: { name, cdm, tier, vertical }. Every
 * rep's rows, since the point is to see whose account it is.
 */
export function targetAccountRows(targetAccountsData, settings) {
  const data = targetAccountsData;
  const out = [];
  const seen = new Set();
  for (const sheetName of data?.sheetNames || []) {
    for (const r of data?.sheets?.[sheetName]?.records || []) {
      const name = rowCompany(r);
      const k = name.toLowerCase();
      if (!name || seen.has(k)) continue;
      seen.add(k);
      out.push({
        name,
        cdm: resolveTargetAccountCdm(r, settings?.targetCdmColumn),
        tier: rowTier(r),
        vertical: resolveTargetAccountVertical(r, settings?.targetVerticalColumn),
      });
    }
  }
  return out;
}

// "technologies" and "technology" are one word for this purpose.
const stem = (t) => (t.length > 4 && t.endsWith('ies') ? `${t.slice(0, -3)}y`
  : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const tokensOf = (s) => normalizeCompanyName(s).split(' ').filter(Boolean).map(stem);

// Edit distance, capped: stops counting once it is past `cap`. Two
// neighbouring letters swapped ("Virbantz" for "Vibrantz") is one edit, not
// two: it is the commonest typo there is, and counted as a delete plus an
// insert it used up an 8-letter word's whole allowance twice over.
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], before[j - 2] + 1);
      }
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Two words are the same word when equal, or one typo apart: a slip
// ("Techonology", "Virbantz") shouldn't hide the row it was meant to be. Short words
// must match exactly, or "Acme" would find "Acne".
export function sameWord(a, b) {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  const cap = len >= 9 ? 2 : len >= 5 ? 1 : 0;
  return cap > 0 && editDistance(a, b, cap) <= cap;
}

/** How alike two company names are, 0..1. The first word has to agree. */
export function nameSimilarity(a, b) {
  const ta = [...new Set(tokensOf(a))];
  const tb = [...new Set(tokensOf(b))];
  if (!ta.length || !tb.length || !sameWord(ta[0], tb[0])) return 0;
  // Pair words off one to one, so a word can't be counted twice.
  const free = [...tb];
  let both = 0;
  for (const t of ta) {
    const i = free.findIndex(u => sameWord(t, u));
    if (i >= 0) { both += 1; free.splice(i, 1); }
  }
  if (both === ta.length && both === tb.length) return 1;
  const jaccard = both / (ta.length + tb.length - both);
  // One name wholly inside the other ("Vibrantz" / "Vibrantz Technologies").
  const inside = both === Math.min(ta.length, tb.length) ? 0.75 : 0;
  return Math.max(jaccard, inside);
}

/** Up to `max` rows that look like `company`, best first. */
export function suggestTargetMatches(company, rows, { max = 3, min = 0.5 } = {}) {
  return (rows || [])
    .map(row => ({ row, score: nameSimilarity(company, row.name) }))
    .filter(x => x.score >= min)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, max)
    .map(x => ({ ...x.row, score: x.score }));
}

/** The names a company is mapped to, [] when unmapped or cleared. */
export function mappedTargetNames(settings, prospectId) {
  if (prospectId == null) return [];
  const raw = settings?.targetMap?.[prospectId];
  return (Array.isArray(raw) ? raw : (raw ? [raw] : [])).map(n => String(n || '').trim()).filter(Boolean);
}

/**
 * The mapped row against the card: which of CDM, Tier and Vertical
 * disagree. Each flag is null when they agree or the row says nothing,
 * else { row, card, apply } where `apply` is what to set the card to.
 * `verticalOptions` snaps the vertical to the Dropdowns spelling.
 */
export function targetRowFlags(row, card, verticalOptions = []) {
  if (!row) return { cdm: null, tier: null, vertical: null };
  const cdm = row.cdm && !matchesCdm(card?.cdm || '', row.cdm)
    ? { row: row.cdm, card: card?.cdm || '', apply: row.cdm }
    : null;
  const t = tierMismatch(card?.tier, { tier: row.tier });
  const tier = t ? { row: t.targetTier, card: t.cardTier, apply: t.apply } : null;
  const listed = (verticalOptions || []).find(o => String(o).trim().toLowerCase() === row.vertical.toLowerCase());
  const v = listed || row.vertical;
  const vertical = v && v.toLowerCase() !== String(card?.vertical || '').trim().toLowerCase()
    ? { row: v, card: card?.vertical || '', apply: v }
    : null;
  return { cdm, tier, vertical };
}
