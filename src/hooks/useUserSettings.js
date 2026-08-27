import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToUserSettings, saveUserSettings, savePathUpdates, initUserSettings } from '../utils/userSettingsSync';
import { pushBackup } from '../utils/settingsBackup';
import { autoMergeValue, mergeSettingsKey, foldWriteResult } from '../utils/settingsMerge';
import { SETTINGS_SIZE_BUDGET, overBudgetMessage, settingsDocReport } from '../utils/settingsDocSize';

// Set (or delete, when value is null/undefined) one dotted path on a
// plain nested object, creating intermediate objects as needed.
// A copy of `obj` with one dotted path set, sharing every subtree the path
// doesn't touch.
//
// The optimistic state a path save shows used to be a structuredClone of the
// whole settings document — a deep copy of everything the user has, on the
// main thread, for a one-key change. That is per save, and the contact
// popup's tag table saves on every click.
function withDottedPath(obj, path, value) {
  const parts = path.split('.');
  const root = { ...(obj && typeof obj === 'object' ? obj : {}) };
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const child = cur[part];
    cur[part] = (child && typeof child === 'object' && !Array.isArray(child)) ? { ...child } : {};
    cur = cur[part];
  }
  const last = parts[parts.length - 1];
  if (value == null) delete cur[last]; else cur[last] = value;
  return root;
}

function setDottedPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value == null) delete cur[last]; else cur[last] = value;
}

// Firestore's 1 MiB document cap, checked before the write rather than
// after. Its own error names a byte count and nothing else, which leaves
// no way to tell which of a hundred settings keys filled the document —
// this refuses the save and names the biggest ones. Returns true when the
// caller should stop.
function refuseIfOverBudget(next) {
  const report = settingsDocReport(next);
  if (report.bytes <= SETTINGS_SIZE_BUDGET) return false;
  console.error('userSettings would exceed the document size limit', report);
  alert(overBudgetMessage(report));
  return true;
}

