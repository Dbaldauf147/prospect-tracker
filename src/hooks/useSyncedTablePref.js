import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { persistTablePrefs, readRemoteTablePrefs, sameStoredValue, settingsHaveLoaded } from '../utils/tablePrefsSync';

export { SET_PREF } from '../utils/tablePrefsSync';

// One piece of a table's column layout — its widths, or its hidden set — held
// in state, cached wherever that table already cached it, and synced through
// settings.tablePrefs so it follows the user to their other machine.
//
// For the tables that predate the shared DataTable and keep their own local
// copy: a per-user localStorage key, an IndexedDB record, whatever. Rather
// than move them onto the shared local storage — which would strand the
// layout every existing user has — this adds only the half they're missing.
// `readLocal` / `writeLocal` stay whatever that table already does.
//
// Firestore wins over the local copy, because it's the only one that knows
// what the other machine did. The local copy is what draws the first paint.
//
//   const [widths, setWidths] = useSyncedTablePref({
//     tableId: 'master-site-list', field: 'widths', settings, updateSettings,
//     readLocal: () => readJsonLs(WIDTHS_LS_KEY, {}),
//     writeLocal: (w) => userLsSet(WIDTHS_LS_KEY, JSON.stringify(w)),
//   });
//
// `field` is one of the canonical layout kinds — widths, hidden, starred,
// names, order, removed, visible, sort, filters — so a table's entry has the
// same shape whichever component wrote it. Sets go through `toRemote` / `fromRemote`,
// since what's stored has to be JSON.
//
// `hasLocal` says whether this browser holds a SAVED value, as opposed to
// readLocal falling back to the table's default. When it does and the
// account has nothing for this field yet, the local layout is uploaded
// once, so a layout set up before the table synced (or never touched since)
// reaches the account without the user having to change it first. Without
// `hasLocal` nothing is seeded: pushing a default would pin it, and a
// column the table later ships switched on would arrive switched off.
export function useSyncedTablePref({
  tableId,
  field,
  settings,
  updateSettings,
  readLocal,
  writeLocal,
  toRemote = (v) => v,
  fromRemote = (v) => v,
  hasLocal = null,
}) {
  const remoteRaw = readRemoteTablePrefs(settings, tableId)?.[field];
  const remoteJson = useMemo(() => (remoteRaw === undefined ? '' : JSON.stringify(remoteRaw)), [remoteRaw]);
  const loaded = settingsHaveLoaded(settings);

  const [value, setValue] = useState(() => (
    remoteRaw === undefined ? readLocal() : fromRemote(remoteRaw)
  ));

  // The writers change identity on every settings snapshot, and a resize
  // drag calls the setter dozens of times — reading them off a ref keeps the
  // setter itself stable, so it can sit in a dependency array without
  // rebuilding every handler under it on each keystroke elsewhere on the page.
  const latest = useRef({});
  latest.current = { settings, updateSettings, writeLocal, toRemote, fromRemote, value, hasLocal };

  // The remote layout we last took, so an echo of our own write doesn't
  // re-enter as someone else's change.
  const adoptedRef = useRef(remoteJson);

  useEffect(() => {
    if (!loaded || remoteJson === '') return;
    if (remoteJson === adoptedRef.current) return;
    adoptedRef.current = remoteJson;
    const incoming = latest.current.fromRemote(JSON.parse(remoteJson));
    if (sameStoredValue(remoteJson, latest.current.value, latest.current.toRemote)) return;
    setValue(incoming);
    // Keep the fast local copy in step, so the next first paint matches.
    try { latest.current.writeLocal(incoming); } catch { /* storage blocked */ }
  }, [loaded, remoteJson]);

  // The one-time upload described above. Once per mount is enough: after
  // it lands the account has an entry, and from then on every change goes
  // up through the setter.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!loaded || remoteJson !== '' || seededRef.current) return;
    seededRef.current = true;
    const l = latest.current;
    let saved = false;
    try { saved = !!l.hasLocal?.(); } catch { /* storage blocked */ }
    if (!saved) return;
    const remoteValue = l.toRemote(l.value);
    adoptedRef.current = JSON.stringify(remoteValue);
    persistTablePrefs(null, tableId, l.settings, l.updateSettings, { [field]: remoteValue });
  }, [loaded, remoteJson, tableId, field]);

  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      const l = latest.current;
      try { l.writeLocal(resolved); } catch { /* storage blocked */ }
      const remoteValue = l.toRemote(resolved);
      adoptedRef.current = JSON.stringify(remoteValue);
      persistTablePrefs(null, tableId, l.settings, l.updateSettings, { [field]: remoteValue });
      return resolved;
    });
  }, [tableId, field]);

  return [value, set];
}
