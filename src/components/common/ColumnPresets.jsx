// The Presets strip at the top of a Columns menu: one chip per saved view
// (click to show exactly those columns, in that order), × to delete one,
// and a name box to save what the table is showing now.
//
// Purely presentational. The caller owns the list (useColumnPresets) and
// does the applying, since each table keeps its hidden set and order its
// own way; utils/columnPresets has the shared rules.
import { useState } from 'react';
import { MAX_PRESET_NAME, presetMatches } from '../../utils/columnPresets';

const chipBase = {
  display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999,
  fontSize: '0.65rem', fontWeight: 600, fontFamily: 'inherit', lineHeight: 1.2,
  padding: '2px 4px 2px 8px', whiteSpace: 'nowrap', maxWidth: 180,
};

export function ColumnPresets({ presets, visibleKeys, columnKeys, alwaysVisible = [], onApply, onSave, onDelete }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const list = presets || [];

  function submit() {
    const clean = name.trim();
    if (!clean) return;
    const replacing = list.some(p => p.name.toLowerCase() === clean.toLowerCase());
    if (replacing && !window.confirm(`Replace the "${clean}" preset with the columns showing now?`)) return;
    onSave(clean);
    setName('');
    setSaving(false);
  }

  return (
    <div style={{ padding: '2px 6px 6px', borderBottom: '1px solid var(--color-border-light)', marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Presets</span>
        {!saving && (
          <button
            type="button"
            onClick={() => setSaving(true)}
            title="Save the columns showing now, in this order, as a preset you can switch back to in one click"
            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit' }}
          >+ Save current</button>
        )}
      </div>
      {saving && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input
            autoFocus
            value={name}
            maxLength={MAX_PRESET_NAME}
            placeholder="Preset name"
            aria-label="Preset name"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { e.stopPropagation(); setSaving(false); setName(''); }
            }}
            style={{ flex: 1, minWidth: 0, fontSize: '0.7rem', padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit' }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            style={{ fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: 'none', background: name.trim() ? 'var(--color-accent)' : '#E2E8F0', color: name.trim() ? '#fff' : '#94A3B8', cursor: name.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}
          >Save</button>
          <button
            type="button"
            onClick={() => { setSaving(false); setName(''); }}
            aria-label="Cancel saving a preset"
            style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
          >Cancel</button>
        </div>
      )}
      {list.length === 0 ? (
        <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          None saved yet. Set up the columns you want, then Save current.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {list.map(p => {
            const active = presetMatches(p, { visibleKeys, columnKeys, alwaysVisible });
            return (
              <span
                key={p.id}
                style={{
                  ...chipBase,
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-accent)' : '#fff',
                  color: active ? '#fff' : 'var(--color-text)',
                }}
              >
                <button
                  type="button"
                  onClick={() => onApply(p)}
                  title={`Show the ${p.cols.length} column${p.cols.length === 1 ? '' : 's'} in "${p.name}", in its order`}
                  style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >{p.name}</button>
                <button
                  type="button"
                  onClick={() => { if (window.confirm(`Delete the "${p.name}" preset?`)) onDelete(p.id); }}
                  title={`Delete the "${p.name}" preset`}
                  aria-label={`Delete preset ${p.name}`}
                  style={{ background: 'transparent', border: 'none', padding: '0 2px', color: 'inherit', opacity: 0.6, fontSize: '0.75rem', lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                >×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
