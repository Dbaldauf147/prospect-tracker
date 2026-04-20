import { useMemo, useState } from 'react';

const CLIENT_STATUSES = ['Client', 'Old Client'];

function getServicesCount(p) {
  const svc = p.servicesExplored || {};
  return Object.values(svc).filter(v => v && v !== '-').length;
}

export function ClientsView({ prospects = [], onSelectProspect }) {
  const [showOld, setShowOld] = useState(false);
  const [query, setQuery] = useState('');

  const clients = useMemo(() => (
    prospects
      .filter(p => p.status === 'Client' || (showOld && p.status === 'Old Client'))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, showOld]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => (c.company || '').toLowerCase().includes(q) || (c.cdm || '').toLowerCase().includes(q))
    : clients;

  const activeCount = prospects.filter(p => p.status === 'Client').length;
  const oldCount = prospects.filter(p => p.status === 'Old Client').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Clients</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            Every prospect in My Accounts with <strong>Status = Client</strong>
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
          placeholder="Search by company or CDM…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {activeCount}{showOld ? ` active · ${oldCount} old` : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {clients.length === 0 ? 'No clients found' : `No clients match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {clients.length === 0
                ? <>Set a prospect's <strong>Status</strong> to <code>Client</code> in My Accounts to list it here.</>
                : 'Adjust your search.'}
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Company</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Status</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>CDM</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Type</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Services</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Sites</th>
                  <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>Website</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const svcCount = getServicesCount(c);
                  const isOld = c.status === 'Old Client';
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectProspect?.(c)}
                      style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', background: isOld ? '#F8FAFC' : '#fff' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                      onMouseLeave={e => e.currentTarget.style.background = isOld ? '#F8FAFC' : '#fff'}
                    >
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: '#1E293B' }}>{c.company}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: isOld ? '#F1F5F9' : '#DCFCE7', color: isOld ? '#64748B' : '#166534' }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#475569' }}>{c.cdm || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#475569' }}>{c.type || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: svcCount > 0 ? '#059669' : '#94A3B8', fontWeight: svcCount > 0 ? 600 : 400 }}>{svcCount || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#475569' }}>{c.numberOfSites || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#475569', fontSize: '0.7rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.website || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
