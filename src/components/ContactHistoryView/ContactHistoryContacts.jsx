// Contacts > History: the people behind the chart. Everyone on the Key,
// Client and DM at Tier 1-3 rosters right now, with the date HubSpot created
// each contact, so a week the lines jump can be read as "these were added".
//
// The rosters are the ones the weekly counts are taken over (the same gates,
// the same account exclusions, the Company override applied), so the rows
// here add up to the stat cards above. Tick rows to Bulk Edit them or to
// apply a saved tag preset (common/BulkContactEditModal).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import { BulkContactEditModal } from '../common/BulkContactEditModal';
import { getHubspotCacheShared } from '../../utils/hubspotContactsCache';
import { useRosterGates } from '../../hooks/useRosterTagCoverage';
import { useOppsRecords } from '../../utils/rosterHooks';
import { ROSTER_CATEGORIES, applyCompanyOverride, contactDisplayName } from '../../utils/contactRosters';
import { COUNTED_ROSTERS } from '../../utils/contactCountHistory';
import { contactAddedMs, addedWithin, ADDED_WINDOWS } from '../../utils/contactAdded';
import { tagVocabulary } from '../../utils/contactTagReview';
import { contactTagString } from '../../utils/contactEditProps';
import { TAG_PRESET_FIELD } from '../../utils/bulkContactEdit';
import { formatDateDisplay } from '../../utils/isoDate';

const ROSTERS = ROSTER_CATEGORIES.filter(r => COUNTED_ROSTERS.includes(r.key));
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const toIso = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const tagsOf = (c) => contactTagString(c).split(';').map(t => t.trim()).filter(Boolean);
const chip = (on) => ({
  padding: '0.2rem 0.65rem', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1px solid ${on ? '#0A66C2' : '#E2E8F0'}`, background: on ? '#EFF6FF' : '#fff', color: on ? '#0A66C2' : '#475569',
});
const barBtn = (primary) => ({
  padding: '0.25rem 0.7rem', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${primary ? '#2563EB' : '#4F46E5'}`, background: primary ? '#2563EB' : '#fff', color: primary ? '#fff' : '#4F46E5',
});

