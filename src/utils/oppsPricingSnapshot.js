// Pricing-Option snapshots live on the Opps 2 record itself
// (`record._pricingOption`) so they survive a Pricing-tab Clear. The
// Pricing → Options tab writes the snapshot here when the user clicks
// "Save to Opp"; the Opps 2 view reads it from the record and renders
// the rich detail in the Opp popup + the linked Year 1 Quoted Amount.
//
// Writes go straight to the opps2-cache IndexedDB store AND the
// opps2Data Firestore document so the snapshot survives reload and
// reaches the user's other devices. A window event lets a mounted
// Opps 2 view rehydrate without a manual reload.

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { dbGet, dbPut } from './db';
import { fmtMoneyWhole } from './pricingOptionCalc';

const OPPS2_STORE = 'opps2-cache';
const OPPS2_CACHE_KEY = 'data';
const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export const OPPS_PRICING_SNAPSHOT_EVENT = 'opps2:pricingSnapshotUpdated';

async function updateOpp2Record(uid, oppId, mutator) {
  if (oppId == null) return null;
  let cache;
  try {
    cache = (await dbGet(OPPS2_STORE, OPPS2_CACHE_KEY)) || { headers: [], records: [] };
  } catch {
    return null;
  }
  const records = Array.isArray(cache.records) ? cache.records : [];
  const idx = records.findIndex(r => String(r?._id) === String(oppId));
  if (idx === -1) return null;
  const nextRecord = mutator({ ...records[idx] });
  if (!nextRecord) return null;
  const nextRecords = records.slice();
  nextRecords[idx] = nextRecord;
  const next = { ...cache, records: nextRecords };
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
  if (!snapshot) return null;
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
  return updateOpp2Record(uid, oppId, (record) => {
    if (!record._pricingOption) return record;
    const next = { ...record };
    delete next._pricingOption;
    return next;
  });
}
