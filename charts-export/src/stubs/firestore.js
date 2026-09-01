// SHIM for the Lovable export — stands in for `firebase/firestore`.
//
// The Opps page (OppsView2.jsx) imports `doc`, `collection`, `getDocs`
// and `onSnapshot` directly from `firebase/firestore` to power its
// cross-device real-time sync. This export is fully offline — there is
// no Firestore project behind it — so `vite.config.js` aliases
// `firebase/firestore` to this file. Every function is a harmless no-op:
//
//   • doc / collection      → return an opaque placeholder ref
//   • getDoc / getDocs      → resolve to an "empty" snapshot
//   • onSnapshot            → never fires; returns an unsubscribe fn
//   • setDoc / writeBatch … → resolve without doing anything
//
// The page's hydration logic already tolerates an empty cloud (it falls
// back to the local IndexedDB cache, which we seed with sample data),
// so the table renders fully and edits persist locally — they just
// don't sync anywhere.

const ref = { id: 'demo', path: 'demo' };

export function doc() { return ref; }
export function collection() { return ref; }
export function deleteField() { return undefined; }
export function serverTimestamp() { return Date.now(); }

export async function getDoc() {
  return { exists: () => false, data: () => null, id: 'demo' };
}

export async function getDocs() {
  return { forEach: () => {}, docs: [], empty: true, size: 0 };
}

export async function setDoc() {}
export async function deleteDoc() {}
export async function addDoc() { return ref; }

export function onSnapshot() {
  // Return the unsubscribe function the caller expects. The listener
  // never fires, so the page simply runs on its hydrated data.
  return () => {};
}

export function writeBatch() {
  return {
    set() { return this; },
    update() { return this; },
    delete() { return this; },
    async commit() {},
  };
}
