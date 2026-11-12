// Hubspot Mapping > Activity and Others' Activity. Dan drops (or pastes)
// the HubSpot activity report for his companies; each activity is lined up
// with the My Accounts company it belongs to by HubSpot Company ID, then by
// name (utils/hubspotActivity.js). Activity lists all of it; Others'
// Activity lists the activity on his accounts that somebody else created.
// The activities are kept in Firestore (hubspotMappingStore.js) and each
// drop merges into what is there, so history builds up across exports.
import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { readHubspotSheet, usePastedRows } from './hubspotDrop';
import {
  compactActivities, mergeActivities, activityMatcher, activityRows, othersActivityRows,
  salespeopleSummary, formatActivityDate, activityKey, accountTier,
} from '../../utils/hubspotActivity';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const chipStyle = (active) => ({ padding: '0.2rem 0.6rem', borderRadius: 999, border: `1px solid ${active ? '#1D4ED8' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#1D4ED8' : '#475569', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const ghostBtn = { padding: '0.2rem 0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', color: '#475569', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };

// The whole stored email of one activity, over the page. Esc, x or a
// click outside closes it.
function BodyPopup({ row, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const line = (label, value) => (value ? <div><span style={{ color: '#64748B' }}>{label}:</span> {value}</div> : null);
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 760, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#334155', lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>{row.type || 'Activity'}{row.account ? `, ${row.account.company}` : row.companyName ? `, ${row.companyName}` : ''}</div>
            {line('Date', formatActivityDate(row.date))}
            {line('By', row.salesperson)}
            {line('To', row.toAddress)}
            {line('CC', row.ccAddress)}
            {line('Subject', row.subject)}
          </div>
          <button type="button" onClick={onClose} title="Close" style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '0.75rem 1rem', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '0.82rem', color: '#1E293B', lineHeight: 1.5 }}>{row.body}</div>
        <div style={{ padding: '0.4rem 1rem', borderTop: '1px solid #E2E8F0', fontSize: '0.68rem', color: '#64748B' }}>The newest message only: the quoted thread below it is left out.</div>
      </div>
    </div>,
    document.body,
  );
}

const text = (key, label, width, extra = {}) => ({
  key, label, defaultWidth: width,
  getSortValue: r => String(r[key] || '').toLowerCase() || null,
  getFilterValue: r => r[key] || '', exportValue: r => r[key] || '',
  render: r => r[key] || blank,
  ...extra,
});

export function HubspotActivityTab({ view, data, onSave, loaded, mapping = [], accounts = [], byId, onSelect, cdmName = '', hasMappingExport = false, settings, updateSettings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState('');
  const [person, setPerson] = useState('');
  // Others' Activity: the ignored activity shown instead of the rest.
  const [showIgnored, setShowIgnored] = useState(false);
  const [shownRows, setShownRows] = useState([]);
  const [openBody, setOpenBody] = useState(null);
  const firstName = String(cdmName || '').trim().split(/\s+/)[0] || 'Dan';
  const others = view === 'others';

  const loadRows = async (readRows, source) => {
    setBusy(true); setError(''); setNote('');
    try {
      const { activities, hasAssignee } = compactActivities(await readRows());
      if (!activities.length) throw new Error(`No activity found. The ${source === 'paste' ? 'pasted rows need a header row with' : 'file needs'} Company ID or Company name, and Activity date or Activity type.`);
      const merged = mergeActivities(data.activities, activities);
      await onSave({
        ...data,
        activities: merged.activities,
        meta: { file: source === 'paste' ? 'rows pasted from Excel' : source, at: new Date().toISOString(), hasAssignee: hasAssignee || !!data.meta?.hasAssignee },
      });
      setNote(`${fmt(activities.length)} rows read: ${fmt(merged.added)} new, ${fmt(merged.updated)} already here.${hasAssignee ? '' : ' This export has no Activity created by column, so it doesn\'t say who logged each activity.'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const upload = (file) => { if (file) loadRows(() => readHubspotSheet(file), file.name); };
  const clearAll = async () => {
    if (!window.confirm(`Remove all ${fmt(data.activities.length)} stored activities? Drop the export again to bring them back.`)) return;
    await onSave({ ...data, activities: [], meta: {} });
    setNote('');
  };

  const rootRef = useRef(null);
  usePastedRows(rootRef, busy, (rows) => loadRows(() => rows, 'paste'));

  const match = useMemo(() => activityMatcher(mapping, accounts), [mapping, accounts]);
  const allRows = useMemo(() => activityRows(data.activities, match, cdmName), [data.activities, match, cdmName]);
  // Activity Dan has ignored on Others' Activity, by activityKey. Kept with
  // the activities, so a later drop of the same rows stays ignored.
  const ignored = useMemo(() => new Set(data.ignored || []), [data.ignored]);
  const othersAll = useMemo(() => othersActivityRows(allRows, cdmName).map(r => ({ ...r, ignored: ignored.has(activityKey(r)) })), [allRows, cdmName, ignored]);
  const othersRows = useMemo(() => othersAll.filter(r => !r.ignored), [othersAll]);
  const ignoredRows = useMemo(() => othersAll.filter(r => r.ignored), [othersAll]);
  const people = useMemo(() => salespeopleSummary(othersRows), [othersRows]);
  const setIgnored = (list, on) => {
    const next = new Set(ignored);
    for (const r of list) { const k = activityKey(r); if (on) next.add(k); else next.delete(k); }
    onSave({ ...data, ignored: [...next] });
  };

  const FILTERS = [
    ['', 'All', () => true],
    ['mapped', 'On My Accounts', r => !!r.account],
    ['unmapped', 'Not on My Accounts', r => !r.account],
    ['mine', `By ${firstName}`, r => r.mine === true],
    ['notMine', 'By others', r => r.mine === false],
  ];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , f]) => [k, allRows.filter(f).length])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, firstName]);
  const rows = useMemo(() => {
    if (others) {
      const list = showIgnored ? ignoredRows : othersRows;
      return person && !showIgnored ? list.filter(r => r.salesperson === person) : list;
    }
    const f = FILTERS.find(([k]) => k === filter)?.[2] || (() => true);
    return allRows.filter(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others, person, othersRows, ignoredRows, showIgnored, allRows, filter, firstName]);

  const columns = useMemo(() => [
    {
      key: 'date', label: 'Activity Date', defaultWidth: 205,
      getSortValue: r => r.date || null,
      getFilterValue: r => formatActivityDate(r.date), exportValue: r => formatActivityDate(r.date),
      render: r => (r.date ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatActivityDate(r.date)}</span> : blank),
    },
    text('type', 'Activity Type', 190),
    text('salesperson', 'Salesperson', 160, { headerTitle: 'Who logged it: Activity created by, else Activity assigned to.' }),
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
    text('companyName', 'HubSpot Company', 220),
    text('companyOwner', 'Company Owner', 150),
    text('createdBy', 'Activity Created By', 160),
    text('assignedTo', 'Activity Assigned To', 160),
    text('how', 'Matched By', 125, { headerTitle: 'How the activity was put on a My Accounts company: its HubSpot Company ID (a company on the Mapping subtab), else its company name.' }),
    text('subject', 'Subject', 260),
    text('toAddress', 'Email To', 240),
    text('ccAddress', 'Email CC', 220),
    {
      key: 'body', label: 'Email Body', defaultWidth: 340,
      headerTitle: 'The newest message of the email (the quoted thread is left out). Click one to read it all.',
      getSortValue: r => r.body || null,
      getFilterValue: r => r.body || '', exportValue: r => r.body || '',
      render: r => (r.body ? (
        <button type="button" onClick={() => setOpenBody(r)} title="Read the whole message"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#334155', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', display: 'block' }}
        >{r.body.replace(/\s+/g, ' ').slice(0, 200)}</button>
      ) : blank),
    },
    text('companyId', 'Company ID', 130),
    text('engagementId', 'Engagement ID', 140, { headerTitle: 'From a paste, only as precise as Excel showed it (1.18921E+11). Drop the file itself for the full ID.' }),
    ...(others ? [{
      key: 'ignore', label: 'Ignore', defaultWidth: 90,
      headerTitle: 'Take an activity off this list. The Ignored chip lists them, to bring one back.',
      getSortValue: r => (r.ignored ? 1 : 0), getFilterValue: r => (r.ignored ? 'Ignored' : ''), exportValue: r => (r.ignored ? 'Ignored' : ''),
      render: r => (
        <button type="button" onClick={() => setIgnored([r], !r.ignored)} style={{ ...ghostBtn, padding: '0 8px' }}
          title={r.ignored ? 'Put it back on the list' : 'Take it off the list'}
        >{r.ignored ? 'Restore' : 'Ignore'}</button>
      ),
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [byId, onSelect, others, ignored, data]);

  const m = data.meta || {};
  const lastOf = (list) => list.reduce((x, r) => (r.date > x ? r.date : x), '');
  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      {!others && (
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0]); }}
          style={{ display: 'block', border: `2px dashed ${dragOver ? '#1D4ED8' : '#CBD5E1'}`, background: dragOver ? '#EFF6FF' : '#F8FAFC', borderRadius: 8, padding: '0.75rem 1rem', cursor: busy ? 'wait' : 'pointer', fontSize: '0.78rem', color: '#475569' }}
        >
          <input type="file" accept=".csv,.xlsx,.xls,.zip" disabled={busy} style={{ display: 'none' }}
            onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <strong style={{ color: '#0F172A' }}>Drop your HubSpot activity export here</strong>, click to choose it (CSV, Excel, or the zip HubSpot downloads), or copy the rows in Excel (header row included) and paste them anywhere on this page with Ctrl+V.
          {' '}It reads Company ID, Company name, Company owner, Activity date, Activity type, Engagement ID, Activity created by, Activity assigned to, Email To Address, Email CC Address and Email body. Each drop adds to the activity already here.
          <div style={{ marginTop: 4, color: '#64748B' }}>
            {busy ? 'Reading...'
              : !loaded ? 'Loading...'
              : m.at ? `${fmt(data.activities.length)} activities stored. Last added from ${m.file} (${new Date(m.at).toLocaleString()}).`
              : 'No activity yet.'}
          </div>
        </label>
      )}
      {!hasMappingExport && (
        <div style={{ fontSize: '0.75rem', color: '#B45309' }}>No HubSpot companies export on the Mapping subtab yet, so activity is matched to My Accounts by company name only.</div>
      )}
      {note && <div style={{ fontSize: '0.75rem', color: '#475569' }}>{note}</div>}
      {error && <div style={{ color: '#B91C1C', fontSize: '0.78rem' }}>{error}</div>}

      {others && (
        <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45 }}>
          Activity on your My Accounts companies that someone other than {firstName} created in HubSpot ({fmt(othersRows.length)} activities{othersRows.length ? `, newest ${formatActivityDate(lastOf(othersRows))}` : ''}).
          {loaded && data.activities.length > 0 && !m.hasAssignee && (
            <span style={{ color: '#B45309' }}> The activity stored so far doesn&apos;t say who created it: add Activity created by to the HubSpot report, export it again and drop it on the Activity subtab.</span>
          )}
          {loaded && !data.activities.length && <span> Drop a HubSpot activity export on the Activity subtab first.</span>}
        </div>
      )}

      {allRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {others ? (
            <>
              <button type="button" onClick={() => { setPerson(''); setShowIgnored(false); }} style={chipStyle(!person && !showIgnored)}>Everyone ({fmt(othersRows.length)})</button>
              {people.map(p => (
                <button key={p.name} type="button" onClick={() => { setPerson(p.name); setShowIgnored(false); }} style={chipStyle(person === p.name && !showIgnored)}
                  title={`${p.count} activities on ${p.accounts} of your accounts, newest ${formatActivityDate(p.last)}`}
                >{p.name} ({fmt(p.count)})</button>
              ))}
              {ignoredRows.length > 0 && (
                <button type="button" onClick={() => { setShowIgnored(true); setPerson(''); }} style={chipStyle(showIgnored)}
                  title="The activity you've ignored. Restore puts one back."
                >Ignored ({fmt(ignoredRows.length)})</button>
              )}
              {shownRows.length > 0 && (
                <button type="button" onClick={() => setIgnored(shownRows, !showIgnored)} style={{ ...ghostBtn, marginLeft: 'auto' }}
                  title={showIgnored ? 'Put every activity on screen back on the list.' : 'Take every activity on screen off the list (pick a salesperson chip or filter the columns first to ignore just some).'}
                >{showIgnored ? `Restore all shown (${fmt(shownRows.length)})` : `Ignore all shown (${fmt(shownRows.length)})`}</button>
              )}
            </>
          ) : (
            <>
              {FILTERS.map(([k, label]) => (
                <button key={k || 'all'} type="button" onClick={() => setFilter(k)} style={chipStyle(filter === k)}>{label} ({fmt(counts[k])})</button>
              ))}
              <button type="button" onClick={clearAll} style={{ ...ghostBtn, marginLeft: 'auto' }}
                title="Remove every stored activity, to start again from the next export."
              >Clear activity</button>
            </>
          )}
        </div>
      )}

      {allRows.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId={others ? 'my-accounts-hubspot-others-activity' : 'my-accounts-hubspot-activity'}
            exportFileName={others ? 'My Accounts Activity by Others in HubSpot' : 'My Accounts HubSpot Activity'}
            columns={columns}
            rows={rows}
            defaultSort={{ key: 'date', direction: 'desc' }}
            alwaysVisible={['date', 'account']}
            defaultHidden={others
              ? ['companyOwner', 'createdBy', 'assignedTo', 'how', 'subject', 'toAddress', 'ccAddress', 'companyId', 'engagementId']
              : ['createdBy', 'assignedTo', 'subject', 'ccAddress', 'companyId', 'engagementId']}
            emptyMessage="Nothing matches"
            settings={settings}
            updateSettings={updateSettings}
            onFilteredRowsChange={setShownRows}
          />
        </div>
      )}
      {openBody && <BodyPopup row={openBody} onClose={() => setOpenBody(null)} />}
    </div>
  );
}
