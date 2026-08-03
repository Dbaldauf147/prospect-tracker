// Persisted weekly reviews — one row per week, in Firestore so the history
// survives a cache clear and follows the user across browsers.
//
// Shape mirrors progressHistory: a single per-user document holding a `weeks`
// array sorted oldest-first. Reviews are small (a headline, a few blockers,
// and the numbers they were written from), so one document comfortably holds
// years of them.
//
// NOTE: this collection needs a rule in firestore.rules (`weeklyReviews`).
// Until `firebase deploy --only firestore:rules` runs, reads and writes fail
// with permission-denied — save() surfaces that rather than swallowing it.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION = 'weeklyReviews';

// The stats block is kept alongside each review so a stored row can be
// re-read later, but it's capped so a year of weeks can't approach
// Firestore's 1 MB per-document limit.
const MAX_STATS_CHARS = 8000;

export async function loadWeeklyReviews(uid) {
  if (!uid) return [];
  const snap = await getDoc(doc(db, COLLECTION, uid));
  if (!snap.exists()) return [];
  const weeks = snap.data()?.weeks;
  return Array.isArray(weeks)
    ? weeks.filter(w => w && typeof w === 'object' && typeof w.week === 'string')
      .sort((a, b) => a.week.localeCompare(b.week))
    : [];
}

// Insert or replace the entry for `entry.week`. Re-reads the remote document
// first so a save from another device isn't clobbered, and returns the merged
// list the caller should render.
export async function saveWeeklyReview(uid, entry, localWeeks = []) {
  if (!uid) throw new Error('Not signed in');
  if (!entry || typeof entry.week !== 'string') throw new Error('Review needs a week key');

  const ref = doc(db, COLLECTION, uid);
  const snap = await getDoc(ref);
  const remote = snap.exists() && Array.isArray(snap.data()?.weeks) ? snap.data().weeks : [];

  const merged = [...remote];
  for (const w of localWeeks) {
    if (w && typeof w.week === 'string' && !merged.some(m => m.week === w.week)) merged.push(w);
  }

  const clean = JSON.parse(JSON.stringify({
    ...entry,
    statsText: typeof entry.statsText === 'string'
      ? entry.statsText.slice(0, MAX_STATS_CHARS)
      : '',
  }));

  const idx = merged.findIndex(w => w.week === clean.week);
  if (idx >= 0) merged[idx] = clean;
  else merged.push(clean);
  merged.sort((a, b) => a.week.localeCompare(b.week));

  await setDoc(ref, { weeks: merged, updatedAt: new Date().toISOString() });
  return merged;
}

// The Progress tab's weekly account-coverage snapshots. Read-only here — the
// Progress page owns writing them; the review just needs the trend.
export async function loadProgressWeeks(uid) {
  if (!uid) return [];
  const snap = await getDoc(doc(db, 'progressHistory', uid));
  if (!snap.exists()) return [];
  const weeks = snap.data()?.weeks;
  return Array.isArray(weeks)
    ? weeks.filter(w => w && typeof w === 'object' && typeof w.week === 'string')
      .sort((a, b) => a.week.localeCompare(b.week))
    : [];
}
