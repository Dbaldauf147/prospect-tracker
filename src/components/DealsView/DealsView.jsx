import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { loadDealsList, saveDealsOverride, clearDealsOverride } from '../../utils/dealsStore';
import {
  asNumber, fmtCurrency, fmtPercent, fmtDate, isTruthy,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import { matchesCdm } from '../../utils/cdmMatch';
import {
  loadDealClientMap, setDealClientMapping,
  loadDealClientIgnore, setDealClientIgnore,
  bulkSetDealClientIgnore, bulkSetDealClientMapping,
  DEALS_CLIENT_MAP_EVENT,
} from '../../utils/dealClientMap';
import { PasteImportModal } from './PasteImportModal';

const MAPPED_COL_KEY = '__mappedToClient__';
const MAPPED_COL_LABEL = 'Mapped to Client';

function normClient(s) { return String(s || '').toLowerCase().trim(); }

// Render the helper column as a lazy editor. We were previously
// mounting a full <select> with every client option (often 100+) for
// every unmapped row — 250 rows × 130 options = 30k+ DOM nodes just
// for the dropdowns, which can balloon paint cost on large lists and
// leaves the table looking blank while the browser catches up. The
// button form keeps the cell DOM tiny; the <select> only mounts when
// the user clicks the cell to assign a client.
function MappedClientCell({ raw, manual, ignored, clientOptions, onChange, onToggleIgnore }) {
  const [editing, setEditing] = useState(false);
  if (ignored) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <span style={{ flex: 1, padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#F1F5F9', color: '#64748B', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="This source name is marked as ignored and won't count against the unmapped tally">
          ✕ Ignored
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleIgnore(raw, false); }}
          title="Restore this row to the unmapped list"
          style={{ padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >↺</button>
      </span>
    );
  }
  if (!editing) {
    const label = manual || 'Map to client…';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title={manual ? `Currently mapped to ${manual}. Click to change.` : 'Click to pick the matching client'}
          style={{
            flex: 1, minWidth: 0, padding: '0.2rem 0.4rem',
            border: '1px solid', borderColor: manual ? '#86EFAC' : '#FCD34D',
            borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit',
            background: manual ? '#F0FDF4' : '#FFFBEB',
            color: manual ? '#166534' : '#92400E',
            textAlign: 'left', cursor: 'pointer',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{label}</button>
        {!manual && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleIgnore(raw, true); }}
            title="Ignore this row — it won't count against the unmapped tally"
            style={{ padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >✕</button>
        )}
      </span>
    );
  }
  return (
    <select
      autoFocus
      value={manual || ''}
      onChange={(e) => { onChange(raw, e.target.value); setEditing(false); }}
      onBlur={() => setEditing(false)}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', padding: '0.2rem 0.3rem',
        border: '1px solid #3B82F6', borderRadius: 4,
        fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff',
        color: '#1E293B',
      }}
    >
      <option value="">— Unmap —</option>
      {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// Canonical ordered column list — these are the headers the Deals
// sub-tab is expected to surface from the user's client-tracker
// workbook. The first column ("Client Name") is sticky.
// Headers in incoming workbooks that should fold into a canonical column
// name. Lets older "Paperwork completed" exports and newer "Paperwork"
// exports both land in the same field, and surfaces the shorter labels
// the user uses on the Clients tab's contract drill-down.
const HEADER_ALIASES = {
  'paperwork': 'Paperwork completed',
  'billing letter': 'Billing information collected',
  'combined bfo': 'Combined',
};

const COLUMN_ORDER = [
  'Client Name',
  'Commission Sheet Sent to Kathy',
  'Paperwork completed',
  'Billing information collected',
  'Closed Won',
  'On Client Tracker?',
  'BFO - Close after contract execution email has been sent',
  'Agreement Name',
  'Current Term Start Date',
  'Original Contract Start',
  'Setup',
  'Recurring Revenue',
  'Commission',
  'Revenue Recorded',
  'Paid to Date',
  'Delta',
  'Currently being paid',
  'Ticket',
  'Comm Status',
  'Due Date',
  'Days/Paid on',
  'GM',
  'Payment Terms',
  'End Date',
  'Auto renewal?',
  'Esc',
  'Current Value',
  'SUCON?',
  'Comm Tracker?',
  'Comm Tracker?2',
  'Comm Tracker?3',
  'Comm Tracker?4',
  'Comm Tracker?5',
  'Comm Tracker?6',
  'Combined',
  'Combine Project Name',
  'Commission Rate',
  'Year',
  'Month',
  'Follow Up On Sale',
];

function buildColumns(rows) {
  if (!rows.length) return [];
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (k !== 'id') keys.add(k);

  // Lay out canonical columns first, then any extras the workbook
  // brought along, so unexpected headers still render at the end.
  const ordered = [];
  for (const k of COLUMN_ORDER) if (keys.has(k)) ordered.push(k);
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  return ordered.map((k, i) => {
    const sticky = i === 0;
    const isCurrency = DEAL_CURRENCY_KEYS.has(k);
    const isPercent = DEAL_PERCENT_KEYS.has(k);
    const isDate = DEAL_DATE_KEYS.has(k);
    const isCheck = DEAL_CHECK_KEYS.has(k);
    return {
      key: k,
      label: k,
      defaultWidth: sticky ? 220 : isCheck ? 110 : isCurrency || isPercent ? 130 : isDate ? 130 : 150,
      ...(sticky ? { sticky: true } : {}),
      render: (row) => {
        const v = row[k];
        if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        if (isCheck) {
          const yes = isTruthy(v);
          return (
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: yes ? '#DCFCE7' : '#F1F5F9', color: yes ? '#166534' : '#64748B' }}>
              {yes ? 'Yes' : (typeof v === 'string' && v.trim() ? v : 'No')}
            </span>
          );
        }
        if (isCurrency) return <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
        if (isPercent) return <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
        if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
        return <span>{String(v)}</span>;
      },
      exportValue: (row) => {
        const v = row[k];
        if (v == null) return '';
        if (isCurrency || isPercent) {
          const n = asNumber(v);
          return n != null ? n : v;
        }
        return v;
      },
    };
  });
}

