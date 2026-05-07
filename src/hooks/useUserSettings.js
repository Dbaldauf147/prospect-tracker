import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, savePathUpdates, initUserSettings } from '../utils/userSettingsSync';
import { pushBackup } from '../utils/settingsBackup';

// Cheap deep-ish equality for the conflict diff. Settings values are
// plain JSON (no functions / dates / classes) so JSON.stringify is a
// fine fingerprint and orders of magnitude faster than dragging in
// lodash for one call site. Object key ordering can produce false
// positives (different stringification of the same data); the
// follow-up doesn't care about false positives — they just mean we
// pessimistically prompt or silently force-write a noop, both
// acceptable.
function jsonEq(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// Compare our last-known local state with the remote document and
// return the set of top-level keys whose values actually differ —
// that's "what the other device changed". `_lastWriteAt` is excluded
// because it's just the bookkeeping stamp and always differs after a
// remote write.
function changedTopLevelKeys(prev, remote) {
  const out = new Set();
  const all = new Set([...Object.keys(prev || {}), ...Object.keys(remote || {})]);
  all.delete('_lastWriteAt');
  for (const k of all) {
    if (!jsonEq(prev?.[k], remote?.[k])) out.add(k);
  }
  return out;
}

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
    // for recovery.
    const updateKeys = Object.keys(updates);
    const isLowImpact = updateKeys.length === 1 && updateKeys[0] === 'tablePrefs';

    try {
      const result = await saveUserSettings(userIdRef.current, updates, { expectedAt });

      if (result.stale) {
        // Field-aware merge: only prompt when our edit actually
        // collides with what the other device changed at the top-level
        // key. Firestore's setDoc(..., merge: true) already preserves
        // every field we don't pass, so an edit to "zoomInfo" on this
        // tab and an edit to "customTypes" on another tab can both win
        // — there's no real conflict, the popup was just noise.
        const remote = result.remoteData || {};
        const remoteChanged = changedTopLevelKeys(prev, remote);
        const ourKeys = new Set(updateKeys);
        let conflict = false;
        for (const k of ourKeys) if (remoteChanged.has(k)) { conflict = true; break; }

        let overwrite;
        if (isLowImpact || !conflict) {
          // No same-key collision → silently force-write. Other device's
          // changes to other keys are preserved by Firestore's merge.
          overwrite = true;
        } else {
          // Genuine same-key conflict — ask before overwriting.
          overwrite = window.confirm(
            'Your settings have been changed on another device since this page loaded.\n\n' +
            'OK = Overwrite the other device\'s changes with yours.\n' +
            'Cancel = Keep the other device\'s changes and discard yours.\n\n' +
            'Tip: Either way, your pre-save state has been backed up locally. You can restore it from the Backups panel.'
          );
        }
        if (overwrite) {
          const forced = await saveUserSettings(userIdRef.current, updates, { force: true });
          // Optimistic state already has our key writes layered on
          // top; pull in the other-device changes for keys we didn't
          // touch so this tab reflects the merged truth.
          const merged = { ...remote, ...optimistic, _lastWriteAt: forced.writtenAt };
          settingsRef.current = merged;
          setSettings(merged);
        } else {
          // User chose to keep the other device's state — drop ours.
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
        // Same field-aware merge as updateSettings, just keyed by the
        // top-level component of each dotted path we're writing. If
        // we're writing "companyOpportunities.acme-inc" and the other
        // device touched "zoomInfo", they don't collide.
        const remote = result.remoteData || {};
        const remoteChanged = changedTopLevelKeys(prev, remote);
        const ourTopKeys = new Set(Object.keys(pathUpdates).map(p => p.split('.')[0]));
        let conflict = false;
        for (const k of ourTopKeys) if (remoteChanged.has(k)) { conflict = true; break; }

        let overwrite;
        if (isLowImpact || !conflict) {
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
          // Layer optimistic (which already has our path writes) on
          // top of the freshest remote so this tab reflects every
          // device's most recent edits.
          const merged = { ...remote, ...optimistic, _lastWriteAt: forced.writtenAt };
          settingsRef.current = merged;
          setSettings(merged);
        } else {
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
