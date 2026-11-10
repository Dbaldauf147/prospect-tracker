import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, fmtCurrency } from '../../utils/dealsFormat';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';
import { cellSourceOf } from '../../utils/commissionsPasteMerge';
import { commissionUploadFiles, commissionUploadKey } from '../../utils/commissionMonthUploads';
import { downloadCommissionMonthFile } from '../../utils/commissionMonthFiles';

// Commissions > Monthly: clicking a month card that has a file opens this.
// It lists the file(s) dropped on the month, each with a Download button
// when a copy was kept (commissionMonthFiles.js), and the roster rows that
// import wrote: the rows whose month commission or revenue cell is recorded
// as coming from a file dropped on this month (CELL_SOURCES_KEY).
//
// Values imported before cell sources were recorded have no source, so
// when no row carries one the table falls back to every row with a value
// for the month, and says so.

function fmtWhen(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const label = { fontSize: '0.68rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' };
const muted = <span style={{ color: 'var(--color-text-muted)' }}>-</span>;

function FileRow({ file }) {
  const [state, setState] = useState('');
  async function download() {
    setState('busy');
    try {
      const ok = await downloadCommissionMonthFile(file.fileId, file.fileName);
      setState(ok ? '' : 'missing');
    } catch {
      setState('missing');
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#F8FAFC' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#1E293B', wordBreak: 'break-word' }}>{file.fileName || 'Unnamed file'}</div>
        <div style={{ color: '#64748B', fontSize: '0.72rem' }}>
          {file.at ? `Uploaded ${fmtWhen(file.at)}` : 'Upload time not recorded'}
          {state === 'missing' && ' - the saved copy could not be found.'}
          {!file.fileId && ' - uploaded before the app kept a copy. Drop it on the card again to keep one to download.'}
        </div>
      </div>
      {file.fileId && (
        <button
          type="button"
          onClick={download}
          disabled={state === 'busy'}
          style={{ padding: '0.3rem 0.7rem', borderRadius: 6, border: '1px solid #16A34A', background: '#16A34A', color: '#fff', fontWeight: 600, fontSize: '0.75rem', cursor: state === 'busy' ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
        >
          {state === 'busy' ? 'Downloading…' : 'Download'}
        </button>
      )}
    </div>
  );
}

export function CommissionMonthImportModal({ monthIdx, upload, data, settings, updateSettings, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const month = COMMISSION_MONTH_NAMES[monthIdx];
  const year = commissionUploadKey(monthIdx).slice(0, 4);
  const files = useMemo(() => [...commissionUploadFiles(upload)].reverse(), [upload]);
  const revKey = `${month} Revenue`;

  // Rows this month's file import wrote, or (no sources on record) every
  // row with a value for the month.
  const { rows, fromSources } = useMemo(() => {
    const sourced = [];
    const all = [];
    (data || []).forEach((row, i) => {
      if (!row || row.__ignored) return;
      const c = asNumber(row[month]);
      const r = asNumber(row[revKey]);
      if ((c == null || c === 0) && (r == null || r === 0)) return;
      const src = [cellSourceOf(row, month), cellSourceOf(row, revKey)]
        .find(s => s?.via === 'file' && s.month === monthIdx);
      const out = { ...row, id: i, __commission: c, __revenue: r, __file: src?.file || '' };
      all.push(out);
      if (src) sourced.push(out);
    });
    return sourced.length ? { rows: sourced, fromSources: true } : { rows: all, fromSources: false };
  }, [data, month, revKey, monthIdx]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    commission: acc.commission + (r.__commission || 0),
    revenue: acc.revenue + (r.__revenue || 0),
  }), { commission: 0, revenue: 0 }), [rows]);

  const columns = useMemo(() => {
    const cols = [
      { key: 'Account Name', label: 'Account Name', defaultWidth: 200, render: (row) => row['Account Name'] || muted },
      { key: 'Project Name', label: 'Project Name', defaultWidth: 300, render: (row) => row['Project Name'] || muted },
      { key: 'Name', label: 'Name', defaultWidth: 150, render: (row) => row['Name'] || muted },
      {
        key: '__revenue', label: 'Revenue', defaultWidth: 120,
        getSortValue: (row) => row.__revenue,
        render: (row) => row.__revenue == null ? muted : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(row.__revenue)}</span>,
        exportValue: (row) => row.__revenue ?? '',
      },
      {
        key: '__commission', label: 'Commission', defaultWidth: 120,
        getSortValue: (row) => row.__commission,
        render: (row) => row.__commission == null ? muted : <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtCurrency(row.__commission)}</span>,
        exportValue: (row) => row.__commission ?? '',
      },
    ];
    if (fromSources) {
      cols.push({ key: '__file', label: 'File', defaultWidth: 200, render: (row) => row.__file || muted });
    }
    return cols;
  }, [fromSources]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${month} commissions import`}
        style={{ background: '#fff', borderRadius: 8, width: 'min(1100px, 96vw)', height: 'min(760px, 92vh)', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.6rem 1rem', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={label}>Commissions file import</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1E293B', marginTop: 2 }}>{month} {year}</div>
            <div style={{ color: '#475569', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {rows.length} row{rows.length === 1 ? '' : 's'} · <strong>{fmtCurrency(totals.commission)}</strong> commission · {fmtCurrency(totals.revenue)} revenue
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', color: '#64748B' }}>×</button>
        </div>
        <div style={{ padding: '0.6rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', flexShrink: 0, maxHeight: '30%', overflowY: 'auto' }}>
          <div style={label}>{files.length === 1 ? 'File' : `Files (${files.length})`}</div>
          {files.length === 0
            ? <div style={{ color: '#64748B' }}>No file is on record for {month}.</div>
            : files.map((f, i) => <FileRow key={f.fileId || `${f.fileName}:${f.at}:${i}`} file={f} />)}
          {!fromSources && rows.length > 0 && (
            <div style={{ color: '#64748B', fontSize: '0.72rem' }}>
              These values were imported before the app recorded which file each one came from, so this shows every row with a {month} value.
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid #E2E8F0' }}>
          <DataTable
            tableId="commissions-month-import"
            columns={columns}
            rows={rows}
            defaultSort={{ key: '__commission', direction: 'desc' }}
            emptyMessage={`No commission or revenue recorded for ${month}.`}
            exportFileName={`Commissions ${month} ${year} import`}
            exportPrimarySheetName={month}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      </div>
    </div>
  );
}
