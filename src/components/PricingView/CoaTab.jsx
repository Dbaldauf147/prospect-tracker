import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import styles from './CoaTab.module.css';

// COA subtab: a running list of COA items and whether each one is approved.
// It is a reference list, not part of any one SIA, so it lives on the
// user's settings (settings.pricingCoaItems) and follows them to their other
// machine rather than being cleared with the workbook.
//
// Each row: { id, item, approved, approver, notes }. `approver` is who
// signed the item off, free text; older rows without it read as blank.
const SETTINGS_KEY = 'pricingCoaItems';

const newId = () => `coa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Typed into a draft and saved on blur / Enter, so every keystroke doesn't
// write the settings document.
// allowEmpty lets a cell be cleared (Notes); the COA Item itself can't be.
function CellInput({ value, onSave, label, placeholder, allowEmpty = false, list }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => {
    const next = draft.trim();
    if ((next || allowEmpty) && next !== value) onSave(next);
    else setDraft(value);
  };
  return (
    <input
      className={styles.cellInput}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      list={list}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

export function CoaTab({ settings, updateSettings }) {
  const items = useMemo(
    () => (Array.isArray(settings?.[SETTINGS_KEY]) ? settings[SETTINGS_KEY] : []),
    [settings],
  );
  const [newItem, setNewItem] = useState('');

  const save = (next) => updateSettings?.({ [SETTINGS_KEY]: next });
  const patchRow = (id, patch) => save(items.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const addItem = () => {
    const item = newItem.trim();
    if (!item) return;
    save([...items, { id: newId(), item, approved: false, approver: '', notes: '' }]);
    setNewItem('');
  };

  const removeRow = (row) => {
    if (!window.confirm(`Remove "${row.item}" from the COA list?`)) return;
    save(items.filter(r => r.id !== row.id));
  };

  const approvedCount = items.filter(r => r.approved).length;
  // Names already used, offered as suggestions in every Approver box.
  const approverNames = useMemo(
    () => [...new Set(items.map(r => String(r.approver || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const columns = useMemo(() => [
    {
      key: 'item',
      label: 'COA Item',
      defaultWidth: 360,
      getSortValue: (row) => row.item.toLowerCase(),
      getFilterValue: (row) => row.item,
      exportValue: (row) => row.item,
      render: (row) => <CellInput label="COA item" value={row.item} onSave={(item) => patchRow(row.id, { item })} />,
    },
    {
      key: 'approved',
      label: 'Approved',
      defaultWidth: 110,
      getSortValue: (row) => (row.approved ? 1 : 0),
      getFilterValue: (row) => (row.approved ? 'Yes' : 'No'),
      exportValue: (row) => (row.approved ? 'Yes' : 'No'),
      render: (row) => (
        <label className={styles.approvedCell}>
          <input
            type="checkbox"
            checked={!!row.approved}
            onChange={e => patchRow(row.id, { approved: e.target.checked })}
          />
          <span className={row.approved ? styles.yes : styles.no}>{row.approved ? 'Yes' : 'No'}</span>
        </label>
      ),
    },
    {
      key: 'approver',
      label: 'Approver',
      defaultWidth: 180,
      getSortValue: (row) => (row.approver || '').toLowerCase(),
      getFilterValue: (row) => row.approver || '',
      exportValue: (row) => row.approver || '',
      render: (row) => (
        <CellInput
          label="Approver"
          placeholder="Who approved it"
          allowEmpty
          list="pricing-coa-approvers"
          value={row.approver || ''}
          onSave={(approver) => patchRow(row.id, { approver })}
        />
      ),
    },
    {
      key: 'notes',
      label: 'Notes',
      defaultWidth: 320,
      getSortValue: (row) => (row.notes || '').toLowerCase(),
      getFilterValue: (row) => row.notes || '',
      exportValue: (row) => row.notes || '',
      render: (row) => (
        <CellInput
          label="Notes"
          placeholder="Add a note"
          allowEmpty
          value={row.notes || ''}
          onSave={(notes) => patchRow(row.id, { notes })}
        />
      ),
    },
    {
      key: '__remove__',
      label: 'Remove',
      defaultWidth: 96,
      render: (row) => (
        <button type="button" className={styles.removeBtn} onClick={() => removeRow(row)} title="Remove this COA item">
          Remove
        </button>
      ),
    },
  // patchRow / removeRow read `items`, so rebuild with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [items]);

  return (
    <div className={styles.wrap}>
      <form
        className={styles.addRow}
        onSubmit={e => { e.preventDefault(); addItem(); }}
      >
        <input
          className={styles.addInput}
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          placeholder="New COA item"
          aria-label="New COA item"
        />
        <button type="submit" className={styles.addBtn} disabled={!newItem.trim()}>Add</button>
        <datalist id="pricing-coa-approvers">
          {approverNames.map(n => <option key={n} value={n} />)}
        </datalist>
        <span className={styles.count}>
          {items.length} item{items.length === 1 ? '' : 's'}, {approvedCount} approved
        </span>
      </form>

      {/* DataTable's scroll body is flex: 1 1 0, so it needs a parent with
          a height. Sized to the rows (capped) so a short list doesn't leave
          a tall empty box under it. */}
      <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(640, 160 + Math.max(1, items.length) * 40) }}>
      <DataTable
        tableId="pricing-coa"
        columns={columns}
        rows={items}
        alwaysVisible={['item']}
        emptyMessage="No COA items yet. Add one above."
        exportFileName="COA"
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
