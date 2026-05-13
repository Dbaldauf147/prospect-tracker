import { collection, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Subcollection path for analyses saved against a prospect. Kept
// separate from the prospect doc so the bulk subscribeToProspects
// query stays lean — a 500 KB base64 XLSX would otherwise multiply
// initial-load size across the whole list.
const ANALYSIS_DOC_ID = 'main';

const SHARED_COL = 'prospects';

// Admin uses the shared collection; everyone else gets their own
let _userId = null;
let _useShared = false;

export function setProspectsUser(uid, email) {
  _userId = uid;
  _useShared = (email === 'baldaufdan@gmail.com');
}

function getCol() {
  if (_useShared) return collection(db, SHARED_COL);
  if (_userId) return collection(db, 'users', _userId, 'prospects');
  return collection(db, SHARED_COL);
}

function getDoc(id) {
  if (_useShared) return doc(db, SHARED_COL, id);
  if (_userId) return doc(db, 'users', _userId, 'prospects', id);
  return doc(db, SHARED_COL, id);
}

export function subscribeToProspects(onChange) {
  return onSnapshot(getCol(), (snap) => {
    const prospects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onChange(prospects);
  }, (err) => {
    console.error('Firestore prospects subscription error:', err);
  });
}

export async function addProspect(prospect) {
  const ref = doc(getCol());
  await setDoc(ref, {
    ...prospect,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProspect(id, updates) {
  await updateDoc(getDoc(id), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProspect(id) {
  await deleteDoc(getDoc(id));
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
    existingIds.slice(i, i + 400).forEach(id => batch.delete(getDoc(id)));
    await batch.commit();
    completed += Math.min(400, existingIds.length - i);
    await report('Clearing old data');
  }
  // Add new in batches
  for (let i = 0; i < newProspects.length; i += 400) {
    const batch = writeBatch(db);
    newProspects.slice(i, i + 400).forEach(p => {
      const ref = doc(getCol());
      batch.set(ref, { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await batch.commit();
    completed += Math.min(400, newProspects.length - i);
    await report('Writing new data');
  }
  return { deleted: existingIds.length, added: newProspects.length };
}

function getAnalysisDoc(prospectId) {
  if (_useShared) return doc(db, SHARED_COL, prospectId, 'analyses', ANALYSIS_DOC_ID);
  if (_userId) return doc(db, 'users', _userId, 'prospects', prospectId, 'analyses', ANALYSIS_DOC_ID);
  return doc(db, SHARED_COL, prospectId, 'analyses', ANALYSIS_DOC_ID);
}

export async function saveIndicativeAnalysis(prospectId, { fileName, dataBase64, sizeBytes }) {
  await setDoc(getAnalysisDoc(prospectId), {
    fileName,
    dataBase64,
    sizeBytes,
    capturedAt: serverTimestamp(),
  });
}

export function subscribeIndicativeAnalysis(prospectId, onChange) {
  return onSnapshot(getAnalysisDoc(prospectId), (snap) => {
    onChange(snap.exists() ? snap.data() : null);
  }, (err) => {
    console.error('Firestore analysis subscription error:', err);
  });
}

export async function deleteIndicativeAnalysis(prospectId) {
  await deleteDoc(getAnalysisDoc(prospectId));
}

export async function seedProspects(prospects) {
  // Check if collection already has data
  const snap = await getDocs(getCol());
  if (snap.size > 0) return false; // already seeded

  const batch = writeBatch(db);
  for (const prospect of prospects) {
    const ref = doc(getCol());
    batch.set(ref, {
      ...prospect,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}
