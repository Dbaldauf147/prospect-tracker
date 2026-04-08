import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import { logAction } from '../utils/auditLog';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      await resolveRole(firebaseUser);
      setLoading(false);
    });
    return unsub;
  }, []);

  const [authError, setAuthError] = useState(null);

  async function signInWithGoogle() {
    try {
      setAuthError(null);
      const result = await signInWithPopup(auth, googleProvider);
      await logAction(result.user, 'login', { method: 'google' });
    } catch (err) {
      console.error('Google sign-in error:', err);
      setAuthError(err.message || 'Sign-in failed');
    }
  }

  async function signInWithEmail(email, password) {
    try {
      setAuthError(null);
      const result = await signInWithEmailAndPassword(auth, email, password);
      await logAction(result.user, 'login', { method: 'email' });
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        // Try creating the account
        try {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          await logAction(result.user, 'signup', { method: 'email' });
        } catch (signupErr) {
          setAuthError(signupErr.message || 'Sign-up failed');
        }
      } else {
        setAuthError(err.message || 'Sign-in failed');
      }
    }
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
    <AuthContext.Provider value={{ user, loading, authError, role, isAdmin, requireAdmin, signInWithGoogle, signInWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
