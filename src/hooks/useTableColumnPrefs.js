// A column layout for a table that draws its own markup.
//
// The shared DataTable has all of this built in - which columns are hidden,
// which are starred as the user's own default view, which have been deleted
// out of the table, and what Reset puts back. A page that renders its own
// table got none of it, and the ones that wanted it hand-rolled the same
// twenty lines each.
//
// This is that wiring, once, for any table that can hand over a column list
// and a stable id. The rules themselves stay in utils/tableColumnPrefs and
// the storage in utils/tablePrefsSync, so a layout saved here reads back the
// same as one saved by DataTable, and follows the user to their other
// machine the same way.
//
// The layout is read once, when the table mounts: from Firestore when the
// user's settings have arrived and carry one, from localStorage otherwise.
// Writes go to both. That is enough for a table inside a popup - it mounts
// each time the popup opens, so a layout set on another machine arrives the
// next time it is opened rather than mid-view - and it keeps this to one
// read and one write instead of a live subscription per column.
//
// `columns` and `alwaysVisible` must be stable (a module constant, or
// memoized): they feed the memos below, and a fresh array each render would
// rebuild every handler under them on each keystroke elsewhere on the page.
import { useCallback, useMemo, useState } from 'react';
import {
  tablePrefsKeys, persistTablePrefs, readRemoteTablePrefs, settingsHaveLoaded,
  loadColHidden, loadColStarred, loadColRemoved,
} from '../utils/tablePrefsSync';
import {
  isColumnVisible, resetToStarred, applyStar,
} from '../utils/tableColumnPrefs';

const EMPTY_KEYS = [];

export function useTableColumnPrefs({
  tableId,
  columns,
  alwaysVisible = EMPTY_KEYS,
  settings = null,
  updateSettings = null,
}) {
  const keys = useMemo(() => tablePrefsKeys(tableId), [tableId]);
  const columnKeys = useMemo(() => (columns || []).map(c => c.key), [columns]);

  // One read, at mount. Firestore wins where it has something to say, since
  // it is the only copy that knows what the other machine did.
  const [prefs, setPrefs] = useState(() => {
    const remote = settingsHaveLoaded(settings) ? readRemoteTablePrefs(settings, tableId) : null;
    const hidden = Array.isArray(remote?.hidden) ? remote.hidden : loadColHidden(keys);
    return {
      hidden: new Set(Array.isArray(hidden) ? hidden : []),
      starred: Array.isArray(remote?.starred) ? new Set(remote.starred) : loadColStarred(keys),
      removed: Array.isArray(remote?.removed) ? new Set(remote.removed) : loadColRemoved(keys),
    };
  });

  // Every change writes all three lists: they move together (starring a
  // column un-hides it, Reset rewrites the lot), and one partial write that
  // lands without its siblings is a layout that reads back as neither.
  const commit = useCallback((change) => {
    setPrefs((prev) => {
      const next = change(prev);
      persistTablePrefs(keys, tableId, settings, updateSettings, {
        hidden: next.hidden, starred: next.starred, removed: next.removed,
      });
      return next;
    });
  }, [keys, tableId, settings, updateSettings]);

  // The columns still in the layout: a deleted one doesn't render and doesn't
  // appear in the picker's main list, it comes back through Restore or Reset.
  const liveColumns = useMemo(
    () => (columns || []).filter(c => !prefs.removed.has(c.key)),
    [columns, prefs.removed],
  );
  const removedColumns = useMemo(
    () => (columns || []).filter(c => prefs.removed.has(c.key)),
    [columns, prefs.removed],
  );
  const visibleCols = useMemo(
    () => new Set(liveColumns
      .filter(c => isColumnVisible(c.key, { hidden: prefs.hidden, removed: prefs.removed, alwaysVisible }))
      .map(c => c.key)),
    [liveColumns, prefs.hidden, prefs.removed, alwaysVisible],
  );

  const toggle = useCallback((key) => {
    if (alwaysVisible.includes(key)) return;
    commit((prev) => {
      const hidden = new Set(prev.hidden);
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      return { ...prev, hidden };
    });
  }, [alwaysVisible, commit]);

  // Starring a column makes it part of the user's default view, so it has to
  // be on screen: applyStar un-hides and un-deletes it in the same move.
  const star = useCallback((key) => {
    commit((prev) => applyStar({
      key, starred: prev.starred, hidden: prev.hidden, removed: prev.removed,
      star: !prev.starred.has(key),
    }));
  }, [commit]);

  const remove = useCallback((key) => {
    if (alwaysVisible.includes(key)) return;
    commit(prev => ({ ...prev, removed: new Set(prev.removed).add(key) }));
  }, [alwaysVisible, commit]);

  const restore = useCallback((key) => {
    commit((prev) => {
      const removed = new Set(prev.removed);
      removed.delete(key);
      return { ...prev, removed };
    });
  }, [commit]);

  // Reset: every deleted column back, and visibility set to the user's
  // starred view - or to everything when they haven't starred any, which is
  // what Reset has always done.
  const reset = useCallback(() => {
    commit(prev => ({
      ...prev,
      ...resetToStarred({ columnKeys, starred: prev.starred, alwaysVisible }),
    }));
  }, [columnKeys, alwaysVisible, commit]);

  const isVisible = useCallback((key) => visibleCols.has(key), [visibleCols]);

  return {
    columns: liveColumns,
    removedColumns,
    visibleCols,
    starredCols: prefs.starred,
    isVisible,
    toggle,
    star,
    remove,
    restore,
    reset,
  };
}
