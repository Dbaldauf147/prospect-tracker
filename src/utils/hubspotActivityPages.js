// Walk every page of /api/hubspot?action=activity for one type (email |
// call | meeting), newest first. Shared by the Activity tab, which loads all
// three, and the All Contacts page, which loads emails on its own when the
// No Reply index hasn't been built yet.
import { apiFetch } from './apiFetch';

export async function fetchAllActivityPages(type, onProgress) {
  const all = [];
  const seenIds = new Set();
  let after = '';
  while (true) {
    const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await apiFetch(url);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    // Dedup by id: the server rolls into a new hs_timestamp window when it
    // hits HubSpot search's 10k paging ceiling, and the window boundary
    // (LTE) can re-return a few records we've already collected.
    for (const r of (json.results || [])) {
      if (r.id) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
      }
      all.push(r);
    }
    onProgress?.(all.length);
    if (json.nextAfter) {
      after = json.nextAfter;
    } else {
      break;
    }
    // Runaway guard only — the full activity history is expected to sit
    // well under this. Records come newest-first, so if this ever trips
    // it drops the oldest tail, never recent activity.
    if (all.length > 100000) { console.warn(`Activity ${type} fetch hit 100k safety cap`); break; }
  }
  return all;
}
