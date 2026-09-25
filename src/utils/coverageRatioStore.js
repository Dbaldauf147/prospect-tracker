// The weekly coverage-ratio log: one reading per week of open pipeline ÷
// annual target, so the Weekly Report email can show which way the ratio
// is going rather than only where it stands today.
//
// Its own Firestore document (coverageRatioHistory/{uid}, a `weeks` map
// keyed by Monday) rather than a mirrored localStorage key, because two
// writers share it: the Weekly Report tab records the week it is opened in,
// and the scheduled send's rebuild fills a week nobody opened it in. A
// mirror is pushed whole from one browser and would drop whatever the cron
// had added; a merge-write of one map entry cannot.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const COVERAGE_RATIO_COLLECTION = 'coverageRatioHistory';

export async function loadCoverageRatioLog(uid) {
  if (!uid) return {};
  const snap = await getDoc(doc(db, COVERAGE_RATIO_COLLECTION, uid));
  const weeks = snap.exists() ? snap.data()?.weeks : null;
  return (weeks && typeof weeks === 'object') ? weeks : {};
}

// Record one week's entry. A merge, so the other weeks - including any the
// cron wrote - are left exactly as they are.
export async function saveCoverageRatioReading(uid, key, entry) {
  if (!uid || !key || !entry) return;
  await setDoc(doc(db, COVERAGE_RATIO_COLLECTION, uid), { weeks: { [key]: entry } }, { merge: true });
}
