import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, initUserSettings } from '../utils/userSettingsSync';

export function useUserSettings(user) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const userIdRef = useRef(null);

  useEffect(() => {
    if (!user) { setSettings({}); setLoaded(false); return; }
    userIdRef.current = user.uid;

    // Migrate localStorage → Firestore on first login, then subscribe
    initUserSettings(user.uid).catch(err => console.error('initUserSettings error:', err));

    const unsub = subscribeToUserSettings(user.uid, (data) => {
      setSettings(data || {});
      setLoaded(true);
    });
    return () => {
      unsub();
      userIdRef.current = null;
      clearTimeout(timerRef.current);
    };
  }, [user]);

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
