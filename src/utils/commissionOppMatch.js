// Which Opps row a Commissions row is for, suggested from names.
//
// A commission row arrives from the finance export with a Project Name
// ("Griffis Properties_DBB-04192022 Am 5_SUSUP") and nothing else that ties
// it to an opp. The opp's BFO Opportunity Name (its "BFO Link") is usually
// the same string, or close to it: an amendment number dropped, a suffix
// trimmed, an underscore where the other has a space. So the suggestion is
// a name comparison, Project Name against BFO Link, and picking one fills
// the row's Account Name and BFO Name from that opp (Scope then follows
// from the BFO Name, as it always has).
//
// Pure, so scripts/commissionOppMatch.test.mjs runs it without a browser.

const BFO_LINK = 'BFO Link';

// What the comparison reads off a commission row: its Project Name, or the
// Name column for a row pasted without one.
export function commissionProjectName(row) {
  return String(row?.['Project Name'] ?? row?.['Name'] ?? '').trim();
}

function tokensOf(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean);
}
const squash = (s) => tokensOf(s).join('');

// Placeholder BFO Links the Opps sheet carries for an opp that has none.
function isRealBfoLink(name) {
  const n = String(name || '').trim();
  return !!n && n !== '-' && !n.toUpperCase().startsWith('#N/A');
}

// The opps worth suggesting, one per BFO Link (first record wins, as
// findOppByBfoLink does), with their names pre-tokenized. Build once per
// Opps cache and reuse across rows.
export function buildOppIndex(records) {
  const out = [];
  const seen = new Set();
  for (const opp of (records || [])) {
    const name = String(opp?.[BFO_LINK] ?? '').trim();
    if (!isRealBfoLink(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tokens = tokensOf(name);
    out.push({ opp, name, tokens: new Set(tokens), squashed: tokens.join('') });
  }
  return { entries: out, cache: new Map() };
}

// 0..1. The same name (ignoring case, spacing and punctuation) is 1; one
// name wholly inside the other is 0.9; otherwise the share of words the two
// have in common (Dice coefficient), so "Prologis_SoW#7 Am 1" and
// "Prologis_SoW#7 Am 2" score high and two different Prologis deals lower.
function scoreAgainst(projTokens, projSquashed, entry) {
  if (!projSquashed || !entry.squashed) return 0;
  if (projSquashed === entry.squashed) return 1;
  const shorter = projSquashed.length <= entry.squashed.length ? projSquashed : entry.squashed;
  const longer = shorter === projSquashed ? entry.squashed : projSquashed;
  if (shorter.length >= 8 && longer.includes(shorter)) return 0.9;
  let shared = 0;
  for (const t of projTokens) if (entry.tokens.has(t)) shared += 1;
  const total = projTokens.size + entry.tokens.size;
  return total ? (2 * shared) / total : 0;
}

export function scoreProjectAgainstBfo(projectName, bfoLink) {
  const tokens = tokensOf(bfoLink);
  return scoreAgainst(new Set(tokensOf(projectName)), squash(projectName),
    { tokens: new Set(tokens), squashed: tokens.join('') });
}

// The best-matching opps for a project name, best first:
// [{ opp, name, score }]. `minScore` keeps unrelated opps out of the list.
export function suggestOpps(index, projectName, { limit = 8, minScore = 0.35 } = {}) {
  if (!index?.entries?.length) return [];
  const key = `${squash(projectName)}|${limit}|${minScore}`;
  if (index.cache.has(key)) return index.cache.get(key);
  const projTokens = new Set(tokensOf(projectName));
  const projSquashed = squash(projectName);
  const scored = [];
  for (const e of index.entries) {
    const score = scoreAgainst(projTokens, projSquashed, e);
    if (score >= minScore) scored.push({ opp: e.opp, name: e.name, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const out = scored.slice(0, limit);
  index.cache.set(key, out);
  return out;
}

// The picker's search box: every opp whose Account, BFO Link, Scope or
// Stage contains the typed text, ranked by how well its name matches the
// row's project, then by name.
export function searchOppIndex(index, term, projectName, { limit = 25 } = {}) {
  const t = String(term || '').trim().toLowerCase();
  if (!t) return suggestOpps(index, projectName, { limit, minScore: 0.35 });
  const projTokens = new Set(tokensOf(projectName));
  const projSquashed = squash(projectName);
  const hits = [];
  for (const e of (index?.entries || [])) {
    const hay = ['Account', BFO_LINK, 'Scope', 'Stage'].map(k => String(e.opp?.[k] || '').toLowerCase());
    if (!hay.some(v => v.includes(t))) continue;
    hits.push({ opp: e.opp, name: e.name, score: scoreAgainst(projTokens, projSquashed, e) });
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

// What picking an opp writes onto the commission row: its Account and its
// BFO Opportunity Name. Scope isn't stored: the Scope column reads it live
// off the opp the BFO Name points at, so it stays right when the opp's
// Scope is edited later.
export function fieldsFromOpp(opp) {
  return {
    'Account Name': String(opp?.Account || '').trim(),
    'BFO Name': String(opp?.[BFO_LINK] || '').trim(),
  };
}
