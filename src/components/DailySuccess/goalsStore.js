// Daily Success Goals — IndexedDB-backed list of long-running goals
// the user wants Claude to help prioritize and break down into daily
// tasks. Each goal:
//   {
//     id: 'g_xxx',
//     text: 'Land 3 new Tier 1 clients in Q2',
//     createdAt: number,           // ms epoch
//     archivedAt: number | null,   // null when active
//     priority: number | null,     // 1 = highest, set by Claude
//     rationale: string | null,    // Claude's why-this-priority text
//     lastPrioritizedAt: number | null,
//   }
//
// Stored under a single key 'list' as an array — these never grow huge
// and a single record keeps reads / writes atomic.

import { dbGet } from '../../utils/db';
import { registerMirroredDbKey, mirrorDbPut } from '../../utils/localMirrorSync';

const STORE = 'daily-success-goals';
const KEY = 'list';
export const DAILY_GOALS_EVENT = 'daily-goals-changed';

// A goal is something the user wrote down and works towards for weeks — it
// belongs to them, not to the laptop they happened to type it on. One record
// holding the whole list, so the single-record mirror fits it exactly.
registerMirroredDbKey(STORE, KEY, DAILY_GOALS_EVENT);

function newId() {
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadGoals() {
  const raw = await dbGet(STORE, KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function saveGoals(list) {
  // mirrorDbPut rather than dbPut: it writes the record and queues the push,
  // so the cloud copy can't be forgotten at one of the callers below.
  await mirrorDbPut(STORE, KEY, Array.isArray(list) ? list : []);
}

export async function addGoal(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const list = await loadGoals();
  const goal = {
    id: newId(),
    text: t,
    createdAt: Date.now(),
    archivedAt: null,
    priority: null,
    rationale: null,
    lastPrioritizedAt: null,
  };
  await saveGoals([...list, goal]);
  return goal;
}

export async function updateGoal(id, patch) {
  const list = await loadGoals();
  const next = list.map(g => (g.id === id ? { ...g, ...patch } : g));
  await saveGoals(next);
  return next.find(g => g.id === id) || null;
}

export async function deleteGoal(id) {
  const list = await loadGoals();
  await saveGoals(list.filter(g => g.id !== id));
}

export async function archiveGoal(id) {
  return updateGoal(id, { archivedAt: Date.now() });
}

export async function unarchiveGoal(id) {
  return updateGoal(id, { archivedAt: null });
}

// Apply a priority list returned by Claude. Each entry is
// { id, priority, rationale }. Goals not in the list keep their
// existing values.
export async function applyPrioritization(prioritized) {
  const list = await loadGoals();
  const byId = new Map((prioritized || []).map(p => [p.id, p]));
  const stamp = Date.now();
  const next = list.map(g => {
    const p = byId.get(g.id);
    if (!p) return g;
    return {
      ...g,
      priority: typeof p.priority === 'number' ? p.priority : g.priority,
      rationale: typeof p.rationale === 'string' ? p.rationale : g.rationale,
      lastPrioritizedAt: stamp,
    };
  });
  await saveGoals(next);
  return next;
}

export function activeGoals(list) {
  return (list || []).filter(g => !g.archivedAt);
}

export function sortedByPriority(list) {
  return [...(list || [])].sort((a, b) => {
    const ap = typeof a.priority === 'number' ? a.priority : 9999;
    const bp = typeof b.priority === 'number' ? b.priority : 9999;
    if (ap !== bp) return ap - bp;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}
