import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { loadDealsList, saveDealsOverride, clearDealsOverride } from '../../utils/dealsStore';
import {
  asNumber, fmtCurrency, fmtPercent, fmtDate, isTruthy,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';

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

export function DealsView({ settings, updateSettings }) {
  const [{ data, source }, setStore] = useState(() => loadDealsList());
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setStore(loadDealsList());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const rows = useMemo(() => data.map((r, i) => ({ ...r, id: i })), [data]);
  const columns = useMemo(() => buildColumns(rows), [rows]);
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Deals</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {rows.length} deals{source === 'override' ? ' · uploaded' : ''}. Upload an Excel export of the client tracker to populate.
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
              Click <strong>Upload Excel</strong> to import your client tracker. Expected headers include Client Name, Agreement Name, Setup, Recurring Revenue, Commission, Due Date, and the rest of the tracker columns.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            alwaysVisible={alwaysVisible}
            emptyMessage={search ? `No deals match "${search}"` : 'No deals to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
    </div>
  );
}
