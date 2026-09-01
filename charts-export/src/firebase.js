// STUB for the standalone export.
//
// The full app initializes Firebase (Auth + Firestore) here. This export
// is offline, so there's nothing to initialize — we export the same names
// other modules import. `db` is only ever handed to the aliased, no-op
// `firebase/firestore` functions (see vite.config.js), so its value is
// never actually read. `auth` / `googleProvider` are only touched by code
// paths the stubbed AuthContext never reaches.
export const db = {};
export const auth = {};
export const googleProvider = {};
