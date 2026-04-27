// Read-only helper for the Opps cache populated by OppsView (IndexedDB).

import { dbGet } from './db';

const STORE = 'opps-cache';

export async function loadOppsFromCache() {
  try { return (await dbGet(STORE, 'data')) || null; }
  catch { return null; }
}

export function findOppByBfoLink(cache, bfoLink) {
  if (!cache?.records || !bfoLink) return null;
  const target = String(bfoLink).trim().toLowerCase();
  return cache.records.find(r => String(r['BFO Link'] || '').trim().toLowerCase() === target) || null;
}

export function searchOpps(cache, term) {
  if (!cache?.records) return [];
  const t = (term || '').trim().toLowerCase();
  if (!t) return cache.records.slice(0, 25);
  return cache.records.filter(r => {
    return ['Account', 'Contact', 'BFO Link', 'Scope', 'Stage']
      .some(k => String(r[k] || '').toLowerCase().includes(t));
  }).slice(0, 25);
}
