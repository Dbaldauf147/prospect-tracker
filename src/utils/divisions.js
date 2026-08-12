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

// Derived from the name at creation time, so the same name always yields
// the same id: React keys stay stable across renders and a name can't end
// up mapped twice under two ids. A later rename keeps the id it was given
// — anything nested under it is keyed by that id.
export function textDivisionId(name) {
  return TEXT_ID_PREFIX + nameKey(name);
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

// ── Parent company ──────────────────────────────────────────────────
// The box ABOVE the company in its own chart: who this company rolls up
// into. There's no second mapping for it — a parent is just the same
// edge read the other way round, so setting "Acme Holdings" as the parent
// of Acme East writes divisionsMap['…holdings'] = [{ Acme East }]. That
// keeps one source of truth: the parent's own popup and its My Accounts
// Divisions cell show Acme East as a division from the same moment, which
// is what a parent means.
//
// A parent that isn't a tracker company is typed, exactly like a typed
// division, and carries a `txt:` id. Its display name has nowhere to live
// on the edge itself (the owner side of divisionsMap is a bare key), so
// typed names are kept in:
//   settings.divisionNames[boxId] = 'Acme Holdings'
// — consulted only when nothing better is available, since a linked
// parent's live company name always wins.

export function divisionNameFor(settings, boxId) {
  return (settings?.divisionNames || {})[boxId] || '';
}

// Every company `childId` currently sits under. Normally one; the mapping
// allows more (a keyword rule can fold the same company under two
// parents), and the chart draws all of them rather than quietly picking
// one — a hidden second parent is a mapping the user can't find to undo.
export function divisionParentsFor(settings, childId, nameById) {
  if (!childId) return [];
  const map = settings?.divisionsMap || {};
  const names = nameById || new Map();
  const out = [];
  for (const [ownerId, list] of Object.entries(map)) {
    if (ownerId === childId) continue;
    if (!(list || []).some(d => d?.id === childId)) continue;
    const live = names.get(ownerId);
    out.push({
      id: ownerId,
      company: live || divisionNameFor(settings, ownerId) || ownerId,
      // Same rule as a division box: only a dead link to a prospect is
      // "missing" — a typed parent IS its text.
      missing: !isTextDivision(ownerId) && !live,
    });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}

// Is `candidateId` somewhere under `rootId`? Guards the one edit that can
// tie the mapping in a knot: making a company its own ancestor. The chart
// walk already refuses to loop, so a cycle wouldn't hang the page — it
// would just draw the same company above and below itself, which reads as
// a bug in the data nobody can explain.
export function isDivisionDescendant(settings, rootId, candidateId) {
  const map = settings?.divisionsMap || {};
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    for (const child of (map[id] || [])) {
      if (!child?.id || seen.has(child.id)) continue;
      if (child.id === candidateId) return true;
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  return false;
}

// Point `childId` at a parent named `name`, detaching it from `fromParentId`
// first when one was given (that's what a rename of the parent box is: the
// same company moving to a different parent).
//
// Returns null when the name is blank, names the company itself, names a
// company already below it, or names the parent it's already under — in
// each case the caller leaves the editor open rather than appearing to
// accept an edit it dropped.
export function setDivisionParentPatch(settings, childId, childCompany, name, companies, fromParentId) {
  const typed = String(name || '').trim();
  if (!childId || !typed) return null;
  const key = nameKey(typed);
  if (key === nameKey(childCompany)) return null;

  const match = (companies || []).find(c =>
    c && c.id !== childId && nameKey(c.company) === key);
  const parentId = match ? match.id : textDivisionId(typed);
  if (parentId === childId) return null;
  if (isDivisionDescendant(settings, childId, parentId)) return null;
  if (parentId === fromParentId) return null;
  if (((settings?.divisionsMap || {})[parentId] || []).some(d => d.id === childId)) return null;

  const detached = fromParentId
    ? removeDivisionPatch(settings, fromParentId, childId)
    : { divisionsMap: { ...(settings?.divisionsMap || {}) } };
  const map = { ...detached.divisionsMap };
  map[parentId] = [...(map[parentId] || []), { id: childId, company: childCompany }];

  const patch = { divisionsMap: map };
  // Only a typed parent needs its name remembered; a linked one reads its
  // company's live name, which stays right through a rename over there.
  if (!match) {
    patch.divisionNames = { ...(settings?.divisionNames || {}), [parentId]: typed };
  }
  return patch;
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
  const key = nameKey(typed);

  const existing = (settings?.divisionsMap || {})[parentId] || [];
  if (existing.some(d => nameKey(d.company) === key)) return null;

  const match = (companies || []).find(c =>
    c && c.id !== parentId && nameKey(c.company) === key);

  const child = match
    ? { id: match.id, company: match.company }
    : { id: textDivisionId(typed), company: typed };
  return addDivisionsPatch(settings, parentId, [child]);
}

// Comparison key for a division name — the one place case and spacing are
// normalized, so the add guard, the rename guard and the id derivation
// can't disagree about whether two names are the same.
export function nameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Rename one entry in `ownerId`'s list, in place.
//
// A typed entry just takes the new name; its id stays put so anything
// nested under it keeps its parent. A LINKED entry is a pointer at a
// company record, and renaming a division here must not rename that
// company — so it detaches into a typed entry carrying the new name, and
// whatever hung under it in the chart is carried across to the new id so
// the branch doesn't vanish mid-edit. The company keeps its own divisions.
//
// Returns null when the name is blank, unchanged, or would collide with a
// sibling, so the caller can leave the editor open rather than appearing
// to accept an edit it dropped.
export function renameDivisionPatch(settings, ownerId, childId, newName) {
  const name = String(newName || '').trim();
  if (!name) return null;
  const map = { ...(settings?.divisionsMap || {}) };
  const list = map[ownerId] || [];
  const idx = list.findIndex(d => d.id === childId);
  if (idx < 0) return null;

  const key = nameKey(name);
  if (list.some((d, i) => i !== idx && nameKey(d.company) === key)) return null;
  if (isTextDivision(childId) && nameKey(list[idx].company) === key) return null;

  const next = list.slice();
  if (isTextDivision(childId)) {
    next[idx] = { ...next[idx], company: name };
    map[ownerId] = next;
    return { divisionsMap: map };
  }

  const newId = textDivisionId(name);
  next[idx] = { id: newId, company: name };
  map[ownerId] = next;
  const carried = map[childId];
  // Don't clobber a same-named typed division that already has children.
  if (carried?.length && !map[newId]) map[newId] = carried.map(c => ({ ...c }));
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

// ── Division contacts ───────────────────────────────────────────────
// Who covers a division, stored beside the mapping:
//   settings.divisionContacts[divisionId] = [{ id, name, jobtitle, email }, …]
//
// Keyed by the DIVISION's id — the same id the chart nests children
// under — so a contact assigned to a division stays with it wherever it
// sits, and a typed division can carry contacts just as a linked one can.
// The name is stored alongside the id so a contact that later drops out
// of the company's contact list still shows who was on it.

export function divisionContactsFor(settings, divisionId) {
  if (!divisionId) return [];
  return (settings?.divisionContacts || {})[divisionId] || [];
}

// `contact` is { id, name, jobtitle, email } — already flattened by the
// caller, since contacts arrive in a few shapes (HubSpot vid vs id).
// Returns null when the contact is blank or already on this division, so
// the caller can leave its picker open rather than appearing to accept it.
export function addDivisionContactPatch(settings, divisionId, contact) {
  const id = String(contact?.id || '').trim();
  const name = String(contact?.name || '').trim();
  if (!divisionId || (!id && !name)) return null;
  const map = { ...(settings?.divisionContacts || {}) };
  const list = map[divisionId] || [];
  const key = id || nameKey(name);
  if (list.some(c => (String(c.id || '') || nameKey(c.name)) === key)) return null;
  map[divisionId] = [...list, {
    id,
    name,
    jobtitle: String(contact?.jobtitle || ''),
    email: String(contact?.email || ''),
  }];
  return { divisionContacts: map };
}

export function removeDivisionContactPatch(settings, divisionId, contactKey) {
  const map = { ...(settings?.divisionContacts || {}) };
  const next = (map[divisionId] || []).filter(c =>
    (String(c.id || '') || nameKey(c.name)) !== contactKey);
  if (next.length === 0) delete map[divisionId];
  else map[divisionId] = next;
  return { divisionContacts: map };
}

// Stable key for a stored contact — id when it has one, name otherwise,
// so a typed-in name can still be removed.
export function divisionContactKey(c) {
  return String(c?.id || '') || nameKey(c?.name);
}

// Bucket a division's contacts by the Team Name on their contact record
// (settings.contactTeamNames, resolved by the caller through `teamOf` —
// this file doesn't know how a contact id maps to a team).
//
// Teams come out in the order they first appear in the list, so the chart
// keeps the order the contacts were assigned in rather than re-sorting
// people out from under whoever added them. Anyone with no team lands in
// a single trailing bucket whose `team` is '' — the caller labels that
// however it likes, and when nobody on the box has a team the result is
// exactly one bucket, which is the ungrouped list it always drew.
export function groupDivisionContactsByTeam(contacts, teamOf) {
  const buckets = new Map();
  const untagged = [];
  for (const c of contacts || []) {
    const team = String((teamOf ? teamOf(c) : '') || '').trim();
    if (!team) { untagged.push(c); continue; }
    // Keyed on the normalized name so "FP&A" and "fp&a" are one team; the
    // label shown is the first spelling seen.
    const key = nameKey(team);
    const bucket = buckets.get(key);
    if (bucket) bucket.contacts.push(c);
    else buckets.set(key, { team, contacts: [c] });
  }
  const out = [...buckets.values()];
  if (untagged.length) out.push({ team: '', contacts: untagged });
  return out;
}

// Carry a division's contacts across when a linked entry is renamed into
// a typed one, so the people on it don't fall off with the id change.
export function moveDivisionContactsPatch(settings, fromId, toId) {
  const map = settings?.divisionContacts || {};
  const list = map[fromId];
  if (!fromId || !toId || fromId === toId || !list?.length || map[toId]) return null;
  return { divisionContacts: { ...map, [toId]: list.map(c => ({ ...c })) } };
}

// ── Reporting lines ─────────────────────────────────────────────────
// Who reports to whom among the people on one box, read off
// settings.contactReportsTo — the same mapping the contact editor's
// "Reports To" picker writes and the By Category org chart draws. Nothing
// new is stored here: the chart only renders what's already mapped at the
// contact level, so a division box and the org chart can't disagree.
//
// A line is only drawn INSIDE a box: a person whose manager is also on
// that box nests under them. A manager on a different box (or not on the
// chart at all) has no line to draw from here, so that person stays at
// the top level and carries the manager's NAME instead — every mapped
// relationship shows up somewhere rather than the cross-box ones
// silently vanishing.
//
// Returns [{ contact, managerNames, children }]:
//   contact      the stored { id, name, jobtitle, email } entry
//   managerNames managers NOT drawn as the node's parent, by name
//   children     the people on this box who report to them
//
// `nameById` resolves a manager id to a display name when that manager
// isn't on this box (their name is stored on whatever box they sit on,
// or comes from the company's contact list).
export function buildDivisionContactTree(assigned, reportsTo, nameById) {
  const list = (assigned || []).filter(Boolean);
  const names = nameById || new Map();
  const map = reportsTo || {};

  // Only a contact with a real id can take part: reportsTo is keyed by
  // HubSpot id, and a division entry typed as bare text has none.
  const byId = new Map();
  for (const c of list) {
    const id = String(c.id || '');
    if (id && !byId.has(id)) byId.set(id, c);
  }

  const managersOf = (c) => {
    const id = String(c?.id || '');
    if (!id) return [];
    const raw = map[id];
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return arr.map(String).filter(m => m && m !== id);
  };

  // The manager to nest under: the first one who's also on this box,
  // unless following the chain up from them leads back to the person we
  // started from. A mapping that has two people managing each other
  // would otherwise leave both of them off the chart entirely.
  const parentIdOf = (c) => {
    const selfId = String(c?.id || '');
    if (!selfId) return '';
    for (const mgrId of managersOf(c)) {
      if (!byId.has(mgrId)) continue;
      let cursor = mgrId;
      let looped = false;
      for (let hops = 0; cursor && hops <= list.length; hops++) {
        if (cursor === selfId) { looped = true; break; }
        cursor = managersOf(byId.get(cursor)).find(m => byId.has(m));
      }
      if (!looped) return mgrId;
    }
    return '';
  };

  const parentOf = new Map();
  const childrenBy = new Map();
  const roots = [];
  for (const c of list) {
    const pid = parentIdOf(c);
    parentOf.set(c, pid);
    if (!pid) { roots.push(c); continue; }
    if (!childrenBy.has(pid)) childrenBy.set(pid, []);
    childrenBy.get(pid).push(c);
  }

  // A contact mapped onto the same box twice would otherwise render
  // twice; the first placement wins, as it does in the box's own list.
  const placed = new Set();
  function node(c) {
    const id = String(c.id || '');
    if (id) placed.add(id);
    const pid = parentOf.get(c);
    return {
      contact: c,
      managerNames: managersOf(c)
        .filter(m => m !== pid)
        .map(m => byId.get(m)?.name || names.get(m) || '')
        .filter(Boolean),
      children: (childrenBy.get(id) || [])
        .filter(k => !placed.has(String(k.id || '')))
        .map(node),
    };
  }
  return roots.map(node);
}

// ── Layout ──────────────────────────────────────────────────────────
// How a box's children are arranged: 'row' fans them out horizontally
// under a bus, 'column' stacks them vertically off a spine. Stored per
// box in settings.divisionLayout so one branch can run across the page
// while another runs down it.
//
// The defaults reproduce the original chart — the company's own
// divisions fan out, everything deeper stacks — so a chart drawn before
// this existed looks the same until someone flips a box.

export function divisionLayoutFor(settings, boxId, fallback = 'column') {
  const v = (settings?.divisionLayout || {})[boxId];
  return (v === 'row' || v === 'column') ? v : fallback;
}

export function setDivisionLayoutPatch(settings, boxId, layout) {
  if (!boxId || (layout !== 'row' && layout !== 'column')) return null;
  return { divisionLayout: { ...(settings?.divisionLayout || {}), [boxId]: layout } };
}
