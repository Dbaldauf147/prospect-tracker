// Coaching rules — free-form standing instructions that shape
// Claude's morning goal suggestions. Persisted in Firestore under
// `userSettings/{uid}.coachingRules` so the rules sync across
// devices and survive a Clear Site Data.

import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { saveUserSettings } from '../../utils/userSettingsSync';

export const DEFAULT_COACHING_RULES = {
  notes: '',
};

function normalize(raw) {
  const r = raw || {};
  return {
    notes: typeof r.notes === 'string' ? r.notes : '',
  };
}

export function subscribeToCoachingRules(uid, onChange) {
  if (!uid) return () => {};
  const ref = doc(db, 'userSettings', uid);
  return onSnapshot(ref, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    onChange(normalize(data?.coachingRules));
  }, (err) => {
    console.warn('coachingRules subscription error:', err);
    onChange(normalize(null));
  });
}

export async function saveCoachingRules(uid, rules) {
  if (!uid) return;
  // force: true is safe here because we only write the coachingRules
  // field — saveUserSettings uses setDoc with merge, so other fields
  // are untouched.
  await saveUserSettings(uid, { coachingRules: normalize(rules) }, { force: true });
}
