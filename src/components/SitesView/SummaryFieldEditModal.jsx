// Updating one input from the data summary: click a row, pick which sites,
// type the value.
//
// Three scopes, because a gap in an upload comes in three shapes: the whole
// file is missing it ("Sqft: Missing"), one business unit is ("the retail
// division never sent gas bills"), or a handful of sites are wrong. Each
// writes into the uploaded column behind the row, the same as mass edit and
// the cell editor, so everything downstream re-derives from it.
//
// This file is the form only. Which column the value lands in, and the write
// itself, belong to the page (SitesView), which already owns both.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const inputStyle = {
  padding: '0.3rem 0.45rem', borderRadius: 6, fontFamily: 'inherit',
  fontSize: '0.78rem', border: '1px solid #CBD5E1', background: '#fff', color: '#0F172A',
};

const scopeButton = (active) => ({
  flex: '1 1 0', padding: '0.35rem 0.5rem', borderRadius: 6, fontFamily: 'inherit',
  fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? '#009530' : '#CBD5E1'}`,
  background: active ? '#F0FDF4' : '#fff',
  color: active ? '#166534' : '#475569',
});

const shown = (v) => (v === null || v === undefined || String(v).trim() === '' ? '' : String(v));

/**
 * field     { label, type, options, note }
 * header    the uploaded column the value is written into
 * created   true when the upload has no such column yet
 * sites     [{ id, name, division, current }]
 * divisions [{ value, label, count }] (the page's division picker list)
 * onApply   ({ ids, value, onlyBlank }) => Promise<string | null>, an error
 *           message or null
 */
export function SummaryFieldEditModal({ field, header, created, sites, divisions, onApply, onClose }) {
  const [scope, setScope] = useState('all');
  const [division, setDivision] = useState(divisions[0]?.value || '');
  const [picked, setPicked] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [value, setValue] = useState('');
  const [onlyBlank, setOnlyBlank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sites.filter(s => (!onlyMissing || !shown(s.current))
      && (!q || s.name.toLowerCase().includes(q) || String(s.division || '').toLowerCase().includes(q)));
  }, [sites, search, onlyMissing]);

  const ids = useMemo(() => {
    if (scope === 'all') return sites.map(s => s.id);
    if (scope === 'division') {
      const selected = divisions.find(d => d.value === division);
      if (!selected) return [];
      // "(no division)" is the page's own sentinel for blank.
      const blank = selected.label === '(no division)';
      return sites.filter(s => (blank ? !shown(s.division) : shown(s.division) === selected.value)).map(s => s.id);
    }
    return sites.filter(s => picked.has(s.id)).map(s => s.id);
  }, [scope, sites, divisions, division, picked]);

  const allListedPicked = listed.length > 0 && listed.every(s => picked.has(s.id));
  function togglePickListed() {
    setPicked(prev => {
      const next = new Set(prev);
      for (const s of listed) {
        if (allListedPicked) next.delete(s.id); else next.add(s.id);
      }
      return next;
    });
  }
  function togglePick(id) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      const result = await onApply({ ids, value, onlyBlank });
      if (result?.error) setError(result.error);
      else setDone(result?.message || 'Saved.');
    } finally {
      setBusy(false);
    }
  }

  const count = ids.length;
  const siteWord = `${count.toLocaleString()} site${count === 1 ? '' : 's'}`;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-label={`Update ${field.label}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, width: 'min(520px, calc(100vw - 32px))', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(15, 23, 42, 0.2)',
        }}
      >
        <div style={{ padding: '0.85rem 1rem 0.55rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Update {field.label}</div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem', lineHeight: 1.45 }}>
            {created
              ? <>Your upload has no column for this yet, so this adds a <strong>{header}</strong> column to it.</>
              : <>Writes into the <strong>{header}</strong> column of your upload.</>}
            {' '}Everything on the page re-derives from it, as if the spreadsheet had arrived that way.
            {field.note ? <> {field.note}</> : null}
          </div>
        </div>

        <div style={{ padding: '0.7rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', overflow: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" style={scopeButton(scope === 'all')} onClick={() => setScope('all')}>
              All sites ({sites.length.toLocaleString()})
            </button>
            <button
              type="button"
              style={{ ...scopeButton(scope === 'division'), opacity: divisions.length ? 1 : 0.5 }}
              disabled={!divisions.length}
              title={divisions.length ? '' : 'No site has a division yet'}
              onClick={() => setScope('division')}
            >By division</button>
            <button type="button" style={scopeButton(scope === 'sites')} onClick={() => setScope('sites')}>
              Individual sites
            </button>
          </div>

          {scope === 'division' && (
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              aria-label="Division"
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {divisions.map(d => (
                <option key={d.value} value={d.value}>{d.label} ({d.count.toLocaleString()})</option>
              ))}
            </select>
          )}

          {scope === 'sites' && (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.4rem', borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search sites..."
                  aria-label="Search sites"
                  style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }}
                />
                <label style={{ fontSize: '0.72rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                  Missing only
                </label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', fontWeight: 600, color: '#475569', borderBottom: '1px solid #F1F5F9' }}>
                <input type="checkbox" checked={allListedPicked} onChange={togglePickListed} disabled={!listed.length} />
                Select all shown ({listed.length.toLocaleString()})
              </label>
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                {listed.map(s => (
                  <label
                    key={s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0.5rem', fontSize: '0.74rem', color: '#0F172A', cursor: 'pointer' }}
                  >
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => togglePick(s.id)} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name || `Site ${s.id + 1}`}
                      {s.division ? <span style={{ color: '#94A3B8' }}> · {s.division}</span> : null}
                    </span>
                    <span style={{ color: shown(s.current) ? '#475569' : '#DC2626', whiteSpace: 'nowrap' }}>
                      {shown(s.current) || 'missing'}
                    </span>
                  </label>
                ))}
                {listed.length === 0 && (
                  <div style={{ padding: '0.6rem', fontSize: '0.74rem', color: '#94A3B8' }}>No sites match.</div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label htmlFor="summary-edit-value" style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>
              New {field.label.toLowerCase()}
            </label>
            {field.options ? (
              <select
                id="summary-edit-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">(blank)</option>
                {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : (
              <>
                <input
                  id="summary-edit-value"
                  type="text"
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={field.type === 'number' ? 'e.g. 125,000' : ''}
                  list={field.suggestions?.length ? 'summary-edit-suggestions' : undefined}
                  style={inputStyle}
                />
                {field.suggestions?.length ? (
                  <datalist id="summary-edit-suggestions">
                    {field.suggestions.map(s => <option key={s} value={s} />)}
                  </datalist>
                ) : null}
              </>
            )}
            <label style={{ fontSize: '0.72rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
              <input type="checkbox" checked={onlyBlank} onChange={(e) => setOnlyBlank(e.target.checked)} />
              Only fill sites that have no value (keep what the upload says)
            </label>
          </div>

          {error && <div style={{ fontSize: '0.74rem', color: '#991B1B' }}>{error}</div>}
          {done && <div style={{ fontSize: '0.74rem', color: '#166534' }}>{done}</div>}
        </div>

        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}
          >{done ? 'Close' : 'Cancel'}</button>
          <button
            type="button"
            disabled={busy || count === 0}
            onClick={apply}
            style={{
              padding: '0.3rem 0.8rem', borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit',
              border: `1px solid ${count && !busy ? '#009530' : '#CBD5E1'}`,
              background: count && !busy ? '#009530' : '#E2E8F0',
              color: count && !busy ? '#fff' : '#94A3B8',
              cursor: count && !busy ? 'pointer' : 'default',
            }}
          >{busy ? 'Saving…' : `Apply to ${siteWord}`}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default SummaryFieldEditModal;
