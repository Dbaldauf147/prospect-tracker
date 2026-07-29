// STUB for the standalone export.
//
// The real app authenticates with Firebase and resolves a per-user role
// from Firestore. This export has no backend, so we hand every consumer a
// static "signed-in admin" so the pages render with full access. The only
// thing the exported pages read from here is `user` (PricingView) — the
// rest of the surface is provided so nothing throws if it's referenced.

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
  // No-op auth actions — wired so buttons that call them don't crash.
  loginWithGoogle: async () => {},
  loginWithEmail: async () => {},
  signup: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
};

const AuthContext = createContext(VALUE);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  return <AuthContext.Provider value={VALUE}>{children}</AuthContext.Provider>;
}
