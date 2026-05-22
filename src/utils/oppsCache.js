// Read helper for opportunities.
//
// Opps 2 (`opps2-cache` IndexedDB + `opps2Data` Firestore) is the
// canonical source going forward. The legacy Opps tab (`opps-cache`,
// fed from a Google Sheet) is kept as a read-only backup view and
// continues to additively feed new rows into Opps 2 via the
// `opps-cache-updated` event so Opps 2 stays current. Every other
// surface in the app — Daily Success, Progress, My Accounts, Key
// Contacts, PE Portfolio, Pricing pickers, etc. — now reads from
// Opps 2 only.

import { dbGet } from './db';

const OPPS2_STORE = 'opps2-cache';

// Dedup key kept around so the Opps 2 view (and the Opps-tab feed
// inside it) can detect whether an incoming Google-Sheets row is
// already on the Opps 2 record set. Consumers don't need this — it's
// only used by the feed logic.
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

// Returns the Opps 2 cache (the canonical opps store). Consumers
// across the app go through this helper so a future re-shape of the
// underlying storage only touches one file. Returns null when the
// cache hasn't been populated yet (e.g. the user hasn't opened Opps 2
// in this browser session and Firestore hasn't been synced down).
export async function loadOppsFromCache() {
  try {
    const data = await dbGet(OPPS2_STORE, 'data');
    if (!data) return null;
    return {
      headers: Array.isArray(data.headers) ? data.headers : [],
      records: Array.isArray(data.records) ? data.records : [],
      fetchedAt: data.fetchedAt || null,
    };
  } catch {
    return null;
  }
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
// fetch so the Opps 2 view (when mounted) can additively merge any
// new rows into its own store.
export const OPPS_CACHE_UPDATED_EVENT = 'opps-cache-updated';
