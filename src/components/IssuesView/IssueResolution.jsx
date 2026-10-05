import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateCell } from '../common/DateCell';

// The Resolution popup's form. What goes in it, and where a save writes,
// comes from buildResolution in issueResolutionSpecs.js.

/** The form for one buildResolution spec. */
export function IssueResolutionModal({ spec, saving, error, onSave, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(spec.fields.map(f => [f.key, f.start])));
  const changed = useMemo(
    () => Object.fromEntries(spec.fields.map(f => [f.key, values[f.key] !== f.current])),
    [spec, values],
  );
  const dirty = Object.values(changed).some(Boolean);
  const canSave = !saving && dirty;
  const set = (k, v) => setValues(prev => ({ ...prev, [k]: v }));

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: '#1E293B', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid #CBD5E1', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: '#1E293B',
  };
  const btnStyle = {
    padding: '0.4rem 0.9rem', borderRadius: 4, fontFamily: 'inherit',
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  };
  const backdropMouseDown = useRef(false);

  function renderInput(f, first) {
    const v = values[f.key];
    if (f.type === 'checkbox') {
      return (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: '#334155', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} style={{ marginTop: 2 }} />
          <span>{f.label}</span>
        </label>
      );
    }
    let input;
    if (f.type === 'date') {
      input = (
        <div style={{ ...inputStyle, padding: '0.3rem 0.55rem' }}>
          <DateCell value={v} onChange={(next) => set(f.key, next)} emptyText="Click to pick a date" />
        </div>
      );
    } else if (f.type === 'select') {
      const opts = f.options || [];
      // Keep a stored value that isn't on the list visible, so the popup
      // never silently shows a different value than the data holds.
      const offList = v && !f.groups && !opts.includes(v);
      input = (
        <select autoFocus={first} value={v} onChange={(e) => set(f.key, e.target.value)} style={inputStyle}>
          <option value="">(Select)</option>
          {offList && <option value={v}>{v}</option>}
          {f.groups
            ? f.groups.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))
            : opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else if (f.type === 'textarea') {
      input = <textarea autoFocus={first} rows={3} value={v} onChange={(e) => set(f.key, e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />;
    } else {
      const listId = f.suggestions?.length ? `issue-resolve-${f.key}` : undefined;
      input = (
        <>
          <input autoFocus={first} type="text" list={listId} value={v} onChange={(e) => set(f.key, e.target.value)} style={inputStyle} />
          {listId && <datalist id={listId}>{f.suggestions.map(s => <option key={s} value={s} />)}</datalist>}
        </>
      );
    }
    return (
      <div>
        <label style={labelStyle}>{f.label}</label>
        {input}
        {f.current && f.type !== 'checkbox' && changed[f.key] && (
          <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: 3 }}>Currently: {String(f.current)}</div>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-label={spec.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{
          width: 480, maxWidth: '92vw', maxHeight: '88vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>{spec.title}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: 2 }}><strong>{spec.subtitle}</strong></div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', overflowY: 'auto' }}>
          {spec.note && <div style={{ fontSize: '0.74rem', color: '#475569' }}>{spec.note}</div>}
          {spec.fields.map((f, i) => <div key={f.key}>{renderInput(f, i === 0)}</div>)}
          {error && <div style={{ fontSize: '0.72rem', color: '#B91C1C' }}>{error}</div>}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', background: '#F8FAFC',
        }}>
          {!dirty && !saving && (
            <span style={{ marginRight: 'auto', fontSize: '0.7rem', color: '#64748B' }}>
              Change a value to enable Save.
            </span>
          )}
          <button type="button" onClick={onClose} style={{ ...btnStyle, border: '1px solid #CBD5E1', background: '#fff', color: '#475569' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave(values, changed)}
            style={{
              ...btnStyle, border: '1px solid #0A66C2',
              background: canSave ? '#0A66C2' : '#93C5FD', color: '#fff',
              cursor: canSave ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
