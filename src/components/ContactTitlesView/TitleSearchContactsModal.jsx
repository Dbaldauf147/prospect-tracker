import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { BulkContactEditModal } from '../common/BulkContactEditModal';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { useContactEditSettings } from '../../hooks/useContactEditSettings';
import { TAG_PRESET_FIELD } from '../../utils/bulkContactEdit';
import { applyCompanyOverride } from '../../utils/contactRosters';
import { companyPopupTarget } from '../../utils/companyLookup';
import styles from './ContactTitlesView.module.css';

// The full-page list behind a search's Contacts button on the Titles page:
// every contact in the app whose job title the search pulls, run with the
// same rules the popup's blurb states (utils/titleSearchMatch.js). The
// "Show left out by Not" switch adds the ones a title term caught and a
// Not term threw back, with the Not term that did it, so a Not list can
// be checked as well as the include list.
//
// `result` is matchTitleSearch's output, worked out by the page so the
// count on the button and the rows in here can't disagree.
//
// Edit Tags, Apply Tag Preset and Bulk Edit other fields work over the
// ticked rows, or over every row on screen when none is ticked, the way
// Prospecting's Tagged popup does (TagContactsPopup). They go through the
// shared BulkContactEditModal, which writes HubSpot and the contacts cache;
// the page re-reads that cache, so the rows here follow the edit.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nameOf = (c) => [c?.firstname, c?.lastname].map(clean).filter(Boolean).join(' ') || clean(c?.email) || 'Unnamed contact';
const barBtn = (primary, disabled) => ({
  padding: '0.3rem 0.75rem', borderRadius: 4, fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  border: `1px solid ${primary ? '#2563EB' : '#4F46E5'}`, background: primary ? '#2563EB' : '#fff', color: primary ? '#fff' : '#4F46E5',
});
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const lower = (s) => clean(s).toLowerCase();