export function useUserSettings(user) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const userIdRef = useRef(null);
  // Count of in-flight saves (multiple updateSettings calls can overlap).
  const writingRef = useRef(0);
  // Remember the latest settings we saw, so stale-write checks and
  // pre-save backups have access without stale closures.
  const settingsRef = useRef({});
  // Latest remote snapshot that arrived while a write was in flight.
  // We can't apply it immediately (it would stomp the optimistic
  // state), but dropping it outright leaves this device holding stale
  // data with a fresh _lastWriteAt — its next save of the same key
  // would then pass the stale check and silently erase the other
  // device's change (e.g. a dropdown option added on another laptop).
  // The save that caused the skip folds it back in when it settles.
  const pendingRemoteRef = useRef(null);

  // So window.__settingsSize() can be called with no arguments from the
  // console when someone needs to know what is filling the document.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    Object.defineProperty(window, '__lastSettings', {
      configurable: true,
      get: () => settingsRef.current,
    });
  }, []);

  useEffect(() => {
    if (!user) { setSettings({}); setLoaded(false); return; }
    userIdRef.current = user.uid;
    pendingRemoteRef.current = null;

    // Migrate localStorage → Firestore on first login, then subscribe
    initUserSettings(user.uid).catch(err => console.error('initUserSettings error:', err));

    const unsub = subscribeToUserSettings(user.uid, (data) => {
      // A write is in flight: stash the snapshot for the writer to fold
      // in afterwards instead of applying (or losing) it now.
      if (writingRef.current > 0) { pendingRemoteRef.current = data || {}; return; }
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
    // Refuse before touching local state, so a save that can't be stored
    // doesn't leave this device showing data the server never took.
    if (refuseIfOverBudget(optimistic)) return;
    settingsRef.current = optimistic;
    setSettings(optimistic);
    writingRef.current += 1;

    const updateKeys = Object.keys(updates);
    // What we ended up writing (the stale path swaps in merged values)
    // and when — used to fold in any snapshot stashed mid-write.
    let written = updates;
    let writtenAt = null;

    try {
      const result = await saveUserSettings(userIdRef.current, updates, { expectedAt });

      if (result.stale) {
        // Silent auto-merge — never prompt. For any key both devices
        // touched, fold the two values together with mergeSettingsKey
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
          mergedUpdates[k] = mergeSettingsKey(k, updates[k], remote[k]);
        }
        const forced = await saveUserSettings(userIdRef.current, mergedUpdates, { force: true });
        written = mergedUpdates;
        writtenAt = forced.writtenAt;
        const merged = foldWriteResult(
          { ...remote, ...mergedUpdates },
          optimistic,
          settingsRef.current,
        );
        merged._lastWriteAt = forced.writtenAt;
        settingsRef.current = merged;
        setSettings(merged);
      } else {
        writtenAt = result.writtenAt;
        // Folded into whatever is current rather than replayed from
        // `optimistic`: edits made while this write was in the air are newer
        // than anything it can say, and rebuilding from the pre-write
        // snapshot silently undid them on screen.
        const next = foldWriteResult(optimistic, optimistic, settingsRef.current);
        next._lastWriteAt = result.writtenAt;
        settingsRef.current = next;
        setSettings(next);
        console.log('Settings saved to Firestore:', Object.keys(updates));
      }
    } catch (err) {
      console.error('Failed to save user settings:', err);
      alert('Failed to save settings: ' + err.message + '\n\nA backup of your pre-save state was saved locally.');
    } finally {
      writingRef.current -= 1;
      const pending = pendingRemoteRef.current;
      if (pending) {
        pendingRemoteRef.current = null;
        // A remote snapshot landed mid-write. Take it as the new base
        // (the other device's changes) and overlay the keys we just
        // wrote, so neither side's change is dropped.
        const next = foldWriteResult({ ...pending, ...written }, optimistic, settingsRef.current);
        const at = Math.max(Number(pending._lastWriteAt) || 0, Number(writtenAt) || 0);
        if (at) next._lastWriteAt = at;
        settingsRef.current = next;
        setSettings(next);
      }
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
    let optimistic = prev;
    for (const [path, value] of Object.entries(pathUpdates)) {
      optimistic = withDottedPath(optimistic, path, value);
    }
    if (refuseIfOverBudget(optimistic)) return;
    settingsRef.current = optimistic;
    setSettings(optimistic);
    writingRef.current += 1;

    // What we ended up writing (the stale path swaps in merged values)
    // and when — used to fold in any snapshot stashed mid-write.
    let written = pathUpdates;
    let writtenAt = null;

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
          // The path's last segment is the key the value sits under, so
          // a dotted write resolves by the same rules as a whole-key one.
          mergedPathUpdates[path] = cur === undefined
            ? value
            : autoMergeValue(value, cur, parts[parts.length - 1]);
        }
        const forced = await savePathUpdates(userIdRef.current, mergedPathUpdates, { force: true });
        written = mergedPathUpdates;
        writtenAt = forced.writtenAt;
        // Rebuild local state: take the freshest remote, then apply
        // our merged path writes on top.
        const rebuilt = structuredClone(remote);
        for (const [path, value] of Object.entries(mergedPathUpdates)) {
          setDottedPath(rebuilt, path, value);
        }
        const next = foldWriteResult(rebuilt, optimistic, settingsRef.current);
        next._lastWriteAt = forced.writtenAt;
        settingsRef.current = next;
        setSettings(next);
      } else {
        writtenAt = result.writtenAt;
        // Same as updateSettings: a path written while this one was in
        // flight is newer than this write's snapshot of the document.
        const next = foldWriteResult(optimistic, optimistic, settingsRef.current);
        next._lastWriteAt = result.writtenAt;
        settingsRef.current = next;
        setSettings(next);
      }
    } catch (err) {
      console.error('Failed path-based save:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      writingRef.current -= 1;
      const pending = pendingRemoteRef.current;
      if (pending) {
        pendingRemoteRef.current = null;
        // A remote snapshot landed mid-write. Take it as the new base
        // (the other device's changes) and overlay the paths we just
        // wrote, so neither side's change is dropped.
        const rebuilt = structuredClone(pending);
        for (const [path, value] of Object.entries(written)) {
          setDottedPath(rebuilt, path, value);
        }
        const next = foldWriteResult(rebuilt, optimistic, settingsRef.current);
        const at = Math.max(Number(pending._lastWriteAt) || 0, Number(writtenAt) || 0);
        if (at) next._lastWriteAt = at;
        settingsRef.current = next;
        setSettings(next);
      }
    }
  }, []);

  return { settings, loaded, updateSettings, updateSettingsPath };
}
