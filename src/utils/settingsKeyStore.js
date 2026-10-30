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
import { SETTINGS_KEYS_COLLECTION, isEncodedSettingsKey, keyDocData, keyDocValue } from './settingsCodec.js';

const COL = 'userSettings';
const keysCol = (userId) => collection(db, COL, userId, SETTINGS_KEYS_COLLECTION);
const keyDoc = (userId, key) => doc(db, COL, userId, SETTINGS_KEYS_COLLECTION, key);
const keyDocPath = (userId, key) => `${COL}/${userId}/${SETTINGS_KEYS_COLLECTION}/${key}`;

/** Live view of every map's document, as key -> value. */
export function subscribeToSettingsKeys(userId, onChange, onError) {
  return onSnapshot(keysCol(userId), (snap) => {
    const out = {};
    snap.forEach((d) => {
      if (!isEncodedSettingsKey(d.id)) return;
      const value = keyDocValue(d.data(), d.id);
      if (value !== undefined) out[d.id] = value;
    });
    onChange(out);
  }, (err) => {
    console.error('settingsKeys subscription error:', err);
    onError?.(err);
  });
}

/** The stored values of some maps, key -> value (absent when there is no document). */
export async function readSettingsKeys(userId, keys) {
  const out = {};
  await Promise.all([...new Set(keys)].filter(isEncodedSettingsKey).map(key => viaSdkOrRest(async () => {
    const snap = await getDoc(keyDoc(userId, key));
    const value = snap.exists() ? keyDocValue(snap.data(), key) : undefined;
    if (value !== undefined) out[key] = value;
  }, async () => {
    const value = keyDocValue(await restGetDoc(keyDocPath(userId, key)), key);
    if (value !== undefined) out[key] = value;
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
