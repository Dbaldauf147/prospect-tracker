// Reading a stored list of service names when service names contain commas.
//
// The Services tab stores its list-of-services cells — Dependent Rollout
// Services, Auto-add Services, Auto-N/A Services — as one comma-separated
// string ("GHG, Budgets"), and so does an opp's Scope. That is fine until a
// service is called "Cat 3, 5, 6, and 7 (part of GHG)". Splitting on every
// comma turns one pick into four fragments, none of which is a service:
// the cell shows a struck-through "Cat 3" and a "+3", and reopening the
// picker shows the service unticked, because the name it was saved under no
// longer exists anywhere in the list.
//
// So a list of service names is split against the names that exist. Tokens
// are rejoined where the join is itself a service — longest run first, so
// the whole "Cat 3, 5, 6, and 7 (part of GHG)" wins over a bare "Cat 3" — and
// a token that matches a service is handed back in that service's own
// spelling, which also fixes casing drift from a hand-typed cell.
//
// Storage doesn't change: the list is still written comma-separated, still
// readable in the Excel export and still findable by the search box. Only
// the reading is name-aware, which is what makes an already-saved cell
// (typed, pasted, or picked before this existed) start resolving correctly.
//
// With no list of known names to check against, this degrades to the plain
// comma split it replaces — the right answer when there is nothing to
// disambiguate with.

// Longest name to try rebuilding, in comma-separated pieces. A service name
// with eleven commas in it is a sentence, not a name, and the cap keeps the
// rejoining bounded however strange the vocabulary gets.
const MAX_SPAN = 12;

// The comparison form: pieces trimmed, rejoined the way the list is written,
// lowercased. Both sides go through it, so "cat 3,5,  6" and the catalog's
// "Cat 3, 5, 6" meet in the middle.
function normKey(text) {
  return String(text ?? '')
    .split(',')
    .map(s => s.trim())
    .join(', ')
    .toLowerCase();
}

// Built per list of known names and cached against the array itself, since
// the callers memoize theirs — one pass rather than one per row of a
// 167-service table.
const indexCache = new WeakMap();

function buildIndex(known) {
  if (Array.isArray(known) && indexCache.has(known)) return indexCache.get(known);
  const byKey = new Map();
  let maxSpan = 1;
  for (const name of known || []) {
    const clean = String(name ?? '').trim();
    if (!clean) continue;
    const key = normKey(clean);
    // First spelling wins, so a list with the same name twice resolves to
    // the one the board would show.
    if (!byKey.has(key)) byKey.set(key, clean);
    const span = Math.min(clean.split(',').length, MAX_SPAN);
    if (span > maxSpan) maxSpan = span;
  }
  const index = { byKey, maxSpan };
  if (Array.isArray(known)) indexCache.set(known, index);
  return index;
}

/**
 * Split a stored list of service names.
 *
 * @param value  the stored cell — a comma-separated string, or an array
 *               (some callers hold one already)
 * @param known  every service name that exists, for rejoining the ones with
 *               commas in them. Omit it for a plain comma split.
 * @returns      the names, in the order they were stored, spelled the way
 *               `known` spells them wherever they match
 */
export function splitServiceNames(value, known) {
  if (Array.isArray(value)) {
    return value.map(s => String(s ?? '').trim()).filter(Boolean);
  }
  const tokens = String(value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const { byKey, maxSpan } = buildIndex(known);
  if (byKey.size === 0) return tokens;

  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let taken = 0;
    // Longest first: a service whose name contains the next one's would
    // otherwise never be recognised.
    for (let span = Math.min(maxSpan, tokens.length - i); span >= 2; span -= 1) {
      const hit = byKey.get(normKey(tokens.slice(i, i + span).join(', ')));
      if (hit) { out.push(hit); taken = span; break; }
    }
    if (taken === 0) {
      out.push(byKey.get(normKey(tokens[i])) ?? tokens[i]);
      taken = 1;
    }
    i += taken;
  }
  return out;
}

/** The list back as it's stored. */
export function joinServiceNames(names) {
  return (names || []).map(n => String(n ?? '').trim()).filter(Boolean).join(', ');
}
