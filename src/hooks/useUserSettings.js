import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, initUserSettings } from '../utils/userSettingsSync';
import { pushBackup } from '../utils/settingsBackup';

export function useUserSettings(user) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const userIdRef = useRef(null);
  const writingRef = useRef(false);
  // Remember the latest settings we saw, so stale-write checks and
  // pre-save backups have access without stale closures.
  const settingsRef = useRef({});

  useEffect(() => {
    if (!user) { setSettings({}); setLoaded(false); return; }
    userIdRef.current = user.uid;

    // Migrate localStorage → Firestore on first login, then subscribe
    initUserSettings(user.uid).catch(err => console.error('initUserSettings error:', err));

    const unsub = subscribeToUserSettings(user.uid, (data) => {
      // Skip snapshot updates while a write is in-flight to avoid overwriting optimistic state
      if (writingRef.current) return;
      settingsRef.current = data || {};
      setSettings(data || {});
      setLoaded(true);
    });

    return () => {
      unsub();
      userIdRef.current = null;
    };
  }, [user]);

  // Optimistic update + immediate Firestore write with staleness guard + local backup.
  const updateSettings = useCallback(async (updates) => {
    if (!userIdRef.current) return;

    // Snapshot the pre-save state for recovery.
    pushBackup(settingsRef.current, 'pre-save').catch(() => {});

    const prev = settingsRef.current || {};
    const expectedAt = prev._lastWriteAt || null;
    const optimistic = { ...prev, ...updates };
    settingsRef.current = optimistic;
    setSettings(optimistic);
    writingRef.current = true;

    try {
      const result = await saveUserSettings(userIdRef.current, updates, { expectedAt });

      if (result.stale) {
        // Someone wrote to Firestore between our last sync and this save.
        // Ask the user before overwriting their other-device work.
        const choice = window.confirm(
          'Your settings have been changed on another device since this page loaded.\n\n' +
          'OK = Overwrite the other device\'s changes with yours.\n' +
          'Cancel = Keep the other device\'s changes and discard yours.\n\n' +
          'Tip: Either way, your pre-save state has been backed up locally. You can restore it from the Backups panel.'
        );
        if (choice) {
          const forced = await saveUserSettings(userIdRef.current, updates, { force: true });
          const next = { ...optimistic, _lastWriteAt: forced.writtenAt };
          settingsRef.current = next;
          setSettings(next);
        } else {
          // Take the remote state.
          const remote = result.remoteData || {};
          settingsRef.current = remote;
          setSettings(remote);
        }
      } else {
        const next = { ...optimistic, _lastWriteAt: result.writtenAt };
        settingsRef.current = next;
        setSettings(next);
        console.log('Settings saved to Firestore:', Object.keys(updates));
      }
    } catch (err) {
      console.error('Failed to save user settings:', err);
      alert('Failed to save settings: ' + err.message + '\n\nA backup of your pre-save state was saved locally.');
    } finally {
      writingRef.current = false;
    }
  }, []);

  return { settings, loaded, updateSettings };
}
