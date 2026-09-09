// Module resolve hook that swaps Firestore for the stubs next door.
//
// Registered with node:module's register() by a test before it imports the
// module under test, so `import { setDoc } from 'firebase/firestore'` inside
// src/utils resolves here instead of to the real SDK. The stub module is a
// normal file, so the test and the code under test share one instance of it
// and the test can steer what the "database" does.
const FIRESTORE = new URL('./firestore.mjs', import.meta.url).href;
const FIREBASE = new URL('./firebase.mjs', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'firebase/firestore') return { url: FIRESTORE, shortCircuit: true };
  // Every module under src/ reaches the app's firebase handle by relative
  // path ('../firebase', './firebase.js'), so match on the tail.
  if (/(^|\/)\.\.?\/firebase(\.js)?$/.test(specifier)) return { url: FIREBASE, shortCircuit: true };
  return nextResolve(specifier, context);
}
