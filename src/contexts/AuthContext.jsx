import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';
import { logAction } from '../utils/auditLog';
import { ADMIN_EMAIL, isEmailAllowed, allowlistDescription } from '../config/accessControl';
import { withTimeout, isTimeoutError } from '../utils/withTimeout';

// How long the role lookup gets before the app gives up on it and goes in
// as a viewer, and how long onAuthStateChanged gets to fire at all before
// the gate stops pretending it is still loading. Both are generous: they
// are not there to make a slow network feel fast, only to make sure a
// network that never answers cannot hold the app on its loading screen.
const ROLE_TIMEOUT_MS = 10000;
const AUTH_STALL_MS = 15000;

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);

  const isAdmin = role === 'admin';

  /**
   * Fetch (or bootstrap) the user's role from Firestore.
   *
   * Deliberately NOT awaited by the sign-in path any more. Every call in
   * here can hang rather than fail -- see utils/withTimeout -- and while
   * `setLoading(false)` sat behind it, a browser that could not reach
   * Firestore left the app on "Loading..." for the life of the tab. The
   * role is not needed to render: it starts at 'viewer', every consumer
   * reads it reactively, and the admin-only actions are guarded
   * separately, so it can land a moment late without anything being
   * wrong. It must never decide whether the app opens at all.
   */
  async function resolveRole(firebaseUser) {
    if (!firebaseUser) {
      setRole('viewer');
      return;
    }
    // The owner is admin by virtue of the email, which is known here
    // without asking Firestore anything. Set it first so a database that
    // never answers cannot cost the owner their own admin rights.
    const isOwner = firebaseUser.email === ADMIN_EMAIL;
    if (isOwner) setRole('admin');

    const userRef = doc(db, 'users', firebaseUser.uid);

    if (isOwner) {
      // Persisting it is bookkeeping for other readers of the document,
      // not something this session needs, so it is fire-and-forget. It
      // used to be awaited, which is the hang: setDoc resolves on server
      // acknowledgement, so offline it stays pending forever rather than
      // rejecting, and the queued write lands by itself when the network
      // comes back.
      setDoc(userRef, { role: 'admin', email: firebaseUser.email }, { merge: true })
        .catch(err => console.warn('Failed to persist the admin role:', err));
      return;
    }

    try {
      const snap = await withTimeout(getDoc(userRef), ROLE_TIMEOUT_MS, 'the role lookup');
      setRole(snap.exists() && snap.data().role ? snap.data().role : 'viewer');
    } catch (err) {
      // Staying 'viewer' is the safe answer either way: a role that
      // couldn't be read must not be assumed to be a privileged one.
      if (isTimeoutError(err)) console.warn('Role lookup timed out; continuing as viewer.', err.message);
      else console.warn('Failed to resolve user role:', err);
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
        try { await signOut(auth); } catch (err) { console.warn('Sign-out of an unauthorized session failed', err); }
        // Normally the sign-out above fires this listener again with null
        // and that pass ends the load. When it fails -- offline, or the
        // SDK refusing -- there is no second pass, and returning with
        // `loading` still true left the app on "Loading..." for good, with
        // neither the login screen nor the reason on it. Ending it here
        // costs nothing in the ordinary case: the null pass clears the
        // user a moment later and the login screen shows the error.
        setUser(null);
        setLoading(false);
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
      // Same idea for the stores that are too big for that path — the
      // captured Quoted Projections rows and the Market Update emails with
      // their attachments keep a document each. Also not awaited.
      try {
        const { hydrateLargeStores } = await import('../utils/hydrateLargeStores');
        if (firebaseUser?.uid) {
          hydrateLargeStores(firebaseUser.uid, firebaseUser.email)
            .catch(err => console.warn('Failed to hydrate large stores', err));
        }
      } catch (err) {
        console.warn('Failed to start large store sync', err);
      }
      // Partition encrypted token storage (Outlook OAuth tokens, etc.).
      try {
        const { setSecureUserId } = await import('../utils/secureStorage');
        setSecureUserId(firebaseUser?.uid || null);
      } catch (err) {
        console.warn('Failed to set secure storage user scope', err);
      }
      setUser(firebaseUser);
      setLoading(false);
      // Not awaited: see resolveRole. The app is already usable, and the
      // role updates the views that read it when it arrives.
      resolveRole(firebaseUser);
    });
    return unsub;
  }, []);

  // onAuthStateChanged firing at all is the one thing above that nothing
  // else can rescue: until it does, `loading` is true and the app shows a
  // bare "Loading..." with no way to tell a slow network from an auth SDK
  // that is never going to call back (a blocked identitytoolkit, a wedged
  // IndexedDB holding the persisted session). After this long, say so --
  // an unexplained spinner is the state this app has been left in more
  // than once, and it gives the person looking at it nothing to report.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!loading) { setStalled(false); return undefined; }
    const t = setTimeout(() => setStalled(true), AUTH_STALL_MS);
    return () => clearTimeout(t);
  }, [loading]);

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
    <AuthContext.Provider value={{ user, loading, stalled, authError, role, isAdmin, requireAdmin, signInWithGoogle, signInWithEmail, createAccount, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
