import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Badge } from '../common/Badge';
import { statusColor, tierColor, formatAum, formatNumber } from '../../utils/formatters';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, ASSET_TYPES, FRAMEWORKS } from '../../data/enums';
import { buildTypeOptions, buildCdmOptions, persistCustomOption, buildAssetTypeOptions } from '../../utils/prospectOptions';
import { PasteAddModal } from './PasteAddModal';
import { resolveHiddenKeys, isColumnVisible, resetToStarred, applyStar } from '../../utils/tableColumnPrefs';
import styles from './TableView.module.css';

const ASSET_TYPES_ALL = ASSET_TYPES;
const FRAMEWORKS_ALL = FRAMEWORKS;

const COLUMNS = [
  { key: 'company', label: 'Company', sticky: true, defaultWidth: 200 },
  { key: 'cdm', label: 'CDM', type: 'enum', defaultWidth: 120 },
  { key: 'status', label: 'Status', type: 'enum', options: STATUSES, defaultWidth: 130 },
  { key: 'type', label: 'Type', type: 'enum', options: TYPES, defaultWidth: 160 },
  { key: 'geography', label: 'Geography', type: 'enum', options: GEOGRAPHIES, defaultWidth: 100 },
  { key: 'publicPrivate', label: 'Pub/Priv', type: 'enum', options: PUBLIC_PRIVATE, defaultWidth: 80 },
  { key: 'assetTypes', label: 'Asset Types', type: 'tags', defaultWidth: 150 },
  { key: 'peAum', label: 'PE AUM', type: 'number', format: 'aum', defaultWidth: 90 },
  { key: 'reAum', label: 'RE AUM', type: 'number', format: 'aum', defaultWidth: 90 },
  { key: 'numberOfSites', label: 'Sites', type: 'number', defaultWidth: 70 },
  { key: 'revenue', label: 'Revenue', defaultWidth: 110 },
  { key: 'rank', label: 'Rank', defaultWidth: 70 },
  { key: 'tier', label: 'Tier', type: 'enum', options: TIERS, defaultWidth: 80 },
  { key: 'hqRegion', label: 'HQ Region', defaultWidth: 110 },
  { key: 'frameworks', label: 'Frameworks', type: 'tags', defaultWidth: 130 },
  { key: 'notes', label: 'Notes', type: 'notes', defaultWidth: 200 },
  { key: 'bfoCompanyId', label: 'BFO Company ID', defaultWidth: 120 },
  { key: 'bfoCompanyName', label: 'BFO Company Name', defaultWidth: 180 },
  { key: 'zoomCompanyId', label: 'Zoom Company ID', defaultWidth: 120 },
  { key: 'zoomCompanyName', label: 'Zoom Company Name', defaultWidth: 180 },
  { key: 'website', label: 'Website', type: 'link', defaultWidth: 150 },
  { key: 'emailDomain', label: 'Email Domain', defaultWidth: 200 },
  { key: 'contacts', label: 'Contacts', type: 'number', defaultWidth: 80 },
  { key: 'contactTypes', label: 'Contact Types', defaultWidth: 100 },
  { key: 'salesperson', label: 'Salesperson', defaultWidth: 140 },
  { key: 'peOrRe', label: 'PE or RE', defaultWidth: 80 },
  { key: 'tierList', label: 'Tier List', defaultWidth: 80 },
];

const COL_WIDTHS_KEY = 'prospect-col-widths';
const COL_VISIBLE_KEY = 'prospect-col-visible';
const COL_REMOVED_KEY = 'prospect-col-removed';
// What the user has hidden, and what they've starred as their own default
// view — the same model the shared DataTable uses, for the same reason:
// a stored list of VISIBLE columns can't tell "hidden on purpose" from
// "added after you last chose", so every new column arrived hidden.
// Company names the row, so it can't be hidden or deleted.
const ALWAYS_VISIBLE_COLS = ['company'];
const COL_HIDDEN_KEY = 'prospect-col-hidden';
const COL_STARRED_KEY = 'prospect-col-starred';

function loadRemovedCols() {
  try { return new Set(JSON.parse(localStorage.getItem(COL_REMOVED_KEY)) || []); } catch { return new Set(); }
}
function saveRemovedCols(set) { localStorage.setItem(COL_REMOVED_KEY, JSON.stringify([...set])); }

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_WIDTHS_KEY)) || {}; } catch { return {}; }
}
function saveColWidths(w) { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(w)); }

