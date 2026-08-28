import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import { logAction } from '../utils/auditLog';
import { ADMIN_EMAIL, isEmailAllowed, allowlistDescription } from '../config/accessControl';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);

  const isAdmin = role === 'admin';

  /** Fetch (or bootstrap) the user's role from Firestore. */
  async function resolveRole(firebaseUser) {
    if (!firebaseUser) {
      setRole('viewer');
      return;
    }
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const snap = await getDoc(userRef);

      if (firebaseUser.email === ADMIN_EMAIL) {
        // Auto-promote the owner to admin and persist it
        setRole('admin');
        await setDoc(userRef, { role: 'admin', email: firebaseUser.email }, { merge: true });
        return;
      }

      if (snap.exists() && snap.data().role) {
        setRole(snap.data().role);
      } else {
        setRole('viewer');
      }
    } catch (err) {
      console.warn('Failed to resolve user role:', err);
      setRole('viewer');
    }
  }

  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // Backstop: a session for a non-allowlisted email (e.g. a stale
      // token, or a Google account outside the company domain) is
      // signed out before any data loads.
      if (firebaseUser && !isEmailAllowed(firebaseUser.email)) {
        setAuthError(`${firebaseUser.email} isn't authorized. ${allowlistDescription()}`);
        try { await signOut(auth); } catch { /* ignore */ }
        return;
      }
      // Partition all browser-local IndexedDB reads/writes by user
      // before any consumer hook starts loading data.
      try {
        const { setDbUserId } = await import('../utils/db');
        setDbUserId(firebaseUser?.uid || null);
      } catch (err) {
        console.warn('Failed to set IndexedDB user scope', err);
      }
      // Same partitioning for localStorage-backed stores (deals roster,
      // commissions, AgentsView overrides, HubSpot activity cache, etc.).
      try {
        const { setUserLsUserId } = await import('../utils/userLs');
        setUserLsUserId(firebaseUser?.uid || null);
      } catch (err) {
        console.warn('Failed to set localStorage user scope', err);
      }
      // The deals roster and the Clients-tab typed fields are localStorage
      // stores with a Firestore mirror. Pull anything the cloud holds that
      // this browser doesn't (a cleared browser, a new machine) now that the
      // localStorage scope above is set — the keys are per-user prefixed, so
      // hydrating any earlier would read the wrong slot. Not awaited: each
      // store fires its own change event when a value lands, which is how
      // the views already refresh, so this must not hold up sign-in.
      try {
        const { hydrateLocalMirrors, setMirrorUserId } = await import('../utils/localMirrorSync');
        setMirrorUserId(firebaseUser?.uid || null);
        if (firebaseUser?.uid) {
          hydrateLocalMirrors(firebaseUser.uid)
            .catch(err => console.warn('Failed to hydrate local mirrors', err));
        }
      } catch (err) {
        console.warn('Failed to start local mirror sync', err);
      }
      // Partition encrypted token storage (Outlook OAuth tokens, etc.).
      try {
        const { setSecureUserId } = await import('../utils/secureStorage');
        setSecureUserId(firebaseUser?.uid || null);
      } catch (err) {
        console.warn('Failed to set secure storage user scope', err);
      }
      setUser(firebaseUser);
      await resolveRole(firebaseUser);
      setLoading(false);
    });
    return unsub;
  }, []);

  const googleSignInPendingRef = useRef(false);

  async function signInWithGoogle() {
    if (googleSignInPendingRef.current) return; // a popup is already open
    googleSignInPendingRef.current = true;
    try {
      setAuthError(null);
      const result = await signInWithPopup(auth, googleProvider);
      if (!isEmailAllowed(result.user.email)) {
        setAuthError(`${result.user.email} isn't authorized. ${allowlistDescription()}`);
        await signOut(auth);
        return;
      }
      await logAction(result.user, 'login', { method: 'google' });
    } catch (err) {
      // Benign — a new popup opened while an old one was pending. Don't show.
      if (err?.code === 'auth/cancelled-popup-request') return;
      // User dismissed the popup — silent, they'll try again.
      if (err?.code === 'auth/popup-closed-by-user') return;
      console.error('Google sign-in error:', err);
      setAuthError(err.message || 'Sign-in failed');
    } finally {
      googleSignInPendingRef.current = false;
    }
  }

  async function signInWithEmail(email, password) {
    if (!isEmailAllowed(email)) {
      setAuthError(`That email isn't authorized. ${allowlistDescription()}`);
      return;
    }
    try {
      setAuthError(null);
      const result = await signInWithEmailAndPassword(auth, email, password);
      await logAction(result.user, 'login', { method: 'email' });
    } catch (err) {
      setAuthError(err.code === 'auth/invalid-credential' ? 'Invalid email or password' : err.message || 'Sign-in failed');
    }
  }

  async function createAccount(email, password, cdmName) {
    if (!isEmailAllowed(email)) {
      setAuthError(`That email isn't authorized. ${allowlistDescription()}`);
      return;
    }
    try {
      setAuthError(null);
      const result = await createUserWithEmailAndPassword(auth, email, password);
      // Seed the new user's userSettings with their chosen CDM name so
      // every CDM-filtering view immediately scopes to them, not the admin.
      if (cdmName && cdmName.trim()) {
        try {
          await setDoc(doc(db, 'userSettings', result.user.uid), {
            cdmName: cdmName.trim(),
            _lastWriteAt: Date.now(),
          }, { merge: true });
        } catch (settingsErr) {
          console.warn('Failed to save initial cdmName:', settingsErr);
        }
      }
      await logAction(result.user, 'signup', { method: 'email' });
    } catch (err) {
      setAuthError(err.code === 'auth/email-already-in-use' ? 'Account already exists: try signing in' : err.message || 'Sign-up failed');
    }
  }

  async function resetPassword(email) {
    setAuthError(null);
    await sendPasswordResetEmail(auth, email);
  }

  async function logout() {
    await logAction(user, 'logout');
    await signOut(auth);
  }

  /** Returns true if the current user is an admin. Shows an alert and returns false otherwise. */
  function requireAdmin() {
    if (isAdmin) return true;
    alert('This action requires admin privileges.');
    return false;
  }

  return (
    <AuthContext.Provider value={{ user, loading, authError, role, isAdmin, requireAdmin, signInWithGoogle, signInWithEmail, createAccount, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
