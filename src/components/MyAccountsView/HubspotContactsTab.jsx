// Hubspot Mapping > Contacts. Dan drops (or pastes) the HubSpot export of
// the contacts on his companies; each contact is lined up with its My
// Accounts company by HubSpot Company ID, company name, then email domain
// (utils/hubspotContacts.js). Each drop replaces the stored contacts
// (hubspotMappingStore.js), since the export is the full list.
import { useState, useMemo, useRef } from 'react';
import { DataTable } from '../common/DataTable';
import { readHubspotSheet, usePastedRows } from './hubspotDrop';
import { compactContacts, contactMatcher, contactRows, contactOwnerSummary } from '../../utils/hubspotContacts';
import { accountTier, formatActivityDate } from '../../utils/hubspotActivity';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const chipStyle = (active) => ({ padding: '0.2rem 0.6rem', borderRadius: 999, border: `1px solid ${active ? '#1D4ED8' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#1D4ED8' : '#475569', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const linkStyle = { color: '#1D4ED8', textDecoration: 'none' };

const text = (key, label, width, extra = {}) => ({
  key, label, defaultWidth: width,
  getSortValue: r => String(r[key] || '').toLowerCase() || null,
  getFilterValue: r => r[key] || '', exportValue: r => r[key] || '',
  render: r => r[key] || blank,
  ...extra,
});
const dateCol = (key, label) => ({
  key, label, defaultWidth: 190,
  getSortValue: r => r[key] || null,
  getFilterValue: r => formatActivityDate(r[key]), exportValue: r => formatActivityDate(r[key]),
  render: r => (r[key] ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatActivityDate(r[key])}</span> : blank),
});

export function HubspotContactsTab({ data, onSave, loaded, mapping = [], accounts = [], byId, onSelect, cdmName = '', hasMappingExport = false, settings, updateSettings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState('');
  const [owner, setOwner] = useState('');
  const firstName = String(cdmName || '').trim().split(/\s+/)[0] || 'Dan';

  const loadRows = async (readRows, source) => {
    setBusy(true); setError(''); setNote('');
    try {
      const { contacts } = compactContacts(await readRows());
      if (!contacts.length) throw new Error(`No contacts found. The ${source === 'paste' ? 'pasted rows need a header row with' : 'file needs'} Email, Contact ID or a name column.`);
      await onSave({ contacts, meta: { file: source === 'paste' ? 'rows pasted from Excel' : source, at: new Date().toISOString() } });
      setNote(`${fmt(contacts.length)} contacts read.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const upload = (file) => { if (file) loadRows(() => readHubspotSheet(file), file.name); };
  const rootRef = useRef(null);
  usePastedRows(rootRef, busy, (rows) => loadRows(() => rows, 'paste'));

  const match = useMemo(() => contactMatcher(mapping, accounts), [mapping, accounts]);
  const allRows = useMemo(() => contactRows(data.contacts, match, cdmName), [data.contacts, match, cdmName]);
  const owners = useMemo(() => contactOwnerSummary(allRows.filter(r => r.account), cdmName), [allRows, cdmName]);

  const FILTERS = [
    ['', 'All', () => true],
    ['mapped', 'On My Accounts', r => !!r.account],
    ['unmapped', 'Not on My Accounts', r => !r.account],
    ['mine', `Owned by ${firstName}`, r => r.mine === true],
    ['notMine', 'Owned by others', r => r.mine === false],
  ];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , f]) => [k, allRows.filter(f).length])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, firstName]);
  const rows = useMemo(() => {
    if (owner) return allRows.filter(r => r.account && r.contactOwner === owner);
    const f = FILTERS.find(([k]) => k === filter)?.[2] || (() => true);
    return allRows.filter(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filter, owner, firstName]);

  const columns = useMemo(() => [
    text('name', 'Name', 170, { headerTitle: 'First and Last Name when the export has them, else Contact Name (left blank when HubSpot has the job title in it).' }),
    {
      key: 'email', label: 'Email', defaultWidth: 230,
      getSortValue: r => r.email || r.workEmail || null,
      getFilterValue: r => r.email || r.workEmail || '', exportValue: r => r.email || r.workEmail || '',
      render: r => {
        const e = r.email || r.workEmail;
        return e ? <a href={`mailto:${e}`} style={linkStyle}>{e}</a> : blank;
      },
    },
    text('jobTitle', 'Job Title', 260),
    {
      key: 'account', label: 'My Accounts', defaultWidth: 220,
      getSortValue: r => (r.account?.company || '').toLowerCase() || null,
      getFilterValue: r => r.account?.company || '', exportValue: r => r.account?.company || '',
      render: r => {
        if (!r.account) return blank;
        const p = byId?.get(r.account.id);
        return p && onSelect ? (
          <button type="button" onClick={() => onSelect(p)} title="Open the company"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
          >{r.account.company}</button>
        ) : <span style={{ fontWeight: 600 }}>{r.account.company}</span>;
      },
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 110,
      getSortValue: r => accountTier(r.account) || null,
      getFilterValue: r => accountTier(r.account), exportValue: r => accountTier(r.account),
      render: r => accountTier(r.account) || blank,
    },
    text('contactOwner', 'Contact Owner', 160),
    dateCol('lastContacted', 'Last Contacted'),
    dateCol('created', 'Create Date'),
    text('phone', 'Phone', 150),
    {
      key: 'linkedIn', label: 'LinkedIn', defaultWidth: 110,
      getSortValue: r => r.linkedIn || null, getFilterValue: r => (r.linkedIn ? 'LinkedIn' : ''), exportValue: r => r.linkedIn || '',
      render: r => (/^https?:\/\//i.test(r.linkedIn) ? <a href={r.linkedIn} target="_blank" rel="noreferrer" style={linkStyle}>Profile</a> : r.linkedIn || blank),
    },
    text('companyName', 'HubSpot Company', 240),
    text('companyOwner', 'Company Owner', 150),
    text('how', 'Matched By', 125, { headerTitle: 'How the contact was put on a My Accounts company: its HubSpot Company ID, else the company name, else its email domain against the account\'s Website or Email Domain.' }),
    text('emailDomain', 'Email Domain', 150),
    text('workEmail', 'Work Email', 220),
    text('contactName', 'Contact Name (HubSpot)', 200),
    text('companyId', 'Company ID', 130),
    text('zoomInfoId', 'ZoomInfo Company ID', 150),
    text('contactId', 'Contact ID', 140, { headerTitle: 'From a paste, only as precise as Excel showed it (2.53818E+11). Drop the file itself for the full ID.' }),
  ], [byId, onSelect]);

  const m = data.meta || {};
  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      <label
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0]); }}
        style={{ display: 'block', border: `2px dashed ${dragOver ? '#1D4ED8' : '#CBD5E1'}`, background: dragOver ? '#EFF6FF' : '#F8FAFC', borderRadius: 8, padding: '0.75rem 1rem', cursor: busy ? 'wait' : 'pointer', fontSize: '0.78rem', color: '#475569' }}
      >
        <input type="file" accept=".csv,.xlsx,.xls,.zip" disabled={busy} style={{ display: 'none' }}
          onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        <strong style={{ color: '#0F172A' }}>Drop your HubSpot contacts export here</strong>, click to choose it (CSV, Excel, or the zip HubSpot downloads), or copy the rows in Excel (header row included) and paste them anywhere on this page with Ctrl+V.
        {' '}It reads Company ID, Company name, Company owner, Contact Name (or First Name and Last Name), Job Title, Contact owner, Create Date, Email, Work email, Email Domain, Last Contacted, Phone Number, LinkedIn URL, ZoomInfo Company ID and Contact ID. Each drop replaces the contacts here.
        <div style={{ marginTop: 4, color: '#64748B' }}>
          {busy ? 'Reading...'
            : !loaded ? 'Loading...'
            : m.at ? `${fmt(data.contacts.length)} contacts, from ${m.file} (${new Date(m.at).toLocaleString()}). Drop or paste a newer export to replace them.`
            : 'No contacts yet.'}
        </div>
      </label>
      {!hasMappingExport && (
        <div style={{ fontSize: '0.75rem', color: '#B45309' }}>No HubSpot companies export on the Mapping subtab yet, so contacts are matched to My Accounts by company name and email domain only.</div>
      )}
      {note && <div style={{ fontSize: '0.75rem', color: '#475569' }}>{note}</div>}
      {error && <div style={{ color: '#B91C1C', fontSize: '0.78rem' }}>{error}</div>}

      {allRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {FILTERS.map(([k, label]) => (
            <button key={k || 'all'} type="button" onClick={() => { setFilter(k); setOwner(''); }} style={chipStyle(!owner && filter === k)}>{label} ({fmt(counts[k])})</button>
          ))}
          {owners.length > 0 && <span style={{ fontSize: '0.72rem', color: '#64748B', marginLeft: '0.5rem' }}>On your accounts, owned by:</span>}
          {owners.map(o => (
            <button key={o.name} type="button" onClick={() => setOwner(owner === o.name ? '' : o.name)} style={chipStyle(owner === o.name)}
              title={`Contacts on your My Accounts companies with ${o.name} as Contact owner`}
            >{o.name} ({fmt(o.count)})</button>
          ))}
        </div>
      )}

      {allRows.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId="my-accounts-hubspot-contacts"
            exportFileName="My Accounts HubSpot Contacts"
            columns={columns}
            rows={rows}
            defaultSort={{ key: 'account', direction: 'asc' }}
            alwaysVisible={['email', 'account']}
            defaultHidden={['companyOwner', 'emailDomain', 'workEmail', 'contactName', 'companyId', 'zoomInfoId', 'contactId', 'created']}
            emptyMessage="Nothing matches"
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
    </div>
  );
}
