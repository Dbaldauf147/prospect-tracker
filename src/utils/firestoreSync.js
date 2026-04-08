import { collection, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const PROSPECTS_COL = 'prospects';

// Get the collection path — per-user if userId provided, shared fallback
function prospectsCol(userId) {
  if (userId) return collection(db, 'users', userId, 'prospects');
  return collection(db, PROSPECTS_COL);
}

function prospectDoc(userId, id) {
  if (userId) return doc(db, 'users', userId, 'prospects', id);
  return doc(db, PROSPECTS_COL, id);
}

let _userId = null;
export function setProspectsUserId(uid) { _userId = uid; }

export function subscribeToProspects(onChange, userId) {
  const uid = userId || _userId;
  // Try user-specific collection first
  if (uid) {
    return onSnapshot(prospectsCol(uid), (snap) => {
      const prospects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // If user has their own data, use it. Otherwise fall back to shared.
      if (prospects.length > 0) {
        onChange(prospects);
      } else {
        // Fall back to shared collection for migration
        const unsub2 = onSnapshot(collection(db, PROSPECTS_COL), (sharedSnap) => {
          onChange(sharedSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        // Store for cleanup — but we can't easily return two unsubs
        // So just subscribe to shared as fallback
      }
    }, (err) => {
      console.error('Firestore prospects subscription error:', err);
    });
  }
  return onSnapshot(collection(db, PROSPECTS_COL), (snap) => {
    onChange(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('Firestore prospects subscription error:', err);
  });
}

export async function addProspect(prospect) {
  const col = _userId ? prospectsCol(_userId) : collection(db, PROSPECTS_COL);
  const ref = doc(col);
  await setDoc(ref, {
    ...prospect,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProspect(id, updates) {
  const ref = _userId ? prospectDoc(_userId, id) : doc(db, PROSPECTS_COL, id);
  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProspect(id) {
  const ref = _userId ? prospectDoc(_userId, id) : doc(db, PROSPECTS_COL, id);
  await deleteDoc(ref);
}

function waitFrame() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export async function replaceAllProspects(existingIds, newProspects, onProgress) {
  const totalSteps = existingIds.length + newProspects.length;
  let completed = 0;

  async function report(phase) {
    const pct = Math.round((completed / totalSteps) * 100);
    if (onProgress) onProgress(`${phase} — ${pct}%`);
    // Yield to browser so UI can repaint
    await waitFrame();
  }

  // Delete existing in batches
  for (let i = 0; i < existingIds.length; i += 400) {
    const batch = writeBatch(db);
    existingIds.slice(i, i + 400).forEach(id => batch.delete(_userId ? prospectDoc(_userId, id) : doc(db, PROSPECTS_COL, id)));
    await batch.commit();
    completed += Math.min(400, existingIds.length - i);
    await report('Clearing old data');
  }
  // Add new in batches
  for (let i = 0; i < newProspects.length; i += 400) {
    const batch = writeBatch(db);
    newProspects.slice(i, i + 400).forEach(p => {
      const col = _userId ? prospectsCol(_userId) : collection(db, PROSPECTS_COL);
      const ref = doc(col);
      batch.set(ref, { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await batch.commit();
    completed += Math.min(400, newProspects.length - i);
    await report('Writing new data');
  }
  return { deleted: existingIds.length, added: newProspects.length };
}

export async function seedProspects(prospects) {
  // Check if collection already has data
  const col = _userId ? prospectsCol(_userId) : collection(db, PROSPECTS_COL);
  const snap = await getDocs(col);
  if (snap.size > 0) return false; // already seeded

  const batch = writeBatch(db);
  for (const prospect of prospects) {
    const ref = doc(col);
    batch.set(ref, {
      ...prospect,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}
