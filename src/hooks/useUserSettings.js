import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, savePathUpdates, initUserSettings } from '../utils/userSettingsSync';
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

    // Column prefs (table widths/visibility/renames) are per-device UX
    // state — not user data — and they fire on every drag, toggle, and
    // rename. The cross-device merge prompt is too noisy for this
    // traffic, so silently force-write when an update is purely
    // tablePrefs. Pre-save backup above still snapshots the prior state
    // for recovery. Any update that touches anything else still goes
    // through the prompt.
    const updateKeys = Object.keys(updates);
    const isLowImpact = updateKeys.length === 1 && updateKeys[0] === 'tablePrefs';

    try {
      const result = await saveUserSettings(userIdRef.current, updates, { expectedAt });

      if (result.stale) {
        let overwrite;
        if (isLowImpact) {
          overwrite = true;
        } else {
          // Someone wrote to Firestore between our last sync and this save.
          // Ask the user before overwriting their other-device work.
          overwrite = window.confirm(
            'Your settings have been changed on another device since this page loaded.\n\n' +
            'OK = Overwrite the other device\'s changes with yours.\n' +
            'Cancel = Keep the other device\'s changes and discard yours.\n\n' +
            'Tip: Either way, your pre-save state has been backed up locally. You can restore it from the Backups panel.'
          );
        }
        if (overwrite) {
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

  // Path-based update. Writes only the specific dotted keys to Firestore,
  // so two laptops editing different paths (e.g. different companies) don't
  // stomp each other's work. Same backup + stale-write semantics as
  // updateSettings.
  //
  //   pathUpdates = { 'companyOpportunities.acme-inc': data }
  //   A null/undefined value means "delete that path".
  const updateSettingsPath = useCallback(async (pathUpdates) => {
    if (!userIdRef.current) return;

    pushBackup(settingsRef.current, 'pre-save-path').catch(() => {});

    const prev = settingsRef.current || {};
    const expectedAt = prev._lastWriteAt || null;

    // Build optimistic local state by walking each path.
    const optimistic = structuredClone(prev);
    for (const [path, value] of Object.entries(pathUpdates)) {
      const parts = path.split('.');
      let cur = optimistic;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (value == null) delete cur[last]; else cur[last] = value;
    }
    settingsRef.current = optimistic;
    setSettings(optimistic);
    writingRef.current = true;

    // Same low-impact carve-out as updateSettings: if every path being
    // written is under tablePrefs.*, silently force-write on stale.
    const isLowImpact = Object.keys(pathUpdates).every(p => p === 'tablePrefs' || p.startsWith('tablePrefs.'));

    try {
      const result = await savePathUpdates(userIdRef.current, pathUpdates, { expectedAt });
      if (result.stale) {
        let overwrite;
        if (isLowImpact) {
          overwrite = true;
        } else {
          overwrite = window.confirm(
            'Your settings have been changed on another device since this page loaded.\n\n' +
            'OK = Overwrite the other device\'s changes with yours.\n' +
            'Cancel = Keep the other device\'s changes and discard yours.\n\n' +
            'Either way, your pre-save state has been backed up locally.'
          );
        }
        if (overwrite) {
          const forced = await savePathUpdates(userIdRef.current, pathUpdates, { force: true });
          const next = { ...optimistic, _lastWriteAt: forced.writtenAt };
          settingsRef.current = next;
          setSettings(next);
        } else {
          const remote = result.remoteData || {};
          settingsRef.current = remote;
          setSettings(remote);
        }
      } else {
        const next = { ...optimistic, _lastWriteAt: result.writtenAt };
        settingsRef.current = next;
        setSettings(next);
      }
    } catch (err) {
      console.error('Failed path-based save:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      writingRef.current = false;
    }
  }, []);

  return { settings, loaded, updateSettings, updateSettingsPath };
}
