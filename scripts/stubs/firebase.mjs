// Stands in for src/firebase.js, which reads import.meta.env and THROWS
// while it is still evaluating outside a Vite build. The stub database
// handle is only ever passed to the stubbed firestore functions.
export const db = { __stub: true };
export const auth = {};
export const googleProvider = {};