export function ContactHistoryContacts({ prospects, cdmName = '', settings, updateSettings, updateSettingsPath }) {
  const { user } = useAuth();
  const userId = user?.uid;
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCacheShared()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [userId]);

  const oppsRecords = useOppsRecords(userId);
  const gates = useRosterGates({ prospects, cdmName, oppsRecords, userId, connected: settings?.contactConnected || null });
  const localFields = settings?.contactLocalFields || null;

  // Read once when the tab opens, so "last 7 days" doesn't shift under a
  // selection while the page sits open.
  const [now] = useState(() => Date.now());
  const [windowDays, setWindowDays] = useState(null);

  const allRows = useMemo(() => {
    const out = [];
    for (const base of contacts || []) {
      const c = applyCompanyOverride(base, localFields);
      const on = ROSTERS.filter(r => gates.gateFor[r.key](c));
      if (!on.length || gates.clientExclusionOf(c)) continue;
      out.push({
        id: String(base.id || base.vid || base.email),
        // The record as HubSpot holds it: a bulk write must not send the
        // Company override back as if it were the contact's own.
        contact: base,
        name: contactDisplayName(c),
        company: String(c.company || '').trim(),
        rosters: on,
        addedMs: contactAddedMs(base),
        tags: tagsOf(base),
      });
    }
    return out;
  }, [contacts, gates, localFields]);

  const rows = useMemo(
    () => (windowDays == null ? allRows : allRows.filter(r => addedWithin(r.addedMs, windowDays, now))),
    [allRows, windowDays, now],
  );
  const countIn = (days) => (days == null ? allRows.length : allRows.filter(r => addedWithin(r.addedMs, days, now)).length);

  // The tag vocabulary a preset is matched against: the standard list plus
  // every tag any contact carries, as the contact popup builds it.
  const tagOptions = useMemo(() => tagVocabulary((contacts || []).flatMap(tagsOf)), [contacts]);

  // Only rows still on screen count, so a filter or a window change can't
  // leave a hidden row in a bulk write.
  const [selected, setSelected] = useState(() => new Set());
  const [filteredIds, setFilteredIds] = useState(null);
  const [editField, setEditField] = useState(null);
  const [flash, setFlash] = useState('');
  const onFilteredRowsChange = useCallback((list) => setFilteredIds(list.map(r => r.id)), []);
  const onScreen = useMemo(() => {
    const ids = filteredIds ? new Set(filteredIds) : null;
    return ids ? rows.filter(r => ids.has(r.id)) : rows;
  }, [rows, filteredIds]);
  const selectedRows = onScreen.filter(r => selected.has(r.id));
  // Only contacts HubSpot knows by id can be written to.
  const selectedContacts = selectedRows.map(r => r.contact).filter(c => c.id || c.vid);
  const allSelected = onScreen.length > 0 && selectedRows.length === onScreen.length;
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(onScreen.map(r => r.id)));
  const showFlash = (text) => { setFlash(text); window.setTimeout(() => setFlash(''), 6000); };

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
      render: r => <span style={{ fontWeight: 600 }}>{r.name}</span>,
    },
    {
      key: 'added', label: 'Date Added', defaultWidth: 120,
      headerTitle: 'The day the contact was created in HubSpot. Blank when HubSpot has no create date for them (a contact added by hand and not yet synced).',
      getSortValue: r => r.addedMs,
      getFilterValue: r => (r.addedMs == null ? '' : formatDateDisplay(toIso(r.addedMs))),
      exportValue: r => (r.addedMs == null ? '' : toIso(r.addedMs)),
      render: r => (r.addedMs == null
        ? blank
        : <span title={new Date(r.addedMs).toLocaleString()} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDateDisplay(toIso(r.addedMs))}</span>),
    },
    {
      key: 'rosters', label: 'Roster', defaultWidth: 190,
      headerTitle: 'Which of the charted rosters the contact is on today: Key, Client, DM at Tier 1-3.',
      getSortValue: r => r.rosters.map(x => x.label).join(', ').toLowerCase(),
      getFilterValue: r => r.rosters.map(x => x.label).join(', '),
      exportValue: r => r.rosters.map(x => x.label).join(', '),
      render: r => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {r.rosters.map(x => (
            <span key={x.key} style={{ padding: '0 7px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, background: x.bg, border: `1px solid ${x.border}`, color: x.color, whiteSpace: 'nowrap' }}>{x.label}</span>
          ))}
        </span>
      ),
    },
    {
      key: 'jobtitle', label: 'Job Title', defaultWidth: 230,
      getSortValue: r => String(r.contact.jobtitle || '').toLowerCase() || null,
      getFilterValue: r => r.contact.jobtitle || '', exportValue: r => r.contact.jobtitle || '',
      render: r => r.contact.jobtitle || blank,
    },
    {
      key: 'company', label: 'Company', defaultWidth: 210,
      getSortValue: r => r.company.toLowerCase() || null, getFilterValue: r => r.company, exportValue: r => r.company,
      render: r => r.company || blank,
    },
    {
      key: 'tags', label: 'Tags', defaultWidth: 260,
      headerTitle: 'The contact\'s HubSpot tags. A tag preset applied here turns these on and off to match its answers.',
      getSortValue: r => r.tags.join('; ').toLowerCase() || null,
      getFilterValue: r => r.tags.join('; '), exportValue: r => r.tags.join('; '),
      render: r => (r.tags.length ? <span title={r.tags.join('\n')}>{r.tags.join('; ')}</span> : blank),
    },
    {
      key: 'email', label: 'Email', defaultWidth: 230,
      getSortValue: r => r.contact.email || null, getFilterValue: r => r.contact.email || '', exportValue: r => r.contact.email || '',
      render: r => (r.contact.email ? <a href={`mailto:${r.contact.email}`} style={{ color: '#2563EB', textDecoration: 'none' }}>{r.contact.email}</a> : blank),
    },
    {
      key: 'city', label: 'City', defaultWidth: 140,
      getSortValue: r => String(r.contact.city || '').toLowerCase() || null,
      getFilterValue: r => r.contact.city || '', exportValue: r => r.contact.city || '',
      render: r => r.contact.city || blank,
    },
    {
      key: 'country', label: 'Country', defaultWidth: 140,
      getSortValue: r => String(r.contact.country || '').toLowerCase() || null,
      getFilterValue: r => r.contact.country || '', exportValue: r => r.contact.country || '',
      render: r => r.contact.country || blank,
    },
  ], []);
  const columns = [selectCol, ...dataColumns];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Contacts on the rosters</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
          Everyone on the Key, Client and DM at Tier 1-3 rosters today, newest first. Date Added is the day the contact
          was created in HubSpot. Tick rows to bulk edit them or apply a tag preset.
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: '#64748B', fontWeight: 600 }}>Added</span>
        {ADDED_WINDOWS.map(w => (
          <button key={w.days ?? 'any'} type="button" aria-pressed={windowDays === w.days} onClick={() => setWindowDays(w.days)} style={chip(windowDays === w.days)}>
            {w.label}{contacts ? ` (${countIn(w.days).toLocaleString()})` : ''}
          </button>
        ))}
      </div>
      {flash && <div style={{ fontSize: '0.78rem', color: '#15803D', fontWeight: 600 }}>{flash}</div>}
      {selectedRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.75rem', color: '#1E3A8A' }}>
          <strong>{selectedRows.length} selected</strong>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => setEditField(TAG_PRESET_FIELD)} disabled={!selectedContacts.length} style={barBtn(false)}>Apply Tag Preset</button>
          <button type="button" onClick={() => setEditField('jobtitle')} disabled={!selectedContacts.length} style={barBtn(true)}>Bulk Edit</button>
          <button type="button" onClick={() => setSelected(new Set())} style={{ ...barBtn(false), border: '1px solid transparent', background: 'transparent', color: '#475569' }}>Clear</button>
        </div>
      )}
      {editField && (
        <BulkContactEditModal
          contacts={selectedContacts}
          settings={settings}
          updateSettings={updateSettings}
          updateSettingsPath={updateSettingsPath}
          initialField={editField}
          tagOptions={tagOptions}
          onClose={() => setEditField(null)}
          onDone={(msg) => { setEditField(null); setSelected(new Set()); showFlash(msg); }}
        />
      )}
      {contacts == null ? (
        <div style={{ fontSize: '0.8rem', color: '#64748B' }}>Loading...</div>
      ) : (
        <div style={{ height: '70vh', display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <DataTable
            tableId="contact-history-contacts"
            exportFileName="Roster Contacts by Date Added"
            columns={columns}
            rows={rows}
            alwaysVisible={['__select__', 'name']}
            onFilteredRowsChange={onFilteredRowsChange}
            defaultSort={{ key: 'added', direction: 'desc' }}
            defaultHidden={['city', 'country']}
            emptyMessage={windowDays == null ? 'No contacts are on the Key, Client or DM at Tier 1-3 rosters yet.' : `No roster contacts were added in the last ${windowDays} days.`}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
    </div>
  );
}
