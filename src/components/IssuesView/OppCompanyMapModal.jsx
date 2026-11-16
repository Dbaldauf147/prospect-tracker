// Issues > "Opp company not in Table View" > Resolve: map the row's opps to
// a Table View company, picked from a searchable list (closest names first)
// or created on Table View from here. The writes are utils/oppCompanyMap.js.
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUSES } from '../../data/enums';
import { rankCompanyChoices } from '../../utils/oppCompanyMissing';

const SHOWN = 150;

const btn = {
  padding: '0.45rem 1rem', borderRadius: 6, fontFamily: 'inherit',
  fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
};
const input = {
  width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.65rem',
  border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.88rem', fontFamily: 'inherit',
  background: '#fff', color: '#1E293B',
};

export function OppCompanyMapModal({ row, prospects, oppsRecords = [], oppNumbers, saving, error, canCreate, onSave, onClose }) {
  const r = row.resolve;
  const count = r.oppIds.length;
  const ranked = useMemo(() => rankCompanyChoices(r.account, prospects), [r.account, prospects]);
  const byName = useMemo(() => {
    const m = new Map();
    for (const p of prospects || []) {
      const k = String(p?.company || '').trim().toLowerCase();
      if (k && !m.has(k)) m.set(k, p);
    }
    return m;
  }, [prospects]);

  const [mode, setMode] = useState('existing');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => (ranked.best ? byName.get(ranked.best.toLowerCase()) || null : null));
  const [newName, setNewName] = useState(r.account);
  const [newStatus, setNewStatus] = useState('Qualifying');
  const [keepAlias, setKeepAlias] = useState(true);
  const backdropDown = useRef(false);

  const q = search.trim().toLowerCase();
  const matches = q ? ranked.names.filter(n => n.toLowerCase().includes(q)) : ranked.names;
  const shown = matches.slice(0, SHOWN);
  const nameTaken = mode === 'create' && byName.get(newName.trim().toLowerCase());

  const oppLines = r.oppIds.map(id => {
    const opp = oppsRecords.find(o => String(o?._id) === String(id));
    const n = oppNumbers?.get(id);
    return [n != null ? `#${n}` : null, opp?.Stage, opp?.Scope].filter(Boolean).join(' · ');
  }).filter(Boolean);

  const canSave = !saving && (mode === 'existing' ? !!picked : !!newName.trim());
  const save = () => {
    if (!canSave) return;
    onSave(mode === 'existing'
      ? { mode: 'existing', record: picked }
      : { mode: 'create', name: newName.trim(), status: newStatus }, { keepAlias });
  };

  const tab = (key, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === key}
      onClick={() => setMode(key)}
      style={{
        ...btn, borderRadius: 999, padding: '0.35rem 0.9rem', fontSize: '0.78rem',
        border: `1px solid ${mode === key ? '#1D4ED8' : '#CBD5E1'}`,
        background: mode === key ? '#EFF6FF' : '#fff', color: mode === key ? '#1D4ED8' : '#475569',
      }}
    >{label}</button>
  );

  return createPortal(
    <div
      onMouseDown={(e) => { backdropDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropDown.current && e.target === e.currentTarget && !saving) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-label="Map to a Table View company"
        onKeyDown={(e) => { if (e.key === 'Escape' && !saving) onClose(); }}
        style={{ background: '#fff', borderRadius: 10, width: 'min(860px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}
      >
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>Map to a Table View company</div>
          <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: 4 }}>
            <strong>{r.account}</strong> is the Account on {count} {count === 1 ? 'opp' : 'opps'}
            {r.accounts?.length > 1 ? ` (also spelled ${r.accounts.filter(a => a !== r.account).map(a => `"${a}"`).join(', ')})` : ''}.
            {' '}Saving sets {count === 1 ? 'its' : 'their'} Account to the company's name, so its card, Retention and the BFO prompts find {count === 1 ? 'it' : 'them'}.
          </div>
          {oppLines.length > 0 && (
            <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: 6 }}>{oppLines.join('   |   ')}</div>
          )}
          <div role="tablist" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {tab('existing', 'Pick an existing company')}
            {canCreate && tab('create', '+ Create a new Table View company')}
          </div>
        </div>

        <div style={{ padding: '14px 22px', overflow: 'auto', flex: 1, minHeight: 0 }}>
          {mode === 'existing' ? (
            <>
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && shown.length) { e.preventDefault(); setPicked(byName.get(shown[0].toLowerCase()) || null); } }}
                placeholder={`Search ${ranked.names.length} Table View companies...`}
                aria-label="Search Table View companies"
                style={input}
              />
              <div style={{ fontSize: '0.72rem', color: '#64748B', margin: '6px 0' }}>
                {q ? `${matches.length} matching` : 'Closest names first'}{matches.length > SHOWN ? `, showing the first ${SHOWN}` : ''}. Click one to pick it.
              </div>
              <div data-company-choices style={{ border: '1px solid #E2E8F0', borderRadius: 6, height: 'min(46vh, 420px)', overflow: 'auto' }}>
                {shown.length === 0 && (
                  <div style={{ padding: 14, fontSize: '0.82rem', color: '#64748B' }}>
                    No Table View company matches "{search.trim()}".
                    {canCreate && (
                      <> <button type="button" onClick={() => { setNewName(search.trim() || r.account); setMode('create'); }} style={{ border: 'none', background: 'none', padding: 0, color: '#1D4ED8', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit' }}>Create it instead</button></>
                    )}
                  </div>
                )}
                {shown.map((name, i) => {
                  const p = byName.get(name.toLowerCase());
                  const on = picked?.id === p?.id;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setPicked(p || null)}
                      aria-pressed={on}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'center', gap: 8, textAlign: 'left',
                        padding: '0.45rem 0.7rem', border: 'none', borderBottom: '1px solid #F1F5F9',
                        background: on ? '#DBEAFE' : (i % 2 ? '#FAFAFA' : '#fff'), cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: '0.85rem', color: '#1E293B', fontWeight: on ? 700 : 500,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      {!q && name === ranked.best && <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#1D4ED8' }}>Best match</span>}
                      {p?.status && <span style={{ fontSize: '0.68rem', color: '#64748B', flexShrink: 0 }}>{p.status}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'block' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>New company name</div>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} style={input} aria-label="New company name" />
                {nameTaken && (
                  <div style={{ fontSize: '0.74rem', color: '#B45309', marginTop: 4 }}>
                    "{nameTaken.company}" is already on Table View, so the opps will map to it rather than a second copy being added.
                  </div>
                )}
              </label>
              <label style={{ display: 'block', maxWidth: 260 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>Status</div>
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={input} aria-label="Status">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                The company is added to Table View with this name, and the {count === 1 ? 'opp' : `${count} opps`} {count === 1 ? 'points' : 'point'} to it.
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#334155', cursor: 'pointer' }}>
            <input type="checkbox" checked={keepAlias} onChange={(e) => setKeepAlias(e.target.checked)} />
            Also remember "{r.account}" as the company's other name
          </label>
          {error && <span role="alert" style={{ fontSize: '0.78rem', color: '#B91C1C' }}>{error}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.8rem', color: '#475569', marginRight: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mode === 'existing' ? (picked ? <>Maps to <strong>{picked.company}</strong></> : 'Pick a company') : null}
          </span>
          <button type="button" onClick={onClose} disabled={saving} style={{ ...btn, border: '1px solid #CBD5E1', background: '#fff', color: '#334155' }}>Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            style={{ ...btn, border: 'none', background: canSave ? '#1D4ED8' : '#94A3B8', color: '#fff', cursor: canSave ? 'pointer' : 'not-allowed' }}
          >{saving ? 'Saving...' : mode === 'existing' ? `Map ${count} ${count === 1 ? 'opp' : 'opps'}` : 'Create and map'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
