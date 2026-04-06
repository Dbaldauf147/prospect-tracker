import { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Badge } from '../common/Badge';
import { statusColor, tierColor, formatAum, formatNumber } from '../../utils/formatters';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, ASSET_TYPES, FRAMEWORKS } from '../../data/enums';
import styles from './TableView.module.css';

const ASSET_TYPES_ALL = ASSET_TYPES;
const FRAMEWORKS_ALL = FRAMEWORKS;

const COLUMNS = [
  { key: 'company', label: 'Company', sticky: true, defaultWidth: 200 },
  { key: 'cdm', label: 'CDM', defaultWidth: 120 },
  { key: 'status', label: 'Status', type: 'enum', options: STATUSES, defaultWidth: 130 },
  { key: 'type', label: 'Type', type: 'enum', options: TYPES, defaultWidth: 160 },
  { key: 'geography', label: 'Geography', type: 'enum', options: GEOGRAPHIES, defaultWidth: 100 },
  { key: 'publicPrivate', label: 'Pub/Priv', type: 'enum', options: PUBLIC_PRIVATE, defaultWidth: 80 },
  { key: 'assetTypes', label: 'Asset Types', type: 'tags', defaultWidth: 150 },
  { key: 'peAum', label: 'PE AUM', type: 'number', format: 'aum', defaultWidth: 90 },
  { key: 'reAum', label: 'RE AUM', type: 'number', format: 'aum', defaultWidth: 90 },
  { key: 'numberOfSites', label: 'Sites', type: 'number', defaultWidth: 70 },
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

function loadRemovedCols() {
  try { return new Set(JSON.parse(localStorage.getItem(COL_REMOVED_KEY)) || []); } catch { return new Set(); }
}
function saveRemovedCols(set) { localStorage.setItem(COL_REMOVED_KEY, JSON.stringify([...set])); }

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_WIDTHS_KEY)) || {}; } catch { return {}; }
}
function saveColWidths(w) { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(w)); }