// The pre-hidden-list visible set, as stored, for the one-time conversion.
function loadColVisibleRaw() {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_VISIBLE_KEY));
    return Array.isArray(saved) && saved.length > 0 ? saved : null;
  } catch { return null; }
}
function loadColHidden() {
  try { const v = JSON.parse(localStorage.getItem(COL_HIDDEN_KEY)); return Array.isArray(v) ? v : null; } catch { return null; }
}
function saveColHidden(set) { localStorage.setItem(COL_HIDDEN_KEY, JSON.stringify([...set])); }
function loadColStarred() {
  try { const v = JSON.parse(localStorage.getItem(COL_STARRED_KEY)); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function saveColStarred(set) { localStorage.setItem(COL_STARRED_KEY, JSON.stringify([...set])); }

function TagsCell({ value, prospect, colDef, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);
  const arr = value || [];

  useEffect(() => {
    if (!expanded) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  if (arr.length === 0) return <span className={styles.cellText}>-</span>;
  const summary = arr.length <= 2 ? arr.join(', ') : `${arr[0]} +${arr.length - 1}`;

  return (
    <div className={styles.tagsCellWrap} ref={ref}>
      <span className={styles.tagsSummary} onClick={() => setExpanded(p => !p)} title={arr.join(', ')}>
        {summary}
      </span>
      {expanded && (
        <div className={styles.tagsDropdown}>
          {/* Prefer options injected on the colDef (Asset Types is managed
              on the Dropdowns tab); fall back to the built-in vocab. */}
          {(Array.isArray(colDef.options) ? colDef.options : (colDef.key === 'assetTypes' ? ASSET_TYPES_ALL : FRAMEWORKS_ALL)).map(opt => (
            <label key={opt} className={styles.tagsDropdownItem}>
              <input
                type="checkbox"
                checked={arr.includes(opt)}
                onChange={() => {
                  const next = arr.includes(opt) ? arr.filter(v => v !== opt) : [...arr, opt];
                  onUpdate(prospect.id, { [colDef.key]: next });
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Sentinel value the enum select uses when the user picks "+ Add new…".
// It's not a valid Type — we intercept the choice, prompt for a new
// name, and route through the parent's onAddOption hook so the new
// value lands in settings.customTypes (and on the row).
const ADD_NEW_OPTION = '__ADD_NEW__';
// Sentinel for "Edit options…" — opens a small editor modal that lets
// the user rename / remove options. Only shown when allowEditOptions
// is set on the column definition.
const EDIT_OPTIONS = '__EDIT_OPTIONS__';

// Shared inline cell editor: double-click to edit; enum columns show a
// dropdown of options. Exported so other prospect tables (PE › Blue
// Owl) edit cells exactly the way Table View does.
export function InlineCell({ value, prospect, colDef, onUpdate, onAddOption, onEditOptions }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showSaved, setShowSaved] = useState(false);

  function startEdit() {
    setEditValue(value ?? '');
    setEditing(true);
  }

  function save() {
    setEditing(false);
    const newVal = colDef.type === 'number' ? (editValue === '' ? null : Number(editValue)) : editValue;
    if (newVal !== value) {
      onUpdate(prospect.id, { [colDef.key]: newVal });
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    }
  }

  if (colDef.type === 'enum' && editing) {
    return (
      <select
        className={styles.inlineSelect}
        value={editValue}
        onChange={e => {
          const picked = e.target.value;
          // "+ Add new…" sentinel: prompt for a name, persist via the
          // parent (onAddOption), and assign the new name to this row
          // in one go. Empty / cancelled prompt leaves the cell as it
          // was before.
          if (picked === ADD_NEW_OPTION) {
            const raw = window.prompt(`Add a new ${colDef.label}:`);
            const name = (raw || '').trim();
            setEditing(false);
            if (!name) return;
            const existing = (colDef.options || []).find(o => o.toLowerCase() === name.toLowerCase());
            const finalName = existing || name;
            if (!existing && onAddOption) onAddOption(colDef.key, name);
            if (finalName !== (value ?? '')) {
              onUpdate(prospect.id, { [colDef.key]: finalName });
              setShowSaved(true);
              setTimeout(() => setShowSaved(false), 1500);
            }
            return;
          }
          if (picked === EDIT_OPTIONS) {
            setEditing(false);
            if (onEditOptions) onEditOptions(colDef.key);
            return;
          }
          setEditValue(picked);
          setTimeout(() => {
            setEditing(false);
            if (picked !== (value ?? '')) {
              onUpdate(prospect.id, { [colDef.key]: picked });
              setShowSaved(true);
              setTimeout(() => setShowSaved(false), 1500);
            }
          }, 0);
        }}
        autoFocus
      >
        <option value="">-</option>
        {colDef.options.map(o => <option key={o} value={o}>{o}</option>)}
        {colDef.allowAddNew && (
          <option value={ADD_NEW_OPTION}>+ Add new {colDef.label}…</option>
        )}
        {colDef.allowEditOptions && (colDef.options || []).length > 0 && (
          <option value={EDIT_OPTIONS}>✎ Edit {colDef.label}s…</option>
        )}
      </select>
    );
  }

  if (editing) {
    return (
      <input
        className={styles.inlineInput}
        type={colDef.type === 'number' ? 'number' : 'text'}
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
    );
  }

  const savedBadge = showSaved ? <span className={styles.savedBadge}>Saved!</span> : null;

  if (colDef.type === 'tags') return <span style={{ position: 'relative' }}>{savedBadge}<TagsCell value={value} prospect={prospect} colDef={colDef} onUpdate={onUpdate} /></span>;
  if (colDef.key === 'status' && value) return <span style={{ position: 'relative' }} onDoubleClick={startEdit}>{savedBadge}<Badge label={value} color={statusColor(value)} /></span>;
  if (colDef.key === 'tier' && value) return <span style={{ position: 'relative' }} onDoubleClick={startEdit}>{savedBadge}<Badge label={value} color={tierColor(value)} /></span>;
  if (colDef.type === 'link' && value) {
    const url = value.startsWith('http') ? value : `https://${value}`;
    return <span style={{ position: 'relative' }}>{savedBadge}<a className={styles.websiteLink} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></span>;
  }
  if (colDef.format === 'aum') return <span className={styles.cellEditable} style={{ position: 'relative' }} onDoubleClick={startEdit}>{savedBadge}{formatAum(value)}</span>;
  if (colDef.type === 'number') return <span className={styles.cellEditable} style={{ position: 'relative' }} onDoubleClick={startEdit}>{savedBadge}{formatNumber(value)}</span>;
  if (colDef.type === 'notes') return <span className={`${styles.notesCell} ${styles.cellEditable}`} style={{ position: 'relative' }} onDoubleClick={startEdit} title={value || ''}>{savedBadge}{value || '-'}</span>;
  return <span className={styles.cellEditable} style={{ position: 'relative' }} onDoubleClick={startEdit}>{savedBadge}{value || '-'}</span>;
}

// Column visibility toggle dropdown with remove option
function ColumnToggle({ visibleCols, starredCols, onToggle, onStar, removedCols, onRemove, onRestore, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activeCols = COLUMNS.filter(c => !removedCols.has(c.key));
  const removed = COLUMNS.filter(c => removedCols.has(c.key));
  const starCount = activeCols.filter(c => starredCols.has(c.key)).length;

  return (
    <div className={styles.colToggleWrap} ref={ref}>
      <button className={styles.colToggleBtn} onClick={() => setOpen(p => !p)}>
        Columns ({visibleCols.size}/{activeCols.length})
      </button>
      {open && (
        <div className={styles.colToggleDropdown}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '2px 6px 6px', borderBottom: '1px solid var(--color-border-light)', marginBottom: 4 }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)', lineHeight: 1.35 }} title="★ marks your default columns. Reset shows the starred ones, hides the rest and restores anything deleted.">
              {starCount > 0
                ? `★ ${starCount} default${starCount === 1 ? '' : 's'} · Reset restores`
                : '★ = your defaults · Reset restores'}
            </span>
            <button
              type="button"
              onClick={onReset}
              style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              title={starCount > 0
                ? `Show your ${starCount} starred column${starCount === 1 ? '' : 's'}, hide the rest and restore every deleted column`
                : `Show every column${removed.length ? ` (incl. ${removed.length} deleted)` : ''}. Star columns first to reset to those instead.`}
            >{`Reset${removed.length ? ` (${removed.length} deleted)` : ''}`}</button>
          </div>
          {activeCols.map(col => (
            <div key={col.key} className={styles.colToggleItem} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input
                type="checkbox"
                checked={visibleCols.has(col.key)}
                onChange={() => onToggle(col.key)}
                disabled={ALWAYS_VISIBLE_COLS.includes(col.key)}
              />
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStar(col.key); }}
                title={starredCols.has(col.key)
                  ? `${col.label} is one of your default columns: Reset brings it back. Click to unstar.`
                  : `Make ${col.label} one of your default columns: Reset brings back every starred column and hides the rest.`}
                aria-label={starredCols.has(col.key) ? `Unstar ${col.label}` : `Star ${col.label}`}
                aria-pressed={starredCols.has(col.key)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: '0 2px', lineHeight: 1, color: starredCols.has(col.key) ? '#F59E0B' : 'var(--color-text-muted)', opacity: starredCols.has(col.key) ? 1 : 0.45 }}
              >{starredCols.has(col.key) ? '★' : '☆'}</button>
              <span style={{ flex: 1, fontSize: '0.75rem' }}>{col.label}</span>
              {!ALWAYS_VISIBLE_COLS.includes(col.key) && (
                <button
                  style={{ border: 'none', background: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: '0.8rem', padding: '0 2px', lineHeight: 1 }}
                  title={`Remove "${col.label}" column`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(col.key); }}
                >✕</button>
              )}
            </div>
          ))}
          {removed.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border-light)', margin: '0.3rem 0', padding: '0.3rem 0.5rem 0.15rem', fontSize: '0.65rem', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Removed</div>
              {removed.map(col => (
                <div key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: '#9CA3AF' }}>
                  <span style={{ flex: 1, textDecoration: 'line-through' }}>{col.label}</span>
                  <button
                    style={{ border: 'none', background: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '0.68rem', padding: '0 2px', fontFamily: 'inherit', fontWeight: 600 }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRestore(col.key); }}
                  >Restore</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Column header aliases for Excel import mapping
const HEADER_MAP = {
  'company': 'company', 'account': 'company', 'account name': 'company', 'client': 'company', 'client name': 'company',
  'cdm': 'cdm', 'salesperson': 'cdm', 'sales rep': 'cdm', 'account owner': 'cdm',
  'status': 'status',
  'type': 'type', 'account type': 'type',
  'geography': 'geography', 'geo': 'geography', 'region': 'geography',
  'public/private': 'publicPrivate', 'pub/priv': 'publicPrivate', 'public private': 'publicPrivate',
  'asset types': 'assetTypes', 'asset type': 'assetTypes',
  'pe aum': 'peAum', 'pe aum (billions)': 'peAum',
  're aum': 'reAum', 're aum (billions)': 'reAum',
  'number of sites': 'numberOfSites', 'sites': 'numberOfSites', '# sites': 'numberOfSites',
  'revenue': 'revenue', 'annual revenue': 'revenue', 'company revenue': 'revenue',
  'rank': 'rank',
  'tier': 'tier',
  'hq region': 'hqRegion',
  'frameworks': 'frameworks',
  'notes': 'notes',
  'website': 'website',
  'email domain': 'emailDomain',
  'bfo company id': 'bfoCompanyId',
  'bfo company name': 'bfoCompanyName',
  'zoom company id': 'zoomCompanyId',
  'zoom company name': 'zoomCompanyName',
  'contacts': 'contacts',
  'contact types': 'contactTypes',
  'pe or re': 'peOrRe',
  'tier list': 'tierList',
};

const VALID_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);

function parseNumber(val) {
  if (!val || val === 'Missing Data') return null;
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

// "Edit CDMs…" modal — lets the user rename or remove CDM options.
// Renaming bulk-updates every prospect that currently has the old
// value, and rewrites the customCdms settings list. Removing prompts
// to clear the field on those prospects too (since the dropdown is
// data-driven, the option only disappears once no prospect uses it).
function EditOptionsModal({ colKey, options, allProspects, onUpdate, settings, updateSettings, onClose }) {
  const counts = useMemo(() => {
    const m = new Map();
    for (const p of (allProspects || [])) {
      const v = String(p?.[colKey] || '').trim();
      if (!v) continue;
      m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  }, [allProspects, colKey]);

  const customListKey = colKey === 'cdm' ? 'customCdms' : null;
  const [busy, setBusy] = useState(false);

  async function rename(oldName) {
    const raw = window.prompt(`Rename "${oldName}" to:`, oldName);
    const next = (raw || '').trim();
    if (!next || next === oldName) return;
    if (next.toLowerCase() !== oldName.toLowerCase() &&
        options.some(o => o.toLowerCase() === next.toLowerCase())) {
      const ok = window.confirm(`"${next}" already exists. Merge "${oldName}" into "${next}"? Every prospect tagged "${oldName}" will be retagged "${next}".`);
      if (!ok) return;
    }
    setBusy(true);
    try {
      const targets = (allProspects || []).filter(p => String(p?.[colKey] || '').trim() === oldName);
      for (const p of targets) {
        await onUpdate(p.id, { [colKey]: next });
      }
      if (customListKey && updateSettings) {
        const list = Array.isArray(settings?.[customListKey]) ? settings[customListKey] : [];
        const filtered = list.filter(t => String(t).trim().toLowerCase() !== oldName.toLowerCase());
        const alreadyHasNew = filtered.some(t => String(t).trim().toLowerCase() === next.toLowerCase());
        const nextList = alreadyHasNew ? filtered : [...filtered, next];
        if (nextList.length !== list.length || !alreadyHasNew) {
          updateSettings({ [customListKey]: nextList });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(name) {
    const used = counts.get(name) || 0;
    const msg = used > 0
      ? `Remove "${name}"? It's currently set on ${used} prospect${used === 1 ? '' : 's'}: those will be cleared.`
      : `Remove "${name}" from the list?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const targets = (allProspects || []).filter(p => String(p?.[colKey] || '').trim() === name);
      for (const p of targets) {
        await onUpdate(p.id, { [colKey]: '' });
      }
      if (customListKey && updateSettings) {
        const list = Array.isArray(settings?.[customListKey]) ? settings[customListKey] : [];
        const nextList = list.filter(t => String(t).trim().toLowerCase() !== name.toLowerCase());
        if (nextList.length !== list.length) updateSettings({ [customListKey]: nextList });
      }
    } finally {
      setBusy(false);
    }
  }

  const label = colKey === 'cdm' ? 'CDM' : colKey;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '1.25rem', maxWidth: 460, width: '90%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: '#1E2A36' }}>Edit {label}s</h3>
          <button style={{ border: 'none', background: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6B7280' }} onClick={onClose}>&times;</button>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#5A6B7E', margin: '0 0 0.75rem' }}>
          Rename or remove options. Renames update every prospect using the old value; removes clear the field on those prospects.
        </p>
        {options.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: '#94A3B8', fontStyle: 'italic', padding: '0.5rem 0' }}>No options yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {options.map(opt => {
              const used = counts.get(opt) || 0;
              return (
                <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.6rem', background: '#F8FAFC', borderRadius: 6 }}>
                  <span style={{ flex: 1, fontSize: '0.82rem', color: '#1E293B', fontWeight: 600 }}>{opt}</span>
                  <span style={{ fontSize: '0.65rem', color: '#94A3B8' }}>{used} {used === 1 ? 'row' : 'rows'}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => rename(opt)}
                    style={{ padding: '2px 8px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', fontSize: '0.7rem', fontWeight: 600, color: '#334155', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                  >Rename</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(opt)}
                    style={{ padding: '2px 8px', border: '1px solid #FCA5A5', borderRadius: 4, background: '#fff', fontSize: '0.7rem', fontWeight: 600, color: '#B91C1C', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                  >Remove</button>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '0.4rem 1rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#5A6B7E' }}
          >Done</button>
        </div>
      </div>
    </div>
  );
}

export function TableView({ prospects, allProspects, sortConfig, toggleSort, onUpdate, onDelete, onSelect, onAdd, onReconcileAll, settings, updateSettings }) {
  const dynamicTypeOptions = useMemo(
    () => buildTypeOptions(allProspects || prospects, settings),
    [allProspects, prospects, settings]
  );

  const dynamicCdmOptions = useMemo(
    () => buildCdmOptions(allProspects || prospects, settings),
    [allProspects, prospects, settings]
  );

  // Asset Types vocabulary, managed on the Dropdowns tab (plus any value
  // already in use), injected into the tags column below.
  const dynamicAssetTypeOptions = useMemo(
    () => buildAssetTypeOptions(allProspects || prospects, settings),
    [allProspects, prospects, settings]
  );

  const handleAddOption = useCallback((colKey, name) => {
    persistCustomOption(colKey, name, settings, updateSettings, dynamicCdmOptions);
  }, [settings, updateSettings, dynamicCdmOptions]);

  // "Edit CDMs…" opens this modal — column key is stored so the editor
  // knows which list it's working on (currently only CDM uses it).
  const [editOptionsCol, setEditOptionsCol] = useState(null);
  const handleEditOptions = useCallback((colKey) => {
    if (colKey !== 'cdm') return;
    setEditOptionsCol(colKey);
  }, []);

  // Inject the live options + add-new flag into the Type and CDM
  // columns so the shared InlineCell renderer picks them up without
  // each cell having to know about settings / prospects.
  const RESOLVED_COLUMNS = useMemo(() => {
    return COLUMNS.map(c => {
      if (c.key === 'type') return { ...c, options: dynamicTypeOptions, allowAddNew: true };
      if (c.key === 'cdm')  return { ...c, options: dynamicCdmOptions,  allowAddNew: true, allowEditOptions: true };
      if (c.key === 'assetTypes') return { ...c, options: dynamicAssetTypeOptions };
      return c;
    });
  }, [dynamicTypeOptions, dynamicCdmOptions, dynamicAssetTypeOptions]);
  const [colWidths, setColWidths] = useState(loadColWidths);
  const [hiddenPref, setHiddenPref] = useState(loadColHidden);
  const [legacyVisible, setLegacyVisible] = useState(loadColVisibleRaw);
  const [starredCols, setStarredCols] = useState(loadColStarred);
  const [removedCols, setRemovedCols] = useState(loadRemovedCols);
  const hiddenCols = useMemo(
    () => resolveHiddenKeys({ hidden: hiddenPref, legacyVisible, columnKeys: COLUMNS.map(c => c.key) }),
    [hiddenPref, legacyVisible],
  );
  const visibleCols = useMemo(
    () => new Set(COLUMNS
      .filter(c => isColumnVisible(c.key, { hidden: hiddenCols, removed: removedCols, alwaysVisible: ALWAYS_VISIBLE_COLS }))
      .map(c => c.key)),
    [hiddenCols, removedCols],
  );
  const resizingRef = useRef(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null); // { mapping, rawHeaders, rows, fileName }
  const uploadRef = useRef(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  // Additive import from the Paste from Excel modal. The modal already
  // filtered out duplicates and rows without a company; this just adds
  // the new prospects one by one (onAdd dedupes again by company key as
  // a backstop) and surfaces progress + a final summary.
  async function handlePasteImport({ toAdd, dupes, noCompany }) {
    setPasteOpen(false);
    setUploading(true);
    let added = 0;
    const failed = [];
    try {
      for (const record of toAdd) {
        setUploadStatus({ type: 'loading', message: `Adding ${added + 1}/${toAdd.length}…` });
        try {
          await onAdd(record);
          added++;
        } catch (err) {
          console.error('Paste import: add failed for', record.company, err);
          failed.push(record.company);
        }
      }
      const skips = [];
      if (dupes.length) skips.push(`${dupes.length} already in Table View`);
      if (noCompany) skips.push(`${noCompany} without a company`);
      if (failed.length) skips.push(`${failed.length} FAILED`);
      setUploadStatus({
        type: failed.length ? 'error' : 'success',
        message: `Added ${added} compan${added === 1 ? 'y' : 'ies'}.${skips.length ? ` Skipped: ${skips.join(', ')}.` : ''}`,
      });
      if (failed.length) {
        window.alert(`These rows failed to save: try them again:\n  ${failed.join('\n  ')}`);
      }
    } finally {
      setUploading(false);
    }
  }

  function handleFileSelect(file) {
    if (!file) return;
    setUploadStatus({ type: 'loading', message: 'Reading file...' });

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Pulled in on use — the spreadsheet library is ~140 KB gzipped
        // and this page only needs it for import / export.
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(e.target.result, { type: 'array' });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) { setUploadStatus({ type: 'error', message: 'File has no data rows' }); return; }

        const rawHeaders = rows[0].map(h => String(h || '').trim());
        const mappedHeaders = rawHeaders.map(h => {
          const key = HEADER_MAP[h.toLowerCase()] || null;
          if (!key) return null;
          if (removedCols.has(key)) return null;
          return key;
        });

        if (!mappedHeaders.includes('company')) { setUploadStatus({ type: 'error', message: 'No "Company" or "Account" column found' }); return; }

        // Build mapping info for each column (exclude removed columns)
        const activeCols = COLUMNS.filter(c => !removedCols.has(c.key));
        const mapping = activeCols.map(col => {
          const idx = mappedHeaders.indexOf(col.key);
          return {
            key: col.key,
            label: col.label,
            mapped: idx >= 0,
            header: idx >= 0 ? rawHeaders[idx] : null,
            colIndex: idx,
          };
        });

        // Also show unmapped file columns
        const unmapped = rawHeaders
          .map((h, i) => ({ header: h, index: i, mapped: mappedHeaders[i] != null }))
          .filter(u => !u.mapped && u.header);

        setUploadPreview({ mapping, unmapped, rawHeaders, mappedHeaders, rows, fileName: file.name });
        setUploadStatus(null);
      } catch (err) {
        setUploadStatus({ type: 'error', message: `Failed to read file: ${err.message}` });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmUpload() {
    if (!uploadPreview) return;
    const { mappedHeaders, rows } = uploadPreview;
    setUploading(true);
    setUploadStatus({ type: 'loading', message: `Parsing ${rows.length - 1} rows...` });

    try {
      const newProspects = [];
      let skipped = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const record = {};
        for (let j = 0; j < mappedHeaders.length; j++) {
          const key = mappedHeaders[j];
          if (!key) continue;
          const val = row[j] != null ? String(row[j]).trim() : '';
          if (!val) continue;

          if (key === 'assetTypes') {
            record[key] = val.split(',').map(s => s.trim()).filter(Boolean);
          } else if (key === 'frameworks') {
            record[key] = val.split(',').map(s => s.trim()).filter(v => VALID_FRAMEWORKS.has(v));
          } else if (key === 'peAum' || key === 'reAum' || key === 'numberOfSites') {
            const n = parseNumber(val);
            if (n != null) record[key] = n;
          } else {
            record[key] = val;
          }
        }

        if (!record.company) { skipped++; continue; }
        newProspects.push(record);
      }

      setUploadStatus({ type: 'loading', message: `Checking ${newProspects.length} rows against the current data...` });

      // The plan is built against the LIVE collection and shown before
      // anything is written, so these numbers are what actually happens.
      // Worth the extra click: an import that removes companies also
      // removes what is keyed to them, and that used to happen silently
      // to the whole roster on every upload.
      const result = await onReconcileAll(newProspects, {
        onProgress: (msg) => setUploadStatus({ type: 'loading', message: msg }),
        confirm: (c) => window.confirm(
          `Import ${newProspects.length} rows?\n\n`
          + `• ${c.updated} existing compan${c.updated === 1 ? 'y' : 'ies'} updated — their Target Account, division and HQ mappings are kept\n`
          + `• ${c.created} added\n`
          + `• ${c.deleted} removed (not in the file) — anything mapped to them goes too\n`
          + (c.collapsed ? `• ${c.collapsed} row${c.collapsed === 1 ? '' : 's'} in the file were another spelling of a company already in it\n` : '')
          + (c.mappingsMoved ? `• ${c.mappingsMoved} mapping${c.mappingsMoved === 1 ? '' : 's'} moved off duplicate records\n` : ''),
        ),
      });

      if (result?.cancelled) {
        setUploadStatus({ type: 'error', message: 'Import cancelled — nothing was changed.' });
        return;
      }

      setUploadStatus({
        type: 'success',
        message: `Done! ${result.updated} updated, ${result.created} added, ${result.deleted} removed.`
          + (skipped ? ` ${skipped} rows skipped (no company).` : ''),
      });
      setUploadPreview(null);
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Upload failed: ${err.message}` });
    } finally {
      setUploading(false);
    }
  }

  function removeCol(key) {
    setRemovedCols(prev => {
      const next = new Set(prev);
      next.add(key);
      saveRemovedCols(next);
      return next;
    });
  }

  function restoreCol(key) {
    setRemovedCols(prev => {
      const next = new Set(prev);
      next.delete(key);
      saveRemovedCols(next);
      return next;
    });
    // It was deleted, not hidden — restoring it should show it.
    commitHidden(new Set([...hiddenCols].filter(k => k !== key)));
  }

  // Persist the hidden set and drop the older visible list, so the table
  // stops reading the pre-conversion shape from here on.
  function commitHidden(nextHidden) {
    setHiddenPref([...nextHidden]);
    setLegacyVisible(null);
    saveColHidden(nextHidden);
  }

  // Star / un-star: the starred set is the user's own default view, which
  // Reset restores. Starring shows the column, since a default you can't
  // see isn't one.
  function toggleStar(key) {
    const star = !starredCols.has(key);
    const next = applyStar({ key, star, starred: starredCols, hidden: hiddenCols, removed: removedCols });
    setStarredCols(next.starred);
    saveColStarred(next.starred);
    setRemovedCols(next.removed);
    saveRemovedCols(next.removed);
    commitHidden(next.hidden);
  }

  // Reset: every deleted column back, and visibility set to the starred
  // view — or to everything when nothing is starred.
  function resetColumns() {
    const { hidden, removed } = resetToStarred({
      columnKeys: COLUMNS.map(c => c.key),
      starred: starredCols,
      alwaysVisible: ALWAYS_VISIBLE_COLS,
    });
    setRemovedCols(removed);
    saveRemovedCols(removed);
    commitHidden(hidden);
  }

  const getWidth = (col) => colWidths[col.key] || col.defaultWidth;

  const visibleColumns = RESOLVED_COLUMNS.filter(c => visibleCols.has(c.key) && !removedCols.has(c.key));

  function toggleCol(key) {
    if (ALWAYS_VISIBLE_COLS.includes(key)) return;
    const next = new Set(hiddenCols);
    if (next.has(key)) next.delete(key); else next.add(key);
    commitHidden(next);
  }

  // Column resize via drag
  const handleResizeStart = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || COLUMNS.find(c => c.key === colKey)?.defaultWidth || 100;
    resizingRef.current = colKey;

    function onMouseMove(ev) {
      const diff = ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColWidths(prev => {
        const next = { ...prev, [colKey]: newWidth };
        saveColWidths(next);
        return next;
      });
    }

    function onMouseUp() {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  if (prospects.length === 0) {
    return (
      <div>
        <div className={styles.tableToolbar}>
          <ColumnToggle visibleCols={visibleCols} starredCols={starredCols} onToggle={toggleCol} onStar={toggleStar} removedCols={removedCols} onRemove={removeCol} onRestore={restoreCol} onReset={resetColumns} />
        </div>
        <div className={styles.empty}>No prospects found</div>
      </div>
    );
  }

  return (
    <div className={styles.outerWrap}>
      <div className={styles.tableToolbar}>
        <ColumnToggle visibleCols={visibleCols} starredCols={starredCols} onToggle={toggleCol} onStar={toggleStar} removedCols={removedCols} onRemove={removeCol} onRestore={restoreCol} onReset={resetColumns} />
        <button className={styles.resetWidthsBtn} onClick={() => { setColWidths({}); saveColWidths({}); }}>
          Reset widths
        </button>
        <button style={{ marginLeft: 'auto', padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit' }} onClick={async () => {
          const activeCols = COLUMNS.filter(c => !removedCols.has(c.key));
          const XLSX = await import('xlsx');
          const ws = XLSX.utils.aoa_to_sheet([activeCols.map(c => c.label)]);
          ws['!cols'] = activeCols.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Template');
          XLSX.writeFile(wb, 'prospect-upload-template.xlsx');
        }}>Download Template</button>
        <button
          style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => setPasteOpen(true)}
          disabled={uploading}
          title="Copy rows from Excel (with the header row) and paste them in to mass-add companies: existing companies are skipped"
        >Paste from Excel</button>
        <label style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', transition: 'border-color 0.15s' }}>
          {uploading ? 'Uploading...' : 'Upload Excel'}
          <input ref={uploadRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { handleFileSelect(e.target.files?.[0]); e.target.value = ''; }} disabled={uploading} />
        </label>
        {uploadStatus && (
          <span style={{ fontSize: '0.7rem', fontWeight: 500, color: uploadStatus.type === 'success' ? '#059669' : uploadStatus.type === 'error' ? '#DC2626' : 'var(--color-text-secondary)' }}>
            {uploadStatus.message}
          </span>
        )}
      </div>
      {pasteOpen && (
        <PasteAddModal
          existingProspects={allProspects || prospects}
          onImport={handlePasteImport}
          onClose={() => setPasteOpen(false)}
        />
      )}
      {editOptionsCol && (
        <EditOptionsModal
          colKey={editOptionsCol}
          options={editOptionsCol === 'cdm' ? dynamicCdmOptions : []}
          allProspects={allProspects || prospects || []}
          onUpdate={onUpdate}
          settings={settings}
          updateSettings={updateSettings}
          onClose={() => setEditOptionsCol(null)}
        />
      )}
      {uploadPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setUploadPreview(null)}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#1E2A36' }}>Column Mapping: {uploadPreview.fileName}</h3>
              <button style={{ border: 'none', background: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6B7280' }} onClick={() => setUploadPreview(null)}>&times;</button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#5A6B7E', margin: '0 0 0.75rem' }}>
              {uploadPreview.rows.length - 1} data rows found &middot; {uploadPreview.mapping.filter(m => m.mapped).length} of {uploadPreview.mapping.length} columns mapped
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '1rem' }}>
              {uploadPreview.mapping.map(m => (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', borderRadius: '6px', background: m.mapped ? '#F0FDF4' : '#FEF2F2', fontSize: '0.75rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: m.mapped ? '#16A34A' : '#DC2626' }}>{m.mapped ? '✓' : '✗'}</span>
                  <span style={{ fontWeight: 600, color: '#1E293B' }}>{m.label}</span>
                  {m.mapped && <span style={{ color: '#6B7280', marginLeft: 'auto', fontSize: '0.68rem' }}>← "{m.header}"</span>}
                  {!m.mapped && <span style={{ color: '#9CA3AF', marginLeft: 'auto', fontSize: '0.68rem' }}>Not found</span>}
                </div>
              ))}
            </div>
            {uploadPreview.unmapped.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.72rem', color: '#9CA3AF', margin: '0 0 0.3rem' }}>Unrecognized columns (will be skipped):</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {uploadPreview.unmapped.map(u => (
                    <span key={u.index} style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '0.65rem', background: '#F3F4F6', color: '#6B7280' }}>{u.header}</span>
                  ))}
                </div>
              </div>
            )}
            {uploadStatus && (
              <p style={{ fontSize: '0.75rem', fontWeight: 500, color: uploadStatus.type === 'success' ? '#059669' : uploadStatus.type === 'error' ? '#DC2626' : '#5A6B7E', margin: '0 0 0.75rem' }}>
                {uploadStatus.message}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button style={{ padding: '0.4rem 1rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: '#fff', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#5A6B7E' }} onClick={() => setUploadPreview(null)}>Cancel</button>
              <button style={{ padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', background: '#3B7DDD', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} onClick={confirmUpload} disabled={uploading}>
                {uploading ? 'Uploading...' : `Upload ${uploadPreview.rows.length - 1} Rows`}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={styles.wrapper}>
        <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) + 40 }}>
          <colgroup>
            {visibleColumns.map(col => (
              <col key={col.key} style={{ width: getWidth(col) }} />
            ))}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  className={col.sticky ? styles.stickyCol : undefined}
                  style={{ width: getWidth(col), position: 'relative' }}
                  onClick={() => col.type !== 'tags' && toggleSort(col.key)}
                >
                  {col.label}
                  {sortConfig.key === col.key && (
                    <span className={styles.sortArrow}>
                      {sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}
                    </span>
                  )}
                  <span
                    className={styles.resizeHandle}
                    onMouseDown={e => handleResizeStart(e, col.key)}
                    onClick={e => e.stopPropagation()}
                  />
                </th>
              ))}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {prospects.map(p => (
              <tr key={p.id}>
                {visibleColumns.map(col => (
                  <td key={col.key} className={col.sticky ? styles.stickyCol : undefined}>
                    {col.key === 'company' ? (
                      <span className={styles.companyName} onClick={() => onSelect(p)}>
                        {p.company}
                      </span>
                    ) : (
                      <InlineCell value={p[col.key]} prospect={p} colDef={col} onUpdate={onUpdate} onAddOption={handleAddOption} onEditOptions={handleEditOptions} />
                    )}
                  </td>
                ))}
                <td>
                  <div className={styles.actions}>
                    <button className={styles.actionBtn} onClick={() => { if (confirm(`Delete "${p.company}"?`)) onDelete(p.id); }} title="Delete">&#x1F5D1;</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
