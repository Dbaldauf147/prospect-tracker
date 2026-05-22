// Pricing-Option snapshots live on the Opps 2 record itself
// (`record._pricingOption`) so they survive a Pricing-tab Clear. The
// Pricing → Options tab writes the snapshot here when the user clicks
// "Save to Opp"; the Opps 2 view reads it from the record and renders
// the rich detail in the Opp popup + the linked Year 1 Quoted Amount.
//
// Writes go to BOTH the opps2-cache IndexedDB store and the opps2Data
// Firestore document so the snapshot survives reload and reaches the
// user's other devices. We read Firestore first as the source of
// truth, fall back to IndexedDB when Firestore has nothing (e.g.
// freshly-fed opps that haven't synced yet), and throw a visible error
// if the opp can't be located in either — so the picker shows the
// alert instead of silently doing nothing.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { dbGet, dbPut } from './db';
import { fmtMoneyWhole } from './pricingOptionCalc';

const OPPS2_STORE = 'opps2-cache';
const OPPS2_CACHE_KEY = 'data';
const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export const OPPS_PRICING_SNAPSHOT_EVENT = 'opps2:pricingSnapshotUpdated';

async function readFirestoreOpps2(uid) {
  if (!uid) return null;
  try {
    const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const raw = snap.data();
    if (!raw?.json) return null;
    return JSON.parse(raw.json);
  } catch (err) {
    console.error('opps2 pricing snapshot: Firestore read failed', err);
    return null;
  }
}

async function readIdbOpps2() {
  try { return (await dbGet(OPPS2_STORE, OPPS2_CACHE_KEY)) || null; }
  catch { return null; }
}

// Pick the freshest copy of the Opps 2 dataset that contains the
// target opp. Prefer Firestore (server-side truth), fall back to IDB
// (covers freshly-fed Opps tab records that haven't synced yet).
async function loadOpps2ContainingOpp(uid, oppId) {
  const target = String(oppId);
  const containsTarget = (data) =>
    Array.isArray(data?.records)
    && data.records.some(r => String(r?._id) === target);
  const fs = await readFirestoreOpps2(uid);
  if (containsTarget(fs)) return { source: 'firestore', data: fs };
  const idb = await readIdbOpps2();
  if (containsTarget(idb)) return { source: 'idb', data: idb };
  return {
    source: null,
    data: fs || idb || { headers: [], records: [] },
  };
}

async function updateOpp2Record(uid, oppId, mutator) {
  if (oppId == null) throw new Error('updateOpp2Record: missing oppId');
  const { source, data } = await loadOpps2ContainingOpp(uid, oppId);
  if (!source) {
    const haveCount = Array.isArray(data?.records) ? data.records.length : 0;
    throw new Error(
      `Opp #${oppId} not found in Opps 2 (checked Firestore + IndexedDB, ` +
      `${haveCount} record${haveCount === 1 ? '' : 's'} loaded). ` +
      'Open the Opps 2 tab to refresh the local cache, then try again.'
    );
  }
  const records = data.records;
  const idx = records.findIndex(r => String(r?._id) === String(oppId));
  const nextRecord = mutator({ ...records[idx] });
  if (!nextRecord) return null;
  const nextRecords = records.slice();
  nextRecords[idx] = nextRecord;
  const next = { ...data, records: nextRecords };
  try { await dbPut(OPPS2_STORE, next, OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2 pricing snapshot: IDB write failed', err); }
  if (uid) {
    try {
      await setDoc(doc(db, OPPS2_FIRESTORE_COLLECTION, uid), {
        json: JSON.stringify(next),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('opps2 pricing snapshot: Firestore write failed', err);
      throw err;
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(OPPS_PRICING_SNAPSHOT_EVENT, {
      detail: { oppId, record: nextRecord },
    }));
  } catch { /* ignore */ }
  return nextRecord;
}

// Attach a frozen snapshot of a Pricing → Options tab option to the
// Opp identified by `oppId`. Also writes the snapshot's Year 1 total
// into the opp's "Quoted Amount" cell so the user can see the number
// at a glance in the table without opening the detail popup.
export async function setOppPricingSnapshot(uid, oppId, snapshot) {
  if (!snapshot) throw new Error('setOppPricingSnapshot: missing snapshot');
  return updateOpp2Record(uid, oppId, (record) => ({
    ...record,
    _pricingOption: snapshot,
    'Quoted Amount': fmtMoneyWhole(snapshot.year1Total || 0),
  }));
}

// Strip the snapshot from an opp. Leaves Quoted Amount intact — the
// user may have edited it manually, and re-zeroing it would feel like
// the value was lost. They can clear it themselves if needed.
export async function clearOppPricingSnapshot(uid, oppId) {
  try {
    return await updateOpp2Record(uid, oppId, (record) => {
      if (!record._pricingOption) return record;
      const next = { ...record };
      delete next._pricingOption;
      return next;
    });
  } catch (err) {
    // Clearing is best-effort — if the opp isn't reachable, that's
    // equivalent to it already being unlinked.
    console.warn('clearOppPricingSnapshot: ignoring failure', err);
    return null;
  }
}
