import { useEffect } from 'react';
import { fmtCurrency } from '../../utils/dealsFormat';
import { cellSourceOf } from '../../utils/commissionsPasteMerge';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';

// Commissions table: clicking a month's revenue or commission cell opens
// this. It names the commission month file the value was imported from (or
// says it was pasted / typed in), read from the row's __cellSources map that
// the import records (see CELL_SOURCES_KEY in utils/commissionsPasteMerge).
//
// Cells imported before sources were tracked have no entry. For those it
// lists the files on record for that calendar month (settings'
// commissionMonthUploads) as the likely source, and says re-dropping the
// file fills the record in.

function fmtWhen(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function monthIdxOf(key) {
  const base = String(key || '').replace(/ Revenue$/, '').trim();
  return COMMISSION_MONTH_NAMES.indexOf(base);
}

// Every upload on record for calendar month `idx`, newest first.
function uploadsForMonth(uploads, idx) {
  if (!uploads || typeof uploads !== 'object' || idx < 0) return [];
  const mm = String(idx + 1).padStart(2, '0');
  return Object.entries(uploads)
    .filter(([k, v]) => k.endsWith(`-${mm}`) && v && typeof v === 'object')
    .map(([k, v]) => ({ key: k, year: k.slice(0, 4), fileName: v.fileName || '', at: v.at || '' }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

const label = { fontSize: '0.68rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' };
const box = { border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.7rem', background: '#F8FAFC' };

export function CommissionCellSourceModal({ row, cellKey, uploads, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isRevenue = /Revenue$/.test(cellKey);
  const idx = monthIdxOf(cellKey);
  const monthName = idx >= 0 ? COMMISSION_MONTH_NAMES[idx] : cellKey;
  const value = row?.[cellKey];
  const hasValue = value != null && String(value).trim() !== '';
  const src = cellSourceOf(row, cellKey);
  const onRecord = uploadsForMonth(uploads, idx);

  let body;
  if (!hasValue) {
    body = <div style={{ color: '#475569' }}>This cell is empty, so nothing has been imported into it yet.</div>;
  } else if (src?.via === 'file') {
    const fileMonth = COMMISSION_MONTH_NAMES[src.month] || '';
    body = (
      <div style={box}>
        <div style={label}>Imported from</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B', marginTop: 2, wordBreak: 'break-word' }}>{src.file || 'A commissions file'}</div>
        <div style={{ color: '#475569', marginTop: 4 }}>
          {fileMonth ? <>The <strong>{fileMonth}</strong> commission month sheet</> : 'A commission month sheet'}
          {src.at ? `, imported ${fmtWhen(src.at)}` : ''}.
        </div>
      </div>
    );
  } else if (src?.via === 'paste') {
    body = (
      <div style={box}>
        <div style={label}>Pasted in</div>
        <div style={{ color: '#475569', marginTop: 4 }}>
          Pasted from Excel or Sheets with Paste from Excel{src.at ? ` on ${fmtWhen(src.at)}` : ''}, not dropped on a month card, so there is no file name on record.
        </div>
      </div>
    );
  } else if (src?.via === 'edit') {
    body = (
      <div style={box}>
        <div style={label}>Typed in</div>
        <div style={{ color: '#475569', marginTop: 4 }}>Edited by hand in this table{src.at ? ` on ${fmtWhen(src.at)}` : ''}.</div>
      </div>
    );
  } else {
    body = (
      <>
        <div style={{ color: '#475569' }}>
          This value was imported before the app recorded which file each cell came from, so its exact source isn't on record.
        </div>
        {onRecord.length > 0 ? (
          <div style={{ ...box, marginTop: '0.6rem' }}>
            <div style={label}>{monthName} files on record</div>
            {onRecord.map(u => (
              <div key={u.key} style={{ marginTop: 4, color: '#1E293B' }}>
                <strong style={{ wordBreak: 'break-word' }}>{u.fileName || 'Unnamed file'}</strong>
                <span style={{ color: '#64748B' }}> ({monthName} {u.year}{u.at ? `, uploaded ${fmtWhen(u.at)}` : ''})</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#64748B', marginTop: '0.5rem' }}>No {monthName} file has been uploaded on the Monthly subtab.</div>
        )}
        <div style={{ color: '#64748B', marginTop: '0.6rem', fontSize: '0.72rem' }}>
          Dropping the {monthName} file on its card under Monthly again records it as the source of every value it contains.
        </div>
      </>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Source of ${cellKey}`}
        style={{ background: '#fff', borderRadius: 8, width: 'min(460px, 96vw)', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)', fontSize: '0.8rem' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.6rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={label}>{monthName} {isRevenue ? 'revenue' : 'commission'}</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1E293B', marginTop: 2, wordBreak: 'break-word' }}>
              {row?.['Project Name'] || 'Commission row'}
            </div>
            {hasValue && <div style={{ color: '#0F172A', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(value)}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', color: '#64748B' }}>×</button>
        </div>
        <div style={{ padding: '0.8rem 1rem 1rem' }}>{body}</div>
      </div>
    </div>
  );
}
