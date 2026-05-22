// Unified read helper for opportunities.
//
// Historically only the Opps tab (`opps-cache`, fed from a Google
// Sheet) populated this store. The newer Opps 2 tab (`opps2-cache`,
// user-entered) is now the canonical source: the Opps tab feeds Opps 2
// additively, and consumers across the app are migrating to read from
// Opps 2 in preparation for the Opps tab being phased out.
//
// This helper returns a merged view (Opps 2 wins on conflicts) so
// every dependent surface sees one unified opp list regardless of
// which store a record originated in.

import { dbGet } from './db';

const OPPS_STORE = 'opps-cache';
const OPPS2_STORE = 'opps2-cache';

// Dedup key: BFO Link is the natural unique id; for rows that lack one
// we fall back to a composite of Account + Open Year + Scope + Start
// Date so user-typed Opps 2 entries don't get clobbered by a fuzzy
// match against a Google-Sheets row of the same name in a different
// year.
export function oppDedupKey(r) {
  if (!r) return '';
  const bfo = String(r['BFO Link'] || '').trim().toLowerCase();
  if (bfo && bfo !== '-' && bfo !== '#n/a') return `bfo:${bfo}`;
  const acct = String(r['Account'] || '').trim().toLowerCase();
  const year = String(r['Open Year'] || '').trim();
  const scope = String(r['Scope'] || '').trim().toLowerCase();
  const start = String(r['Start Date'] || '').trim();
  if (!acct && !year && !scope && !start) return '';
  return `acct:${acct}|${year}|${scope}|${start}`;
}

export async function loadOppsFromCache() {
  let opps2 = null;
  let opps = null;
  try { opps2 = await dbGet(OPPS2_STORE, 'data'); } catch { /* ignore */ }
  try { opps = await dbGet(OPPS_STORE, 'data'); } catch { /* ignore */ }
  if (!opps2 && !opps) return null;

  const seen = new Set();
  const records = [];
  for (const r of (opps2?.records || [])) {
    const k = oppDedupKey(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    records.push(r);
  }
  for (const r of (opps?.records || [])) {
    const k = oppDedupKey(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    records.push(r);
  }

  const headers = [...(opps2?.headers || [])];
  const headerSet = new Set(headers);
  for (const h of (opps?.headers || [])) {
    if (h && !headerSet.has(h)) { headerSet.add(h); headers.push(h); }
  }

  const fetchedAt = [opps2?.fetchedAt, opps?.fetchedAt].filter(Boolean).sort().pop() || null;
  return { headers, records, fetchedAt };
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

// Window event the Opps tab fires after a successful Google-Sheets
// fetch so the Opps 2 view (and any other listener) can re-merge.
export const OPPS_CACHE_UPDATED_EVENT = 'opps-cache-updated';
