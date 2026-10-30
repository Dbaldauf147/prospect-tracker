import { doc, getDoc, setDoc, updateDoc, deleteField, FieldPath } from 'firebase/firestore';
import { onSnapshot } from './safeOnSnapshot';
import { db } from '../firebase';
import { restGetDoc, restUpdateFields, dottedFieldEntries, keyFieldEntries } from './firestoreRest.js';
import { isClientWedgedError, isClientWedged, noteClientWedged } from './firestoreClientHealth.js';
import { composeSettings, legacyKeysIn, splitSettingsUpdates, splitPathUpdates, ENCODED_SETTINGS_KEYS } from './settingsCodec.js';
import { subscribeToSettingsKeys, readSettingsKeys, writeSettingsKeys } from './settingsKeyStore.js';
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

// The settings document plus the per-company site lists and the big maps
// that used to be keys on it (see companySiteListsStore and settingsCodec for
// why they moved), delivered as the single object every caller expects.
export function subscribeToUserSettings(userId, onChange) {
  const ref = doc(db, COL, userId);
  let rawDoc;    // undefined until the document's first snapshot
  let pending = false; // whether that snapshot carries this tab's own unsent writes
  let lists;     // undefined until the site lists' first snapshot
  let keyValues; // undefined until the big maps' first snapshot
  let migrating = false;
  let movingKeys = false;
  // Set once a move has failed (rules not released yet, say): tried again on
  // the next page load rather than on every snapshot.
  let moveFailed = false;

  const emit = () => {
    // Nothing goes out until every source has reported. A settings object
    // whose companySiteLists (or targetMap) is still empty is worse than a
    // slightly later one: a save merges against what it finds there, so an
    // early emit would let it write the stored entries away.
    if (rawDoc === undefined || lists === undefined || keyValues === undefined) return;
    if (rawDoc === null && !Object.keys(lists).length && !Object.keys(keyValues).length) { onChange(null); return; }

    const merged = composeSettings(rawDoc || {}, keyValues);
    const legacy = merged[SITE_LISTS_KEY];
    // A migration that hasn't finished yet leaves a company in both
    // places; the subcollection holds the newer copy either way.
    const all = { ...(legacy && typeof legacy === 'object' ? legacy : {}), ...lists };
    if (Object.keys(all).length) merged[SITE_LISTS_KEY] = all;
    else delete merged[SITE_LISTS_KEY];
    onChange(merged);

    // A big map the settings document still holds itself (saved before the
    // maps moved out, or written since by a tab on the old code) is moved to
    // its own document once, so the settings document shrinks now rather
    // than whenever that key next happens to be saved. Guarded by the stale
    // check: if another device wrote in between, it waits for the next
    // snapshot.
    const due = legacyKeysIn(rawDoc);
    if (!movingKeys && !moveFailed && due.length && !pending) {
      movingKeys = true;
      const updates = Object.fromEntries(due.map(k => [k, merged[k] ?? null]));
      saveUserSettings(userId, updates, { expectedAt: Number(rawDoc?._lastWriteAt || 0) })
        .then((res) => { if (!res?.stale) console.log('Settings: moved to their own documents:', due); })
        .catch((err) => { moveFailed = true; console.warn('Settings: could not move the big maps to their own documents yet', err); })
        .finally(() => { movingKeys = false; });
    }
  };

  const unsubDoc = onSnapshot(ref, (snap) => {
    rawDoc = snap.exists() ? snap.data() : null;
    pending = !!snap.metadata?.hasPendingWrites;
    const legacy = rawDoc?.[SITE_LISTS_KEY];
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

  const unsubKeys = subscribeToSettingsKeys(userId, (map) => {
    keyValues = map;
    emit();
  }, () => {
    // Same as the site lists: carry on with what the settings document
    // still holds for these keys.
    if (keyValues === undefined) { keyValues = {}; emit(); }
  });

  return () => { unsubDoc(); unsubLists(); unsubKeys(); };
}

// ── When the SDK has crashed ───────────────────────────────────────────
//
// The Firestore client can kill itself mid-session: an internal assertion
// escapes into its async queue and from then on every read, write and
// snapshot in the tab rejects, quoting the original error. The Utility
// Lookup company mapping is where it surfaced — "Failed to save: FIRESTORE
// INTERNAL ASSERTION FAILED (ID: b815)" — but nothing about that save
// caused it and nothing about it can be retried: the client is gone until
// the page reloads. See utils/firestoreClientHealth.
//
// The document itself is perfectly writable over HTTPS, so rather than
// losing the change, these two go around the corpse. The caller is told the
// tab needs reloading; the work still lands.
//
// The one thing that does not survive is a companySiteLists write: those go
// to a subcollection through runTransaction, which has no honest one-request
// equivalent (a transaction is a read and a conditional write). A save
// carrying site-list ops still fails on a crashed client, and says so.
const settingsPath = (userId) => `${COL}/${userId}`;

// The settings document for the stale check, read over HTTPS once the SDK
// can no longer answer. Returns the data, or null when there is no document.
//
// `keys` names the big maps to read from their own documents too
// (settingsCodec): the ones a stale save touches, so the merge sees the other
// device's entries, or all of them for a full read. The rest come back as
// whatever the settings document itself still holds for them.
async function readSettingsDoc(userId, ref, keys = []) {
  const [raw, keyValues] = await Promise.all([
    readRawSettingsDoc(userId, ref),
    keys.length ? readSettingsKeys(userId, keys) : {},
  ]);
  return raw || Object.keys(keyValues).length ? composeSettings(raw || {}, keyValues) : null;
}

async function readRawSettingsDoc(userId, ref) {
  if (isClientWedged()) return restGetDoc(settingsPath(userId));
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    if (!isClientWedgedError(err)) throw err;
    noteClientWedged(err);
    return restGetDoc(settingsPath(userId));
  }
}

// `sdkWrite`, falling back to a field-masked REST PATCH of the same paths.
// Masked rather than a whole-document write: a settings document holds
// everything the user has, and a save that replaced it with the handful of
// keys in flight would be far worse than the crash it is working around.
async function writeSettingsFields(userId, fieldEntries, sdkWrite) {
  if (isClientWedged()) {
    await restUpdateFields(settingsPath(userId), fieldEntries);
    return { viaRest: true };
  }
  try {
    await sdkWrite();
    return { viaRest: false };
  } catch (err) {
    if (!isClientWedgedError(err)) throw err;
    noteClientWedged(err);
    await restUpdateFields(settingsPath(userId), fieldEntries);
    return { viaRest: true };
  }
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
  const { ops, rest: fields } = splitSiteListUpdates(updates);
  // So do the big maps (settingsCodec): `keys` goes to their documents.
  const { keys, main: rest } = splitSettingsUpdates(fields);
  const keyNames = Object.keys(keys);

  if (!force && expectedAt != null) {
    try {
      const remote = await readSettingsDoc(userId, ref, keyNames);
      if (remote) {
        const remoteAt = Number(remote._lastWriteAt || 0);
        if (remoteAt > Number(expectedAt)) {
          return { stale: true, remoteAt, remoteData: await withSiteLists(userId, remote, ops) };
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
  // The maps' documents first, so the settings document never drops its old
  // copy of a map before the new home holds it.
  if (keyNames.length) await writeSettingsKeys(userId, keys, writtenAt);
  const written = { ...rest, _lastWriteAt: writtenAt };
  // Whole keys, not dotted paths: a settings key is free to contain a dot
  // (orgCharts entries are keyed by name), and splitting one would write to
  // a nested field nothing reads.
  const { viaRest } = await writeSettingsFields(
    userId,
    keyFieldEntries(written),
    () => writeWholeKeys(ref, written),
  );
  return { stale: false, writtenAt, viaRest };
}

// Write whole settings keys, each one REPLACING what the document holds
// under it.
//
// This used to be setDoc(merge: true), and merge does not mean what a
// caller here means by it: Firestore folds a map field in KEY BY KEY, so a
// write of { ccMap: {…} } that leaves out the address somebody just removed
// leaves that address sitting on the server. Every "clear this" in the app
// is shaped that way - drop the entry from a copy of the map, save the map -
// so none of them ever landed. The value came back on the next load, which
// is what "I removed it and it's back the next day" was.
//
// updateDoc against a top-level field replaces that field's whole value,
// which is what the callers mean and what the HTTPS fallback's update mask
// has always done, so the two paths now agree rather than quietly differing
// on whether a removal counts.
//
// FieldPath rather than a plain string: a settings key is free to contain a
// dot, and updateDoc reads a dotted string as a path into a nested map.
async function writeWholeKeys(ref, written) {
  const args = [];
  for (const [key, value] of Object.entries(written)) {
    if (value === undefined) continue;
    // null is how a caller spells "drop this key", the same thing it means
    // to the REST fallback (in the mask, absent from the body).
    args.push(new FieldPath(key), value === null ? deleteField() : value);
  }
  if (!args.length) return;
  try {
    await updateDoc(ref, ...args);
  } catch (err) {
    // updateDoc refuses a document that doesn't exist, which is exactly a
    // user's first save. Nothing is there to replace, so a plain write is
    // the same thing.
    if (err?.code !== 'not-found') throw err;
    const seed = {};
    for (const [key, value] of Object.entries(written)) {
      if (value != null) seed[key] = value;
    }
    await setDoc(ref, seed, { merge: true });
  }
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
//
// opts.wholeValues: the settings with these paths applied. A path into one
// of the big maps kept in their own documents (utils/settingsCodec) is
// written as the map's whole new value, read from here. Required whenever
// such a path is in the update.
export async function savePathUpdates(userId, pathUpdates, opts = {}) {
  const ref = doc(db, COL, userId);
  const { expectedAt, force, wholeValues } = opts;
  const { ops, rest: rawRest } = splitSiteListPaths(pathUpdates);
  const { keys, main: rest } = splitPathUpdates(rawRest, wholeValues);
  const keyNames = Object.keys(keys);

  if (!force && expectedAt != null) {
    try {
      const remote = await readSettingsDoc(userId, ref, keyNames);
      if (remote) {
        const remoteAt = Number(remote._lastWriteAt || 0);
        if (remoteAt > Number(expectedAt)) {
          return { stale: true, remoteAt, remoteData: await withSiteLists(userId, remote, ops) };
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
  // The big maps' documents first, as in saveUserSettings.
  if (keyNames.length) await writeSettingsKeys(userId, keys, writtenAt);

  // Still stamp _lastWriteAt even when every path went to the
  // subcollection: it is what other devices watch to know this one wrote.
  const updates = { _lastWriteAt: writtenAt };
  for (const [path, value] of Object.entries(rest)) {
    updates[path] = value == null ? deleteField() : value;
  }

  // The REST patch these paths become if the SDK can't take them. Written
  // from `rest` rather than `updates`, since deleteField() is an SDK
  // sentinel — over HTTPS a delete is the path being in the update mask
  // and absent from the body, which a null value spells.
  const fieldEntries = dottedFieldEntries({ ...rest, _lastWriteAt: writtenAt });

  const { viaRest } = await writeSettingsFields(userId, fieldEntries, async () => {
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
  });

  return { stale: false, writtenAt, viaRest };
}

export async function initUserSettings(userId) {
  const ref = doc(db, COL, userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await migrateFromLocalStorage(userId);
  }
}

// One read of the settings document, right now, outside the live
// subscription above.
//
// The subscription is what normally keeps a reader current, and while it is
// healthy this returns what the reader already has. It earns its keep when
// it doesn't: a crashed SDK client (see firestoreClientHealth) leaves every
// listener in the tab dead, so a rate card edited on another device stops
// arriving and nothing says so. readSettingsDoc goes around that over HTTPS,
// which means a reader that asks can still get the saved truth out of a tab
// that has quietly stopped hearing it.
export async function fetchUserSettings(userId) {
  if (!userId) return null;
  return readSettingsDoc(userId, doc(db, COL, userId), ENCODED_SETTINGS_KEYS);
}
