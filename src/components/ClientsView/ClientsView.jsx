import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { matchesCdm } from '../../utils/cdmMatch';
import { DealsView } from '../DealsView/DealsView';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import { loadClientManagerMap, setClientManager, CLIENT_MANAGER_EVENT } from '../../utils/clientManagerStore';
import {
  asDate, fmtCurrency, fmtPercent, fmtDate, isTruthy,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';

// The Paperwork column doubles as a status field in this dataset —
// values like "Cancelled" and "Expired" mark agreements that no
// longer count, regardless of their End Date.
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'expired']);
function isInactiveAgreement(deal) {
  const status = String(deal?.['Paperwork completed'] || '').trim().toLowerCase();
  return INACTIVE_STATUSES.has(status);
}

// Earliest upcoming contract End Date across the client's deals, plus
// integer days from today. Past end dates and Cancelled / Expired
// agreements are ignored — the column answers "what expires next?",
// so a deal already off the books shouldn't pull focus.
const MS_PER_DAY = 86400000;
function soonestExpiration(deals) {
  if (!deals || deals.length === 0) return { date: null, days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  let bestMs = null;
  for (const d of deals) {
    if (isInactiveAgreement(d)) continue;
    const parsed = asDate(d['End Date']);
    if (!parsed) continue;
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    const ms = dayStart.getTime();
    if (ms < todayMs) continue;
    if (bestMs == null || ms < bestMs) bestMs = ms;
  }
  if (bestMs == null) return { date: null, days: null };
  return { date: new Date(bestMs), days: Math.round((bestMs - todayMs) / MS_PER_DAY) };
}

// Column layout for the per-client contract drill-down. Each entry's
// `key` is the canonical field name stored on the deal row; `label` is
// the heading shown on the Clients tab. Several labels are shorter
// aliases of the Deals-subtab headers — the upload normalizer in
// DealsView already folds them onto the same key.
const CONTRACT_COLUMNS = [
  { key: 'Agreement Name',          label: 'Agreement Name', minWidth: 260 },
  { key: 'Paperwork completed',     label: 'Paperwork' },
  { key: 'Current Term Start Date', label: 'Current Term Start Date' },
  { key: 'Payment Terms',           label: 'Payment Terms' },
  { key: 'End Date',                label: 'End Date' },
  { key: 'Auto renewal?',           label: 'Auto renewal?' },
  { key: 'Esc',                     label: 'Esc', minWidth: 140 },
];

function normClientName(s) {
  return String(s || '').trim().toLowerCase();
}

// Inline editor for the Client Manager column. Local draft so typing
// stays snappy; commits on blur or Enter, reverts on Escape. The
// container swallows click + keydown so editing doesn't trigger the
// row-open popup or table-level shortcuts.
function ClientManagerCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    const next = draft.trim();
    if (next === (value || '').trim()) return;
    onCommit(company, next);
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
      }}
    />
  );
}

function renderContractCell(key, value) {
  if (value == null || value === '') return <span style={{ color: '#94A3B8' }}>—</span>;
  if (DEAL_CHECK_KEYS.has(key)) {
    const yes = isTruthy(value);
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: yes ? '#DCFCE7' : '#F1F5F9', color: yes ? '#166534' : '#64748B' }}>
        {yes ? 'Yes' : (typeof value === 'string' && value.trim() ? value : 'No')}
      </span>
    );
  }
  if (DEAL_CURRENCY_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(value)}</span>;
  if (DEAL_PERCENT_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(value)}</span>;
  if (DEAL_DATE_KEYS.has(key)) return <span style={{ color: '#334155' }}>{fmtDate(value)}</span>;
  return <span style={{ color: '#1E293B' }}>{String(value)}</span>;
}

