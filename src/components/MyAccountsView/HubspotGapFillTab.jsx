// Hubspot Mapping > Gap Fill: the work list for filling the app's contacts
// from the HubSpot contacts export on the Contacts subtab. Each row is an
// export contact whose email the app doesn't have at all, or one the app
// has with fields left blank that the export can fill
// (utils/hubspotContactGaps.js). The cells the export can fill are tinted
// green; Export Excel takes the list away to work through.
import { useState, useMemo, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { contactMatcher, contactRows } from '../../utils/hubspotContacts';
import { accountTier, formatActivityDate } from '../../utils/hubspotActivity';
import { appContactsByEmail, contactGapRows, appContactName, GAP, GAP_FIELDS } from '../../utils/hubspotContactGaps';
import { getHubspotCacheShared } from '../../utils/hubspotContactsCache';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const chipStyle = (active) => ({ padding: '0.2rem 0.6rem', borderRadius: 999, border: `1px solid ${active ? '#1D4ED8' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#1D4ED8' : '#475569', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const linkStyle = { color: '#1D4ED8', textDecoration: 'none' };
const FILL_TINT = { background: '#DCFCE7', color: '#166534', borderRadius: 4, padding: '0 5px', fontWeight: 600 };
const GAP_TINTS = {
  [GAP.notInApp]: { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
  [GAP.missingData]: { bg: '#FFFBEB', border: '#FDE68A', ink: '#B45309' },
};

// A cell the export can fill on an app contact is tinted green.
const fills = (r, key) => r.fill?.includes(key);
const cell = (r, key, content) => (fills(r, key)
  ? <span style={FILL_TINT} title="Blank on this contact in the app: this value from HubSpot fills it">{content}</span>
  : content);

const text = (key, label, width, extra = {}) => ({
  key, label, defaultWidth: width,
  getSortValue: r => String(r[key] || '').toLowerCase() || null,
  getFilterValue: r => r[key] || '', exportValue: r => r[key] || '',
  render: r => (r[key] ? cell(r, key, r[key]) : blank),
  ...extra,
});

export function HubspotGapFillTab({ data, loaded, mapping = [], accounts = [], byId, onSelect, cdmName = '', settings, updateSettings }) {
  const [filter, setFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);

  // The contacts the app holds, re-read whenever the cache changes.
  const [appContacts, setAppContacts] = useState(null);
  useEffect(() => {
    let live = true;
    const read = () => getHubspotCacheShared().then(c => { if (live) setAppContacts(c?.contacts || []); }).catch(() => { if (live) setAppContacts([]); });
    read();
    window.addEventListener('hubspot-cache-updated', read);
    return () => { live = false; window.removeEventListener('hubspot-cache-updated', read); };
  }, []);

  const match = useMemo(() => contactMatcher(mapping, accounts), [mapping, accounts]);
  const byEmail = useMemo(() => appContactsByEmail(appContacts || [], settings?.contactOldEmails), [appContacts, settings?.contactOldEmails]);
  const allRows = useMemo(() => {
    if (appContacts == null) return [];
    const rows = contactGapRows(contactRows(data.contacts, match, cdmName), byEmail);
    return onlyMine ? rows.filter(r => r.account) : rows;
  }, [data.contacts, match, cdmName, byEmail, appContacts, onlyMine]);

  const FILTERS = useMemo(() => [
    ['', 'All gaps', () => true],
    ['notInApp', GAP.notInApp, r => r.gap === GAP.notInApp],
    ['missingData', GAP.missingData, r => r.gap === GAP.missingData],
    ...GAP_FIELDS.map(f => [`f:${f.key}`, `Missing ${f.label}`, r => r.fill.includes(f.key)]),
  ], []);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , f]) => [k, allRows.filter(f).length])), [FILTERS, allRows]);
  const rows = useMemo(() => allRows.filter(FILTERS.find(([k]) => k === filter)?.[2] || (() => true)), [allRows, FILTERS, filter]);

  const columns = useMemo(() => [
    {
      key: 'gap', label: 'Gap', defaultWidth: 130,
      getSortValue: r => r.gap, getFilterValue: r => r.gap, exportValue: r => r.gap,
      headerTitle: 'Not in the app: no contact in the app has this email (or has it as an old email). Missing data: the app has the contact, with fields blank that HubSpot has.',
      render: r => {
        const t = GAP_TINTS[r.gap];
        return <span style={{ fontSize: '0.68rem', fontWeight: 700, color: t.ink, background: t.bg, border: `1px solid ${t.border}`, padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.gap}</span>;
      },
    },
    {
      key: 'fillLabels', label: 'Can Fill', defaultWidth: 170,
      getSortValue: r => r.fill.length || null, getFilterValue: r => r.fillLabels, exportValue: r => r.fillLabels,
      headerTitle: 'The fields blank on the app\'s contact that HubSpot has a value for.',
      render: r => r.fillLabels || blank,
    },
    text('name', 'Name', 170),
    {
      key: 'gapEmail', label: 'Email', defaultWidth: 230,
      getSortValue: r => r.gapEmail, getFilterValue: r => r.gapEmail, exportValue: r => r.gapEmail,
      render: r => <a href={`mailto:${r.gapEmail}`} style={linkStyle}>{r.gapEmail}</a>,
    },
    text('jobTitle', 'Job Title', 240),
    text('phone', 'Phone', 150),
    {
      key: 'linkedIn', label: 'LinkedIn', defaultWidth: 110,
      getSortValue: r => r.linkedIn || null, getFilterValue: r => (r.linkedIn ? 'LinkedIn' : ''), exportValue: r => r.linkedIn || '',
      render: r => (!r.linkedIn ? blank : cell(r, 'linkedIn', /^https?:\/\//i.test(r.linkedIn)
        ? <a href={r.linkedIn} target="_blank" rel="noreferrer" style={fills(r, 'linkedIn') ? { color: 'inherit' } : linkStyle}>Profile</a>
        : r.linkedIn)),
    },
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
      key: 'tier', label: 'Tier', defaultWidth: 100,
      getSortValue: r => accountTier(r.account) || null,
      getFilterValue: r => accountTier(r.account), exportValue: r => accountTier(r.account),
      render: r => accountTier(r.account) || blank,
    },
    text('companyName', 'HubSpot Company', 220),
    text('firstName', 'First Name', 120),
    text('lastName', 'Last Name', 120),
    text('contactOwner', 'Contact Owner', 150),
    {
      key: 'lastContacted', label: 'Last Contacted', defaultWidth: 180,
      getSortValue: r => r.lastContacted || null,
      getFilterValue: r => formatActivityDate(r.lastContacted), exportValue: r => formatActivityDate(r.lastContacted),
      render: r => (r.lastContacted ? formatActivityDate(r.lastContacted) : blank),
    },
    {
      key: 'appName', label: 'In the App As', defaultWidth: 180,
      getSortValue: r => (r.app ? appContactName(r.app).toLowerCase() : null),
      getFilterValue: r => (r.app ? appContactName(r.app) : ''), exportValue: r => (r.app ? appContactName(r.app) : ''),
      headerTitle: 'The app\'s contact this row matched by email.',
      render: r => (r.app ? appContactName(r.app) : blank),
    },
    text('how', 'Matched By', 125, { headerTitle: 'How the contact was put on a My Accounts company: its HubSpot Company ID, else the company name, else its email domain.' }),
  ], [byId, onSelect]);

  if (!loaded || appContacts == null) return <div style={{ fontSize: '0.78rem', color: '#64748B' }}>Loading...</div>;
  if (!data.contacts.length) {
    return <div style={{ fontSize: '0.78rem', color: '#64748B' }}>No HubSpot contacts export yet. Drop it on the Contacts subtab, and the contacts the app is missing, or is missing data on, are listed here.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45 }}>
        The {fmt(data.contacts.length)} contacts in the HubSpot export on the Contacts subtab, set against the {fmt(appContacts.length)} contacts in the app, by email.
        {' '}Listed: the emails the app doesn't have, and the contacts it has with a phone, LinkedIn, job title, name or company left blank that HubSpot has. <span style={FILL_TINT}>Green</span> marks a value that fills a blank.
        {appContacts.length === 0 && <span style={{ color: '#B45309' }}> The app's contacts haven't loaded on this browser yet (sync HubSpot), so every email reads as not in the app.</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {FILTERS.map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setFilter(k)} style={chipStyle(filter === k)}>{label} ({fmt(counts[k])})</button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#475569', marginLeft: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} />
          On My Accounts only
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-hubspot-gap-fill"
          exportFileName="HubSpot Contacts Gap Fill"
          columns={columns}
          rows={rows}
          defaultSort={{ key: 'account', direction: 'asc' }}
          alwaysVisible={['gapEmail', 'gap']}
          defaultHidden={['firstName', 'lastName', 'how', 'lastContacted']}
          emptyMessage={allRows.length ? 'Nothing matches' : 'No gaps: the app has every contact in the export, with nothing blank that HubSpot has.'}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
