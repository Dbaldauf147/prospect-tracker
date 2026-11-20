// The saved tag presets (settings.tagPresets, utils/tagPresets.js), managed
// outside the contact popup: add a new one, edit or rename one, delete one.
// First used by the HubSpot tab, next to its bulk tag edits, so a preset can
// be set up and applied to a selection without opening a contact first.
//
// A new preset starts empty and opens straight in TagPresetEditor, the same
// editor the ✎ on a preset chip in the contact popup opens.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { TagPresetEditor } from '../ProspectModal/TagPresetEditor';
import { savePreset, deletePreset, presetSummary } from '../../utils/tagPresets';

const btn = { padding: '0.3rem 0.75rem', borderRadius: 4, fontSize: '0.76rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' };

export function TagPresetManager({ settings, updateSettings, tags, onClose }) {
  const presets = settings?.tagPresets || [];
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const editing = presets.find(p => p.id === editingId) || null;

  const save = (list) => updateSettings({ tagPresets: list });

  const add = () => {
    const name = newName.trim();
    if (!name) { setError('Give the preset a name.'); return; }
    if (presets.some(p => String(p?.name || '').trim().toLowerCase() === name.toLowerCase())) {
      setError(`A preset is already called "${name}". Edit that one instead.`);
      return;
    }
    const list = savePreset(presets, name, {});
    save(list);
    setNewName('');
    setError('');
    setEditingId(list[list.length - 1].id);
  };

  const remove = (p) => {
    if (!window.confirm(`Delete the tag preset "${p.name}"? Contacts it was applied to keep their tags.`)) return;
    save(deletePreset(presets, p.id));
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !editing) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 10040, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
    >
      <div role="dialog" aria-label="Tag presets" data-tag-preset-manager
        style={{ width: 'min(480px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', borderBottom: '1px solid #E2E8F0' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>Tag presets</span>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.1rem', lineHeight: 1, color: '#64748B', cursor: 'pointer' }}
          >&times;</button>
        </div>
        <div style={{ padding: '0.6rem 0.9rem', fontSize: '0.7rem', color: '#64748B', borderBottom: '1px solid #F1F5F9' }}>
          A preset is a saved set of tag answers. Select contacts in Mass Edit and use Apply Tag Preset to give them all the same answers at once.
        </div>
        <div style={{ overflowY: 'auto', padding: '0.4rem 0.9rem' }}>
          {presets.length === 0 && (
            <div style={{ fontSize: '0.75rem', color: '#94A3B8', padding: '0.5rem 0' }}>No presets yet. Add one below.</div>
          )}
          {presets.map(p => (
            <div key={p.id} data-tag-preset-item={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0', borderTop: '1px solid #F1F5F9' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B' }}>{p.name}</div>
                <div style={{ fontSize: '0.68rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={presetSummary(p)}>{presetSummary(p)}</div>
              </div>
              <button type="button" onClick={() => setEditingId(p.id)} style={{ ...btn, border: '1px solid #C4B5FD', background: '#F5F3FF', color: '#5B21B6' }}>Edit</button>
              <button type="button" onClick={() => remove(p)} style={{ ...btn, border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C' }}>Delete</button>
            </div>
          ))}
        </div>
        <div style={{ padding: '0.6rem 0.9rem', borderTop: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              data-tag-preset-new-name
              value={newName}
              placeholder="New preset name, e.g. ESG Director"
              onChange={e => { setNewName(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.8rem', fontFamily: 'inherit', border: '1px solid #CBD5E1', borderRadius: 4 }}
            />
            <button type="button" data-tag-preset-add onClick={add} style={{ ...btn, border: '1px solid #6D28D9', background: '#6D28D9', color: '#fff' }}>+ Add preset</button>
          </div>
          {error && <div style={{ fontSize: '0.7rem', color: '#B91C1C', marginTop: 4 }}>{error}</div>}
        </div>
      </div>
      {editing && (
        <TagPresetEditor
          preset={editing}
          presets={presets}
          tags={tags}
          onSave={save}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>,
    document.body,
  );
}