function ContractTable({ deals }) {
  if (!deals || deals.length === 0) {
    return (
      <div style={{ padding: '0.75rem 1.25rem', color: '#64748B', fontSize: '0.75rem', fontStyle: 'italic' }}>
        No contracts found for this client. Upload contract data on the Deals subtab — the Client Name column must match this client.
      </div>
    );
  }
  // Cancelled / Expired agreements sink to the bottom — they're still
  // worth seeing as history but shouldn't crowd the active rows.
  const sorted = [...deals].sort((a, b) => {
    const ai = isInactiveAgreement(a) ? 1 : 0;
    const bi = isInactiveAgreement(b) ? 1 : 0;
    return ai - bi;
  });
  return (
    <div style={{ overflowX: 'auto', padding: '0.5rem 0.75rem 0.75rem' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: 'max-content', minWidth: '100%' }}>
        <thead>
          <tr style={{ background: '#F1F5F9' }}>
            {CONTRACT_COLUMNS.map(col => (
              <th key={col.key} style={{ padding: '0.35rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, fontSize: '0.65rem', whiteSpace: 'nowrap', borderBottom: '1px solid #CBD5E1', minWidth: col.minWidth }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => {
            const inactive = isInactiveAgreement(d);
            const baseBg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
            return (
            <tr key={i} style={{ background: inactive ? '#F1F5F9' : baseBg, color: inactive ? '#94A3B8' : undefined, opacity: inactive ? 0.7 : 1 }}>
              {CONTRACT_COLUMNS.map(col => (
                <td key={col.key} style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0', minWidth: col.minWidth }}>
                  {renderContractCell(col.key, d[col.key])}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SUBTAB_STORAGE_KEY = 'clients-view:active-subtab';
function readSavedSubtab() {
  try {
    const s = localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (s === 'clients' || s === 'deals') return s;
  } catch {}
  return 'clients';
}

function getServicesCount(p) {
  const svc = p.servicesExplored || {};
  return Object.values(svc).filter(v => v && v !== '-').length;
}

// Loose status check — tolerate trailing whitespace and casing drift in the data.
function normStatus(s) {
  return String(s || '').trim().toLowerCase();
}
function isClient(p) { return normStatus(p.status) === 'client'; }
function isOldClient(p) { return normStatus(p.status) === 'old client'; }

export function ClientsView({ prospects = [], cdmName, settings, updateSettings }) {
  const [subtab, setSubtab] = useState(readSavedSubtab);
  function selectSubtab(key) {
    setSubtab(key);
    try { localStorage.setItem(SUBTAB_STORAGE_KEY, key); } catch {}
  }
  const [showOld, setShowOld] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Load uploaded deals so each client row can drill down into its
  // own contracts. Re-read on the cross-tab storage event so an
  // upload from the Deals subtab in another window shows up here.
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-manager-map') setManagerMap(loadClientManagerMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onManagerMap() { setManagerMap(loadClientManagerMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
    };
  }, []);
  // Refresh deals + client map whenever we switch back to the Clients
  // subtab — same-window upload / mapping changes on the Deals subtab
  // don't fire storage.
  useEffect(() => {
    if (subtab === 'clients') {
      setDealsList(loadDealsList().data);
      setClientMap(loadDealClientMap());
      setManagerMap(loadClientManagerMap());
    }
  }, [subtab]);

  // Group deals by client. A row's raw Client Name is preferred, but
  // when the user has explicitly mapped that source name to a different
  // client via the helper column on the Deals subtab, we group it
  // under the mapped name instead.
  const dealsByClient = useMemo(() => {
    const map = new Map();
    for (const d of dealsList) {
      const raw = normClientName(d['Client Name']);
      if (!raw) continue;
      const mapped = clientMap[raw];
      const k = mapped ? normClientName(mapped) : raw;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(d);
    }
    return map;
  }, [dealsList, clientMap]);

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Only the configured user's clients. Additionally filter to active
  // Client by default, or include Old Client too when the toggle is on.
  const clients = useMemo(() => (
    prospects
      .filter(p => matchesCdm(p.cdm, cdmName))
      .filter(p => isClient(p) || (showOld && isOldClient(p)))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, showOld, cdmName]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => (
        (c.company || '').toLowerCase().includes(q) ||
        (c.cdm || '').toLowerCase().includes(q) ||
        (c.type || '').toLowerCase().includes(q) ||
        (c.website || '').toLowerCase().includes(q) ||
        (managerMap[normClientName(c.company)] || '').toLowerCase().includes(q)
      ))
    : clients;

  const myProspects = useMemo(() => prospects.filter(p => matchesCdm(p.cdm, cdmName)), [prospects, cdmName]);
  const activeCount = myProspects.filter(isClient).length;
  const oldCount = myProspects.filter(isOldClient).length;

  // Diagnostic counts for the empty state.
  const totalProspects = prospects.length;
  const allClients = useMemo(() => prospects.filter(isClient).length, [prospects]);
  const uniqueCdms = useMemo(() => {
    const s = new Set();
    for (const p of prospects) {
      const v = (p.cdm || '').trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [prospects]);

  const rows = useMemo(() => filtered.map(c => {
    const clientDeals = dealsByClient.get(normClientName(c.company)) || [];
    const next = soonestExpiration(clientDeals);
    return {
      ...c,
      id: c.id,
      services: getServicesCount(c),
      contractCount: clientDeals.length,
      soonestExpiration: next.date,
      daysUntilExpiration: next.days,
      clientManager: managerMap[normClientName(c.company)] || '',
    };
  }), [filtered, dealsByClient, managerMap]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 260, sticky: true,
      render: (row) => {
        const isOpen = expandedIds.has(row.id);
        const count = row.contractCount;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}
              title={count > 0 ? `${isOpen ? 'Hide' : 'Show'} ${count} contract${count === 1 ? '' : 's'}` : 'No contracts uploaded for this client'}
              style={{
                width: 18, height: 18, padding: 0, border: '1px solid #CBD5E1', borderRadius: 4,
                background: isOpen ? '#1E293B' : '#FFFFFF', color: isOpen ? '#FFFFFF' : '#475569',
                fontSize: '0.65rem', lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{isOpen ? '▾' : '▸'}</button>
            <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.company || '—'}</span>
            {count > 0 && (
              <span title={`${count} contract${count === 1 ? '' : 's'} on file`} style={{ display: 'inline-block', padding: '0 6px', borderRadius: 999, fontSize: '0.6rem', fontWeight: 700, background: '#E0E7FF', color: '#3730A3' }}>
                {count}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'status', label: 'Status', defaultWidth: 120,
      render: (row) => {
        const isOld = isOldClient(row);
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: isOld ? '#F1F5F9' : '#DCFCE7', color: isOld ? '#64748B' : '#166534' }}>
            {row.status || '—'}
          </span>
        );
      },
    },
    { key: 'cdm', label: 'CDM', defaultWidth: 160 },
    {
      key: 'clientManager', label: 'Client Manager', defaultWidth: 180,
      getSortValue: (row) => (row.clientManager || '').toLowerCase(),
      render: (row) => (
        <ClientManagerCell
          company={row.company}
          value={row.clientManager}
          onCommit={setClientManager}
        />
      ),
    },
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
      key: 'soonestExpiration', label: 'Soonest Expiration', defaultWidth: 150,
      getSortValue: (row) => row.soonestExpiration ? row.soonestExpiration.getTime() : null,
      render: (row) => (
        <span style={{ color: row.soonestExpiration ? '#334155' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
          {row.soonestExpiration ? fmtDate(row.soonestExpiration) : '—'}
        </span>
      ),
    },
    {
      key: 'daysUntilExpiration', label: 'Days Until', defaultWidth: 110,
      getSortValue: (row) => row.daysUntilExpiration == null ? null : row.daysUntilExpiration,
      render: (row) => {
        if (row.daysUntilExpiration == null) return <span style={{ color: '#94A3B8' }}>—</span>;
        const d = row.daysUntilExpiration;
        // Highlight contracts that are inside the typical 90-day renewal window
        // so they pop without the user having to sort the column manually.
        const color = d <= 30 ? '#B91C1C' : d <= 90 ? '#B45309' : '#475569';
        return (
          <span style={{ display: 'block', textAlign: 'right', color, fontWeight: d <= 90 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
            {d}
          </span>
        );
      },
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
  ], [expandedIds]);

  const subtabBar = (
    <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 1.25rem 0', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
      {[
        { key: 'clients', label: 'Clients' },
        { key: 'deals', label: 'Deals' },
      ].map(t => {
        const active = subtab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => selectSubtab(t.key)}
            style={{
              padding: '0.45rem 0.85rem',
              border: '1px solid',
              borderColor: active ? '#CBD5E1' : 'transparent',
              borderBottomColor: active ? '#fff' : 'transparent',
              borderRadius: '6px 6px 0 0',
              marginBottom: -1,
              background: active ? '#fff' : 'transparent',
              color: active ? '#1E293B' : '#64748B',
              fontSize: '0.78rem',
              fontWeight: active ? 700 : 600,
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >{t.label}</button>
        );
      })}
    </div>
  );

  if (subtab === 'deals') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <DealsView settings={settings} updateSettings={updateSettings} prospects={prospects} cdmName={cdmName} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {subtabBar}
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Clients</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {cdmName ? `${cdmName}'s clients` : 'Your clients'} — every prospect with CDM = {cdmName || 'your CDM'} and <strong>Status = Client</strong>
            {showOld ? ' or Old Client' : ''}. Click ▸ to expand a client&apos;s contracts.
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
          placeholder="Filter by company, CDM, Client Manager, type, website…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {activeCount}{showOld ? ` active · ${oldCount} old` : ''}
        </span>
      </div>

      {/* Always-visible diagnostic strip so 'blank page' is never actually blank. */}
      <div style={{ padding: '0 1.25rem 0.5rem', fontSize: '0.68rem', color: '#64748B', flexShrink: 0 }}>
        Loaded {totalProspects} prospects · {myProspects.length} match CDM &quot;{cdmName || '(unset)'}&quot; · {allClients} are Status=Client · showing {clients.length}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {clients.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', textAlign: 'center' }}>No clients found for {cdmName || 'this user'}</div>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', textAlign: 'center' }}>
              Set a prospect&apos;s <strong>CDM</strong> to {cdmName || 'your CDM name'} and <strong>Status</strong> to <code>Client</code> in My Accounts to list it here.
            </div>
            <div style={{ fontSize: '0.72rem', background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: 6, color: '#334155' }}>
              <div><strong>Diagnostic:</strong></div>
              <div>Total prospects loaded: {totalProspects}</div>
              <div>Prospects matching CDM &quot;{cdmName || '(unset)'}&quot;: {myProspects.length}</div>
              <div>Prospects with Status = Client: {allClients}</div>
              <div>{cdmName || 'Your CDM'} + Client: {activeCount}</div>
              {totalProspects === 0 && (
                <div style={{ color: '#B91C1C', marginTop: '0.5rem' }}>
                  Prospects haven&apos;t loaded yet. If this sticks, check your network / login.
                </div>
              )}
              {totalProspects > 0 && myProspects.length === 0 && uniqueCdms.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div>No CDM value matches &quot;{cdmName || '(unset)'}&quot;. Unique CDMs in your data:</div>
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
            expandedRowIds={expandedIds}
            renderExpansion={(row) => (
              <ContractTable deals={dealsByClient.get(normClientName(row.company)) || []} />
            )}
            emptyMessage={q ? `No clients match "${query}"` : 'No clients to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
    </div>
  );
}
