// Opps whose Scope (the services on the deal) names a service the Dropdowns
// tab's services list doesn't have. Feeds the Issues page's "Service not in
// Dropdowns" row; see detectOppScopeOffList in clientIssues.
import { splitServiceNames, joinServiceNames } from './serviceNameList.js';

// What an empty Scope cell is written as, not a service.
const SCOPE_PLACEHOLDERS = new Set(['-', '#n/a', 'n/a']);

// records        the Opps records ({ Scope, ... })
// knownServices  every service name the Dropdowns tab has; with none (not
//                loaded yet, or the list hidden) nothing is returned
// ignored        names the user chose to stop flagging (Fix popup's
//                Ignore), on any opp; matched case-insensitively
// Returns [{ record, off }] for each opp with at least one unmatched name,
// `off` the unmatched names as written, deduped case-insensitively.
export function oppScopeOffList(records, knownServices, ignored = null) {
  if (!Array.isArray(knownServices) || knownServices.length === 0) return [];
  const known = new Set(
    [...knownServices, ...(Array.isArray(ignored) ? ignored : [])]
      .map(s => String(s ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const out = [];
  for (const record of records || []) {
    const off = [];
    for (const name of splitServiceNames(record?.Scope, knownServices)) {
      const k = name.trim().toLowerCase();
      if (!k || SCOPE_PLACEHOLDERS.has(k) || known.has(k)) continue;
      if (!off.some(x => x.toLowerCase() === k)) off.push(name.trim());
    }
    if (off.length > 0) out.push({ record, off });
  }
  return out;
}

// ---- Fixing one from the Issues page ----
// The row's Fix button settles an unmatched name one of two ways: map it to
// a service already on the list, or add it to the list as a new service
// (optionally under a corrected spelling). Either way, when the name the
// opp should carry differs from what it carries now, every opp naming the
// old one gets its Scope rewritten, so one fix clears every row it caused.

// One Scope with `from` swapped for `to`, in place. `to` is one service or
// a list of them (an unmatched name like "RA & GHG" can stand for several),
// which go in where `from` was, in the order given. Anything the opp
// already names is dropped rather than listed twice. The result is written
// the way Scope is stored (comma-separated). Returns the cell unchanged
// when it doesn't name `from`.
export function remapScopeService(scope, from, to, knownServices) {
  const fromKey = String(from ?? '').trim().toLowerCase();
  const targets = (Array.isArray(to) ? to : [to]).map(t => String(t ?? '').trim()).filter(Boolean);
  if (!fromKey || targets.length === 0) return scope;
  const names = splitServiceNames(scope, knownServices);
  if (!names.some(n => n.trim().toLowerCase() === fromKey)) return scope;
  const out = [];
  for (const n of names) {
    const next = n.trim().toLowerCase() === fromKey ? targets : [n.trim()];
    for (const x of next) if (!out.some(y => y.toLowerCase() === x.toLowerCase())) out.push(x);
  }
  return joinServiceNames(out);
}

// Scope patches for a set of remaps ({ from, to } pairs, `to` one name or
// a list) across records:
// { [oppId]: { Scope } } for each opp whose Scope actually changes. With
// `onlyIds`, opps outside it are left alone (the "just this opp" choice).
export function scopeRemapPatches(records, remaps, knownServices, onlyIds = null) {
  const only = onlyIds ? new Set([...onlyIds].map(String)) : null;
  const patches = {};
  for (const r of records || []) {
    if (r?._id == null) continue;
    if (only && !only.has(String(r._id))) continue;
    const before = r.Scope;
    let scope = before;
    for (const { from, to } of remaps || []) scope = remapScopeService(scope, from, to, knownServices);
    if (scope !== before) patches[r._id] = { Scope: scope };
  }
  return patches;
}

// Closest service on the list to an unmatched name, to pre-select in the
// Fix popup ("Risk managment" -> "Risk Management"). Plain edit distance on
// the lowercased names, accepted only when it is small next to the name's
// length, so an unrelated name gets no guess rather than a wrong one.
export function suggestServiceMatch(name, knownServices) {
  const a = String(name ?? '').trim().toLowerCase();
  if (!a) return '';
  let best = '', bestScore = Infinity;
  for (const s of knownServices || []) {
    const b = String(s ?? '').trim().toLowerCase();
    if (!b) continue;
    if (b === a) return String(s).trim();
    const d = editDistance(a, b);
    const score = d / Math.max(a.length, b.length);
    if (score < bestScore) { bestScore = score; best = String(s).trim(); }
  }
  return bestScore <= 0.25 ? best : '';
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.25 + 1) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Services on the list matching what has been typed so far, best first, for
// the Fix popup's type-ahead: names starting with it, then names with a word
// starting with it, then names containing it anywhere. Ties keep the list's
// order. Names in `exclude` (already picked) are left out.
export function rankServiceMatches(query, services, { exclude = [], limit = 12 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const skip = new Set((exclude || []).map(x => String(x ?? '').trim().toLowerCase()));
  const scored = [];
  (services || []).forEach((s, i) => {
    const name = String(s ?? '').trim();
    const k = name.toLowerCase();
    if (!k || skip.has(k)) return;
    let rank;
    if (!q) rank = 3;
    else if (k.startsWith(q)) rank = 0;
    else if (k.split(/[^a-z0-9]+/).some(w => w && w.startsWith(q))) rank = 1;
    else if (k.includes(q)) rank = 2;
    else return;
    scored.push({ name, rank, i });
  });
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return scored.slice(0, limit).map(x => x.name);
}

// ---- Ignoring a name ----
// The Fix popup's Ignore puts unmatched names on a list kept in Settings
// (`ignoredScopeServices`) so they stop being flagged on any opp; the
// Issues header lists them so one can be un-ignored. Both helpers return
// the new list, deduped case-insensitively, keeping the first spelling.
export function addIgnoredScopeServices(list, names) {
  const out = [];
  for (const n of [...(Array.isArray(list) ? list : []), ...(names || [])]) {
    const t = String(n ?? '').trim();
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

export function removeIgnoredScopeService(list, name) {
  const k = String(name ?? '').trim().toLowerCase();
  return (Array.isArray(list) ? list : []).filter(n => String(n ?? '').trim().toLowerCase() !== k);
}

// The note line a company's service gets when the Fix popup maps an
// unmatched Scope name onto it, so the name the deal used is not lost.
export function serviceAliasNoteLine(oldName) {
  return `Previously listed as "${String(oldName ?? '').trim()}"`;
}

// serviceNotes updates for the companies whose opps a Fix just rewrote:
// for each patched opp, every remap whose `from` its Scope named adds
// serviceAliasNoteLine(from) to that company's note for each target
// service. A line the note already has is not added again.
//   records            the Opps records, before the rewrite
//   remaps             [{ from, to: [names] }]
//   patches            scopeRemapPatches' result (which opps changed)
//   prospectIdFor      account name -> prospect id (or null)
//   prospectsById      Map of prospect id -> prospect
// Returns [{ id, serviceNotes }] with each prospect's whole new map.
export function serviceAliasNotePatches(records, remaps, patches, knownServices, prospectIdFor, prospectsById) {
  const notesById = new Map();
  for (const r of records || []) {
    if (r?._id == null || !patches?.[r._id]) continue;
    const id = prospectIdFor(String(r.Account || '').trim());
    const p = id != null ? prospectsById.get(id) : null;
    if (!p) continue;
    const names = splitServiceNames(r.Scope, knownServices).map(n => n.trim().toLowerCase());
    for (const { from, to } of remaps || []) {
      if (!names.includes(String(from ?? '').trim().toLowerCase())) continue;
      if (!notesById.has(id)) notesById.set(id, { ...(p.serviceNotes || {}) });
      const notes = notesById.get(id);
      const line = serviceAliasNoteLine(from);
      for (const target of Array.isArray(to) ? to : [to]) {
        if (String(target).trim().toLowerCase() === String(from).trim().toLowerCase()) continue;
        const cur = String(notes[target] || '');
        if (cur.toLowerCase().split('\n').some(l => l.trim() === line.toLowerCase())) continue;
        notes[target] = cur.trim() ? `${cur.replace(/\s+$/, '')}\n${line}` : line;
      }
    }
  }
  const out = [];
  for (const [id, serviceNotes] of notesById) {
    const before = prospectsById.get(id)?.serviceNotes || {};
    if (JSON.stringify(before) !== JSON.stringify(serviceNotes)) out.push({ id, serviceNotes });
  }
  return out;
}
