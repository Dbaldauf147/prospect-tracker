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
import { renameTargetVertical, resolveTargetAccountVertical, tierMismatch, targetRowCompany as rowCompany, targetRowTier as rowTier, targetTierColumns } from './targetTier.js';

/**
 * Every account on the Target Accounts list, once each, with what the
 * popup shows for it: { name, cdm, tier, vertical, sheet }. Every rep's
 * rows, since the point is to see whose account it is.
 *
 * An account on more than one row (two sheets, or listed twice on one)
 * shows its first TIERED row, else its first row, filling in a CDM or
 * vertical that row is missing from the account's other rows. It used to be the first
 * row outright, so an untiered duplicate ahead of the Tier 3 row made the
 * box read "none" and ask to move the card to Not on tier list, while the
 * Targets page row said Tier 3.
 */
export function targetAccountRows(targetAccountsData, settings) {
  const data = targetAccountsData;
  const out = [];
  const at = new Map();
  for (const sheetName of data?.sheetNames || []) {
    const sheet = data?.sheets?.[sheetName];
    const tierCols = targetTierColumns(sheet?.headers?.length ? sheet.headers : Object.keys(sheet?.records?.[0] || {}));
    for (const r of sheet?.records || []) {
      const name = rowCompany(r);
      if (!name) continue;
      const k = name.toLowerCase();
      const tier = rowTier(r, tierCols);
      const row = {
        name,
        cdm: resolveTargetAccountCdm(r, settings?.targetCdmColumn),
        tier,
        vertical: renameTargetVertical(resolveTargetAccountVertical(r, settings?.targetVerticalColumn), settings),
        sheet: sheetName,
      };
      if (!at.has(k)) { at.set(k, out.length); out.push(row); continue; }
      // The tiered row wins, but whichever row it is keeps a CDM or vertical
      // only the other row had: an account tiered on one sheet and owned on
      // another read "CDM none" in the popup while the list named its CDM.
      const kept = out[at.get(k)];
      const win = !kept.tier && tier ? row : kept;
      const lose = win === row ? kept : row;
      out[at.get(k)] = { ...win, cdm: win.cdm || lose.cdm, vertical: win.vertical || lose.vertical };
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

/** A name's words as nameSimilarity compares them; for a caller that compares one name against many. */
export function similarityTokens(s) {
  return [...new Set(tokensOf(s))];
}

/** How alike two company names are, 0..1. The first word has to agree. */
export function nameSimilarity(a, b) {
  return tokenSimilarity(similarityTokens(a), similarityTokens(b));
}

/** nameSimilarity over names already split by similarityTokens. */
export function tokenSimilarity(ta, tb) {
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

/**
 * The Hubspot Mapping subtab's Targets list helper: for every account that
 * isn't mapped to a Targets list row, the best-looking row (suggestTargetMatches'
 * rules) that no other account is mapped to. Returns Map(accountId -> row
 * with score).
 *
 * Left out: an account with a mapping, set or cleared on purpose
 * (settings.targetMap has its id, even as []), or one the name match already
 * ties to a row (`targetNames` on the My Accounts row); a suggestion the card's
 * Ignore hid (settings.ignoredTargetSuggestions); and rows without a record
 * behind them (the Opps-only ones). Two accounts after the same row: the
 * closer name keeps it and the other gets nothing.
 */
export function targetSuggestionsForAccounts(accounts, rows, settings, { min = 0.5 } = {}) {
  const out = new Map();
  if (!rows?.length) return out;
  const targetMap = settings?.targetMap || {};
  const ignored = settings?.ignoredTargetSuggestions || {};
  const taken = new Set();
  for (const names of Object.values(targetMap)) {
    for (const n of (Array.isArray(names) ? names : [names])) if (n) taken.add(String(n).trim().toLowerCase());
  }
  for (const a of accounts || []) for (const n of a?.targetNames || []) if (n) taken.add(String(n).trim().toLowerCase());
  const pool = rows
    .filter(r => r?.name && !taken.has(r.name.toLowerCase()))
    .map(r => ({ row: r, tokens: similarityTokens(r.name) }));
  const best = [];
  for (const a of accounts || []) {
    const id = a?.id;
    if (id == null || String(id).startsWith('opps-only:')) continue;
    if (Object.prototype.hasOwnProperty.call(targetMap, id)) continue;
    if ((a.targetNames || []).length) continue;
    const mine = similarityTokens(a.company);
    if (!mine.length) continue;
    const skip = ignored[id] || {};
    let hit = null;
    for (const p of pool) {
      const score = tokenSimilarity(mine, p.tokens);
      if (score < min || skip[p.row.name.toLowerCase()]) continue;
      if (!hit || score > hit.score || (score === hit.score && p.row.name.localeCompare(hit.row.name) < 0)) hit = { row: p.row, score };
    }
    if (hit) best.push({ id, ...hit });
  }
  best.sort((x, y) => y.score - x.score);
  const claimed = new Set();
  for (const b of best) {
    const k = b.row.name.toLowerCase();
    if (claimed.has(k)) continue;
    claimed.add(k);
    out.set(b.id, { ...b.row, score: b.score });
  }
  return out;
}

/**
 * What accepting a Targets list row writes on the company: the row's CDM,
 * Tier and Vertical wherever the card disagrees (targetRowFlags, the same
 * fixes the card's Targets list box offers). A row with no tier or no
 * vertical leaves that field alone rather than blanking it. The CDM is
 * spelled the way the CDM dropdown spells that person (canonicalCdm).
 */
export function targetAcceptPatch(row, card, { verticalOptions = [], canonicalCdm = (n) => n } = {}) {
  const flags = targetRowFlags(row, card, verticalOptions);
  const patch = {};
  if (flags.cdm) patch.cdm = canonicalCdm(flags.cdm.apply) || flags.cdm.apply;
  if (flags.tier && row?.tier) patch.tier = flags.tier.apply;
  if (flags.vertical) patch.vertical = flags.vertical.apply;
  return patch;
}
