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

import { dbGet, dbPut } from '../../utils/db';

const STORE = 'daily-success-goals';
const KEY = 'list';

function newId() {
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadGoals() {
  const raw = await dbGet(STORE, KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function saveGoals(list) {
  await dbPut(STORE, Array.isArray(list) ? list : [], KEY);
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
