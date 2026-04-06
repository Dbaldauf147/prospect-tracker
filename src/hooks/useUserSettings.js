import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, initUserSettings } from '../utils/userSettingsSync';

export function useUserSettings(user) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const userIdRef = useRef(null);

  // Flush any pending debounced writes immediately
  const flushPending = useCallback(() => {
    if (!userIdRef.current || Object.keys(pendingRef.current).length === 0) return;
    clearTimeout(timerRef.current);
    const toWrite = { ...pendingRef.current };
    pendingRef.current = {};
    saveUserSettings(userIdRef.current, toWrite).catch(err =>
      console.error('Failed to flush user settings:', err)
    );
  }, []);

  useEffect(() => {
    if (!user) { setSettings({}); setLoaded(false); return; }
    userIdRef.current = user.uid;

    // Migrate localStorage → Firestore on first login, then subscribe
    initUserSettings(user.uid).catch(err => console.error('initUserSettings error:', err));

    const unsub = subscribeToUserSettings(user.uid, (data) => {
      // Merge incoming Firestore data but preserve any keys with pending writes
      setSettings(prev => {
        const merged = { ...(data || {}) };
        // Keep local values for keys that are still pending a Firestore write
        for (const key of Object.keys(pendingRef.current)) {
          merged[key] = pendingRef.current[key];
        }
        return merged;
      });
      setLoaded(true);
    });

    // Flush pending writes on page unload so hard refresh doesn't lose data
    const handleUnload = () => flushPending();
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      unsub();
      flushPending();
      userIdRef.current = null;
      clearTimeout(timerRef.current);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [user, flushPending]);

  // Optimistic update + debounced Firestore write.
  // Rapid calls (e.g. typing) coalesce into a single write after 800 ms of silence.
  const updateSettings = useCallback((updates) => {
    if (!userIdRef.current) return;
    setSettings(prev => ({ ...prev, ...updates }));
    Object.assign(pendingRef.current, updates);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const toWrite = { ...pendingRef.current };
      pendingRef.current = {};
      saveUserSettings(userIdRef.current, toWrite).catch(err =>
        console.error('Failed to save user settings:', err)
      );
    }, 800);
  }, []);

  return { settings, loaded, updateSettings };
}
