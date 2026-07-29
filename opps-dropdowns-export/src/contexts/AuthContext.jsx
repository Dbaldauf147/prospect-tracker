// SHIM for the Lovable export.
//
// The real AuthContext wraps Firebase Auth (Google sign-in, email/password,
// per-user roles read from Firestore). The export has no backend and no
// login screen, so we hand every consumer a fixed "demo" user with admin
// rights. OppsView2 reads `user.uid` (to key its local cache) and
// `isAdmin` (to gate a couple of admin-only buttons); both are satisfied
// here.

import { createContext, useContext } from 'react';

const DEMO_USER = {
  uid: 'demo-user',
  email: 'demo@example.com',
  displayName: 'Demo User',
};

const VALUE = {
  user: DEMO_USER,
  role: 'admin',
  isAdmin: true,
  loading: false,
  authError: null,
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  registerWithEmail: async () => {},
  resetPassword: async () => {},
  logout: async () => {},
};

const AuthContext = createContext(VALUE);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  return <AuthContext.Provider value={VALUE}>{children}</AuthContext.Provider>;
}
