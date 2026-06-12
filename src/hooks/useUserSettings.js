import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, savePathUpdates, initUserSettings } from '../utils/userSettingsSync';
import { pushBackup } from '../utils/settingsBackup';

// Best-effort merge for a single setting key when two devices both
// touched it. The goal is to never lose data without being asked, so
// we use structural rules rather than always letting one side win:
//
//   * arrays of objects with stable ids (rows in zoomInfo, opps, etc.)
//     → union by id, ours wins on same id (last-edit-on-this-device).
//   * arrays of primitives (customTypes, hiddenServices)
//     → dedup union, preserving our order then appending remote-only.
//   * plain objects (dismissedGuesses, contactLocalFields, …)
//     → recursive shallow merge: ours wins on overlapping leaf keys.
//   * anything else (strings, numbers, bool, mixed arrays)
//     → ours wins, since we just made the edit on this device.
function autoMergeValue(ours, remote) {
  if (remote === undefined) return ours;
  if (ours === undefined) return remote;
  if (Array.isArray(ours) && Array.isArray(remote)) {
    const idOf = (x) => (x && typeof x === 'object' ? (x.id ?? x._id ?? null) : null);
    const oursAllIded = ours.length === 0 || ours.every(x => idOf(x) != null);
    const remoteAllIded = remote.length === 0 || remote.every(x => idOf(x) != null);
    if (oursAllIded && remoteAllIded) {
      const ourIds = new Set(ours.map(idOf));
      const result = [...ours];
      for (const r of remote) if (!ourIds.has(idOf(r))) result.push(r);
      return result;
    }
    const allPrim = ours.every(x => x === null || typeof x !== 'object')
      && remote.every(x => x === null || typeof x !== 'object');
    if (allPrim) {
      const norm = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
      const seen = new Set(ours.map(norm));
      const result = [...ours];
      for (const v of remote) {
        const k = norm(v);
        if (!seen.has(k)) { seen.add(k); result.push(v); }
      }
      return result;
    }
    return ours;
  }
  if (ours && remote && typeof ours === 'object' && typeof remote === 'object'
      && !Array.isArray(ours) && !Array.isArray(remote)) {
    const out = { ...remote };
    for (const k of Object.keys(ours)) out[k] = autoMergeValue(ours[k], remote[k]);
    return out;
  }
  return ours;
}

// Table-layout prefs (settings.tablePrefs) get their own merge instead
// of autoMergeValue. Each table's `visible` is a complete snapshot of
// the columns currently shown — the generic primitive-array union above
// would resurrect any column the user just hid, because the removed key
// still sits in the remote array and gets appended back. Merge per
// table with ours-wins-per-field: the device that just touched a
// table's layout is right about that layout, and tables only the other
// device touched flow through from remote untouched.
function mergeTablePrefs(ours, remote) {
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isMap(ours)) return remote === undefined ? ours : remote;
  if (!isMap(remote)) return ours;
  const out = { ...remote };
  for (const tableId of Object.keys(ours)) {
    const o = ours[tableId];
    const r = remote[tableId];
    out[tableId] = (isMap(o) && isMap(r)) ? { ...r, ...o } : o;
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

    const updateKeys = Object.keys(updates);

    try {
      const result = await saveUserSettings(userIdRef.current, updates, { expectedAt });

      if (result.stale) {
        // Silent auto-merge — never prompt. For any key both devices
        // touched, fold the two values together with autoMergeValue
        // (id-keyed array union, primitive-array dedup, recursive
        // object merge). For keys only we touched, ours flows through.
        // Firestore's setDoc(merge:true) keeps the other device's
        // changes to keys we didn't touch. Pre-save backup above means
        // the prior state is recoverable if the heuristic ever picks
        // the wrong side on a primitive overlap.
        const remote = result.remoteData || {};
        const mergedUpdates = { ...updates };
        for (const k of updateKeys) {
          if (!(k in remote)) continue;
          mergedUpdates[k] = k === 'tablePrefs'
            ? mergeTablePrefs(updates[k], remote[k])
            : autoMergeValue(updates[k], remote[k]);
        }
        const forced = await saveUserSettings(userIdRef.current, mergedUpdates, { force: true });
        const merged = { ...remote, ...mergedUpdates, _lastWriteAt: forced.writtenAt };
        settingsRef.current = merged;
        setSettings(merged);
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

    try {
      const result = await savePathUpdates(userIdRef.current, pathUpdates, { expectedAt });
      if (result.stale) {
        // Silent auto-merge for path-based saves. Path writes target
        // specific dotted keys (e.g. "companyOpportunities.acme-inc"),
        // so the merge surface is just that path's value: if the
        // remote has a value at the same path that's already been
        // edited by the other device, autoMergeValue folds it in
        // (id-keyed list union, recursive object merge, etc.). Keys
        // the other device changed and we didn't touch are preserved
        // by force-writing only our paths via savePathUpdates.
        const remote = result.remoteData || {};
        const mergedPathUpdates = {};
        for (const [path, value] of Object.entries(pathUpdates)) {
          if (value == null) {
            mergedPathUpdates[path] = value; // delete-paths flow through unchanged
            continue;
          }
          // Walk the dotted path through `remote` to find what's there now.
          const parts = path.split('.');
          let cur = remote;
          for (const part of parts) {
            if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
            else { cur = undefined; break; }
          }
          mergedPathUpdates[path] = cur === undefined ? value : autoMergeValue(value, cur);
        }
        const forced = await savePathUpdates(userIdRef.current, mergedPathUpdates, { force: true });
        // Rebuild local state: take the freshest remote, then apply
        // our merged path writes on top.
        const next = structuredClone(remote);
        for (const [path, value] of Object.entries(mergedPathUpdates)) {
          const parts = path.split('.');
          let cur = next;
          for (let i = 0; i < parts.length - 1; i++) {
            if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          const last = parts[parts.length - 1];
          if (value == null) delete cur[last]; else cur[last] = value;
        }
        next._lastWriteAt = forced.writtenAt;
        settingsRef.current = next;
        setSettings(next);
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
