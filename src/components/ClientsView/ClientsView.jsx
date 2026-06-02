import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { matchesCdm } from '../../utils/cdmMatch';
import { DealsView } from '../DealsView/DealsView';
import { CommissionsView } from './CommissionsView';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import {
  loadClientManagerMap, setClientManager, CLIENT_MANAGER_EVENT,
  loadClientInPersonMap, setClientInPerson, CLIENT_IN_PERSON_EVENT,
  loadClientStatusMap, setClientStatus, CLIENT_STATUS_EVENT,
  loadClientNotesMap, setClientNotes, CLIENT_NOTES_EVENT,
  loadClientUntrackedMap, setClientUntracked, CLIENT_UNTRACKED_EVENT,
} from '../../utils/clientManagerStore';
import {
  asDate, fmtCurrency, fmtPercent, fmtDate, isTruthy,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import {
  buildListRegistry, buildAvailableLists, resolveColumnLink,
  SelectCell, MultiSelectCell, LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';

// The Paperwork column doubles as a status field in this dataset —
// values like "Cancelled" and "Expired" mark agreements that no
// longer count, regardless of their End Date.
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'expired']);
function isInactiveAgreement(deal) {
  const status = String(deal?.['Paperwork completed'] || '').trim().toLowerCase();
  return INACTIVE_STATUSES.has(status);
}

// Earliest contract End Date across the client's active deals, plus
// integer days from today (negative when the date is already past).
// Cancelled / Expired agreements are skipped; everything else counts
// regardless of whether the date is in the future — a Fully Executed
// row with a date that already slipped past is exactly the kind of
// thing this column needs to surface.
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
  { key: 'Agreement Name',          label: 'Agreement Name', minWidth: 420 },
  { key: 'Paperwork completed',     label: 'Paperwork', minWidth: 220 },
  { key: 'Current Term Start Date', label: 'Current Term Start Date' },
  { key: 'Payment Terms',           label: 'Payment Terms' },
  { key: 'End Date',                label: 'End Date', minWidth: 130 },
  { key: '__daysToEnd',             label: 'Days to End Date', minWidth: 130 },
  { key: 'Auto renewal?',           label: 'Auto renewal?' },
  { key: 'Esc',                     label: 'Esc', minWidth: 140 },
];

// Whole-day delta between a contract End Date and today, rendered as
// a colored cell. Negative means the date has already passed; rows
// inside 30 days run amber so renewals are easy to spot. Cancelled /
// expired rows render in grey to match the rest of the inactive row.
function renderDaysToEnd(endRaw, inactive) {
  const d = asDate(endRaw);
  if (!d) return <span style={{ color: '#94A3B8' }}>—</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  const color = inactive
    ? '#94A3B8'
    : days < 0 ? '#B91C1C'
    : days <= 30 ? '#92400E'
    : '#334155';
  const label = days === 0
    ? 'Today'
    : days > 0 ? `${days}d`
    : `${Math.abs(days)}d ago`;
  return <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{label}</span>;
}

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

// Free-text Status editor used when no Dropdowns list is bound to
// the column. When a list IS bound, ClientsView uses the shared
// SelectCell from columnLinks instead.
function ClientStatusTextCell({ company, value, onCommit }) {
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

// Multi-line free-form notes cell. Uses a textarea so the user can
// hit Enter for a new line; commits on blur. The cell grows up to a
// max height and scrolls — keeps long notes from blowing out the row.
function NotesCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    if (draft === (value || '')) return;
    onCommit(company, draft);
  }
  return (
    <textarea
      value={draft}
      placeholder="—"
      rows={focused ? 3 : 1}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
        resize: 'vertical', minHeight: 24, maxHeight: 160,
        whiteSpace: 'pre-wrap',
      }}
    />
  );
}

