// A table's saved column presets, synced like the rest of its layout.
//
// Kept at settings.tablePrefs[tableId].presets so a view saved on one
// machine is there on the other, with a localStorage copy under the same
// naming scheme as the table's other layout keys for the first paint. The
// rules for what a preset is and what applying one does live in
// utils/columnPresets.
//
//   const presets = useColumnPresets({ tableId, settings, updateSettings });
//   presets.list           -> [{ id, name, cols, order }]
//   presets.save({ name, cols, order })
//   presets.remove(id)
import { useCallback } from 'react';
import { useSyncedTablePref } from './useSyncedTablePref';
import { lsHas } from '../utils/tablePrefsSync';
import { sanitizePresets, savePreset, deletePreset } from '../utils/columnPresets';

export function columnPresetsLsKey(tableId) {
  return `prospect-col-presets-${tableId}`;
}

export function useColumnPresets({ tableId, settings = null, updateSettings = null }) {
  const lsKey = columnPresetsLsKey(tableId);
  const [list, setList] = useSyncedTablePref({
    tableId, field: 'presets', settings, updateSettings,
    readLocal: () => {
      try { return sanitizePresets(JSON.parse(localStorage.getItem(lsKey))); } catch { return []; }
    },
    writeLocal: (v) => localStorage.setItem(lsKey, JSON.stringify(v)),
    fromRemote: sanitizePresets,
    hasLocal: () => lsHas(lsKey),
  });

  const save = useCallback((preset) => setList(prev => savePreset(prev, preset)), [setList]);
  const remove = useCallback((id) => setList(prev => deletePreset(prev, id)), [setList]);

  return { list, save, remove };
}
