// STUB for the standalone export.
//
// The real module synced "Opps 2" opportunities to/from Firestore
// (collection `opps2Data`) plus an IndexedDB cache. Two exported pages
// touch it:
//   - DealsView (Clients page) → loadOpps2Newest, to flag deals whose
//     linked opportunity is already Sold.
//   - oppsPricingSnapshot (Pricing page) → load/save helpers, used when a
//     pricing option is pushed back onto an opportunity row.
//
// With no backend, the loaders return null/empty and the savers are
// no-ops. Both pages already tolerate an empty result, so the tables and
// calculators render fully from local/sample data — they just skip the
// cross-page opportunity sync.

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export async function loadOpps2Newest() {
  return null;
}

export async function loadOpps2FromFirestore() {
  return null;
}

export async function loadOpps2Cache() {
  return null;
}

export async function saveOpps2Cache() {
  // no-op — nothing to cache without a backend
}

export async function saveOpps2ToFirestore() {
  // no-op — no Firestore in the export
}
