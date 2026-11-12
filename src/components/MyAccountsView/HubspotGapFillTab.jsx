// Hubspot Mapping > Gap Fill: the work list for filling the app's contacts
// from the HubSpot contacts export on the Contacts subtab. Each row is an
// export contact whose email the app doesn't have at all, or one the app
// has with fields left blank that the export can fill
// (utils/hubspotContactGaps.js). The cells the export can fill are tinted
// green; Export Excel takes the list away to work through.
//
// Add puts a Not in the app contact into the app (create-contact, the same
// call the company popup's Paste Contacts makes) with Lead Source "Added
// from HubSpot"; Fill writes the blank fields HubSpot has onto the app's
// contact (update-contact). Both go row by row or for every row on screen,
// and a row drops off the list once it is done, since the app then has it.
// Both only work on a contact of an active My Accounts company (not Old
// Client, Hold Off or Lost - Not Sold); other rows say why they can't.
import { useState, useMemo, useEffect, useRef } from 'react';
import { DataTable } from '../common/DataTable';
import { contactMatcher, contactRows } from '../../utils/hubspotContacts';
import { accountTier, formatActivityDate } from '../../utils/hubspotActivity';
import { appContactsByEmail, contactGapRows, appContactName, GAP, GAP_FIELDS, gapFillPlan, gapFillBlocked, withoutInactiveAccounts } from '../../utils/hubspotContactGaps';
import { getHubspotCacheShared, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { apiFetch } from '../../utils/apiFetch';
import { HUBSPOT_EXPORT_LEAD_SOURCE } from '../../utils/contactLeadSource';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const chipStyle = (active) => ({ padding: '0.2rem 0.6rem', borderRadius: 999, border: `1px solid ${active ? '#1D4ED8' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#1D4ED8' : '#475569', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const linkStyle = { color: '#1D4ED8', textDecoration: 'none' };
const actionBtn = (kind) => ({ padding: '0 8px', borderRadius: 5, border: `1px solid ${kind === 'add' ? '#1D4ED8' : '#15803D'}`, background: '#fff', color: kind === 'add' ? '#1D4ED8' : '#15803D', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const bulkBtn = (kind, disabled) => ({ ...actionBtn(kind), padding: '0.2rem 0.6rem', fontSize: '0.72rem', borderRadius: 6, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' });
// How many rows go into the cache in one write: the cache is the whole
// contact list, so a write per row would rewrite it thousands of times.
const FLUSH_EVERY = 25;

// One row through HubSpot: the call, then the record the cache should hold.
async function sendPlan(plan) {
  if (plan.kind === 'add') {
    const res = await apiFetch('/api/hubspot?action=create-contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: plan.properties }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success || !json.contact?.id) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
    // An email HubSpot already had hands back that record: kept as it is.
    const record = json.alreadyExisted ? json.contact : { ...plan.properties, ...json.contact, _source: 'manual' };
    return { id: String(json.contact.id), record, existed: !!json.alreadyExisted };
  }
  const res = await apiFetch('/api/hubspot?action=update-contact', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // A blank company is linked, never renamed: renaming the Company record
    // would rename it for everyone linked to it.
    body: JSON.stringify({ contactId: plan.contactId, properties: plan.properties, companyMode: 'relink' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
  return { id: plan.contactId, record: { ...plan.properties, ...(json.contact || {}) }, existed: false };
}

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
  // Add / Fill: the run in progress ({ kind, done, total }), what the last
  // one did, and each email's failure, kept on its row.
  const [running, setRunning] = useState(null);
  const [runNote, setRunNote] = useState('');
  const [failed, setFailed] = useState({});
  const [shownRows, setShownRows] = useState([]);
  const stopRef = useRef(false);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Run rows through HubSpot one at a time, writing the cache every
  // FLUSH_EVERY rows and at the end; added contacts get Lead Source
  // "Added from HubSpot". Stop finishes the row in hand and stops.
  const substatusOf = (a) => a?.substatus || byId?.get(a?.id)?.substatus || '';
  const blockedWhy = (r) => gapFillBlocked(r, substatusOf);
  // The plan for a row Add / Fill may act on, else null.
  const planFor = (r) => (blockedWhy(r) ? null : gapFillPlan(r));
  const run = async (list) => {
    const work = list.map(r => ({ row: r, plan: planFor(r) })).filter(w => w.plan);
    if (!work.length || running) return;
    const kind = work.every(w => w.plan.kind === 'add') ? 'add' : work.every(w => w.plan.kind === 'fill') ? 'fill' : 'mixed';
    stopRef.current = false;
    setRunNote('');
    setRunning({ kind, done: 0, total: work.length });
    let added = 0; let existed = 0; let filled = 0;
    const errors = {};
    let pending = [];
    const leadSources = {};
    const flush = async () => {
      if (pending.length) {
        const batch = pending; pending = [];
        await updateHubspotCache(draft => {
          for (const { kind: k, id, record } of batch) {
            const i = draft.contacts.findIndex(c => String(c.id || c.vid) === id);
            if (k === 'add') { if (i < 0) draft.contacts.push(record); }
            else if (i >= 0) draft.contacts[i] = { ...draft.contacts[i], ...record };
          }
        });
      }
      if (Object.keys(leadSources).length && updateSettings) {
        const cur = settingsRef.current?.contactLeadSource || {};
        const next = { ...cur };
        for (const [id, v] of Object.entries(leadSources)) if (!cur[id]) next[id] = v;
        for (const id of Object.keys(leadSources)) delete leadSources[id];
        updateSettings({ contactLeadSource: next });
      }
    };
    for (let i = 0; i < work.length; i++) {
      if (stopRef.current) break;
      const { row, plan } = work[i];
      try {
        const out = await sendPlan(plan);
        pending.push({ kind: plan.kind, id: out.id, record: out.record });
        if (plan.kind === 'add') {
          if (out.existed) existed += 1;
          else { added += 1; leadSources[out.id] = HUBSPOT_EXPORT_LEAD_SOURCE; }
        } else filled += 1;
      } catch (err) {
        errors[row.gapEmail] = String(err?.message || err).slice(0, 300);
      }
      if (pending.length >= FLUSH_EVERY) await flush().catch(() => {});
      setRunning(r => (r ? { ...r, done: i + 1 } : r));
    }
    await flush().catch(err => { errors._cache = `Couldn't save to the app's contacts: ${err?.message || err}`; });
    setFailed(prev => {
      const next = { ...prev };
      for (const w of work) delete next[w.row.gapEmail];
      return { ...next, ...errors };
    });
    const nErr = Object.keys(errors).length;
    setRunNote([
      added ? `${fmt(added)} added (Lead Source "${HUBSPOT_EXPORT_LEAD_SOURCE}")` : '',
      existed ? `${fmt(existed)} already in HubSpot, picked up as they are` : '',
      filled ? `${fmt(filled)} filled` : '',
      nErr ? `${fmt(nErr)} failed (the reason is on the row)` : '',
      stopRef.current ? 'stopped' : '',
    ].filter(Boolean).join(', ') || 'Nothing to do.');
    setRunning(null);
  };

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
  // Contacts at Hold Off, Lost - Not Sold and Old Client accounts are left
  // off: nobody is working those accounts.
  const { rows: allRows, hidden: hiddenInactive } = useMemo(() => {
    if (appContacts == null) return { rows: [], hidden: 0 };
    const all = withoutInactiveAccounts(contactGapRows(contactRows(data.contacts, match, cdmName), byEmail), byId);
    return onlyMine ? { ...all, rows: all.rows.filter(r => r.account) } : all;
  }, [data.contacts, match, cdmName, byEmail, appContacts, onlyMine, byId]);

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
      key: 'action', label: 'Action', defaultWidth: 90,
      headerTitle: 'Add: put this contact in the app, with Lead Source "Added from HubSpot". Fill: write the green values onto the app\'s contact.',
      getSortValue: r => (failed[r.gapEmail] ? 0 : 1), getFilterValue: r => (failed[r.gapEmail] ? 'Failed' : ''), exportValue: () => '',
      render: r => {
        const why = blockedWhy(r);
        if (why) return <span title={`${why}: Add and Fill only work on your active My Accounts companies.`} style={{ color: '#94A3B8', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Not yours</span>;
        const plan = gapFillPlan(r);
        if (!plan) return blank;
        return (
          <button type="button" disabled={!!running} onClick={() => run([r])} style={{ ...actionBtn(plan.kind), opacity: running ? 0.5 : 1 }}
            title={plan.kind === 'add' ? 'Add this contact to the app' : `Fill ${r.fillLabels} on the app's contact`}
          >{plan.kind === 'add' ? '+ Add' : 'Fill'}</button>
        );
      },
    },
    {
      key: 'failed', label: 'Last Try', defaultWidth: 200,
      headerTitle: 'Why the last Add or Fill of this row failed.',
      getSortValue: r => failed[r.gapEmail] || null, getFilterValue: r => failed[r.gapEmail] || '', exportValue: r => failed[r.gapEmail] || '',
      render: r => (failed[r.gapEmail] ? <span title={failed[r.gapEmail]} style={{ color: '#B91C1C', fontSize: '0.72rem' }}>{failed[r.gapEmail]}</span> : blank),
    },
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [byId, onSelect, failed, running, settings]);
  const shownAdds = shownRows.filter(r => planFor(r)?.kind === 'add');
  const shownFills = shownRows.filter(r => planFor(r)?.kind === 'fill');
  const confirmRun = (list, verb) => {
    if (!list.length) return;
    if (list.length > 1 && !window.confirm(`${verb} ${fmt(list.length)} contacts in the app's HubSpot? ${verb === 'Add' ? `Each is created with Lead Source "${HUBSPOT_EXPORT_LEAD_SOURCE}".` : 'Only the blank fields are written.'} Stop finishes the one in hand.`)) return;
    run(list);
  };

  if (!loaded || appContacts == null) return <div style={{ fontSize: '0.78rem', color: '#64748B' }}>Loading...</div>;
  if (!data.contacts.length) {
    return <div style={{ fontSize: '0.78rem', color: '#64748B' }}>No HubSpot contacts export yet. Drop it on the Contacts subtab, and the contacts the app is missing, or is missing data on, are listed here.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45 }}>
        The {fmt(data.contacts.length)} contacts in the HubSpot export on the Contacts subtab, set against the {fmt(appContacts.length)} contacts in the app, by email.
        {' '}Listed: the emails the app doesn't have, and the contacts it has with a phone, LinkedIn, job title, name or company left blank that HubSpot has. <span style={FILL_TINT}>Green</span> marks a value that fills a blank.
        {hiddenInactive > 0 && ` ${fmt(hiddenInactive)} at Hold Off, Lost - Not Sold or Old Client accounts are left out.`}
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
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {running ? (
            <>
              <span style={{ fontSize: '0.72rem', color: '#475569' }}>{running.kind === 'fill' ? 'Filling' : 'Adding'} {fmt(running.done)} of {fmt(running.total)}...</span>
              <button type="button" onClick={() => { stopRef.current = true; }} style={{ ...bulkBtn('fill', false), color: '#B91C1C', border: '1px solid #FCA5A5' }}>Stop</button>
            </>
          ) : (
            <>
              <button type="button" disabled={!shownAdds.length} onClick={() => confirmRun(shownAdds, 'Add')} style={bulkBtn('add', !shownAdds.length)}
                title={`Add every Not in the app contact on screen whose company is one of your active My Accounts (not Old Client, Hold Off or Lost - Not Sold) to the app, with Lead Source "${HUBSPOT_EXPORT_LEAD_SOURCE}". Filter first to add just some.`}
              >+ Add all shown on My Accounts ({fmt(shownAdds.length)})</button>
              <button type="button" disabled={!shownFills.length} onClick={() => confirmRun(shownFills, 'Fill')} style={bulkBtn('fill', !shownFills.length)}
                title="Write the green values onto every app contact on screen whose company is one of your active My Accounts (not Old Client, Hold Off or Lost - Not Sold). Only blank fields are written. Filter first to fill just some."
              >Fill all shown on My Accounts ({fmt(shownFills.length)})</button>
            </>
          )}
        </span>
      </div>
      {runNote && <div style={{ fontSize: '0.75rem', color: '#475569' }}>{runNote}</div>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-hubspot-gap-fill"
          exportFileName="HubSpot Contacts Gap Fill"
          columns={columns}
          rows={rows}
          defaultSort={{ key: 'account', direction: 'asc' }}
          alwaysVisible={['action', 'gapEmail', 'gap']}
          defaultHidden={['firstName', 'lastName', 'how', 'lastContacted']}
          onFilteredRowsChange={setShownRows}
          emptyMessage={allRows.length ? 'Nothing matches' : 'No gaps: the app has every contact in the export, with nothing blank that HubSpot has.'}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
