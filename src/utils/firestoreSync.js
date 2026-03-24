import { collection, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const PROSPECTS_COL = 'prospects';

export function subscribeToProspects(onChange) {
  return onSnapshot(collection(db, PROSPECTS_COL), (snap) => {
    const prospects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onChange(prospects);
  }, (err) => {
    console.error('Firestore prospects subscription error:', err);
  });
}

export async function addProspect(prospect) {
  const ref = doc(collection(db, PROSPECTS_COL));
  await setDoc(ref, {
    ...prospect,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProspect(id, updates) {
  const ref = doc(db, PROSPECTS_COL, id);
  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProspect(id) {
  await deleteDoc(doc(db, PROSPECTS_COL, id));
}

export async function seedProspects(prospects) {
  // Check if collection already has data
  const snap = await getDocs(collection(db, PROSPECTS_COL));
  if (snap.size > 0) return false; // already seeded

  const batch = writeBatch(db);
  for (const prospect of prospects) {
    const ref = doc(collection(db, PROSPECTS_COL));
    batch.set(ref, {
      ...prospect,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}
