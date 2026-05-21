import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, asDate, fmtCurrency, fmtPercent, fmtDate } from '../../utils/dealsFormat';
import { loadCommissions, saveCommissionsOverride, clearCommissionsOverride } from '../../utils/commissionsStore';
import { CommissionsPasteImportModal, COMMISSIONS_CANONICAL } from './CommissionsPasteImportModal';

// Detect a "<m>/1/<y>" header so the column renderer can flip to
// currency formatting. The plain-date header is the commission $ for
// that month; the "<m>/1/<y> Revenue" variant is the underlying project
// revenue that produced it.
const MONTH_KEY_RE = /^\d{1,2}\/1\/\d{4}$/;
function isMonthCommissionKey(k) { return MONTH_KEY_RE.test(String(k || '').trim()); }
function isMonthRevenueKey(k) {
  const s = String(k || '').trim();
  return /^\d{1,2}\/1\/\d{4}\s+Revenue$/i.test(s);
}
function isFYRevenueKey(k) { return /^FY\d{4}\s+Revenue$/i.test(String(k || '').trim()); }

const CURRENCY_KEYS = new Set();
const DATE_KEYS = new Set(['Comm Start Date', 'Comm End Date']);
const PERCENT_KEYS = new Set(['%']);

function defaultWidth(k) {
  if (k === 'Name') return 170;
  if (k === 'Project Name') return 280;
  if (DATE_KEYS.has(k)) return 120;
  if (PERCENT_KEYS.has(k)) return 70;
  if (isFYRevenueKey(k)) return 130;
  if (isMonthRevenueKey(k) || isMonthCommissionKey(k)) return 110;
  return 130;
}

function buildColumns() {
  return COMMISSIONS_CANONICAL.map((k, i) => {
    const sticky = i === 0;
    const isCurrency = CURRENCY_KEYS.has(k) || isMonthRevenueKey(k) || isFYRevenueKey(k) || isMonthCommissionKey(k);
    const isDate = DATE_KEYS.has(k);
    const isPercent = PERCENT_KEYS.has(k);
    return {
      key: k,
      label: k,
      defaultWidth: defaultWidth(k),
      ...(sticky ? { sticky: true } : {}),
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      ...(isCurrency || isPercent ? { getSortValue: (row) => asNumber(row[k]) } : {}),
      render: (row) => {
        const v = row[k];
        if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
        if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
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

export function CommissionsView({ settings, updateSettings }) {
  const [{ data, source }, setStore] = useState(() => loadCommissions());
  const [search, setSearch] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [initialPaste, setInitialPaste] = useState('');

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'commissions-list-override') setStore(loadCommissions());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Page-level paste handler. When the user hits Ctrl/Cmd+V anywhere on
  // the Commissions tab — including the empty-state placeholder, the
  // toolbar, or the table — pop the import modal open with the
  // clipboard text pre-filled so they don't have to click Paste from
  // Excel first. Skipped while a real input / textarea has focus so the
  // search box and the modal's own textarea keep working normally.
  useEffect(() => {
    function onPaste(e) {
      if (showPaste) return;
      const ae = document.activeElement;
      const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (ae && ae.isContentEditable)) return;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text || !text.trim()) return;
      e.preventDefault();
      setInitialPaste(text);
      setShowPaste(true);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [showPaste]);

  const columns = useMemo(buildColumns, []);
  const tableId = useMemo(() => 'commissions:' + columns.map(c => c.key).sort().join('|'), [columns]);
  const alwaysVisible = useMemo(() => (columns[0] ? [columns[0].key] : []), [columns]);

  const rows = useMemo(
    () => data.map((r, i) => ({ ...r, id: i })),
    [data]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [rows, search]);

  function handleImport(records) {
    setStore(() => {
      try { saveCommissionsOverride(records); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: records, source: 'override' };
    });
    setShowPaste(false);
  }

  function handleClear() {
    if (!window.confirm('Clear all imported commissions data?')) return;
    clearCommissionsOverride();
    setStore({ data: [], source: 'empty' });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Commissions</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.15rem' }}>
            {rows.length === 0
              ? 'Paste your monthly commission roster from Excel — the next step maps each pasted column to a destination.'
              : `${rows.length} commission row${rows.length === 1 ? '' : 's'} on file.`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Excel. The next step lets you confirm which pasted column maps to each commission field."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #16A34A', background: '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Excel</button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleClear}
              title="Remove the imported commissions list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter commissions…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No commissions yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>Paste from Excel</strong> to drop in copied commission rows. The popup will map each pasted column (Name, Project Name, monthly revenue, monthly commission…) onto its destination.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            alwaysVisible={alwaysVisible}
            emptyMessage={search ? `No rows match "${search}"` : 'No commissions to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>

      {showPaste && (
        <CommissionsPasteImportModal
          onClose={() => { setShowPaste(false); setInitialPaste(''); }}
          onImport={(records) => { handleImport(records); setInitialPaste(''); }}
          initialPaste={initialPaste}
        />
      )}
    </div>
  );
}
