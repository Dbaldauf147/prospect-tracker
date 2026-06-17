import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { fmtDate } from '../../utils/dealsFormat';
import { setIssueSnoozed } from '../../utils/issueSnoozeStore';
import { loadClientManagerMap, CLIENT_MANAGER_EVENT } from '../../utils/clientManagerStore';
import { normClientName } from '../../utils/clientIssues';
import { useIssues } from '../../hooks/useIssues';

// Issues tab — a running list of outstanding items that need to be
// addressed across the app. Each row is one problem surfaced by a
// detector in utils/clientIssues.js. The first mapped issue is a client
// whose soonest active contract has already expired (negative Days Until
// on the Clients tab).
//
// Each row can be snoozed: a snoozed issue stays on this tab (greyed out,
// so it can be un-snoozed) but drops out of the open-issue count on the
// sidebar badge.
export function IssuesView({ prospects = [], cdmName, settings, updateSettings, onSelectProspect }) {
  // useIssues handles loading the source data + listening for cross-tab
  // refreshes, and tags each row with a `snoozed` flag.
  const { issues, openCount } = useIssues({ prospects, cdmName });

  // Client Manager is owned by the Clients tab; mirror it here (read-only)
  // and re-read when it changes there so the column stays in sync.
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  useEffect(() => {
    function onStorage(e) { if (e.key === 'clients-manager-map') setManagerMap(loadClientManagerMap()); }
    function onManager() { setManagerMap(loadClientManagerMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManager);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManager);
    };
  }, []);

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
      key: 'clientManager', label: 'Client Manager', defaultWidth: 180,
      getFilterValue: (row) => managerMap[normClientName(row.company)] || '',
      getSortValue: (row) => (managerMap[normClientName(row.company)] || '').toLowerCase(),
      render: (row) => {
        const name = managerMap[normClientName(row.company)] || '';
        return name
          ? <span style={{ color: '#334155' }}>{name}</span>
          : <span style={{ color: '#94A3B8' }}>—</span>;
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
    {
      key: 'snooze', label: 'Snooze', defaultWidth: 110,
      getFilterValue: (row) => (row.snoozed ? 'Snoozed' : 'Active'),
      getSortValue: (row) => (row.snoozed ? 1 : 0),
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIssueSnoozed(row.id, !row.snoozed);
          }}
          title={row.snoozed ? 'Snoozed — not counted on the menu. Click to un-snooze.' : 'Snooze this issue so it stops counting on the menu'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 10px', borderRadius: 999, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
            border: row.snoozed ? '1px solid #CBD5E1' : '1px solid #FCA5A5',
            background: row.snoozed ? '#F1F5F9' : '#FEF2F2',
            color: row.snoozed ? '#475569' : '#B91C1C',
          }}
        >
          {row.snoozed ? '🔕 Snoozed' : '🔔 Snooze'}
        </button>
      ),
    },
  ], [onSelectProspect, prospectById, managerMap]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Issues</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          Outstanding items that need to be addressed
          {cdmName ? ` for ${cdmName}` : ''}. {openCount} open issue{openCount === 1 ? '' : 's'}
          {issues.length - openCount > 0 ? `, ${issues.length - openCount} snoozed` : ''}.
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
            rowStyle={(row) => (row.snoozed ? { opacity: 0.5 } : undefined)}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
    </div>
  );
}
