// My Accounts > Hubspot Mapping: Dan drops the export of his companies in
// Schneider's HubSpot here, and each account on My Accounts is lined up
// with its HubSpot record (utils/hubspotMapping.js). Accounts HubSpot
// doesn't have, and HubSpot companies My Accounts doesn't have, are listed
// too. The export and his links are kept in Firestore
// (utils/hubspotMappingStore.js), so the mapping is there next time.
//
// Matching runs over every account, whatever the inactive toggle says: an
// inactive account that is in HubSpot is still a match, not an "Only in
// HubSpot" row. Those rows (Old Client, Hold Off, Lost - Not Sold, or a
// substatus, which reads as Hold Off) sit on the Inactive chip of their own
// and are left out of All and the other chips.

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { domainKey } from '../../utils/seHubspotExisting';
import { compactMappingCompanies, buildHubspotMapping, MAPPING_STATUS, SUGGEST_MIN_SCORE } from '../../utils/hubspotMapping';
import { loadHubspotMapping, saveHubspotMapping, EMPTY_HUBSPOT_MAPPING } from '../../utils/hubspotMappingStore';
import { reportingStatus } from '../../utils/reportingStatus';
import { matchesCdm } from '../../utils/cdmMatch';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const STATUS_TINTS = {
  [MAPPING_STATUS.matched]: { bg: '#F0FDF4', border: '#BBF7D0', ink: '#15803D' },
  [MAPPING_STATUS.accountOnly]: { bg: '#FFFBEB', border: '#FDE68A', ink: '#B45309' },
  [MAPPING_STATUS.hubspotOnly]: { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
};
// How sure a possible match looks: green from 85%, amber from 70%, grey below.
const scoreTint = (score) => (score >= 85 ? { bg: '#F0FDF4', border: '#BBF7D0', ink: '#15803D' }
  : score >= 70 ? { bg: '#FFFBEB', border: '#FDE68A', ink: '#B45309' }
  : { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' });
const linkBtn = { background: 'none', border: '1px solid #CBD5E1', borderRadius: 4, padding: '0 6px', fontSize: '0.68rem', fontFamily: 'inherit', color: '#1D4ED8', cursor: 'pointer', whiteSpace: 'nowrap' };

// A CSV is read as text, so its dates stay as HubSpot wrote them
// ("2026-10-05 14:02") rather than being reparsed into "10/5/26".
async function readSheet(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: /\.csv$/i.test(file.name) });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

// A filter chip of its own: matched accounts whose Status and HubSpot
// Lifecycle Stage disagree (statusDiscrepancy).
const MISMATCH = 'Status mismatch';
// Another: HubSpot-only rows whose company is on the Table tab after all.
const ON_TABLE = 'On Table, not My Accounts';
// And the accounts out of active rotation, as on the rest of My Accounts.
const INACTIVE = 'Inactive';
const INACTIVE_STATUSES = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);
const HOW = { website: 'Website', name: 'Name', linked: 'Your link' };
const accountSite = (r) => (r.account ? domainKey(r.account.website) || domainKey(r.account.emailDomain) : '');
const hsField = (field) => (r) => r.hubspot.map(c => c[field]).filter(Boolean).join(', ');
// Same-named duplicate records read once.
const dupNames = (r) => [...new Set((r.duplicates || []).map(c => c.name))].join(', ');

export function HubspotMappingTab({ accounts = [], prospects = [], search = '', onSelect, settings, updateSettings, filterBar, cdmName = '' }) {
  const [data, setData] = useState(EMPTY_HUBSPOT_MAPPING);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [showUnmapped, setShowUnmapped] = useState(false);

  useEffect(() => {
    loadHubspotMapping().then(setData).catch(err => setError(err.message)).finally(() => setLoaded(true));
  }, []);

  const save = async (next) => {
    setData(next);
    try { await saveHubspotMapping(next); }
    catch (err) { setError(`Couldn't save: ${err.message}`); }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const companies = compactMappingCompanies(await readSheet(file));
      if (!companies.length) throw new Error('No companies found. The file needs a Company name column.');
      await save({ ...data, companies, meta: { file: file.name, at: new Date().toISOString() } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const link = (accountId, hubspotId) => {
    const links = { ...data.links };
    if (hubspotId) links[accountId] = hubspotId; else delete links[accountId];
    save({ ...data, links });
  };

  // Aliases and "goes by" live on the tracker record, not the account row.
  const byId = useMemo(() => new Map((prospects || []).map(p => [p.id, p])), [prospects]);
  // A matched account's CDM is its tracker record's; a HubSpot-only row's is
  // that of the Table tab records with its name or website, if any.
  const cdmOf = (r) => {
    const recs = r.account ? [byId.get(r.account.id) || r.account] : r.tracker || [];
    return [...new Set(recs.map(p => String(p.cdm || '').trim()).filter(Boolean))].join(', ');
  };
  // A Tier 1 or Tier 2 company whose CDM isn't Dan and whose popup doesn't
  // have "aligned w/other CDM" ticked: he should align with that CDM first.
  // A matched account's tier is its My Accounts tier; a Table tab record's
  // is the tier on the record.
  const firstName = String(cdmName || '').trim().split(/\s+/)[0] || 'Dan';
  const cdmWarning = (r) => {
    if (!cdmName) return '';
    const recs = r.account
      ? [{ ...(byId.get(r.account.id) || r.account), tier: r.account.myTier }]
      : r.tracker || [];
    const flagged = recs.filter(p => (p.tier === 'Tier 1' || p.tier === 'Tier 2')
      && !matchesCdm(p.cdm, cdmName) && p.cdmAligned !== true);
    if (!flagged.length) return '';
    const p = flagged[0];
    return `${p.tier} with ${String(p.cdm || '').trim() || 'no CDM'} as CDM, and ${firstName}'s aligned w/other CDM isn't ticked`;
  };
  const trackerOf = (r) => (r.tracker || []).map(p => p.company).filter(Boolean).join(', ');
  const substatusOf = (r) => (r.account ? String(r.account.substatus || byId.get(r.account.id)?.substatus || '').trim() : '');
  const isInactiveRow = (r) => !!r.account && INACTIVE_STATUSES.has(reportingStatus({ ...r.account, substatus: substatusOf(r) }));
  const mapping = useMemo(() => {
    if (!data.companies.length) return [];
    const withNames = accounts.map(a => {
      const p = byId.get(a.id);
      return p ? { ...a, goesBy: a.goesBy || p.goesBy, aliases: a.aliases || p.aliases, website: a.website || p.website, emailDomain: a.emailDomain || p.emailDomain } : a;
    });
    return buildHubspotMapping(withNames, data.companies, { links: data.links, tracker: prospects || [] });
  }, [accounts, prospects, byId, data]);

  const counts = useMemo(() => {
    const c = { '': 0 };
    for (const r of mapping) {
      if (isInactiveRow(r)) { c[INACTIVE] = (c[INACTIVE] || 0) + 1; continue; }
      c[''] += 1;
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.statusFlag) c[MISMATCH] = (c[MISMATCH] || 0) + 1;
      if (r.tracker?.length) c[ON_TABLE] = (c[ON_TABLE] || 0) + 1;
    }
    return c;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, byId]);

  const rows = useMemo(() => {
    let out = statusFilter === INACTIVE ? mapping.filter(isInactiveRow) : mapping.filter(r => !isInactiveRow(r));
    if (statusFilter === MISMATCH) out = out.filter(r => r.statusFlag);
    else if (statusFilter === ON_TABLE) out = out.filter(r => r.tracker?.length);
    else if (statusFilter && statusFilter !== INACTIVE) out = out.filter(r => r.status === statusFilter);
    const term = search.trim().toLowerCase();
    if (term) {
      out = out.filter(r => [r.account?.company, ...r.hubspot.map(c => c.name), ...(r.duplicates || []).map(c => c.name), ...r.suggestions.map(c => c.name), ...(r.tracker || []).map(p => p.company)]
        .filter(Boolean).join(' ').toLowerCase().includes(term));
    }
    return out.map(r => ({ ...r, id: r.key }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, byId, statusFilter, search]);

  const columns = useMemo(() => [
    {
      key: 'status', label: 'Status', defaultWidth: 150,
      getFilterValue: r => r.status, exportValue: r => r.status, getSortValue: r => r.status,
      render: r => {
        const t = STATUS_TINTS[r.status];
        return <span style={{ fontSize: '0.68rem', fontWeight: 700, color: t.ink, background: t.bg, border: `1px solid ${t.border}`, padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.status}</span>;
      },
    },
    {
      key: 'account', label: 'My Accounts', defaultWidth: 240,
      getSortValue: r => (r.account?.company || '').toLowerCase() || null,
      getFilterValue: r => r.account?.company || '',
      exportValue: r => r.account?.company || '',
      render: r => {
        if (!r.account) return blank;
        const p = byId.get(r.account.id);
        return p && onSelect ? (
          <button type="button" onClick={() => { setShowUnmapped(false); onSelect(p); }} title="Open the company"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
          >{r.account.company}</button>
        ) : <span style={{ fontWeight: 600 }}>{r.account.company}</span>;
      },
    },
    {
      key: 'statusFlag', label: 'Status Check', defaultWidth: 280,
      headerTitle: 'Flags a matched account whose Status disagrees with its HubSpot Lifecycle Stage: a Client that is not a Customer in HubSpot, or a Customer in HubSpot that is not a Client or Old Client here.',
      getSortValue: r => r.statusFlag || null,
      getFilterValue: r => (r.statusFlag ? MISMATCH : ''),
      exportValue: r => r.statusFlag,
      render: r => (r.statusFlag ? (
        <span title={r.statusFlag} style={{ fontSize: '0.68rem', fontWeight: 700, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{'\u26A0'} {r.statusFlag}</span>
      ) : blank),
    },
    { key: 'tier', label: 'Tier', defaultWidth: 90, getFilterValue: r => r.account?.tierLabel || r.account?.myTier || '', exportValue: r => r.account?.tierLabel || r.account?.myTier || '', render: r => r.account?.tierLabel || r.account?.myTier || blank },
    { key: 'accountStatus', label: 'Account Status', defaultWidth: 130, getFilterValue: r => r.account?.status || '', exportValue: r => r.account?.status || '', render: r => r.account?.status || blank },
    {
      // Read off the tracker record: the account row doesn't carry it.
      key: 'substatus', label: 'Substatus', defaultWidth: 140,
      getFilterValue: r => substatusOf(r), exportValue: r => substatusOf(r),
      render: r => substatusOf(r) || blank,
    },
    {
      key: 'cdm', label: 'CDM', defaultWidth: 210,
      headerTitle: `\u26A0 marks a Tier 1 or Tier 2 company whose CDM isn't ${cdmName || 'you'} and whose "${firstName}'s aligned w/other CDM" box (company popup) isn't ticked.`,
      getFilterValue: r => cdmOf(r) + (cdmWarning(r) ? ' \u26A0' : ''),
      exportValue: r => [cdmOf(r), cdmWarning(r)].filter(Boolean).join(' - '),
      render: r => {
        const cdm = cdmOf(r);
        const warn = cdmWarning(r);
        if (!warn) return cdm || blank;
        return (
          <span title={warn} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', padding: '0 6px', borderRadius: 999, whiteSpace: 'nowrap' }}>{'\u26A0'} Not aligned</span>
            <span>{cdm || blank}</span>
          </span>
        );
      },
    },
    {
      key: 'onTable', label: 'On Table Tab', defaultWidth: 220,
      headerTitle: 'For a HubSpot company no account matched: the companies on the Table tab with its name or website. They are on the tracker but not on My Accounts (for example another CDM\'s account, or one with no tier and no opps), which is why it shows as Only in HubSpot.',
      getSortValue: r => trackerOf(r).toLowerCase() || null,
      getFilterValue: r => trackerOf(r), exportValue: r => trackerOf(r),
      render: r => {
        if (!r.tracker?.length) return blank;
        return (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
            {r.tracker.map(p => (onSelect ? (
              <button key={p.id || p.company} type="button" onClick={() => onSelect(p)} title="Open the company"
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
              >{p.company}</button>
            ) : <span key={p.id || p.company}>{p.company}</span>))}
          </span>
        );
      },
    },
    {
      key: 'hubspot', label: 'HubSpot Company', defaultWidth: 260,
      getSortValue: r => (r.hubspot[0]?.name || '').toLowerCase() || null,
      getFilterValue: hsField('name'), exportValue: hsField('name'),
      render: r => {
        if (!r.hubspot.length) return blank;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>{hsField('name')(r)}</span>
            {r.hubspot.length > 1 && (
              <span title="More than one HubSpot record has this name: likely duplicates to merge in HubSpot"
                style={{ fontSize: '0.62rem', fontWeight: 700, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', padding: '0 5px', borderRadius: 999, whiteSpace: 'nowrap' }}
              >{r.hubspot.length} records</span>
            )}
            {r.how === 'linked' && (
              <button type="button" style={linkBtn} onClick={() => link(r.account.id, null)} title="Linked by you. Unlink to go back to the name match.">Unlink</button>
            )}
          </span>
        );
      },
    },
    {
      key: 'duplicates', label: 'Hubspot Duplicates', defaultWidth: 260,
      headerTitle: 'Other HubSpot companies that are most likely this account entered again under a slightly different name (for example Silver Lake Partners next to Silver Lake). They show here instead of as Only in HubSpot rows. Merge them in HubSpot when you are ready.',
      getSortValue: r => (r.duplicates[0]?.name || '').toLowerCase() || null,
      getFilterValue: dupNames, exportValue: r => r.duplicates.map(c => `${c.name} (${c.id})`).join(', '),
      render: r => {
        if (!r.duplicates.length) return blank;
        return (
          <span title={r.duplicates.map(c => `${c.name} (${c.id})`).join('\n')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>{dupNames(r)}</span>
            {r.duplicates.length > 1 && (
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '0 5px', borderRadius: 999, whiteSpace: 'nowrap' }}
              >{r.duplicates.length} records</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'suggestions', label: 'Possible Match', defaultWidth: 360,
      headerTitle: `For a row with no match: the closest names on the other side that aren't matched yet (an account's HubSpot companies, a HubSpot company's accounts), with how alike the names are. ${SUGGEST_MIN_SCORE}% and up are shown. Map links the two.`,
      getSortValue: r => (r.suggestions[0] ? r.suggestions[0].score : null),
      getFilterValue: r => r.suggestions.map(m => m.name).join(', '),
      exportValue: r => r.suggestions.map(m => `${m.name} (${m.score}%)`).join(', '),
      render: r => (r.suggestions.length ? (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, padding: '2px 0' }}>
          {r.suggestions.map(m => {
            const t = scoreTint(m.score);
            return (
              <span key={`${m.accountId}:${m.hubspotId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.66rem', fontWeight: 700, color: t.ink, background: t.bg, border: `1px solid ${t.border}`, padding: '0 6px', borderRadius: 999, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'center' }}>{m.score}%</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={m.name}>{m.name}</span>
                <button type="button" style={linkBtn} onClick={() => link(m.accountId, m.hubspotId)}
                  title={r.account ? `Map ${r.account.company} to HubSpot's ${m.name} (${m.hubspotId})` : `Map the account ${m.name} to this HubSpot company`}
                >Map</button>
              </span>
            );
          })}
        </span>
      ) : blank),
    },
    { key: 'accountWebsite', label: 'My Website', defaultWidth: 160, getFilterValue: r => accountSite(r), exportValue: r => accountSite(r), render: r => accountSite(r) || blank },
    { key: 'website', label: 'HubSpot Website', defaultWidth: 160, getFilterValue: hsField('domain'), exportValue: hsField('domain'), render: r => hsField('domain')(r) || blank },
    { key: 'how', label: 'Matched By', defaultWidth: 100, getFilterValue: r => HOW[r.how] || '', exportValue: r => HOW[r.how] || '', render: r => HOW[r.how] || blank },
    { key: 'hubspotId', label: 'HubSpot Company ID', defaultWidth: 150, getFilterValue: hsField('id'), exportValue: hsField('id'), render: r => hsField('id')(r) || blank },
    { key: 'owner', label: 'HubSpot Owner', defaultWidth: 130, getFilterValue: hsField('owner'), exportValue: hsField('owner'), render: r => hsField('owner')(r) || blank },
    { key: 'lifecycle', label: 'Lifecycle Stage', defaultWidth: 120, getFilterValue: hsField('lifecycle'), exportValue: hsField('lifecycle'), render: r => hsField('lifecycle')(r) || blank },
    { key: 'targetAccount', label: 'Target Account', defaultWidth: 110, getFilterValue: hsField('targetAccount'), exportValue: hsField('targetAccount'), render: r => hsField('targetAccount')(r) || blank },
    { key: 'lastActivity', label: 'Last Activity', defaultWidth: 130, getFilterValue: hsField('lastActivity'), exportValue: hsField('lastActivity'), render: r => hsField('lastActivity')(r) || blank },
    { key: 'lastContacted', label: 'Last Contacted', defaultWidth: 130, getFilterValue: hsField('lastContacted'), exportValue: hsField('lastContacted'), render: r => hsField('lastContacted')(r) || blank },
    { key: 'nextActivity', label: 'Next Activity', defaultWidth: 130, getFilterValue: hsField('nextActivity'), exportValue: hsField('nextActivity'), render: r => hsField('nextActivity')(r) || blank },
    { key: 'created', label: 'HubSpot Created', defaultWidth: 130, getFilterValue: hsField('created'), exportValue: hsField('created'), render: r => hsField('created')(r) || blank },
  // link closes over data; the table re-renders with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [data, byId, onSelect, cdmName]);

  const chip = (label, value) => {
    const active = statusFilter === value;
    return (
      <button key={label} type="button" onClick={() => setStatusFilter(value)}
        style={{ padding: '0.2rem 0.6rem', borderRadius: 999, border: `1px solid ${active ? '#1D4ED8' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#1D4ED8' : '#475569', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >{label} ({fmt(counts[value])})</button>
    );
  };

  // The share of My Accounts companies (inactive ones aside, as in the
  // chips) that are mapped to a HubSpot company: In both over In both plus
  // Only in My Accounts.
  const mappedCount = counts[MAPPING_STATUS.matched] || 0;
  const accountTotal = mappedCount + (counts[MAPPING_STATUS.accountOnly] || 0);
  const mappedPct = accountTotal ? Math.round((mappedCount / accountTotal) * 100) : null;
  // The rest of those accounts, the ones the click on the banner lists.
  const unmappedRows = useMemo(
    () => mapping.filter(r => r.status === MAPPING_STATUS.accountOnly && !isInactiveRow(r)).map(r => ({ ...r, id: r.key })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapping, byId],
  );

  useEffect(() => {
    if (!showUnmapped) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setShowUnmapped(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showUnmapped]);

  const m = data.meta || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      {mapping.length > 0 && mappedPct != null && (
        <button
          type="button"
          onClick={() => setShowUnmapped(true)}
          title="My Accounts companies (inactive ones left out) that are mapped to a HubSpot company, by website, name or your link. Click to see the ones that aren't."
          style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', padding: '0.5rem 0.9rem', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
        >
          <span style={{ fontSize: '1.5rem', fontWeight: 700, color: mappedPct >= 90 ? '#15803D' : mappedPct >= 70 ? '#B45309' : '#B91C1C', fontVariantNumeric: 'tabular-nums' }}>{mappedPct}%</span>
          <span style={{ fontSize: '0.8rem', color: '#475569' }}>
            of My Accounts companies mapped to a HubSpot company ({fmt(mappedCount)} of {fmt(accountTotal)})
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1D4ED8', marginLeft: 'auto' }}>
            {unmappedRows.length ? `See the ${fmt(unmappedRows.length)} not mapped` : 'All mapped'}
          </span>
        </button>
      )}
      {showUnmapped && createPortal(
        <div onClick={() => setShowUnmapped(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 1100, maxWidth: '100%', height: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>
                  My Accounts companies not mapped to HubSpot ({fmt(unmappedRows.length)})
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748B', lineHeight: 1.45 }}>
                  Active accounts with no HubSpot company matched by website, name or your link. Map links a possible match, and the company drops off this list.
                </div>
              </div>
              <button type="button" onClick={() => setShowUnmapped(false)} title="Close" style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {unmappedRows.length ? (
                <DataTable
                  tableId="my-accounts-hubspot-unmapped"
                  exportFileName="My Accounts Not Mapped to HubSpot"
                  columns={columns}
                  rows={unmappedRows}
                  defaultSort={{ key: 'account', direction: 'asc' }}
                  alwaysVisible={['account']}
                  defaultHidden={['status', 'statusFlag', 'onTable', 'hubspot', 'duplicates', 'website', 'how', 'hubspotId', 'owner', 'lifecycle', 'targetAccount', 'lastActivity', 'lastContacted', 'nextActivity', 'created']}
                  emptyMessage="Nothing matches"
                  settings={settings}
                  updateSettings={updateSettings}
                />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748B', fontSize: '0.85rem' }}>Every active My Accounts company is mapped to a HubSpot company.</div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <label
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0]); }}
        style={{ display: 'block', border: `2px dashed ${dragOver ? '#1D4ED8' : '#CBD5E1'}`, background: dragOver ? '#EFF6FF' : '#F8FAFC', borderRadius: 8, padding: '0.75rem 1rem', cursor: busy ? 'wait' : 'pointer', fontSize: '0.78rem', color: '#475569' }}
      >
        <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} style={{ display: 'none' }}
          onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        <strong style={{ color: '#0F172A' }}>Drop your HubSpot companies export here</strong>, or click to choose it (CSV or Excel).
        {' '}It needs Company name. Add Company Domain Name (or Website URL) to the export and accounts match by website first, then by name; Company ID, Company owner, Lifecycle Stage, Target Account and the activity dates come along when they&apos;re there.
        <div style={{ marginTop: 4, color: '#64748B' }}>
          {busy ? 'Reading the file...'
            : !loaded ? 'Loading...'
            : m.at ? `${fmt(data.companies.length)} HubSpot companies, from ${m.file} (${new Date(m.at).toLocaleString()}). Drop a newer export to replace it.`
            : 'No export yet.'}
        </div>
      </label>
      {error && <div style={{ color: '#B91C1C', fontSize: '0.78rem' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {filterBar}
        {mapping.length > 0 && (
          <>
            {chip('All', '')}
            {chip(MAPPING_STATUS.matched, MAPPING_STATUS.matched)}
            {chip(MAPPING_STATUS.accountOnly, MAPPING_STATUS.accountOnly)}
            {chip(MAPPING_STATUS.hubspotOnly, MAPPING_STATUS.hubspotOnly)}
            {chip(ON_TABLE, ON_TABLE)}
            {chip(MISMATCH, MISMATCH)}
            {chip(INACTIVE, INACTIVE)}
          </>
        )}
      </div>
      {mapping.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId="my-accounts-hubspot-mapping"
            exportFileName="My Accounts Hubspot Mapping"
            columns={columns}
            rows={rows}
            defaultSort={{ key: 'account', direction: 'asc' }}
            alwaysVisible={['status', 'account', 'hubspot']}
            defaultHidden={['lastContacted', 'nextActivity', 'created']}
            emptyMessage="Nothing matches"
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
    </div>
  );
}
