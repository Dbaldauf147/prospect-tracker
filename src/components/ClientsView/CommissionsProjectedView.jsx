import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { fmtCurrency, fmtDate, fmtPercent, asDate } from '../../utils/dealsFormat';
import { BFO_PAYMENT_STATUS_LABEL } from '../../utils/commissionBfoSchedule';
import { projectionTotals, PROJECTION_MONTHS, upcomingMonths, expectedForMonth } from '../../utils/commissionProjection';

// Commissions > Projected. A 12-month projection for the commissions being
// paid now and the ones not paid yet (see utils/commissionProjection). The
// parent hands in `items`: each roster row with its `projection` attached,
// already narrowed to those two kinds.

const muted = <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
const money = (v, bold) => (v == null
  ? muted
  : <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 600 : 400 }}>{fmtCurrency(v)}</span>);

const CATEGORY = {
  paying: { label: 'Being paid', bg: '#DCFCE7', fg: '#166534', title: 'Payment Status is Active and commission has been paid' },
  notYet: { label: 'Not yet paid', bg: '#DBEAFE', fg: '#1D4ED8', title: 'Has a Comm Start Date and no commission paid yet' },
};

// Payment status pill colors, as the BFO popup draws them: overpaid and
// paid as expected green, underpaid red.
const PAY_STYLE = {
  overpaid: { bg: '#DCFCE7', fg: '#166534' },
  exact: { bg: '#DCFCE7', fg: '#166534' },
  underpaid: { bg: '#FEE2E2', fg: '#991B1B' },
};
const pill = (label, { bg, fg }, title) => (
  <span title={title} style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: bg, color: fg, whiteSpace: 'nowrap' }}>{label}</span>
);
const paymentLabel = (row) => (row.__bfoPayment ? BFO_PAYMENT_STATUS_LABEL[row.__bfoPayment.status] : '');
// To watch (flagged in the BFO popup) and OK (popup all green, every cell
// matching or marked OK). An opp can be both.
const reviewLabel = (row) => [row.__bfoWatched && 'To watch', row.__bfoGreen && 'OK'].filter(Boolean).join(', ');

