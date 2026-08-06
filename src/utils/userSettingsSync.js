import { doc, getDoc, setDoc, updateDoc, deleteField, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  SITE_LISTS_KEY,
  applySiteListOps,
  migrateCompanySiteLists,
  readCompanySiteLists,
  slugsForOps,
  splitSiteListPaths,
  splitSiteListUpdates,
  subscribeToCompanySiteLists,
} from './companySiteListsStore';

const COL = 'userSettings';

// The settings document plus the per-company site lists that used to be a
// key on it (see companySiteListsStore for why they moved), delivered as
// the single object every caller already expects.
export function subscribeToUserSettings(userId, onChange) {
  const ref = doc(db, COL, userId);
  let docData;   // undefined until the document's first snapshot
  let lists;     // undefined until the subcollection's first snapshot
  let migrating = false;

  const emit = () => {
    // Nothing goes out until BOTH sources have reported. A settings object
    // whose companySiteLists is still empty is worse than a slightly later
    // one: "Save to <company>" merges its rows against what it finds
    // there, so an early emit would let a save write a company's existing
    // sites away.
    if (docData === undefined || lists === undefined) return;
    if (docData === null && !Object.keys(lists).length) { onChange(null); return; }

    const merged = { ...(docData || {}) };
    const legacy = merged[SITE_LISTS_KEY];
    // A migration that hasn't finished yet leaves a company in both
    // places; the subcollection holds the newer copy either way.
    const all = { ...(legacy && typeof legacy === 'object' ? legacy : {}), ...lists };
    if (Object.keys(all).length) merged[SITE_LISTS_KEY] = all;
    else delete merged[SITE_LISTS_KEY];
    onChange(merged);
  };

  const unsubDoc = onSnapshot(ref, (snap) => {
    docData = snap.exists() ? snap.data() : null;
    const legacy = docData?.[SITE_LISTS_KEY];
    if (!migrating && legacy && typeof legacy === 'object' && Object.keys(legacy).length) {
      migrating = true;
      migrateCompanySiteLists(userId, legacy)
        .catch(err => { migrating = false; console.error('companySiteLists migration failed:', err); });
    }
    emit();
  }, (err) => {
    console.error('userSettings subscription error:', err);
  });

  const unsubLists = subscribeToCompanySiteLists(userId, (map) => {
    lists = map;
    emit();
  }, () => {
    // Reads of the subcollection failed (most likely rules that haven't
    // released yet). Carry on with whatever the settings document holds
    // rather than leaving the app stuck on "loading" — writes will still
    // surface the real error.
    if (lists === undefined) { lists = {}; emit(); }
  });

  return () => { unsubDoc(); unsubLists(); };
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
  // companySiteLists lives in its own subcollection; everything else is a
  // field on the document.
  const { ops, rest } = splitSiteListUpdates(updates);

  if (!force && expectedAt != null) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const remoteAt = Number(snap.data()?._lastWriteAt || 0);
        if (remoteAt > Number(expectedAt)) {
          return { stale: true, remoteAt, remoteData: await withSiteLists(userId, snap.data(), ops) };
        }
      }
    } catch (err) {
      // We can't tell whether our copy is stale (e.g. laptop just woke
      // and the network isn't back) — writing anyway could replace
      // another device's newer data with ours. Fail the save; the
      // caller alerts and a pre-save backup was already taken.
      console.warn('saveUserSettings: stale check failed', err);
      throw err;
    }
  }

  const writtenAt = Date.now();
  if (ops.length) await applySiteListOps(userId, ops);
  await setDoc(ref, { ...rest, _lastWriteAt: writtenAt }, { merge: true });
  return { stale: false, writtenAt };
}

// The remote settings document with the site lists a write touches folded
// back in under their old key, so the auto-merge in useUserSettings sees
// the other device's rows exactly as it did when they were one field.
async function withSiteLists(userId, remote, ops) {
  if (!ops.length) return remote;
  try {
    const lists = await readCompanySiteLists(userId, slugsForOps(ops));
    const existing = remote?.[SITE_LISTS_KEY];
    return {
      ...remote,
      [SITE_LISTS_KEY]: { ...(existing && typeof existing === 'object' ? existing : {}), ...lists },
    };
  } catch (err) {
    // Worst case the merge treats the remote as having nothing at these
    // paths, which is what it did before the site lists moved.
    console.warn('Could not read remote site lists for the stale-write merge', err);
    return remote;
  }
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
  const { ops, rest } = splitSiteListPaths(pathUpdates);

  if (!force && expectedAt != null) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const remoteAt = Number(snap.data()?._lastWriteAt || 0);
        if (remoteAt > Number(expectedAt)) {
          return { stale: true, remoteAt, remoteData: await withSiteLists(userId, snap.data(), ops) };
        }
      }
    } catch (err) {
      // Same as saveUserSettings: an unverifiable stale check must not
      // fall through to a write that could clobber newer remote data.
      console.warn('savePathUpdates: stale check failed', err);
      throw err;
    }
  }

  const writtenAt = Date.now();
  if (ops.length) await applySiteListOps(userId, ops);

  // Still stamp _lastWriteAt even when every path went to the
  // subcollection: it is what other devices watch to know this one wrote.
  const updates = { _lastWriteAt: writtenAt };
  for (const [path, value] of Object.entries(rest)) {
    updates[path] = value == null ? deleteField() : value;
  }

  try {
    await updateDoc(ref, updates);
  } catch (err) {
    // updateDoc fails if the document does not exist yet; fall back to a full
    // setDoc by building a nested object from the dot paths.
    if (err?.code === 'not-found') {
      const nested = { _lastWriteAt: writtenAt };
      for (const [path, value] of Object.entries(rest)) {
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