export function TitleSearchContactsModal({ entry, result, settings, updateSettings, updateSettingsPath = null, prospects, allContacts, onSelectProspect, onClose }) {
  const [showExcluded, setShowExcluded] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [filteredIds, setFilteredIds] = useState(null);
  const [editField, setEditField] = useState(null);
  const [flash, setFlash] = useState('');
  // The contact popup, opened by clicking a name. Holds the raw HubSpot
  // record, which is what the popup edits.
  const [editingContact, setEditingContact] = useState(null);
  const contactEditSettings = useContactEditSettings({ settings, updateSettings });

  // Escape closes the list, but not from under an open contact popup.
  useEffect(() => {
    if (editingContact) return undefined;
    // ...nor from under the Bulk Edit one.
    const onKey = (e) => { if (e.key === 'Escape' && !editField) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, editingContact, editField]);

  // Vertical and Sub Vertical live on the company (the company popup), so
  // they are joined on by the contact's company name, whole-name match as
  // utils/companyLookup does it.
  const prospectByCompany = useMemo(() => {
    const map = new Map();
    for (const p of prospects || []) {
      const key = lower(p?.company);
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [prospects]);

  const openCompanyFromContact = useCallback((name) => {
    const target = companyPopupTarget(prospects, name);
    if (!target || !onSelectProspect) return;
    setEditingContact(null);
    onSelectProspect(target);
  }, [prospects, onSelectProspect]);
  const editCompanyKey = lower(editingContact?.company);
  const editCompanyContacts = useMemo(
    () => (editCompanyKey ? (allContacts || []).filter(c => lower(c?.company) === editCompanyKey) : []),
    [editCompanyKey, allContacts],
  );
  const editEmailDomains = useMemo(() => {
    const p = editCompanyKey ? prospectByCompany.get(editCompanyKey) : null;
    return p?.emailDomain ? String(p.emailDomain).split(/[\n;,]+/).map(x => x.trim()).filter(Boolean) : [];
  }, [editCompanyKey, prospectByCompany]);
  const companyNames = useMemo(() => (prospects || []).map(p => p.company).filter(Boolean), [prospects]);

  const localFields = settings?.contactLocalFields;
  const rows = useMemo(() => {
    const toRow = (m, status) => {
      const c = applyCompanyOverride(m.contact, localFields);
      const account = prospectByCompany.get(lower(c?.company));
      return {
        vertical: clean(account?.vertical),
        subVertical: clean(account?.subVertical),
        id: String(c?.id || c?.vid || c?.email || `${nameOf(c)}|${m.title}`),
        // The synced record, for a bulk write and for the contact popup a
        // name opens. Only a contact HubSpot knows by id can be bulk written.
        contact: m.contact,
        editable: !!(m.contact && (m.contact.id || m.contact.vid)),
        status,
        name: nameOf(c),
        jobtitle: m.title,
        company: clean(c?.company),
        email: clean(c?.email),
        phone: clean(c?.phone),
        location: [c?.city, c?.state, c?.country].map(clean).filter(Boolean).join(', '),
        country: clean(c?.country),
        hits: m.hits.join(', '),
        notHits: m.notHits.join(', '),
        tags: String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').split(';').map(clean).filter(Boolean).join(', '),
      };
    };
    const list = result.matched.map(m => toRow(m, 'Included'));
    if (showExcluded) list.push(...result.excluded.map(m => toRow(m, 'Left out by Not')));
    return list;
  }, [result, showExcluded, localFields, prospectByCompany]);

  const onFilteredRowsChange = useCallback((list) => setFilteredIds(list.map(r => r.id)), []);
  // Only rows still on screen count, so a filter can't leave a hidden row
  // in a bulk write.
  const onScreen = useMemo(() => {
    const ids = filteredIds ? new Set(filteredIds) : null;
    return ids ? rows.filter(r => ids.has(r.id)) : rows;
  }, [rows, filteredIds]);
  const selectedRows = onScreen.filter(r => selected.has(r.id));
  // Nothing ticked means everybody on screen.
  const targetRows = selectedRows.length ? selectedRows : onScreen;
  const targetContacts = targetRows.filter(r => r.editable).map(r => r.contact);
  const allSelected = onScreen.length > 0 && selectedRows.length === onScreen.length;
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(onScreen.map(r => r.id)));
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
    ...(showExcluded ? [{
      key: 'status', label: 'Status', defaultWidth: 130,
      render: (r) => (
        <span className={r.status === 'Included' ? styles.statusIn : styles.statusOut}>{r.status}</span>
      ),
    }] : []),
    {
      key: 'name', label: 'Name', defaultWidth: 180,
      render: (r) => (
        <button
          type="button"
          className={styles.contactLink}
          onClick={() => setEditingContact(r.contact)}
          title={`Open ${r.name}`}
        >{r.name}</button>
      ),
    },
    { key: 'jobtitle', label: 'Job Title', defaultWidth: 300 },
    { key: 'company', label: 'Company', defaultWidth: 200 },
    { key: 'vertical', label: 'Vertical', defaultWidth: 150 },
    { key: 'subVertical', label: 'Sub Vertical', defaultWidth: 160 },
    { key: 'hits', label: 'Matched Terms', defaultWidth: 180 },
    ...(showExcluded ? [{ key: 'notHits', label: 'Not Terms Hit', defaultWidth: 160 }] : []),
    { key: 'email', label: 'Email', defaultWidth: 220 },
    { key: 'location', label: 'Location', defaultWidth: 180 },
    { key: 'country', label: 'Country', defaultWidth: 120 },
    { key: 'phone', label: 'Phone', defaultWidth: 130 },
    { key: 'tags', label: "Dan's Tags", defaultWidth: 200 },
  ], [showExcluded]);
  const columns = [selectCol, ...dataColumns];
  const who = selectedRows.length ? `${selectedRows.length} selected` : `all ${onScreen.length} on screen`;
  const notEditable = targetRows.length - targetContacts.length;
  const cannot = targetContacts.length === 0;

  const title = clean(entry?.name) || 'Untitled search';
  const exportName = `${title} contacts`.replace(/[\\/:*?"<>|]+/g, ' ');

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.contactsModal}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} contacts`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <span className={styles.modalCount}>
            {plural(result.matched.length, 'contact')}
            {result.excluded.length > 0 && `, ${result.excluded.length.toLocaleString()} more left out by the Not terms`}
          </span>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.modalBlurb}>
            Every contact whose job title has at least one of this search&apos;s {plural(result.includeCount, 'title term')} and
            none of its {plural(result.excludeCount, 'Not term')} (its own Not groups plus the Not list that applies to every
            search). A term matches as whole words in any case, plural included, so &quot;Intern&quot; does not catch
            &quot;International&quot;. Hidden, Left and Schneider contacts are left out, the same as the other contact pages.
            {entry?.scope ? ` The scope line ("${clean(entry.scope)}") is not applied: use the Country column to narrow it.` : ''}
            <label className={styles.modalToggle}>
              <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
              Show the {result.excluded.length.toLocaleString()} left out by a Not term
            </label>
          </div>
          {result.includeCount === 0 ? (
            <div className={styles.empty}>This search has no title terms yet, so it pulls nobody. Add some in an Include group.</div>
          ) : (
            <>
            <div data-bulk-bar style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 8px 0', padding: '0.4rem 0.6rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.75rem', color: '#1E3A8A' }}>
              <strong data-target-count>{selectedRows.length ? `${selectedRows.length} selected` : `Editing all ${onScreen.length.toLocaleString()} on screen`}</strong>
              <span style={{ color: '#64748B' }}>Tick rows to edit just those, or leave them all unticked to edit everyone on screen.</span>
              {notEditable > 0 && <span style={{ color: '#64748B' }}>({notEditable} without a HubSpot record will be skipped)</span>}
              {flash && <span style={{ color: '#15803D', fontWeight: 600 }}>{flash}</span>}
              <div style={{ flex: 1 }} />
              <button type="button" disabled={cannot} onClick={() => setEditField('dans_tags')} style={barBtn(true, cannot)} title={`Mark Yes, No or Not sure for a tag, or add, remove or replace tags, on ${who}`}>Edit Tags ({targetContacts.length.toLocaleString()})</button>
              <button type="button" disabled={cannot} onClick={() => setEditField(TAG_PRESET_FIELD)} style={barBtn(false, cannot)} title={`Apply a saved tag preset to ${who}`}>Apply Tag Preset</button>
              <button type="button" disabled={cannot} onClick={() => setEditField('jobtitle')} style={barBtn(false, cannot)} title={`Bulk edit title, city, country or notes on ${who}`}>Bulk Edit other fields</button>
              {selectedRows.length > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} style={{ ...barBtn(false, false), border: '1px solid transparent', background: 'transparent', color: '#475569' }}>Clear</button>
              )}
            </div>
            <div className={styles.modalTable}>
              <DataTable
                tableId="contact-titles-search-contacts"
                columns={columns}
                rows={rows}
                alwaysVisible={['__select__', 'name']}
                onFilteredRowsChange={onFilteredRowsChange}
                defaultSort={{ key: 'name', direction: 'asc' }}
                emptyMessage="No contacts in the app hold a title this search pulls"
                exportFileName={exportName}
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
            </>
          )}
        </div>
      </div>
      {editingContact && createPortal(
        // Clicks inside the popup must not reach the list's overlay, which
        // closes the list: a portal still bubbles through its React parent.
        <div onClick={(e) => e.stopPropagation()}>
          <ContactEditModal
            prospects={prospects || []}
            contact={editingContact}
            onSave={(_updated, opts) => { if (!opts?.silent) setEditingContact(null); }}
            onClose={() => setEditingContact(null)}
            onOpenCompany={onSelectProspect ? openCompanyFromContact : null}
            {...contactEditSettings}
            companyContacts={editCompanyContacts}
            allContacts={allContacts || []}
            emailDomains={editEmailDomains}
            companyNames={companyNames}
          />
        </div>,
        document.body,
      )}
      {editField && (
        <div onClick={e => e.stopPropagation()}>
          <BulkContactEditModal
            contacts={targetContacts}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            initialField={editField}
            onClose={() => setEditField(null)}
            onDone={(msg) => { setEditField(null); setSelected(new Set()); setFlash(msg); window.setTimeout(() => setFlash(''), 6000); }}
          />
        </div>
      )}
    </div>
  );
}