function Tile({ label, totals, note }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.6rem 0.75rem', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: '0.8rem', color: '#1E293B' }}>{label}</strong>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.65rem', color: '#64748B' }}>{totals.count} deal{totals.count === 1 ? '' : 's'}</span>
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', fontVariantNumeric: 'tabular-nums', marginTop: 2 }} title={`Expected monthly commission x ${PROJECTION_MONTHS}`}>
        {fmtCurrency(totals.projected)} <span style={{ fontSize: '0.68rem', fontWeight: 500, color: '#64748B' }}>projected over {PROJECTION_MONTHS} months</span>
      </div>
      <div style={{ fontSize: '0.68rem', color: '#64748B', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        {fmtCurrency(totals.expectedMonthly)}/mo expected · {fmtCurrency(totals.paidSoFar)} paid so far · {fmtCurrency(totals.remaining)} still to come
      </div>
      {note && <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export function CommissionsProjectedView({ items, settings, updateSettings }) {
  const totals = useMemo(() => projectionTotals(items), [items]);
  const unpriced = useMemo(() => (items || []).filter(r => r.projection.expectedMonthly == null).length, [items]);

  // This month and the next three, with each row's expected commission in
  // each (0 outside its Comm Start - End window).
  const months = useMemo(() => upcomingMonths(new Date()), []);
  const rows = useMemo(() => {
    const today = new Date();
    return (items || []).map((r) => {
      const byMonth = {};
      let upcoming = 0;
      let anyPriced = false;
      for (const m of months) {
        const v = expectedForMonth(r, r.projection, m, today);
        byMonth[m.key] = v;
        if (v != null) { upcoming += v; anyPriced = true; }
      }
      return { ...r, __byMonth: byMonth, __upcoming: anyPriced ? upcoming : null };
    });
  }, [items, months]);
  const monthTotals = useMemo(() => months.map(m => ({
    ...m,
    total: rows.reduce((s, r) => s + (r.__byMonth[m.key] || 0), 0),
    deals: rows.reduce((n, r) => n + (r.__byMonth[m.key] ? 1 : 0), 0),
  })), [months, rows]);
  const upcomingTotal = monthTotals.reduce((s, m) => s + m.total, 0);
  const upcomingLabel = `${months[0].label.split(' ')[0]} - ${months[months.length - 1].label}`;

  const columns = useMemo(() => [
    {
      key: '__category', label: 'Projection', defaultWidth: 120,
      getSortValue: (row) => CATEGORY[row.projection.category].label,
      getFilterValue: (row) => CATEGORY[row.projection.category].label,
      render: (row) => {
        const c = CATEGORY[row.projection.category];
        return <span title={c.title} style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{c.label}</span>;
      },
      exportValue: (row) => CATEGORY[row.projection.category].label,
    },
    {
      key: '__payment', label: 'Payment Status', defaultWidth: 140,
      getSortValue: (row) => paymentLabel(row) || null,
      getFilterValue: (row) => paymentLabel(row),
      render: (row) => {
        const p = row.__bfoPayment;
        if (!p) return <span title="No expected commission to compare against (no linked deal)">{muted}</span>;
        const diff = p.actual - p.expected;
        return pill(
          BFO_PAYMENT_STATUS_LABEL[p.status],
          PAY_STYLE[p.status],
          `Commission actual ${fmtCurrency(p.actual)} (recorded + projected) against expected ${fmtCurrency(p.expected)}${p.status === 'exact' ? '' : `, ${p.status} by ${fmtCurrency(Math.abs(diff))}`}`,
        );
      },
      exportValue: (row) => paymentLabel(row),
    },
    {
      key: '__review', label: 'Watch / OK', defaultWidth: 140,
      getSortValue: (row) => reviewLabel(row) || null,
      getFilterValue: (row) => reviewLabel(row),
      render: (row) => {
        if (!row.__bfoWatched && !row.__bfoGreen) return muted;
        return (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {row.__bfoWatched && pill('To watch', { bg: '#FEF9C3', fg: '#854D0E' }, 'Flagged To watch in the BFO popup')}
            {row.__bfoGreen && pill('OK', { bg: '#DCFCE7', fg: '#166534' }, 'BFO popup is all green: every cell matches Expected or is marked OK')}
          </span>
        );
      },
      exportValue: (row) => reviewLabel(row),
    },
    { key: 'Account Name', label: 'Account Name', defaultWidth: 180, render: (row) => row['Account Name'] || muted },
    { key: 'Project Name', label: 'Project Name', defaultWidth: 280, render: (row) => row['Project Name'] || row['Name'] || muted },
    { key: 'BFO Name', label: 'BFO Name', defaultWidth: 180, render: (row) => row['BFO Name'] || muted },
    {
      key: 'Comm Start Date', label: 'Comm Start Date', defaultWidth: 120,
      getSortValue: (row) => asDate(row['Comm Start Date'])?.getTime() ?? null,
      render: (row) => (asDate(row['Comm Start Date']) ? fmtDate(row['Comm Start Date']) : muted),
      exportValue: (row) => (asDate(row['Comm Start Date']) ? fmtDate(row['Comm Start Date']) : ''),
    },
    {
      key: 'Comm End Date', label: 'Comm End Date', defaultWidth: 120,
      getSortValue: (row) => asDate(row['Comm End Date'])?.getTime() ?? null,
      render: (row) => (asDate(row['Comm End Date']) ? fmtDate(row['Comm End Date']) : muted),
      exportValue: (row) => (asDate(row['Comm End Date']) ? fmtDate(row['Comm End Date']) : ''),
    },
    { key: '%', label: '%', defaultWidth: 70, render: (row) => (row['%'] !== '' && row['%'] != null ? fmtPercent(row['%']) : muted) },
    {
      key: '__monthsPaid', label: 'Months Paid', defaultWidth: 100,
      getSortValue: (row) => row.projection.monthsPaid,
      render: (row) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{row.projection.monthsPaid} of {PROJECTION_MONTHS}</span>,
      exportValue: (row) => row.projection.monthsPaid,
    },
    {
      key: '__paidSoFar', label: 'Paid So Far', defaultWidth: 120,
      getSortValue: (row) => row.projection.paidSoFar,
      render: (row) => money(row.projection.paidSoFar || null),
      exportValue: (row) => row.projection.paidSoFar || '',
    },
    {
      key: '__currentMonthly', label: 'Current Monthly', defaultWidth: 130,
      getSortValue: (row) => row.projection.currentMonthly,
      render: (row) => (row.projection.currentMonthly == null
        ? muted
        : <span title={`Paid in ${row.projection.currentMonth}`}>{money(row.projection.currentMonthly)}</span>),
      exportValue: (row) => row.projection.currentMonthly ?? '',
    },
    {
      key: '__expectedMonthly', label: 'Expected Monthly', defaultWidth: 140,
      getSortValue: (row) => row.projection.expectedMonthly,
      render: (row) => <span title={row.projection.expectedSource}>{money(row.projection.expectedMonthly)}</span>,
      exportValue: (row) => row.projection.expectedMonthly ?? '',
    },
    {
      key: '__projected', label: `Projected ${PROJECTION_MONTHS}-Mo`, defaultWidth: 140,
      getSortValue: (row) => row.projection.projected,
      render: (row) => <span title={`Expected monthly x ${PROJECTION_MONTHS}`}>{money(row.projection.projected, true)}</span>,
      exportValue: (row) => row.projection.projected ?? '',
    },
    {
      key: '__remaining', label: 'Still To Come', defaultWidth: 130,
      getSortValue: (row) => row.projection.remaining,
      render: (row) => <span title={`Projected ${PROJECTION_MONTHS}-month commission less what has been paid so far`}>{money(row.projection.remaining)}</span>,
      exportValue: (row) => row.projection.remaining ?? '',
    },
    ...months.map((m, i) => ({
      key: `__month:${i}`,
      label: i === 0 ? `${m.label} (This Month)` : m.label,
      defaultWidth: i === 0 ? 150 : 110,
      getSortValue: (row) => row.__byMonth[m.key],
      render: (row) => {
        const v = row.__byMonth[m.key];
        if (v === 0) return <span title={`${m.label} is outside this commission's Comm Start - End window`} style={{ color: 'var(--color-text-muted)' }}>$0</span>;
        return <span title={`Expected commission for ${m.label}`}>{money(v)}</span>;
      },
      exportValue: (row) => row.__byMonth[m.key] ?? '',
    })),
    {
      key: '__upcoming', label: `Next ${months.length} Months`, defaultWidth: 130,
      getSortValue: (row) => row.__upcoming,
      render: (row) => <span title={`Expected commission ${upcomingLabel}`}>{money(row.__upcoming, true)}</span>,
      exportValue: (row) => row.__upcoming ?? '',
    },
  ], [months, upcomingLabel]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.5rem' }}>
          Commissions being paid now and ones not paid yet, projected over {PROJECTION_MONTHS} months of payments. A deal being paid is projected at its latest month&apos;s commission. A deal not paid yet is projected from its monthly revenue x %, or from the linked opp&apos;s Quoted Amount x % / 12. Hover an Expected Monthly cell to see where it came from. The month columns spread the expected monthly amount over this month and the next three, inside each deal's Comm Start - End window.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.5rem' }}>
          <Tile label="Being paid" totals={totals.paying} />
          <Tile label="Not yet paid" totals={totals.notYet} note={unpriced ? `${unpriced} deal${unpriced === 1 ? ' has' : 's have'} no expected amount yet (no revenue or Quoted Amount to go on).` : ''} />
          <Tile label="Total" totals={totals.all} />
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {monthTotals.map((m, i) => (
            <div key={m.key} title={`Expected commission for ${m.label} across ${m.deals} deal${m.deals === 1 ? '' : 's'}`} style={{ background: i === 0 ? '#EFF6FF' : '#fff', border: `1px solid ${i === 0 ? '#BFDBFE' : 'var(--color-border)'}`, borderRadius: 8, padding: '0.4rem 0.7rem', minWidth: 130 }}>
              <div style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>{m.label}{i === 0 ? ' (this month)' : ''}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(m.total)}</div>
              <div style={{ fontSize: '0.62rem', color: '#94A3B8' }}>{m.deals} deal{m.deals === 1 ? '' : 's'}</div>
            </div>
          ))}
          <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '0.4rem 0.7rem', minWidth: 150 }}>
            <div style={{ fontSize: '0.68rem', color: '#166534', fontWeight: 600 }}>{upcomingLabel}</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#14532D', fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(upcomingTotal)}</div>
            <div style={{ fontSize: '0.62rem', color: '#16A34A' }}>Export Excel includes each month</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <DataTable
          tableId="commissions-projected"
          columns={columns}
          rows={rows}
          defaultSort={{ key: '__projected', direction: 'desc' }}
          emptyMessage="No commissions being paid or waiting to start."
          exportFileName="Commissions Projected"
          exportPrimarySheetName="Projected"
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
