import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { fmtDate } from '../../utils/dealsFormat';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import { loadClientUntrackedMap, CLIENT_UNTRACKED_EVENT } from '../../utils/clientManagerStore';
import { computeIssues } from '../../utils/clientIssues';

// Issues tab — a running list of outstanding items that need to be
// addressed across the app. Each row is one problem surfaced by a
// detector in utils/clientIssues.js. The first mapped issue is a client
// whose soonest active contract has already expired (negative Days Until
// on the Clients tab).
export function IssuesView({ prospects = [], cdmName, settings, updateSettings, onSelectProspect }) {
  // The detectors read the same uploaded deals + client mappings the
  // Clients tab uses, plus the "Don't Track" overrides so opted-out
  // clients never raise an issue. Re-read on the cross-tab events so an
  // upload or toggle elsewhere refreshes this list.
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onUntracked() { setUntrackedMap(loadClientUntrackedMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntracked);
    };
  }, []);

  const issues = useMemo(
    () => computeIssues({ prospects, cdmName, dealsList, clientMap, untrackedMap }),
    [prospects, cdmName, dealsList, clientMap, untrackedMap]
  );

  const prospectById = useMemo(() => {
    const m = new Map();
    for (const p of prospects) m.set(p.id, p);
    return m;
  }, [prospects]);

  const columns = useMemo(() => [
    {
      key: 'source', label: 'Area', defaultWidth: 120,
      getFilterValue: (row) => row.source || '',
      render: (row) => (
        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#EEF2FF', color: '#3730A3' }}>
          {row.source}
        </span>
      ),
    },
    {
      key: 'type', label: 'Issue', defaultWidth: 180,
      getFilterValue: (row) => row.type || '',
      render: (row) => <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.type}</span>,
    },
    {
      key: 'company', label: 'Client', defaultWidth: 240,
      getFilterValue: (row) => row.company || '',
      render: (row) => {
        if (!row.prospectId || !onSelectProspect) {
          return <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.company}</span>;
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const p = prospectById.get(row.prospectId);
              if (p) onSelectProspect(p);
            }}
            title="Open this account"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600, color: '#0A66C2', textAlign: 'left' }}
          >
            {row.company}
          </button>
        );
      },
    },
    {
      key: 'daysUntil', label: 'Days Until', defaultWidth: 110,
      getSortValue: (row) => row.daysUntil == null ? null : row.daysUntil,
      render: (row) => {
        if (row.daysUntil == null) return <span style={{ color: '#94A3B8' }}>—</span>;
        return (
          <span style={{ color: '#B91C1C', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {row.daysUntil}
          </span>
        );
      },
    },
    {
      key: 'expirationDate', label: 'Expiration', defaultWidth: 130,
      getSortValue: (row) => row.expirationDate ? row.expirationDate.getTime() : null,
      render: (row) => (
        <span style={{ color: row.expirationDate ? '#334155' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
          {row.expirationDate ? fmtDate(row.expirationDate) : '—'}
        </span>
      ),
    },
    {
      key: 'detail', label: 'Details', defaultWidth: 420,
      getFilterValue: (row) => row.detail || '',
      render: (row) => <span style={{ color: '#475569' }}>{row.detail}</span>,
    },
  ], [onSelectProspect, prospectById]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Issues</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          Outstanding items that need to be addressed
          {cdmName ? ` for ${cdmName}` : ''}. {issues.length} open issue{issues.length === 1 ? '' : 's'}.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0 0.25rem' }}>
        {issues.length === 0 ? (
          <div style={{ margin: '0.5rem 1.25rem', padding: '1.5rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.35rem' }}>No outstanding issues 🎉</div>
            <div style={{ fontSize: '0.78rem' }}>
              Issues appear here automatically. The first one tracked is a client on the Clients tab whose soonest contract End Date has already passed (a negative <strong>Days Until</strong>).
            </div>
          </div>
        ) : (
          <DataTable
            tableId="issues"
            columns={columns}
            rows={issues}
            defaultSort={{ key: 'daysUntil', direction: 'asc' }}
            emptyMessage="No issues to display"
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
    </div>
  );
}
