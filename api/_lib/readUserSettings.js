// A user's settings as the app sees them, for the server jobs: the settings
// document with the big maps that moved to their own documents
// (`userSettings/{uid}/settingsKeys/{key}`, see src/utils/settingsCodec.js)
// folded back in. null when there is nothing stored.
import { composeSettings, keyDocValue, SETTINGS_KEYS_COLLECTION, isEncodedSettingsKey } from '../../src/utils/settingsCodec.js';

export async function readUserSettings(db, uid) {
  const ref = db.collection('userSettings').doc(uid);
  const [snap, keys] = await Promise.all([
    ref.get(),
    // A failed read of the maps still leaves whatever the settings document
    // holds for them, which is better than failing the whole job.
    ref.collection(SETTINGS_KEYS_COLLECTION).get().catch((err) => {
      console.warn('readUserSettings: settingsKeys read failed', err?.message || err);
      return null;
    }),
  ]);
  const values = {};
  keys?.forEach((d) => {
    if (!isEncodedSettingsKey(d.id)) return;
    const value = keyDocValue(d.data(), d.id);
    if (value !== undefined) values[d.id] = value;
  });
  if (!snap.exists && !Object.keys(values).length) return null;
  return composeSettings(snap.exists ? (snap.data() || {}) : {}, values);
}
