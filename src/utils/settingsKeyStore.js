// The big settings maps' own documents, `userSettings/{uid}/settingsKeys/{key}`
// (see settingsCodec for why they moved off the settings document). Each
// holds one map as a JSON string: { json, at }.
//
// Every read and write goes through viaSdkOrRest, so a crashed Firestore
// client still reaches them over HTTPS, the same as the settings document.

import { collection, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { onSnapshot } from './safeOnSnapshot';
import { db } from '../firebase';
import { restDeleteDoc, restGetDoc, restSetDoc } from './firestoreRest.js';
import { viaSdkOrRest } from './firestoreClientHealth.js';
import { SETTINGS_KEYS_COLLECTION, isEncodedSettingsKey, keyDocAt, keyDocData, keyDocValue } from './settingsCodec.js';

const COL = 'userSettings';
const keysCol = (userId) => collection(db, COL, userId, SETTINGS_KEYS_COLLECTION);
const keyDoc = (userId, key) => doc(db, COL, userId, SETTINGS_KEYS_COLLECTION, key);
const keyDocPath = (userId, key) => `${COL}/${userId}/${SETTINGS_KEYS_COLLECTION}/${key}`;

/**
 * Live view of every map's document, as key -> value, and key -> the `at`
 * it was written with (what a save compares to tell its copy is old).
 */
export function subscribeToSettingsKeys(userId, onChange, onError) {
  return onSnapshot(keysCol(userId), (snap) => {
    const out = {};
    const ats = {};
    snap.forEach((d) => {
      if (!isEncodedSettingsKey(d.id)) return;
      const data = d.data();
      const value = keyDocValue(data, d.id);
      if (value !== undefined) { out[d.id] = value; ats[d.id] = keyDocAt(data); }
    });
    onChange(out, ats);
  }, (err) => {
    console.error('settingsKeys subscription error:', err);
    onError?.(err);
  });
}

/**
 * The stored values of some maps, key -> value (absent when there is no
 * document). `atsOut`, when given, is filled with key -> each one's `at`.
 */
export async function readSettingsKeys(userId, keys, atsOut = null) {
  const out = {};
  const take = (key, data) => {
    const value = data ? keyDocValue(data, key) : undefined;
    if (value === undefined) return;
    out[key] = value;
    if (atsOut) atsOut[key] = keyDocAt(data);
  };
  await Promise.all([...new Set(keys)].filter(isEncodedSettingsKey).map(key => viaSdkOrRest(async () => {
    const snap = await getDoc(keyDoc(userId, key));
    take(key, snap.exists() ? snap.data() : null);
  }, async () => {
    take(key, await restGetDoc(keyDocPath(userId, key)));
  })));
  return out;
}

/** Write maps to their documents: key -> value, null deleting the document. */
export async function writeSettingsKeys(userId, values, at = Date.now()) {
  // One at a time: each can run to hundreds of KB.
  for (const [key, value] of Object.entries(values || {})) {
    if (!isEncodedSettingsKey(key)) continue;
    if (value == null) {
      await viaSdkOrRest(() => deleteDoc(keyDoc(userId, key)), () => restDeleteDoc(keyDocPath(userId, key)));
    } else {
      const data = keyDocData(value, at);
      await viaSdkOrRest(() => setDoc(keyDoc(userId, key), data), () => restSetDoc(keyDocPath(userId, key), data));
    }
  }
}
