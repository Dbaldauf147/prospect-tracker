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
    existingIds.slice(i, i + 400).forEach(id => batch.delete(doc(db, PROSPECTS_COL, id)));
    await batch.commit();
    completed += Math.min(400, existingIds.length - i);
    await report('Clearing old data');
  }
  // Add new in batches
  for (let i = 0; i < newProspects.length; i += 400) {
    const batch = writeBatch(db);
    newProspects.slice(i, i + 400).forEach(p => {
      const ref = doc(collection(db, PROSPECTS_COL));
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
