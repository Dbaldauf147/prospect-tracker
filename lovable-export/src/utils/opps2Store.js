// SHIM for the Lovable export.
//
// The original module synced "Opps 2" opportunities to/from Firestore
// (collection `opps2Data`) and an IndexedDB cache. The Clients page only
// touches ONE export from here: `loadOpps2Newest`, which the Deals tab
// uses to flag deals whose linked opportunity is already marked Sold.
//
// With no backend in the export we return null — DealsView reads
// `result?.records` and falls back to an empty list, so the Deals table
// still renders fully from the sample data; it just won't show the
// "linked opp is Sold" cross-reference warning.

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export async function loadOpps2Newest() {
  return null;
}