// Per-client In Person Meeting flag. Centered checkbox; the table
// row already has no onRowClick so a click on the box only toggles
// the flag, but stop propagation anyway to be safe.
function InPersonCell({ company, checked, onChange }) {
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(company, e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
    </label>
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
  // worth seeing as history but shouldn't crowd the active rows. Inside
  // each group sort by End Date ascending so the soonest-expiring
  // contracts surface first; rows with no End Date drop to the bottom
  // of their group.
  const sorted = [...deals].sort((a, b) => {
    const ai = isInactiveAgreement(a) ? 1 : 0;
    const bi = isInactiveAgreement(b) ? 1 : 0;
    if (ai !== bi) return ai - bi;
    const aDate = asDate(a['End Date']);
    const bDate = asDate(b['End Date']);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.getTime() - bDate.getTime();
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
                  {col.key === '__daysToEnd'
                    ? renderDaysToEnd(d['End Date'], inactive)
                    : renderContractCell(col.key, d[col.key])}
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
    if (s === 'clients' || s === 'oldclients' || s === 'deals' || s === 'commissions') return s;
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

export function ClientsView({ prospects = [], cdmName, settings, updateSettings, user }) {
  const [subtab, setSubtab] = useState(readSavedSubtab);
  function selectSubtab(key) {
    setSubtab(key);
    try { localStorage.setItem(SUBTAB_STORAGE_KEY, key); } catch {}
  }

  // The Clients and Old Clients subtabs share this view; the only real
  // difference is which Status the primary list filters on. The secondary
  // "Include …" toggle pulls in the other bucket. Labels and the table id
  // (so column widths persist independently) follow the active subtab.
  const isOldMode = subtab === 'oldclients';
  const primaryMatch = isOldMode ? isOldClient : isClient;
  const secondaryMatch = isOldMode ? isClient : isOldClient;
  const statusLabel = isOldMode ? 'Old Client' : 'Client';
  const otherLabel = isOldMode ? 'Client' : 'Old Client';
  const headingLabel = isOldMode ? 'Old Clients' : 'Clients';
  const tableId = isOldMode ? 'oldclients' : 'clients';

  const [showOld, setShowOld] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Load uploaded deals so each client row can drill down into its
  // own contracts. Re-read on the cross-tab storage event so an
  // upload from the Deals subtab in another window shows up here.
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  const [inPersonMap, setInPersonMap] = useState(() => loadClientInPersonMap());
  const [statusMap, setStatusMap] = useState(() => loadClientStatusMap());
  const [notesMap, setNotesMap] = useState(() => loadClientNotesMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-manager-map') setManagerMap(loadClientManagerMap());
      if (e.key === 'clients-inperson-map') setInPersonMap(loadClientInPersonMap());
      if (e.key === 'clients-status-map') setStatusMap(loadClientStatusMap());
      if (e.key === 'clients-notes-map') setNotesMap(loadClientNotesMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onManagerMap() { setManagerMap(loadClientManagerMap()); }
    function onInPersonMap() { setInPersonMap(loadClientInPersonMap()); }
    function onStatusMap() { setStatusMap(loadClientStatusMap()); }
    function onNotesMap() { setNotesMap(loadClientNotesMap()); }
    function onUntrackedMap() { setUntrackedMap(loadClientUntrackedMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
    window.addEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatusMap);
    window.addEventListener(CLIENT_NOTES_EVENT, onNotesMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
      window.removeEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatusMap);
      window.removeEventListener(CLIENT_NOTES_EVENT, onNotesMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
    };
  }, []);
  // Refresh deals + client map whenever we switch back to the Clients
  // subtab — same-window upload / mapping changes on the Deals subtab
  // don't fire storage.
  useEffect(() => {
    if (subtab === 'clients' || subtab === 'oldclients') {
      setDealsList(loadDealsList().data);
      setClientMap(loadDealClientMap());
      setManagerMap(loadClientManagerMap());
      setInPersonMap(loadClientInPersonMap());
      setStatusMap(loadClientStatusMap());
      setNotesMap(loadClientNotesMap());
      setUntrackedMap(loadClientUntrackedMap());
    }
  }, [subtab]);

  // User-configurable column-to-Dropdowns-list bindings, mirroring the
  // Deals / Opps 2 "Link columns" feature. Lets the Status column on
  // this table pull picks from a Dropdowns-tab list.
  const columnLinks = settings?.clientsColumnLinks || {};
  const updateColumnLinks = (next) => {
    updateSettings?.({ clientsColumnLinks: next || {} });
  };
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    [settings?.dropdownLists]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);
  const [linkModalOpen, setLinkModalOpen] = useState(false);

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

  // Only the configured user's clients. Filter to the tab's primary
  // Status by default, or include the other bucket when the toggle is on.
  const clients = useMemo(() => (
    prospects
      .filter(p => matchesCdm(p.cdm, cdmName))
      .filter(p => primaryMatch(p) || (showOld && secondaryMatch(p)))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, showOld, cdmName, primaryMatch, secondaryMatch]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => {
        const ck = normClientName(c.company);
        return (
          (c.company || '').toLowerCase().includes(q) ||
          (c.cdm || '').toLowerCase().includes(q) ||
          (c.type || '').toLowerCase().includes(q) ||
          (c.website || '').toLowerCase().includes(q) ||
          (managerMap[ck] || '').toLowerCase().includes(q) ||
          (statusMap[ck] || '').toLowerCase().includes(q)
        );
      })
    : clients;

  const myProspects = useMemo(() => prospects.filter(p => matchesCdm(p.cdm, cdmName)), [prospects, cdmName]);
  const activeCount = myProspects.filter(primaryMatch).length; // primary bucket for this tab
  const oldCount = myProspects.filter(secondaryMatch).length;  // the "Include …" bucket

  // Diagnostic counts for the empty state.
  const totalProspects = prospects.length;
  const allClients = useMemo(() => prospects.filter(primaryMatch).length, [prospects, primaryMatch]);
  const uniqueCdms = useMemo(() => {
    const s = new Set();
    for (const p of prospects) {
      const v = (p.cdm || '').trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [prospects]);

  const rows = useMemo(() => filtered.map(c => {
    const ck = normClientName(c.company);
    const clientDeals = dealsByClient.get(ck) || [];
    const next = soonestExpiration(clientDeals);
    const untracked = !!untrackedMap[ck];
    return {
      ...c,
      id: c.id,
      services: getServicesCount(c),
      contractCount: clientDeals.length,
      soonestExpiration: next.date,
      // Untracked rows blank Days Until so they fall through the
      // default ascending sort (nulls go last) and don't compete with
      // active accounts for attention.
      daysUntilExpiration: untracked ? null : next.days,
      clientManager: managerMap[ck] || '',
      inPersonMeeting: !!inPersonMap[ck],
      Status: statusMap[ck] || '',
      notes: notesMap[ck] || '',
      untracked,
    };
  }), [filtered, dealsByClient, managerMap, inPersonMap, statusMap, notesMap, untrackedMap]);

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
          </span>
        );
      },
    },
    {
      key: 'status', label: 'Account Status', defaultWidth: 130,
      render: (row) => {
        const isOld = isOldClient(row);
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: isOld ? '#F1F5F9' : '#DCFCE7', color: isOld ? '#64748B' : '#166534' }}>
            {row.status || '—'}
          </span>
        );
      },
    },
    {
      key: 'Status', label: 'Status', defaultWidth: 160,
      getSortValue: (row) => (row.Status || '').toLowerCase(),
      getFilterValue: (row) => row.Status || '',
      render: (row) => {
        const link = resolveColumnLink('Status', columnLinks);
        if (link) {
          const opts = listRegistry?.get(link.listKey)?.options || [];
          const onChange = (v) => setClientStatus(row.company, v);
          if (link.mode === 'multi') {
            return <MultiSelectCell value={row.Status} onChange={onChange} options={opts} />;
          }
          return <SelectCell value={row.Status} onChange={onChange} options={opts} />;
        }
        return (
          <ClientStatusTextCell
            company={row.company}
            value={row.Status}
            onCommit={setClientStatus}
          />
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
    {
      key: 'inPersonMeeting', label: 'In Person Meeting', defaultWidth: 150,
      getSortValue: (row) => row.inPersonMeeting ? 1 : 0,
      getFilterValue: (row) => row.inPersonMeeting ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.inPersonMeeting}
          onChange={setClientInPerson}
        />
      ),
    },
    {
      key: 'untracked', label: "Don't Track", defaultWidth: 110,
      getSortValue: (row) => row.untracked ? 1 : 0,
      getFilterValue: (row) => row.untracked ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.untracked}
          onChange={setClientUntracked}
        />
      ),
    },
    { key: 'type', label: 'Type', defaultWidth: 140 },
    {
      key: 'services', label: 'Services', defaultWidth: 100,
      render: (row) => (
        <span style={{ color: row.services > 0 ? '#059669' : '#94A3B8', fontWeight: row.services > 0 ? 600 : 400 }}>
          {row.services || '—'}
        </span>
      ),
    },
    {
      key: 'numberOfSites', label: 'Sites', defaultWidth: 90,
      render: (row) => (
        <span style={{ color: '#475569' }}>{row.numberOfSites || '—'}</span>
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
          <span style={{ color, fontWeight: d <= 90 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
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
    {
      key: 'notes', label: 'Notes', defaultWidth: 320,
      getSortValue: (row) => (row.notes || '').toLowerCase(),
      getFilterValue: (row) => row.notes || '',
      render: (row) => (
        <NotesCell
          company={row.company}
          value={row.notes}
          onCommit={setClientNotes}
        />
      ),
    },
  ], [expandedIds, columnLinks, listRegistry]);

  const subtabBar = (
    <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 1.25rem 0', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
      {[
        { key: 'clients', label: 'Clients' },
        { key: 'oldclients', label: 'Old Clients' },
        { key: 'deals', label: 'Deals' },
        { key: 'commissions', label: 'Commissions' },
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
        <DealsView settings={settings} updateSettings={updateSettings} prospects={prospects} cdmName={cdmName} user={user} />
      </div>
    );
  }

  if (subtab === 'commissions') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <CommissionsView settings={settings} updateSettings={updateSettings} prospects={prospects} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {subtabBar}
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>{headingLabel}</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {cdmName ? `${cdmName}'s ${headingLabel.toLowerCase()}` : `Your ${headingLabel.toLowerCase()}`} — every prospect with CDM = {cdmName || 'your CDM'} and <strong>Status = {statusLabel}</strong>
            {showOld ? ` or ${otherLabel}` : ''}. Click ▸ to expand a client&apos;s contracts.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} />
          <span>Include {otherLabel}s ({oldCount})</span>
        </label>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by company, CDM, Client Manager, Status, type, website…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={() => setLinkModalOpen(true)}
          title="Bind the Status column to a Dropdowns-tab list so the cell picks from a fixed option list."
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #E2E8F0', background: 'white', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >Link columns</button>
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {activeCount}{showOld ? ` ${statusLabel.toLowerCase()} · ${oldCount} ${otherLabel.toLowerCase()}` : ''}
        </span>
      </div>

      {/* Always-visible diagnostic strip so 'blank page' is never actually blank. */}
      <div style={{ padding: '0 1.25rem 0.5rem', fontSize: '0.68rem', color: '#64748B', flexShrink: 0 }}>
        Loaded {totalProspects} prospects · {myProspects.length} match CDM &quot;{cdmName || '(unset)'}&quot; · {allClients} are Status={statusLabel} · showing {clients.length}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {clients.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', textAlign: 'center' }}>No {headingLabel.toLowerCase()} found for {cdmName || 'this user'}</div>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', textAlign: 'center' }}>
              Set a prospect&apos;s <strong>CDM</strong> to {cdmName || 'your CDM name'} and <strong>Status</strong> to <code>{statusLabel}</code> in My Accounts to list it here.
            </div>
            <div style={{ fontSize: '0.72rem', background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: 6, color: '#334155' }}>
              <div><strong>Diagnostic:</strong></div>
              <div>Total prospects loaded: {totalProspects}</div>
              <div>Prospects matching CDM &quot;{cdmName || '(unset)'}&quot;: {myProspects.length}</div>
              <div>Prospects with Status = {statusLabel}: {allClients}</div>
              <div>{cdmName || 'Your CDM'} + {statusLabel}: {activeCount}</div>
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
            tableId={tableId}
            columns={columns}
            rows={rows}
            alwaysVisible={['company']}
            defaultSort={{ key: 'daysUntilExpiration', direction: 'asc' }}
            rowStyle={(row) => {
              // Untracked clients sit greyed at the bottom (Days Until
              // is blanked above so the default ascending sort drops
              // them past every row with a real date).
              if (row.untracked) {
                return { background: '#F1F5F9', color: '#94A3B8' };
              }
              // Tint the row light red when a renewal is closing in
              // (<270 days) and the Status column is unset — those are
              // the clients that need a status set before they slip.
              const s = String(row.Status || '').trim();
              const noStatus = s === '' || s === '-' || s === '—' || s === '–';
              if (row.daysUntilExpiration != null && row.daysUntilExpiration < 270 && noStatus) {
                return { background: '#FEE2E2' };
              }
              return undefined;
            }}
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
      {linkModalOpen && (
        <LinkColumnsModal
          headers={['Status']}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}
    </div>
  );
}