function loadColVisible() {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_VISIBLE_KEY));
    if (saved) return new Set(saved);
    return null;
  } catch { return null; }
}
function saveColVisible(set) { localStorage.setItem(COL_VISIBLE_KEY, JSON.stringify([...set])); }

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

  if (arr.length === 0) return <span className={styles.cellText}>—</span>;
  const summary = arr.length <= 2 ? arr.join(', ') : `${arr[0]} +${arr.length - 1}`;

  return (
    <div className={styles.tagsCellWrap} ref={ref}>
      <span className={styles.tagsSummary} onClick={() => setExpanded(p => !p)} title={arr.join(', ')}>
        {summary}
      </span>
      {expanded && (
        <div className={styles.tagsDropdown}>
          {(colDef.key === 'assetTypes' ? ASSET_TYPES_ALL : FRAMEWORKS_ALL).map(opt => (
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

function InlineCell({ value, prospect, colDef, onUpdate }) {
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
      <select className={styles.inlineSelect} value={editValue} onChange={e => { setEditValue(e.target.value); setTimeout(() => { const newVal = e.target.value; setEditing(false); if (newVal !== (value ?? '')) { onUpdate(prospect.id, { [colDef.key]: newVal }); setShowSaved(true); setTimeout(() => setShowSaved(false), 1500); } }, 0); }} autoFocus>
        <option value="">—</option>
        {colDef.options.map(o => <option key={o} value={o}>{o}</option>)}
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
  if (colDef.type === 'notes') return <span className={`${styles.notesCell} ${styles.cellEditable}`} style={{ position: 'relative' }} onDoubleClick={startEdit} title={value || ''}>{savedBadge}{value || '—'}</span>;
  return <span className={styles.cellEditable} style={{ position: 'relative' }} onDoubleClick={startEdit}>{savedBadge}{value || '—'}</span>;
}

// Column visibility toggle dropdown with remove option
function ColumnToggle({ visibleCols, onToggle, removedCols, onRemove, onRestore }) {
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

  return (
    <div className={styles.colToggleWrap} ref={ref}>
      <button className={styles.colToggleBtn} onClick={() => setOpen(p => !p)}>
        Columns ({visibleCols.size}/{activeCols.length})
      </button>
      {open && (
        <div className={styles.colToggleDropdown}>
          {activeCols.map(col => (
            <div key={col.key} className={styles.colToggleItem} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input
                type="checkbox"
                checked={visibleCols.has(col.key)}
                onChange={() => onToggle(col.key)}
                disabled={col.key === 'company'}
              />
              <span style={{ flex: 1, fontSize: '0.75rem' }}>{col.label}</span>
              {col.key !== 'company' && (
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

const VALID_FRAMEWORKS = new Set(['GRESB', 'CDP', 'UN PRI', 'SBT', 'NZAM']);

function parseNumber(val) {
  if (!val || val === 'Missing Data') return null;
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

export function TableView({ prospects, allProspects, sortConfig, toggleSort, onUpdate, onDelete, onSelect, onAdd, onReplaceAll }) {
  const [colWidths, setColWidths] = useState(loadColWidths);
  const [visibleCols, setVisibleCols] = useState(() => {
    const saved = loadColVisible();
    return saved || new Set(COLUMNS.map(c => c.key));
  });
  const [removedCols, setRemovedCols] = useState(loadRemovedCols);
  const resizingRef = useRef(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null); // { mapping, rawHeaders, rows, fileName }
  const uploadRef = useRef(null);

  function handleFileSelect(file) {
    if (!file) return;
    setUploadStatus({ type: 'loading', message: 'Reading file...' });

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
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

      setUploadStatus({ type: 'loading', message: `Replacing all data with ${newProspects.length} rows...` });

      await onReplaceAll(newProspects, (msg) => {
        setUploadStatus({ type: 'loading', message: msg });
      });

      setUploadStatus({ type: 'success', message: `Done! Replaced with ${newProspects.length} rows. ${skipped} rows skipped (no company).` });
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
    // Also remove from visible
    setVisibleCols(prev => {
      const next = new Set(prev);
      next.delete(key);
      saveColVisible(next);
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
    // Add back to visible
    setVisibleCols(prev => {
      const next = new Set(prev);
      next.add(key);
      saveColVisible(next);
      return next;
    });
  }

  const getWidth = (col) => colWidths[col.key] || col.defaultWidth;

  const visibleColumns = COLUMNS.filter(c => visibleCols.has(c.key) && !removedCols.has(c.key));

  function toggleCol(key) {
    if (key === 'company') return; // always visible
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveColVisible(next);
      return next;
    });
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
          <ColumnToggle visibleCols={visibleCols} onToggle={toggleCol} removedCols={removedCols} onRemove={removeCol} onRestore={restoreCol} />
        </div>
        <div className={styles.empty}>No prospects found</div>
      </div>
    );
  }

  return (
    <div className={styles.outerWrap}>
      <div className={styles.tableToolbar}>
        <ColumnToggle visibleCols={visibleCols} onToggle={toggleCol} removedCols={removedCols} onRemove={removeCol} onRestore={restoreCol} />
        <button className={styles.resetWidthsBtn} onClick={() => { setColWidths({}); saveColWidths({}); }}>
          Reset widths
        </button>
        <button style={{ marginLeft: 'auto', padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => {
          const activeCols = COLUMNS.filter(c => !removedCols.has(c.key));
          const ws = XLSX.utils.aoa_to_sheet([activeCols.map(c => c.label)]);
          ws['!cols'] = activeCols.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Template');
          XLSX.writeFile(wb, 'prospect-upload-template.xlsx');
        }}>Download Template</button>
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
      {uploadPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setUploadPreview(null)}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#1E2A36' }}>Column Mapping — {uploadPreview.fileName}</h3>
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
                      <InlineCell value={p[col.key]} prospect={p} colDef={col} onUpdate={onUpdate} />
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
