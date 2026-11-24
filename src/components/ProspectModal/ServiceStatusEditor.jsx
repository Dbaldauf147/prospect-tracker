// The editor behind "Edit statuses..." on the company card's service status
// dropdowns: add, rename, reorder and remove the statuses a service can be
// set to. The list is shared (settings.dropdownLists.serviceStatuses, the same
// list the Dropdowns page shows), so a change reaches every company.
//
// Renaming or removing a status changes what the dropdowns offer; a company
// already set to the old name keeps it, and its dropdown still shows it.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cleanServiceStatusList, isLockedServiceStatus } from '../../utils/serviceStatusList';

const btn = { fontSize: '0.75rem', fontFamily: 'inherit', padding: '0.3rem 0.7rem', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', color: '#1E293B', cursor: 'pointer' };
const iconBtn = { ...btn, padding: '0.1rem 0.4rem', fontSize: '0.72rem', lineHeight: 1.2 };

let nextId = 0;
const row = (name) => ({ id: `s${nextId++}`, name, locked: isLockedServiceStatus(name) });

export default function ServiceStatusEditor({ statuses, onSave, onClose }) {
  const [rows, setRows] = useState(() => statuses.filter(s => s !== '-').map(row));
  const [draft, setDraft] = useState('');
  const addRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  useEffect(() => { addRef.current?.focus(); }, []);

  const names = rows.map(r => r.name.trim().toLowerCase());
  const dupe = (name, i) => names.some((n, j) => j !== i && n && n === name.trim().toLowerCase());
  const draftTaken = !!draft.trim() && (names.includes(draft.trim().toLowerCase()) || draft.trim() === '-');
  const anyBad = rows.some((r, i) => !r.name.trim() || dupe(r.name, i));

  const add = () => {
    const name = draft.trim();
    if (!name || draftTaken) return;
    setRows(rs => [...rs, row(name)]);
    setDraft('');
  };
  const move = (i, by) => setRows((rs) => {
    const j = i + by;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const save = () => {
    if (anyBad) return;
    // A name typed in the add box but not added yet is kept too.
    const pending = draft.trim() && !draftTaken ? [draft.trim()] : [];
    onSave(cleanServiceStatusList(['-', ...rows.map(r => r.name), ...pending]));
    onClose();
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div role="dialog" aria-label="Edit service statuses" style={{ background: '#fff', borderRadius: 8, width: 420, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '0.9rem 1rem 0.5rem', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>Service statuses</div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
              The choices in every service status dropdown, for every company. Locked ones can be moved but not renamed or removed.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: '1.3rem', color: '#64748B', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '0.3rem 1rem', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.25rem 0', fontSize: '0.78rem', color: '#94A3B8' }}>
            <span style={{ flex: 1 }}>- (auto)</span>
            <span style={{ fontSize: '0.66rem' }}>always first</span>
          </div>
          {rows.map((r, i) => {
            const bad = !r.name.trim() ? 'A status needs a name' : dupe(r.name, i) ? 'Already on the list' : '';
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.2rem 0' }}>
                <input
                  value={r.name}
                  disabled={r.locked}
                  aria-label={`Status ${i + 1}`}
                  title={r.locked ? 'Locked: the app reads this status by name' : bad || 'Rename this status'}
                  onChange={e => setRows(rs => rs.map(x => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
                  style={{ flex: 1, fontSize: '0.8rem', fontFamily: 'inherit', padding: '0.3rem 0.45rem', border: `1px solid ${bad ? '#DC2626' : '#CBD5E1'}`, borderRadius: 4, background: r.locked ? '#F8FAFC' : '#fff', color: r.locked ? '#64748B' : '#0F172A' }}
                />
                {r.locked && <span title="Locked: the app reads this status by name" style={{ fontSize: '0.62rem', fontWeight: 700, color: '#94A3B8' }}>LOCKED</span>}
                <button type="button" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.name} up`} title="Move up">↑</button>
                <button type="button" style={iconBtn} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${r.name} down`} title="Move down">↓</button>
                <button
                  type="button"
                  style={{ ...iconBtn, color: r.locked ? '#CBD5E1' : '#B91C1C', cursor: r.locked ? 'default' : 'pointer' }}
                  disabled={r.locked}
                  onClick={() => setRows(rs => rs.filter(x => x.id !== r.id))}
                  aria-label={`Remove ${r.name}`}
                  title={r.locked ? 'Locked' : 'Remove (companies already set to it keep it)'}
                >×</button>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 6 }}>
          <input
            ref={addRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="New status, e.g. Pilot"
            aria-label="New status"
            style={{ flex: 1, fontSize: '0.8rem', fontFamily: 'inherit', padding: '0.3rem 0.45rem', border: `1px solid ${draftTaken ? '#DC2626' : '#CBD5E1'}`, borderRadius: 4 }}
          />
          <button type="button" style={btn} onClick={add} disabled={!draft.trim() || draftTaken} title={draftTaken ? 'Already on the list' : 'Add to the list'}>+ Add</button>
        </div>
        <div style={{ padding: '0.6rem 1rem 0.9rem', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <span style={{ flex: 1, fontSize: '0.68rem', color: '#64748B', alignSelf: 'center' }}>Companies already set to a renamed or removed status keep it.</span>
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button type="button" onClick={save} disabled={anyBad} style={{ ...btn, background: anyBad ? '#E2E8F0' : '#1E40AF', borderColor: anyBad ? '#E2E8F0' : '#1E40AF', color: anyBad ? '#94A3B8' : '#fff' }}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
