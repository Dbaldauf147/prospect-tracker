// SHIM for the Lovable export.
//
// In the full app this initializes Firebase (Auth + Firestore). The
// export is offline, so there's nothing to initialize — we just export
// the same names other modules import. `db` is handed to the (aliased,
// no-op) `firebase/firestore` functions, so its actual value is never
// read. `auth` / `googleProvider` are only referenced by code paths
// that the stubbed AuthContext never reaches.

export const db = {};
export const auth = {};
export const googleProvider = {};
