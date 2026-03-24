import { useState } from 'react';
import { Badge } from '../common/Badge';
import { statusColor, tierColor, formatAum, formatNumber } from '../../utils/formatters';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE } from '../../data/enums';
import styles from './TableView.module.css';

const COLUMNS = [
  { key: 'company', label: 'Company', sticky: true },
  { key: 'status', label: 'Status', type: 'enum', options: STATUSES },
  { key: 'tier', label: 'Tier', type: 'enum', options: TIERS },
  { key: 'type', label: 'Type', type: 'enum', options: TYPES },
  { key: 'geography', label: 'Geography', type: 'enum', options: GEOGRAPHIES },
  { key: 'publicPrivate', label: 'Pub/Priv', type: 'enum', options: PUBLIC_PRIVATE },
  { key: 'reAum', label: 'RE AUM', type: 'number', format: 'aum' },
  { key: 'peAum', label: 'PE AUM', type: 'number', format: 'aum' },
  { key: 'numberOfSites', label: 'Sites', type: 'number' },
  { key: 'assetTypes', label: 'Asset Types', type: 'tags' },
  { key: 'frameworks', label: 'Frameworks', type: 'tags' },
  { key: 'hqRegion', label: 'HQ Region' },
  { key: 'cdm', label: 'CDM' },
  { key: 'website', label: 'Website', type: 'link' },
  { key: 'notes', label: 'Notes', type: 'notes' },
];

function InlineCell({ value, prospect, colDef, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  function startEdit() {
    setEditValue(value ?? '');
    setEditing(true);
  }

  function save() {
    setEditing(false);
    const newVal = colDef.type === 'number' ? (editValue === '' ? null : Number(editValue)) : editValue;
    if (newVal !== value) {
      onUpdate(prospect.id, { [colDef.key]: newVal });
    }
  }

  if (colDef.type === 'enum' && editing) {
    return (
      <select
        className={styles.inlineSelect}
        value={editValue}
        onChange={e => { setEditValue(e.target.value); }}
        onBlur={save}
        autoFocus
      >
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

  // Display
  if (colDef.key === 'status' && value) {
    return <span onDoubleClick={startEdit}><Badge label={value} color={statusColor(value)} /></span>;
  }
  if (colDef.key === 'tier' && value) {
    return <span onDoubleClick={startEdit}><Badge label={value} color={tierColor(value)} /></span>;
  }
  if (colDef.type === 'tags') {
    const arr = value || [];
    if (arr.length === 0) return <span className={styles.cellText}>—</span>;
    return (
      <div className={styles.tagsCell}>
        {arr.map(t => <span key={t} className={styles.tagPill}>{t}</span>)}
      </div>
    );
  }
  if (colDef.type === 'link' && value) {
    const url = value.startsWith('http') ? value : `https://${value}`;
    return <a className={styles.websiteLink} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>;
  }
  if (colDef.format === 'aum') {
    return <span className={styles.cellEditable} onDoubleClick={startEdit}>{formatAum(value)}</span>;
  }
  if (colDef.type === 'number') {
    return <span className={styles.cellEditable} onDoubleClick={startEdit}>{formatNumber(value)}</span>;
  }
  if (colDef.type === 'notes') {
    return <span className={`${styles.notesCell} ${styles.cellEditable}`} onDoubleClick={startEdit} title={value || ''}>{value || '—'}</span>;
  }

  return <span className={styles.cellEditable} onDoubleClick={startEdit}>{value || '—'}</span>;
}

export function TableView({ prospects, sortConfig, toggleSort, onUpdate, onDelete, onSelect }) {
  if (prospects.length === 0) {
    return <div className={styles.empty}>No prospects found</div>;
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                className={col.sticky ? styles.stickyCol : undefined}
                onClick={() => col.type !== 'tags' && toggleSort(col.key)}
              >
                {col.label}
                {sortConfig.key === col.key && (
                  <span className={styles.sortArrow}>
                    {sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}
                  </span>
                )}
              </th>
            ))}
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {prospects.map(p => (
            <tr key={p.id}>
              {COLUMNS.map(col => (
                <td key={col.key} className={col.sticky ? styles.stickyCol : undefined}>
                  {col.key === 'company' ? (
                    <span className={styles.companyName} onClick={() => onSelect(p)}>
                      {p.company}
                    </span>
                  ) : (
                    <InlineCell
                      value={p[col.key]}
                      prospect={p}
                      colDef={col}
                      onUpdate={onUpdate}
                    />
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
  );
}
