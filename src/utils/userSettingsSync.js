import { doc, getDoc, setDoc, updateDoc, deleteField, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const COL = 'userSettings';

export function subscribeToUserSettings(userId, onChange) {
  const ref = doc(db, COL, userId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? snap.data() : null);
  }, (err) => {
    console.error('userSettings subscription error:', err);
  });
}

// Write with an optional staleness check.
//
//   opts.expectedAt       - the _lastWriteAt the caller thinks is current.
//                           If the remote has advanced past this, we bail
//                           and return { stale: true, remoteData }.
//   opts.force            - skip the stale check. Used when the user has
//                           already been prompted and chose to overwrite.
//
// Always stamps the write with a new _lastWriteAt.
export async function saveUserSettings(userId, updates, opts = {}) {
  const ref = doc(db, COL, userId);
  const { expectedAt, force } = opts;

  if (!force && expectedAt != null) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const remoteAt = Number(snap.data()?._lastWriteAt || 0);
        if (remoteAt > Number(expectedAt)) {
          return { stale: true, remoteAt, remoteData: snap.data() };
        }
      }
    } catch (err) {
      // Network hiccup — don't silently overwrite. Surface the error.
      console.warn('saveUserSettings: stale check failed', err);
    }
  }

  const writtenAt = Date.now();
  await setDoc(ref, { ...updates, _lastWriteAt: writtenAt }, { merge: true });
  return { stale: false, writtenAt };
}

// On first login with empty Firestore settings, copy existing localStorage data up.
async function migrateFromLocalStorage(userId) {
  const pairs = {
    targetMap: 'my-accounts-target-map',
    divisionsMap: 'my-accounts-divisions-map',
    divisionRules: 'my-accounts-division-rules',
    savedFilters: 'prospect-saved-filters',
    ccMap: 'prospect-cc-map',
    toAlsoMap: 'prospect-to-also-map',
    dismissedGuesses: 'hubspot-dismissed-guesses',
    emailSignature: 'prospect-email-signature',
    emailDrafts: 'prospect-email-drafts',
  };
  const data = {};
  for (const [key, lsKey] of Object.entries(pairs)) {
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw !== null) data[key] = JSON.parse(raw);
    } catch {}
  }
  // Migrate org charts stored as orgchart-* keys
  const orgCharts = {};
  for (let i = 0; i < localStorage.length; i++) {
    const lsKey = localStorage.key(i);
    if (lsKey?.startsWith('orgchart-')) {
      try { orgCharts[lsKey] = JSON.parse(localStorage.getItem(lsKey)); } catch {}
    }
  }
  if (Object.keys(orgCharts).length > 0) data.orgCharts = orgCharts;

  if (Object.keys(data).length > 0) {
    console.log('Migrating localStorage settings to Firestore:', Object.keys(data));
    await saveUserSettings(userId, data, { force: true });
  }
}

// Path-based write. `pathUpdates` has keys like 'companyOpportunities.acme-inc'.
// A value of `null` or `undefined` means "delete this path". Same staleness
// and _lastWriteAt semantics as saveUserSettings.
export async function savePathUpdates(userId, pathUpdates, opts = {}) {
  const ref = doc(db, COL, userId);
  const { expectedAt, force } = opts;

  if (!force && expectedAt != null) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const remoteAt = Number(snap.data()?._lastWriteAt || 0);
        if (remoteAt > Number(expectedAt)) {
          return { stale: true, remoteAt, remoteData: snap.data() };
        }
      }
    } catch (err) {
      console.warn('savePathUpdates: stale check failed', err);
    }
  }

  const writtenAt = Date.now();
  const updates = { _lastWriteAt: writtenAt };
  for (const [path, value] of Object.entries(pathUpdates)) {
    updates[path] = value == null ? deleteField() : value;
  }

  try {
    await updateDoc(ref, updates);
  } catch (err) {
    // updateDoc fails if the document does not exist yet; fall back to a full
    // setDoc by building a nested object from the dot paths.
    if (err?.code === 'not-found') {
      const nested = { _lastWriteAt: writtenAt };
      for (const [path, value] of Object.entries(pathUpdates)) {
        if (value == null) continue;
        const parts = path.split('.');
        let cur = nested;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
      }
      await setDoc(ref, nested);
    } else {
      throw err;
    }
  }

  return { stale: false, writtenAt };
}

export async function initUserSettings(userId) {
  const ref = doc(db, COL, userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await migrateFromLocalStorage(userId);
  }
}
