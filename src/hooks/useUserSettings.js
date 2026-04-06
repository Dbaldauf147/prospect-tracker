import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, initUserSettings } from '../utils/userSettingsSync';

export function useUserSettings(user) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const userIdRef = useRef(null);
  const writingRef = useRef(false);

  useEffect(() => {
    if (!user) { setSettings({}); setLoaded(false); return; }
    userIdRef.current = user.uid;

    // Migrate localStorage → Firestore on first login, then subscribe
    initUserSettings(user.uid).catch(err => console.error('initUserSettings error:', err));

    const unsub = subscribeToUserSettings(user.uid, (data) => {
      // Skip snapshot updates while a write is in-flight to avoid overwriting optimistic state
      if (writingRef.current) return;
      setSettings(data || {});
      setLoaded(true);
    });

    return () => {
      unsub();
      userIdRef.current = null;
    };
  }, [user]);

  // Optimistic update + immediate Firestore write.
  const updateSettings = useCallback((updates) => {
    if (!userIdRef.current) return;
    setSettings(prev => ({ ...prev, ...updates }));
    writingRef.current = true;
    saveUserSettings(userIdRef.current, updates)
      .catch(err => console.error('Failed to save user settings:', err))
      .finally(() => { writingRef.current = false; });
  }, []);

  return { settings, loaded, updateSettings };
}
