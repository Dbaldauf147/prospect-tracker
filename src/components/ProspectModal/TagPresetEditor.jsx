// Editing one saved tag preset (utils/tagPresets.js): its name, and the
// answer and sale status it sets for each tag. Opened from the ✎ on a
// preset chip in the contact popup's tag table.
//
// Every tag in the vocabulary gets a row, so a tag the preset didn't save
// can be added to it; a row left on "-" for both is left out of the preset
// (applying it then leaves that tag alone on the contact).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tagKey } from '../../utils/contactTagReview.js';
import { updatePreset } from '../../utils/tagPresets.js';

const ANSWERS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];
const STATUSES = [
  { value: 'sold', label: 'Sold' },
  { value: 'notsold', label: 'Not sold' },
];

function startingRows(preset, tags) {
  const saved = new Map(Object.entries(preset?.tags || {}).map(([t, r]) => [tagKey(t), r]));
  const rows = (tags || []).map(tag => {
    const r = saved.get(tagKey(tag)) || {};
    saved.delete(tagKey(tag));
    return { tag, answer: r.answer || '', status: r.status || '' };
  });
  // Anything the preset holds that the vocabulary no longer has stays on
  // the end, so saving the editor doesn't quietly drop it.
  for (const [k, r] of saved) {
    const tag = Object.keys(preset.tags).find(t => tagKey(t) === k) || k;
    rows.push({ tag, answer: r.answer || '', status: r.status || '', orphan: true });
  }
  return rows;
}

export function TagPresetEditor({ preset, presets, tags, onSave, onClose }) {
  const [name, setName] = useState(preset?.name || '');
  const [rows, setRows] = useState(() => startingRows(preset, tags));
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setRow = (i, patch) => setRows(prev => prev.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, ...patch };
    // The same pairing the tag table enforces (withTagAnswer / withTagStatus):
    // No and Not sure leave nothing for a sale status to be about, and a sale
    // status only stands beside a Yes.
    if ('answer' in patch && (next.answer === 'no' || next.answer === 'unsure')) next.status = '';
    if ('status' in patch && next.status && next.answer && next.answer !== 'yes') next.answer = '';
    return next;
  }));

  const save = () => {
    const tagsOut = {};
    for (const r of rows) if (r.answer || r.status) tagsOut[r.tag] = { answer: r.answer, status: r.status };
    const { list, error: why } = updatePreset(presets, preset.id, { name, tags: tagsOut });
    if (why) { setError(why); return; }
    onSave(list);
    onClose();
  };

  const setCount = rows.filter(r => r.answer || r.status).length;
  const select = {
    width: '100%', padding: '2px 4px', fontSize: '0.72rem', fontFamily: 'inherit',
    border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#1E293B',
  };

  return createPortal(
    // data-tags-picker: the contact popup's tag dropdown closes on any click
    // outside itself, and this is portalled out of it. Marked as part of the
    // picker so working in the editor doesn't close (and unmount) it.
    <div
      data-tags-picker
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
    >
      <div role="dialog" aria-label={`Edit tag preset ${preset?.name || ''}`} data-tag-preset-editor
        style={{ width: 'min(520px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', borderBottom: '1px solid #E2E8F0' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>Edit tag preset</span>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.1rem', lineHeight: 1, color: '#64748B', cursor: 'pointer' }}
          >&times;</button>
        </div>
        <div style={{ padding: '0.7rem 0.9rem', borderBottom: '1px solid #F1F5F9' }}>
          <label style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 3 }}>Name</label>
          <input
            data-tag-preset-name
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', fontSize: '0.8rem', fontFamily: 'inherit', border: '1px solid #CBD5E1', borderRadius: 4 }}
          />
          <div style={{ fontSize: '0.66rem', color: '#94A3B8', marginTop: 4 }}>
            Applying the preset sets each tag below to its answer. A tag left on "-" is left alone on the contact.
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0.3rem 0.9rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.74rem' }}>
            <thead>
              <tr style={{ color: '#94A3B8', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 700 }}>Tag</th>
                <th style={{ textAlign: 'left', padding: '4px 4px', fontWeight: 700, width: 110 }}>Answer</th>
                <th style={{ textAlign: 'left', padding: '4px 0 4px 4px', fontWeight: 700, width: 110 }}>Sale status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.tag} data-tag-preset-row={r.tag} style={{ borderTop: '1px solid #F1F5F9', background: r.answer || r.status ? '#FAF5FF' : 'transparent' }}>
                  <td style={{ padding: '4px 0', color: '#1E293B', fontWeight: r.answer || r.status ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={r.orphan ? `${r.tag} is no longer in the tag list, so applying the preset skips it.` : r.tag}
                  >{r.tag}{r.orphan ? ' (not in tag list)' : ''}</td>
                  <td style={{ padding: '4px 4px' }}>
                    <select aria-label={`${r.tag} answer`} value={r.answer} onChange={e => setRow(i, { answer: e.target.value })} style={select}>
                      <option value="">-</option>
                      {ANSWERS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '4px 0 4px 4px' }}>
                    <select aria-label={`${r.tag} sale status`} value={r.status} onChange={e => setRow(i, { status: e.target.value })} style={select}>
                      <option value="">-</option>
                      {STATUSES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.55rem 0.9rem', borderTop: '1px solid #E2E8F0' }}>
          <span style={{ fontSize: '0.68rem', color: error ? '#B91C1C' : '#64748B', flex: 1 }}>
            {error || `${setCount} tag${setCount === 1 ? '' : 's'} set`}
          </span>
          <button type="button" onClick={onClose}
            style={{ padding: '0.25rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
          >Cancel</button>
          <button type="button" data-tag-preset-save onClick={save}
            style={{ padding: '0.25rem 0.8rem', border: '1px solid #6D28D9', borderRadius: 4, background: '#6D28D9', color: '#fff', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
          >Save preset</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
