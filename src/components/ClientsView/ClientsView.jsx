import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';

function getServicesCount(p) {
  const svc = p.servicesExplored || {};
  return Object.values(svc).filter(v => v && v !== '-').length;
}

function isBaldauf(cdm) {
  return (cdm || '').toLowerCase().includes('baldauf');
}

export function ClientsView({ prospects = [], onSelectProspect }) {
  const [showOld, setShowOld] = useState(false);
  const [query, setQuery] = useState('');

  // Only Dan Baldauf's clients. Additionally filter to active Client by
  // default, or include Old Client too when the toggle is on.
  const clients = useMemo(() => (
    prospects
      .filter(p => isBaldauf(p.cdm))
      .filter(p => p.status === 'Client' || (showOld && p.status === 'Old Client'))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, showOld]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => (
        (c.company || '').toLowerCase().includes(q) ||
        (c.cdm || '').toLowerCase().includes(q) ||
        (c.type || '').toLowerCase().includes(q) ||
        (c.website || '').toLowerCase().includes(q)
      ))
    : clients;

  const baldaufProspects = useMemo(() => prospects.filter(p => isBaldauf(p.cdm)), [prospects]);
  const activeCount = baldaufProspects.filter(p => p.status === 'Client').length;
  const oldCount = baldaufProspects.filter(p => p.status === 'Old Client').length;

  // Diagnostic counts for the empty state.
  const totalProspects = prospects.length;
  const allClients = useMemo(() => prospects.filter(p => p.status === 'Client').length, [prospects]);
  const uniqueCdms = useMemo(() => {
    const s = new Set();
    for (const p of prospects) {
      const v = (p.cdm || '').trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [prospects]);

  const rows = useMemo(() => filtered.map(c => ({
    ...c,
    id: c.id,
    services: getServicesCount(c),
  })), [filtered]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 240, sticky: true,
      render: (row) => <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.company || '—'}</span>,
    },
    {
      key: 'status', label: 'Status', defaultWidth: 120,
      render: (row) => {
        const isOld = row.status === 'Old Client';
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: isOld ? '#F1F5F9' : '#DCFCE7', color: isOld ? '#64748B' : '#166534' }}>
            {row.status || '—'}
          </span>
        );
      },
    },
    { key: 'cdm', label: 'CDM', defaultWidth: 160 },
    { key: 'type', label: 'Type', defaultWidth: 140 },
    {
      key: 'services', label: 'Services', defaultWidth: 100,
      render: (row) => (
        <span style={{ display: 'block', textAlign: 'right', color: row.services > 0 ? '#059669' : '#94A3B8', fontWeight: row.services > 0 ? 600 : 400 }}>
          {row.services || '—'}
        </span>
      ),
    },
    {
      key: 'numberOfSites', label: 'Sites', defaultWidth: 90,
      render: (row) => (
        <span style={{ display: 'block', textAlign: 'right', color: '#475569' }}>{row.numberOfSites || '—'}</span>
      ),
    },
    {
      key: 'website', label: 'Website', defaultWidth: 240,
      render: (row) => {
        if (!row.website) return '—';
        return (
          <a
            href={/^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: '#0A66C2', textDecoration: 'none', fontSize: '0.72rem' }}
          >
            {row.website}
          </a>
        );
      },
    },
  ], []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Clients</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            Dan Baldauf&apos;s clients — every prospect with CDM = Baldauf and <strong>Status = Client</strong>
            {showOld ? ' or Old Client' : ''}. Click a row to open the company popup.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} />
          <span>Include Old Clients ({oldCount})</span>
        </label>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by company, CDM, type, website…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {activeCount}{showOld ? ` active · ${oldCount} old` : ''}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {clients.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', textAlign: 'center' }}>No Baldauf clients found</div>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', textAlign: 'center' }}>
              Set a prospect&apos;s <strong>CDM</strong> to Baldauf and <strong>Status</strong> to <code>Client</code> in My Accounts to list it here.
            </div>
            <div style={{ fontSize: '0.72rem', background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: 6, color: '#334155' }}>
              <div><strong>Diagnostic:</strong></div>
              <div>Total prospects loaded: {totalProspects}</div>
              <div>Prospects with CDM containing &quot;baldauf&quot;: {baldaufProspects.length}</div>
              <div>Prospects with Status = Client: {allClients}</div>
              <div>Baldauf + Client: {activeCount}</div>
              {totalProspects === 0 && (
                <div style={{ color: '#B91C1C', marginTop: '0.5rem' }}>
                  Prospects haven&apos;t loaded yet. If this sticks, check your network / login.
                </div>
              )}
              {totalProspects > 0 && baldaufProspects.length === 0 && uniqueCdms.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div>No CDM value contains &quot;baldauf&quot;. Unique CDMs in your data:</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', marginTop: '0.25rem', maxHeight: '120px', overflow: 'auto', background: '#fff', padding: '0.4rem', borderRadius: 4 }}>
                    {uniqueCdms.slice(0, 40).map((c, i) => <div key={i}>{c}</div>)}
                    {uniqueCdms.length > 40 && <div>… and {uniqueCdms.length - 40} more</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <DataTable
            tableId="clients"
            columns={columns}
            rows={rows}
            alwaysVisible={['company']}
            onRowClick={(row) => onSelectProspect?.(row)}
            emptyMessage={q ? `No clients match "${query}"` : 'No clients to display'}
          />
        )}
      </div>
    </div>
  );
}