export function DealsView({ settings, updateSettings, prospects = [], cdmName }) {
  const [{ data, source }, setStore] = useState(() => loadDealsList());
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const [showPaste, setShowPaste] = useState(false);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [ignoreSet, setIgnoreSet] = useState(() => loadDealClientIgnore());
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [bulkPick, setBulkPick] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setStore(loadDealsList());
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'deals-client-ignore') setIgnoreSet(loadDealClientIgnore());
    }
    function onClientMap() {
      setClientMap(loadDealClientMap());
      setIgnoreSet(loadDealClientIgnore());
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    };
  }, []);

  // Active + Old Client roster the helper-column dropdown picks from.
  // CDM-matching Client / Old Client prospects come first, but any
  // Old Client in the pool — even ones whose CDM has drifted to
  // another rep — is included too, since a deal row often points at
  // an account that's been reassigned over time. Falls back to every
  // CDM-matching prospect when no clients are flagged yet. Status
  // comparison collapses internal whitespace so "Old  Client",
  // "old\tclient", etc. still match.
  const clientOptions = useMemo(() => {
    const normStatus = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const cdmList = prospects.filter(p => matchesCdm(p.cdm, cdmName));
    const myClients = cdmList.filter(p => {
      const s = normStatus(p.status);
      return s === 'client' || s === 'old client';
    });
    const allOldClients = prospects.filter(p => normStatus(p.status) === 'old client');
    const pool = (myClients.length > 0 || allOldClients.length > 0)
      ? [...myClients, ...allOldClients]
      : cdmList;
    const names = new Set();
    for (const p of pool) {
      const name = String(p.company || '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [prospects, cdmName]);

  const clientNameSet = useMemo(
    () => new Set(clientOptions.map(n => normClient(n))),
    [clientOptions]
  );

  const rows = useMemo(() => data.map((r, i) => ({ ...r, id: i })), [data]);
  const baseColumns = useMemo(() => buildColumns(rows), [rows]);
  // Inject a helper "Mapped to Client" column right after the sticky
  // Client Name. The column is read-only when the row's Client Name
  // already matches an active client, and otherwise renders a small
  // dropdown that persists the user's pick via dealClientMap. Only
  // surfaces when prospects are passed in.
  const columns = useMemo(() => {
    if (clientOptions.length === 0) return baseColumns;
    if (baseColumns.length === 0) return baseColumns;
    const helperCol = {
      key: MAPPED_COL_KEY,
      label: MAPPED_COL_LABEL,
      defaultWidth: 220,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return <span style={{ color: '#94A3B8' }}>—</span>;
        const norm = normClient(raw);
        const auto = clientNameSet.has(norm);
        const manual = clientMap[norm];
        const ignored = ignoreSet.has(norm);
        if (auto) {
          return (
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#DCFCE7', color: '#166534' }} title="Client Name matches an active client">
              ✓ Matches
            </span>
          );
        }
        return (
          <MappedClientCell
            raw={raw}
            manual={manual}
            ignored={ignored}
            clientOptions={clientOptions}
            onChange={setDealClientMapping}
            onToggleIgnore={setDealClientIgnore}
          />
        );
      },
      exportValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        if (clientNameSet.has(norm)) return raw;
        if (ignoreSet.has(norm)) return '(ignored)';
        return clientMap[norm] || '';
      },
    };
    // Insert immediately after the sticky Client Name column.
    return [baseColumns[0], helperCol, ...baseColumns.slice(1)];
  }, [baseColumns, clientOptions, clientNameSet, clientMap, ignoreSet]);
  const tableId = useMemo(
    () => 'deals:' + columns.map(c => c.key).sort().join('|'),
    [columns]
  );
  const alwaysVisible = useMemo(
    () => (columns[0] ? [columns[0].key] : []),
    [columns]
  );

  function isRowUnmapped(row) {
    if (clientOptions.length === 0) return false;
    const raw = String(row['Client Name'] || '').trim();
    if (!raw) return false;
    const norm = normClient(raw);
    if (clientNameSet.has(norm)) return false;
    if (clientMap[norm]) return false;
    if (ignoreSet.has(norm)) return false;
    return true;
  }

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      const term = search.toLowerCase();
      out = out.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(term))
      );
    }
    if (onlyUnmapped) out = out.filter(isRowUnmapped);
    return out;
  }, [search, rows, onlyUnmapped, clientNameSet, clientMap, ignoreSet, clientOptions]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook has no sheets');
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No rows parsed');

      // Normalize headers: trim whitespace, strip stray trailing
      // periods so 'Client Name ' or 'Client Name.' still lands under
      // the canonical column, then fold aliases (e.g. 'Paperwork' ->
      // 'Paperwork completed') so old and new tracker exports share
      // the same underlying column.
      const normalizeHeader = (h) => {
        const cleaned = String(h || '').trim().replace(/\.+$/, '');
        const aliased = HEADER_ALIASES[cleaned.toLowerCase()];
        return aliased || cleaned;
      };
      const cleaned = parsed
        .map(r => {
          const out = {};
          for (const k of Object.keys(r)) out[normalizeHeader(k)] = r[k];
          return out;
        })
        .filter(r => Object.values(r).some(v => v !== '' && v != null));

      if (cleaned.length === 0) throw new Error('All rows were blank.');
      saveDealsOverride(cleaned);
      setStore(loadDealsList());
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload too large for browser storage (max ~5 MB). Try trimming unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  function handleRevert() {
    if (!window.confirm('Clear the uploaded deals list?')) return;
    clearDealsOverride();
    setStore(loadDealsList());
  }

  function handlePasteImport(records) {
    saveDealsOverride(records);
    setStore(loadDealsList());
    setShowPaste(false);
  }

  // Count rows whose Client Name doesn't match any active client,
  // hasn't been hand-mapped, and hasn't been explicitly ignored.
  // Surfaces the work the user still has to do after a paste import.
  const unmappedCount = useMemo(() => {
    if (clientOptions.length === 0) return 0;
    let n = 0;
    for (const r of rows) {
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (clientNameSet.has(norm)) continue;
      if (clientMap[norm]) continue;
      if (ignoreSet.has(norm)) continue;
      n++;
    }
    return n;
  }, [rows, clientNameSet, clientMap, ignoreSet, clientOptions]);

  // Distinct unmapped source-name strings drive bulk actions: ignoring
  // or assigning happens per source name, so each "Brookfield (BPREP
  // US fund)" only needs one decision regardless of how many deal
  // rows share it.
  const distinctUnmappedNames = useMemo(() => {
    const out = new Map();
    for (const r of rows) {
      if (!isRowUnmapped(r)) continue;
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (!out.has(norm)) out.set(norm, raw);
    }
    return out;
  }, [rows, clientNameSet, clientMap, ignoreSet, clientOptions]);

  function handleBulkIgnore() {
    if (distinctUnmappedNames.size === 0) return;
    if (!window.confirm(`Ignore all ${distinctUnmappedNames.size} unmapped Client Name${distinctUnmappedNames.size === 1 ? '' : 's'}? You can undo per row with the ↺ button.`)) return;
    bulkSetDealClientIgnore([...distinctUnmappedNames.values()], true);
  }

  function handleBulkMap() {
    if (!bulkPick) return;
    if (distinctUnmappedNames.size === 0) return;
    if (!window.confirm(`Map all ${distinctUnmappedNames.size} unmapped Client Name${distinctUnmappedNames.size === 1 ? '' : 's'} to "${bulkPick}"?`)) return;
    bulkSetDealClientMapping([...distinctUnmappedNames.values()], bulkPick);
    setBulkPick('');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Deals</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {rows.length} deals{source === 'override' ? ' · uploaded' : ''}. Upload an Excel export or paste from Google Sheets.
            {unmappedCount > 0 && (
              <> · <span style={{ color: '#92400E', fontWeight: 700 }}>{unmappedCount} row{unmappedCount === 1 ? '' : 's'} with unmatched Client Names</span> — use the <em>Mapped to Client</em> column to assign or ignore.</>
            )}
            {ignoreSet.size > 0 && (
              <> · <span style={{ color: '#64748B' }}>{ignoreSet.size} ignored</span></>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Google Sheets. The next step lets you confirm which pasted column maps to each deal field."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Sheets</button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Replace the Deals table by uploading a new Excel file."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Upload Excel</button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title="Remove the uploaded deals list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      {uploadError && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter deals…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
        {clientOptions.length > 0 && (
          <button
            type="button"
            onClick={() => setOnlyUnmapped(v => !v)}
            disabled={unmappedCount === 0 && !onlyUnmapped}
            title={unmappedCount === 0 ? 'No unmapped rows remain' : (onlyUnmapped ? 'Show all rows' : 'Show only rows whose Client Name is not yet mapped or matched')}
            style={{
              padding: '0.35rem 0.7rem',
              border: '1px solid',
              borderColor: onlyUnmapped ? '#92400E' : '#FCD34D',
              borderRadius: 6,
              background: onlyUnmapped ? '#92400E' : '#FFFBEB',
              color: onlyUnmapped ? '#fff' : '#92400E',
              fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: (unmappedCount === 0 && !onlyUnmapped) ? 'not-allowed' : 'pointer',
              opacity: (unmappedCount === 0 && !onlyUnmapped) ? 0.5 : 1,
            }}
          >{onlyUnmapped ? `✓ Showing unmapped (${unmappedCount})` : `Show only unmapped (${unmappedCount})`}</button>
        )}
      </div>

      {onlyUnmapped && distinctUnmappedNames.size > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.72rem', color: '#92400E' }}>
            {distinctUnmappedNames.size} distinct unmapped Client Name{distinctUnmappedNames.size === 1 ? '' : 's'}
          </strong>
          <span style={{ fontSize: '0.7rem', color: '#92400E' }}>· apply to all:</span>
          <select
            value={bulkPick}
            onChange={(e) => setBulkPick(e.target.value)}
            style={{ padding: '0.25rem 0.4rem', border: '1px solid #FCD34D', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 280 }}
          >
            <option value="">— Map all to client… —</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            onClick={handleBulkMap}
            disabled={!bulkPick}
            style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: bulkPick ? '#16A34A' : '#94A3B8', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: bulkPick ? 'pointer' : 'not-allowed' }}
          >Map all</button>
          <span style={{ fontSize: '0.7rem', color: '#92400E' }}>or</span>
          <button
            type="button"
            onClick={handleBulkIgnore}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          >✕ Ignore all unmapped</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No deals yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>Paste from Sheets</strong> to drop in copied Google Sheets rows, or <strong>Upload Excel</strong> for a workbook. Expected headers include Client Name, Agreement Name, Setup, Recurring Revenue, Commission, Due Date, and the rest of the tracker columns.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            alwaysVisible={alwaysVisible}
            rowStyle={(row) => {
              if (clientOptions.length === 0) return undefined;
              const raw = String(row['Client Name'] || '').trim();
              if (!raw) return undefined;
              const norm = normClient(raw);
              if (clientNameSet.has(norm)) return undefined;
              if (clientMap[norm]) return undefined;
              if (ignoreSet.has(norm)) return undefined;
              return { background: '#FFFBEB' };
            }}
            emptyMessage={search ? `No deals match "${search}"` : 'No deals to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
      {showPaste && (
        <PasteImportModal
          onClose={() => setShowPaste(false)}
          onImport={handlePasteImport}
        />
      )}
    </div>
  );
}
