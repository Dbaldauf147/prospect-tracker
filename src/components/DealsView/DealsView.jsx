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
  loadDealClientMap, setDealClientMapping, DEALS_CLIENT_MAP_EVENT,
} from '../../utils/dealClientMap';
import { PasteImportModal } from './PasteImportModal';

const MAPPED_COL_KEY = '__mappedToClient__';
const MAPPED_COL_LABEL = 'Mapped to Client';

function normClient(s) { return String(s || '').toLowerCase().trim(); }

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
  const fileInputRef = useRef(null);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setStore(loadDealsList());
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    };
  }, []);

  // Active client roster the helper-column dropdown picks from. Falls
  // back to every CDM-matching prospect when no clients are flagged yet,
  // so the picker still has something useful to offer.
  const clientOptions = useMemo(() => {
    const list = prospects.filter(p => matchesCdm(p.cdm, cdmName));
    const onlyClients = list.filter(p => {
      const s = normClient(p.status);
      return s === 'client' || s === 'old client';
    });
    const pool = onlyClients.length > 0 ? onlyClients : list;
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
        const auto = clientNameSet.has(normClient(raw));
        const manual = clientMap[normClient(raw)];
        if (auto) {
          return (
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#DCFCE7', color: '#166534' }} title="Client Name matches an active client">
              ✓ Matches
            </span>
          );
        }
        return (
          <select
            value={manual || ''}
            onChange={(e) => {
              const next = e.target.value;
              setDealClientMapping(raw, next);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', padding: '0.2rem 0.3rem', border: '1px solid',
              borderColor: manual ? '#86EFAC' : '#FCD34D',
              borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit',
              background: manual ? '#F0FDF4' : '#FFFBEB',
              color: '#1E293B',
            }}
          >
            <option value="">— Map to client… —</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        );
      },
      exportValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        if (clientNameSet.has(normClient(raw))) return raw;
        return clientMap[normClient(raw)] || '';
      },
    };
    // Insert immediately after the sticky Client Name column.
    return [baseColumns[0], helperCol, ...baseColumns.slice(1)];
  }, [baseColumns, clientOptions, clientNameSet, clientMap]);
  const tableId = useMemo(
    () => 'deals:' + columns.map(c => c.key).sort().join('|'),
    [columns]
  );
  const alwaysVisible = useMemo(
    () => (columns[0] ? [columns[0].key] : []),
    [columns]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r =>
      Object.values(r).some(v => String(v).toLowerCase().includes(term))
    );
  }, [search, rows]);

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

  // Count rows whose Client Name doesn't match any active client and
  // hasn't been hand-mapped yet — surfaces the work the user still has
  // to do after a paste import.
  const unmappedCount = useMemo(() => {
    if (clientOptions.length === 0) return 0;
    let n = 0;
    for (const r of rows) {
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (clientNameSet.has(norm)) continue;
      if (clientMap[norm]) continue;
      n++;
    }
    return n;
  }, [rows, clientNameSet, clientMap, clientOptions]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Deals</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {rows.length} deals{source === 'override' ? ' · uploaded' : ''}. Upload an Excel export or paste from Google Sheets.
            {unmappedCount > 0 && (
              <> · <span style={{ color: '#92400E', fontWeight: 700 }}>{unmappedCount} row{unmappedCount === 1 ? '' : 's'} with unmatched Client Names</span> — use the <em>Mapped to Client</em> column to assign.</>
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

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
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
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
