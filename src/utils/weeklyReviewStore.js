// This module used to hold the saved weekly reviews as well as the progress
// snapshots below. The "what's holding you back" review was removed from the
// Weekly Report, so its load/save pair went with it — but the `weeklyReviews`
// Firestore documents are deliberately left in place: they are the user's own
// history, and deleting them to tidy up a UI change would throw away data
// that reverting this commit could not bring back.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// The Progress tab's weekly account-coverage snapshots. Read-only here — the
// Progress page owns writing them; the Weekly Report's KPI cards just need
// the trend.
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
