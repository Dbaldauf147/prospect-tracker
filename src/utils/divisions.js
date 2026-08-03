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

export function divisionsFor(settings, parentId) {
  if (!parentId) return [];
  return (settings?.divisionsMap || {})[parentId] || [];
}

export function divisionRulesFor(settings, parentId) {
  if (!parentId) return [];
  return (settings?.divisionRules || {})[parentId] || [];
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
