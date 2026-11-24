import { useState } from 'react';
import { ASSET_TYPES, FRAMEWORKS } from '../../data/enums';

// Bulk-edit bar for the Table tab: shows once any rows are ticked. Pick a
// column, give it a value, and Apply writes it to every ticked company.
// Enum columns get their dropdown, tag columns add or remove one tag, the
// rest take typed text. A blank value clears the field (the Apply button
// says which it will do).
export function BulkEditBar({ columns, selectedCount, applying, progress, onApply, onClear }) {
  const [fieldKey, setFieldKey] = useState(() => columns[0]?.key || '');
  const [mode, setMode] = useState('add');
  const [value, setValue] = useState('');
  // A value typed for one field must not be applied to the next one by
  // accident, so changing the field empties it.
  const pickField = (key) => { setFieldKey(key); setValue(''); setMode('add'); };

  const field = columns.find(c => c.key === fieldKey) || columns[0];
  if (!field) return null;
  const isTags = field.type === 'tags';
  const options = isTags
    ? (Array.isArray(field.options) ? field.options : (field.key === 'assetTypes' ? ASSET_TYPES : FRAMEWORKS))
    : field.type === 'enum' ? (field.options || []) : null;
  const blank = !String(value).trim();
  const inputStyle = { padding: '0.3rem 0.45rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B' };
  const label = applying
    ? `Applying ${progress?.done ?? 0}/${progress?.total ?? selectedCount}…`
    : isTags
      ? `${mode === 'remove' ? 'Remove from' : 'Add to'} ${selectedCount}`
      : blank ? `Clear on ${selectedCount}` : `Apply to ${selectedCount}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0.4rem 0.75rem', padding: '0.5rem 0.75rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.78rem', flexShrink: 0 }}>
      <span style={{ fontWeight: 700, color: '#1E3A8A' }}>{selectedCount} selected</span>
      <span style={{ color: '#64748B' }}>·</span>
      {isTags ? (
        <select value={mode} onChange={e => setMode(e.target.value)} style={inputStyle} disabled={applying} aria-label="Add or remove">
          <option value="add">Add</option>
          <option value="remove">Remove</option>
        </select>
      ) : (
        <span style={{ color: '#64748B' }}>Set</span>
      )}
      {isTags && (
        <select value={value} onChange={e => setValue(e.target.value)} style={{ ...inputStyle, minWidth: 160 }} disabled={applying} aria-label="Tag">
          <option value="">Pick one…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {isTags && <span style={{ color: '#64748B' }}>{mode === 'remove' ? 'from' : 'to'}</span>}
      <select value={fieldKey} onChange={e => pickField(e.target.value)} style={inputStyle} disabled={applying} aria-label="Field">
        {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      {!isTags && <span style={{ color: '#64748B' }}>to</span>}
      {!isTags && (options ? (
        <select value={value} onChange={e => setValue(e.target.value)} style={{ ...inputStyle, minWidth: 170 }} disabled={applying} aria-label="Value">
          <option value="">(blank, clears it)</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type="text"
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !applying) onApply(field, mode, value); }}
          placeholder="New value (blank to clear)"
          style={{ ...inputStyle, minWidth: 200 }}
          disabled={applying}
          aria-label="Value"
        />
      ))}
      <button
        type="button"
        onClick={() => onApply(field, mode, value)}
        disabled={applying || (isTags && blank)}
        style={{ padding: '0.3rem 0.8rem', border: 'none', borderRadius: 4, background: applying || (isTags && blank) ? '#93C5FD' : '#2563EB', color: '#fff', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: applying || (isTags && blank) ? 'default' : 'pointer' }}
      >{label}</button>
      <button
        type="button"
        onClick={onClear}
        disabled={applying}
        style={{ marginLeft: 'auto', padding: '0.3rem 0.6rem', border: '1px solid #BFDBFE', borderRadius: 4, background: '#fff', color: '#1E3A8A', fontSize: '0.74rem', fontFamily: 'inherit', cursor: applying ? 'default' : 'pointer' }}
      >Clear selection</button>
    </div>
  );
}
