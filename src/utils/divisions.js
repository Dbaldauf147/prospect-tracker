// Division mapping — which tracker companies are divisions (subsidiaries,
// operating brands, regional entities) of a parent company.
//
// Stored on user settings, keyed by the PARENT prospect's id:
//   settings.divisionsMap[parentId]  = [{ id, company }, …]   explicit picks
//   settings.divisionRules[parentId] = ['keyword', …]         auto-map rules
//
// A rule is a convenience, not a live filter: adding one immediately folds
// every company whose name contains the keyword into divisionsMap, and the
// rule sticks around so the mapping's intent stays visible (and so it can
// be re-applied against companies added later). Removing a rule leaves the
// divisions it already added in place — pulling them back out silently
// would undo picks the user may have curated since.
//
// Both the My Accounts "Divisions" column and the company popup's Divisions
// section write through these helpers, so the two can't drift.
//
// An entry's `id` is normally a prospect id, but the popup lets you type a
// division that has no record of its own — a brand or regional entity you
// track on paper and nowhere else. Those carry a `txt:` id derived from the
// name. Everything downstream reads `company`, not `id` (the My Accounts
// site rollup matches Master Site List rows by company name), so a typed
// division rolls up exactly like a linked one as long as the text matches.

const TEXT_ID_PREFIX = 'txt:';

export function isTextDivision(id) {
  return String(id || '').startsWith(TEXT_ID_PREFIX);
}

// Deterministic, so the same name always yields the same id: React keys stay
// stable across renders and a name can't end up mapped twice under two ids.
export function textDivisionId(name) {
  return TEXT_ID_PREFIX + String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function divisionsFor(settings, parentId) {
  if (!parentId) return [];
  return (settings?.divisionsMap || {})[parentId] || [];
}

export function divisionRulesFor(settings, parentId) {
  if (!parentId) return [];
  return (settings?.divisionRules || {})[parentId] || [];
}

// The division hierarchy under `rootId`, as nested
// { id, company, missing, children } nodes.
//
// A division is itself a company, so it can carry divisions of its own —
// walking divisionsMap recursively is what turns the flat parent → child
// pairs into the org chart the popup draws. `nameById` supplies each
// node's current name (the mapping stores a snapshot taken when it was
// added); a node whose id is absent from it is flagged `missing` and its
// stored name is used, so a deleted company shows up rather than
// silently pruning the branch under it.
//
// A company mapped under two parents appears under both, but a cycle
// (A → B → A) or a repeat within one branch stops at the repeat, so the
// walk always terminates. MAX_DEPTH is a second belt: nothing legitimate
// nests that far, and it keeps a pathological map from blowing the stack.
const MAX_DEPTH = 12;

export function buildDivisionTree(settings, rootId, rootName, nameById) {
  const map = settings?.divisionsMap || {};
  const names = nameById || new Map();

  function walk(id, storedName, ancestors, depth) {
    const live = names.get(id);
    const typed = isTextDivision(id);
    const node = {
      id,
      company: live || storedName || '',
      // A typed division has no record to go missing — it IS its text.
      // Only a link to a prospect that's gone counts as missing.
      missing: !typed && !live,
      children: [],
    };
    if (depth >= MAX_DEPTH) return node;
    for (const child of (map[id] || [])) {
      if (!child?.id || ancestors.has(child.id)) continue;
      node.children.push(walk(child.id, child.company, new Set([...ancestors, child.id]), depth + 1));
    }
    return node;
  }

  return walk(rootId, rootName, new Set([rootId]), 0);
}

// Companies whose name contains `keyword`, excluding the parent itself.
// Shared so the rule chip's "(n matches)" count and the rows a rule
// actually adds are always the same set.
export function companiesMatchingKeyword(companies, parentId, keyword) {
  const k = String(keyword || '').trim().toLowerCase();
  if (!k) return [];
  return (companies || []).filter(c =>
    c && c.id !== parentId && String(c.company || '').toLowerCase().includes(k));
}

// Each helper returns a settings patch to hand straight to updateSettings —
// no mutation of the settings object it was given.

export function addDivisionPatch(settings, parentId, child) {
  return addDivisionsPatch(settings, parentId, [child]);
}

// Bulk add. Callers adding several at once MUST use this rather than
// looping addDivisionPatch: every patch is computed from the settings
// object the caller already holds, so N separate calls each build on the
// same pre-add state and the last write wins — dropping all but one pick.
export function addDivisionsPatch(settings, parentId, children) {
  const map = { ...(settings?.divisionsMap || {}) };
  let list = map[parentId] || [];
  for (const child of children || []) {
    if (!child?.id) continue;
    if (list.find(d => d.id === child.id)) continue;
    list = [...list, { id: child.id, company: child.company }];
  }
  if (list.length) map[parentId] = list;
  return { divisionsMap: map };
}

// Add a division by typed name. When the text matches a tracker company
// exactly (case- and space-insensitively) the entry links to that record,
// which buys live renaming and lets that company's own divisions nest
// under it in the chart. Otherwise it's stored as free text. Either way
// the name is what downstream rollups read, so both behave the same there.
//
// Returns null when the name is blank or already mapped under this parent
// — the caller can leave the box's text alone so nothing looks lost.
export function addNamedDivisionPatch(settings, parentId, name, companies) {
  const typed = String(name || '').trim();
  if (!typed) return null;
  const key = typed.toLowerCase().replace(/\s+/g, ' ');

  const existing = (settings?.divisionsMap || {})[parentId] || [];
  if (existing.some(d => String(d.company || '').trim().toLowerCase().replace(/\s+/g, ' ') === key)) {
    return null;
  }

  const match = (companies || []).find(c =>
    c && c.id !== parentId
    && String(c.company || '').trim().toLowerCase().replace(/\s+/g, ' ') === key);

  const child = match
    ? { id: match.id, company: match.company }
    : { id: textDivisionId(typed), company: typed };
  return addDivisionsPatch(settings, parentId, [child]);
}

export function removeDivisionPatch(settings, parentId, childId) {
  const map = { ...(settings?.divisionsMap || {}) };
  const next = (map[parentId] || []).filter(d => d.id !== childId);
  if (next.length === 0) delete map[parentId];
  else map[parentId] = next;
  return { divisionsMap: map };
}

// Adds the rule AND every company that matches it right now, in one patch.
export function addDivisionRulePatch(settings, parentId, keyword, companies) {
  const word = String(keyword || '').trim();
  const rules = { ...(settings?.divisionRules || {}) };
  const existingRules = rules[parentId] || [];
  if (!word) return { divisionRules: rules, divisionsMap: { ...(settings?.divisionsMap || {}) } };
  if (!existingRules.includes(word)) rules[parentId] = [...existingRules, word];

  const { divisionsMap } = addDivisionsPatch(
    settings, parentId, companiesMatchingKeyword(companies, parentId, word));
  return { divisionRules: rules, divisionsMap };
}

export function removeDivisionRulePatch(settings, parentId, ruleIndex) {
  const rules = { ...(settings?.divisionRules || {}) };
  const existing = [...(rules[parentId] || [])];
  existing.splice(ruleIndex, 1);
  if (existing.length === 0) delete rules[parentId];
  else rules[parentId] = existing;
  return { divisionRules: rules };
}
