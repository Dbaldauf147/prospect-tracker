import { useMemo, useRef, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, fmtCurrency } from '../../utils/dealsFormat';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';
import { commissionMonthlyTotals } from '../../utils/commissionsMonthFile';

// Commissions > Monthly. One card per calendar month with that month's
// commission and revenue totals. Each card is also a drop target: drop a
// commissions Excel file on it (or browse for one) and the parent reads it
// and opens the usual column-mapping popup, with generic "Commission" /
// "Revenue" columns pointed at that month. Clicking a card lists the rows
// behind its totals underneath.

const ACCEPT = '.xlsx,.xls,.xlsm,.csv';

function MonthCard({ idx, totals, selected, isCurrent, busy, onSelect, onFile }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const month = COMMISSION_MONTH_NAMES[idx];

  function takeFiles(list) {
    const files = [...(list || [])];
    if (files.length === 0) return;
    // Show this month's rows below, so the import lands in view.
    onSelect(idx);
    onFile(files, idx);
  }

  return (
    <div
      onClick={() => onSelect(idx)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!over) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); takeFiles(e.dataTransfer.files); }}
      title={`Drop a commissions Excel file here to add it to ${month}. Click to see ${month}'s rows below.`}
      style={{
        background: over ? '#EFF6FF' : '#fff',
        border: over ? '2px dashed #3B82F6' : selected ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
        borderRadius: 8,
        padding: over || selected ? '0.55rem 0.7rem' : '0.6rem 0.75rem',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: '0.3rem',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ fontSize: '0.82rem', color: '#1E293B' }}>{month}</strong>
        {isCurrent && (
          <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#DBEAFE', color: '#1D4ED8' }}>This month</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.65rem', color: '#64748B' }} title="Rows with a commission this month">
          {totals.paidRows} paid
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: totals.commission ? '#0F172A' : '#94A3B8' }} title="Commission total for the month">
          {totals.commission ? fmtCurrency(totals.commission) : '-'}
        </span>
        <span style={{ fontSize: '0.68rem', color: '#64748B' }} title="Revenue total for the month">
          Revenue {totals.revenue ? fmtCurrency(totals.revenue) : '-'}
        </span>
      </div>
      <div
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        style={{
          marginTop: 2, padding: '0.35rem', borderRadius: 6,
          border: '1px dashed #CBD5E1', background: over ? '#DBEAFE' : '#F8FAFC',
          color: '#475569', fontSize: '0.66rem', textAlign: 'center',
        }}
      >
        {busy ? 'Reading file…' : over ? `Drop to add to ${month}` : 'Drop Excel file here or browse'}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

export function CommissionsMonthlyView({ data, onFile, busyMonth, fileError, onDismissError, settings, updateSettings }) {
  const totals = useMemo(() => commissionMonthlyTotals(data, asNumber), [data]);
  const currentMonth = new Date().getMonth();
  const [selected, setSelected] = useState(currentMonth);
  const selectedMonth = COMMISSION_MONTH_NAMES[selected];

  const yearTotal = useMemo(() => totals.reduce((acc, t) => ({
    commission: acc.commission + t.commission,
    revenue: acc.revenue + t.revenue,
  }), { commission: 0, revenue: 0 }), [totals]);

  // Rows behind the selected month's totals.
  const monthRows = useMemo(() => {
    const out = [];
    (data || []).forEach((row, i) => {
      if (!row || row.__ignored) return;
      const c = asNumber(row[selectedMonth]);
      const r = asNumber(row[`${selectedMonth} Revenue`]);
      if ((c == null || c === 0) && (r == null || r === 0)) return;
      out.push({ ...row, id: i, __commission: c, __revenue: r });
    });
    return out;
  }, [data, selectedMonth]);

  const columns = useMemo(() => [
    { key: 'Account Name', label: 'Account Name', defaultWidth: 200, render: (row) => row['Account Name'] || <span style={{ color: 'var(--color-text-muted)' }}>-</span> },
    { key: 'Project Name', label: 'Project Name', defaultWidth: 300, render: (row) => row['Project Name'] || row['Name'] || <span style={{ color: 'var(--color-text-muted)' }}>-</span> },
    { key: 'Name', label: 'Name', defaultWidth: 160, render: (row) => row['Name'] || <span style={{ color: 'var(--color-text-muted)' }}>-</span> },
    {
      key: '__revenue', label: 'Revenue', defaultWidth: 130,
      getSortValue: (row) => row.__revenue,
      render: (row) => row.__revenue == null ? <span style={{ color: 'var(--color-text-muted)' }}>-</span> : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(row.__revenue)}</span>,
      exportValue: (row) => row.__revenue ?? '',
    },
    {
      key: '__commission', label: 'Commission', defaultWidth: 130,
      getSortValue: (row) => row.__commission,
      render: (row) => row.__commission == null ? <span style={{ color: 'var(--color-text-muted)' }}>-</span> : <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtCurrency(row.__commission)}</span>,
      exportValue: (row) => row.__commission ?? '',
    },
  ], []);

  return (
    // A file let go between the cards would otherwise make the browser open
    // it in place of the app.
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, overflowY: 'auto', maxHeight: '60%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.5rem' }}>
          <span>Drop a commissions Excel file on a month to read it into the roster. A generic Commission or Revenue column lands in the month you drop it on; you confirm the column mapping before anything is saved.</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
            All months: <strong>{fmtCurrency(yearTotal.commission)}</strong> commission · {fmtCurrency(yearTotal.revenue)} revenue
          </span>
        </div>
        {fileError && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', marginBottom: '0.5rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.75rem' }}>
            <span style={{ flex: 1 }}>{fileError}</span>
            <button type="button" onClick={onDismissError} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: '#991B1B', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.5rem' }}>
          {totals.map((t, i) => (
            <MonthCard
              key={t.month}
              idx={i}
              totals={t}
              selected={i === selected}
              isCurrent={i === currentMonth}
              busy={busyMonth === i}
              onSelect={setSelected}
              onFile={onFile}
            />
          ))}
        </div>
      </div>
      <div style={{ padding: '0.25rem 1.25rem 0.4rem', flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>
        {selectedMonth}: {monthRows.length} row{monthRows.length === 1 ? '' : 's'}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <DataTable
          tableId="commissions-monthly"
          columns={columns}
          rows={monthRows}
          defaultSort={{ key: '__commission', direction: 'desc' }}
          emptyMessage={`No commission or revenue recorded for ${selectedMonth}. Drop a file on the ${selectedMonth} card to add one.`}
          exportFileName={`Commissions ${selectedMonth}`}
          exportPrimarySheetName={selectedMonth}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
