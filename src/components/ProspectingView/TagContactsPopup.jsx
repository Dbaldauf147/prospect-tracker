// Everyone behind one Tagged chip on Prospecting, in a popup: the whole
// roster rather than the inline list's first 200, the tags each contact
// carries, and Bulk Edit / Apply Tag Preset over the ticked rows (or over
// every row on screen when none is ticked).
//
// The rows are the coverage's own `people`, so the Tagged figure here is the
// one the chip was built from. Edits go through the shared
// BulkContactEditModal, which writes HubSpot and the contacts cache; the
// coverage behind this popup recomputes from that cache.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { BulkContactEditModal } from '../common/BulkContactEditModal';
import { contactTagString } from '../../utils/contactEditProps';
import { TAG_PRESET_FIELD } from '../../utils/bulkContactEdit';

const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const tagsOf = (c) => contactTagString(c).split(';').map(t => t.trim()).filter(Boolean);
const barBtn = (primary, disabled) => ({
  padding: '0.3rem 0.75rem', borderRadius: 4, fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  border: `1px solid ${primary ? '#2563EB' : '#4F46E5'}`, background: primary ? '#2563EB' : '#fff', color: primary ? '#fff' : '#4F46E5',
});

export function TagContactsPopup({ title, people, yesOnly = false, settings, updateSettings, onOpenContact, onClose }) {
  const rows = useMemo(() => (people || []).map((p, i) => {
    const contact = p.contact || null;
    return {
      id: p.id || `${p.email || p.name}-${i}`,
      contact,
      // Only a contact HubSpot knows by id can be written to.
      editable: !!(contact && (contact.id || contact.vid)),
      name: p.name || '',
      company: p.company || '',
      email: p.email || '',
      jobtitle: String(contact?.jobtitle || ''),
      tags: contact ? tagsOf(contact) : [],
      answered: p.answered || 0,
      total: p.total || 0,
      done: !!p.done,
    };
  }), [people]);

  const [selected, setSelected] = useState(() => new Set());
  const [filteredIds, setFilteredIds] = useState(null);
  const [editField, setEditField] = useState(null);
  const [flash, setFlash] = useState('');
  const onFilteredRowsChange = useCallback((list) => setFilteredIds(list.map(r => r.id)), []);
  // Only rows still on screen count, so a filter can't leave a hidden row
  // in a bulk write.
  const onScreen = useMemo(() => {
    const ids = filteredIds ? new Set(filteredIds) : null;
    return ids ? rows.filter(r => ids.has(r.id)) : rows;
  }, [rows, filteredIds]);
  const selectedRows = onScreen.filter(r => selected.has(r.id));
  // Nothing ticked means everybody on screen: "bulk edit them all" is the
  // common case here, and ticking 296 boxes first would be the long way.
  const targetRows = selectedRows.length ? selectedRows : onScreen;
  const targetContacts = targetRows.filter(r => r.editable).map(r => r.contact);
  const allSelected = onScreen.length > 0 && selectedRows.length === onScreen.length;
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(onScreen.map(r => r.id)));

  useEffect(() => {
    // Esc closes this popup, but not from under one opened on top of it.
    const onKey = (e) => { if (e.key === 'Escape' && !editField) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editField]);

  const selectCol = {
    key: '__select__',
    label: '',
    defaultWidth: 36,
    renderHeader: () => (
      <input type="checkbox" aria-label="Select every row on screen" title="Select every row on screen"
        checked={allSelected} onChange={toggleAll} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
    ),
    render: r => (
      <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)}
        onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
    ),
    exportValue: () => '',
  };
  const dataColumns = useMemo(() => [
    {
      key: 'name', label: 'Name', defaultWidth: 190,
      getSortValue: r => r.name.toLowerCase() || null, getFilterValue: r => r.name, exportValue: r => r.name,
      render: r => (onOpenContact && r.contact ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenContact(r.contact); }}
          title={`Open ${r.name}`}
          style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 600, color: '#0A66C2', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, textAlign: 'left' }}
        >{r.name}</button>
      ) : <span style={{ fontWeight: 600 }}>{r.name}</span>),
    },
    {
      key: 'company', label: 'Company', defaultWidth: 210,
      getSortValue: r => r.company.toLowerCase() || null, getFilterValue: r => r.company, exportValue: r => r.company,
      render: r => r.company || blank,
    },
    {
      key: 'jobtitle', label: 'Job Title', defaultWidth: 220,
      getSortValue: r => r.jobtitle.toLowerCase() || null, getFilterValue: r => r.jobtitle, exportValue: r => r.jobtitle,
      render: r => r.jobtitle || blank,
    },
    {
      key: 'tags', label: 'Tags', defaultWidth: 360,
      headerTitle: "The contact's HubSpot tags as they stand now. Bulk Edit can add to, remove from or replace them, and a tag preset turns them on and off to match its answers.",
      getSortValue: r => r.tags.length,
      getFilterValue: r => r.tags.join('; '), exportValue: r => r.tags.join('; '),
      render: r => (r.tags.length ? (
        <span title={r.tags.join('\n')} style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {r.tags.map(t => (
            <span key={t} style={{ padding: '0 7px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 600, background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#334155', whiteSpace: 'nowrap' }}>{t}</span>
          ))}
        </span>
      ) : <span style={{ color: '#B45309', fontSize: '0.72rem' }}>No tags</span>),
    },
    {
      key: 'tagged', label: 'Tagged', defaultWidth: 90,
      headerTitle: yesOnly ? 'How many of the tags in question this contact is tagged Yes on.' : 'How many of the tag questions have an answer for this contact.',
      getSortValue: r => (r.total ? r.answered / r.total : 0),
      getFilterValue: r => (r.done ? 'Done' : `${r.answered}/${r.total}`),
      exportValue: r => `${r.answered}/${r.total}`,
      render: r => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.done ? '#166534' : '#B45309' }}>
          {r.done ? '✓' : `${r.answered}/${r.total}`}
        </span>
      ),
    },
    {
      key: 'email', label: 'Email', defaultWidth: 230,
      getSortValue: r => r.email.toLowerCase() || null, getFilterValue: r => r.email, exportValue: r => r.email,
      render: r => (r.email ? <a href={`mailto:${r.email}`} style={{ color: '#2563EB', textDecoration: 'none' }}>{r.email}</a> : blank),
    },
  ], [onOpenContact, yesOnly]);
  const columns = [selectCol, ...dataColumns];

  const who = selectedRows.length ? `${selectedRows.length} selected` : `all ${onScreen.length}`;
  const notEditable = targetRows.length - targetContacts.length;
  const cannot = targetContacts.length === 0;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 8900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-tag-contacts-popup
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: '1rem 1.1rem', width: 1280, maxWidth: '100%', height: '88vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>{title}</h3>
            <div style={{ marginTop: 2, fontSize: '0.74rem', color: '#64748B' }}>
              {rows.length} contact{rows.length === 1 ? '' : 's'}, least tagged first. Tick rows to edit just those, or leave them all unticked to edit everyone on screen.
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.4rem 0.6rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.75rem', color: '#1E3A8A' }}>
          <strong data-target-count>{selectedRows.length ? `${selectedRows.length} selected` : `Editing all ${onScreen.length} on screen`}</strong>
          {notEditable > 0 && <span style={{ color: '#64748B' }}>({notEditable} without a HubSpot record will be skipped)</span>}
          {flash && <span style={{ color: '#15803D', fontWeight: 600 }}>{flash}</span>}
          <div style={{ flex: 1 }} />
          <button type="button" disabled={cannot} onClick={() => setEditField('dans_tags')} style={barBtn(true, cannot)} title={`Add, remove or replace tags on ${who}`}>Edit Tags ({targetContacts.length})</button>
          <button type="button" disabled={cannot} onClick={() => setEditField(TAG_PRESET_FIELD)} style={barBtn(false, cannot)} title={`Apply a saved tag preset to ${who}`}>Apply Tag Preset</button>
          <button type="button" disabled={cannot} onClick={() => setEditField('jobtitle')} style={barBtn(false, cannot)} title={`Bulk edit title, city, country or notes on ${who}`}>Bulk Edit other fields</button>
          {selectedRows.length > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} style={{ ...barBtn(false, false), border: '1px solid transparent', background: 'transparent', color: '#475569' }}>Clear</button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId="prospecting-tag-contacts"
            exportFileName={title}
            columns={columns}
            rows={rows}
            alwaysVisible={['__select__', 'name']}
            onFilteredRowsChange={onFilteredRowsChange}
            emptyMessage="No contacts on this roster."
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      </div>
      {editField && (
        <div onClick={e => e.stopPropagation()}>
          <BulkContactEditModal
            contacts={targetContacts}
            settings={settings}
            updateSettings={updateSettings}
            initialField={editField}
            onClose={() => setEditField(null)}
            onDone={(msg) => { setEditField(null); setSelected(new Set()); setFlash(msg); window.setTimeout(() => setFlash(''), 6000); }}
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
