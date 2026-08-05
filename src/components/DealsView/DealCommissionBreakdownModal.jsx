import { useMemo } from 'react';
import { asNumber, fmtCurrency } from '../../utils/dealsFormat';
import { DEAL_BFO_KEY, normBfo } from '../../utils/dealCommissions';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';

// Per-metric configuration for the breakdown. `revenue` maps to the
// Commissions tab's monthly revenue cells ("January Revenue" …) and is
// measured against the deal's contract value (Setup + Recurring Revenue);
// `paid` maps to the monthly commission cells ("January" …) and is measured
// against the deal's Commission amount. This mirrors exactly how the
// Revenue Recorded / Paid to Date cells compute their numerator and
// denominator in DealsView, so the modal always agrees with the grid cell.
const METRICS = {
  revenue: {
    title: 'Revenue Recorded',
    monthKey: (m) => `${m} Revenue`,
    receivedLabel: 'Revenue recorded',
    expectedLabel: 'Contract value',
    expectedFormula: 'Setup + Recurring Revenue',
    expectedOf: (deal) => (asNumber(deal?.['Setup']) ?? 0) + (asNumber(deal?.['Recurring Revenue']) ?? 0),
  },
  paid: {
    title: 'Paid to Date',
    monthKey: (m) => m,
    receivedLabel: 'Commission paid',
    expectedLabel: 'Commission owed',
    expectedFormula: 'Commission',
    expectedOf: (deal) => asNumber(deal?.['Commission']) ?? 0,
  },
};

// Sum the metric's 12 monthly cells on a single commission row.
function monthlyValues(row, metric) {
  return COMMISSION_MONTH_NAMES.map((m) => asNumber(row?.[metric.monthKey(m)]) ?? 0);
}

function StatCard({ label, value, sub, bg, fg, border }) {
  return (
    <div style={{ flex: 1, minWidth: 150, padding: '0.6rem 0.75rem', background: bg, border: `1px solid ${border}`, borderRadius: 8 }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: fg, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums', marginTop: '0.15rem' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: fg, opacity: 0.8, marginTop: '0.1rem' }}>{sub}</div>}
    </div>
  );
}

// Breakdown popup for a deal's Revenue Recorded / Paid to Date cell. Lists
// every Commissions-tab row mapped to the deal (by BFO Name), broken down
// month by month, and compares the mapped total (received) against what the
// deal expects (contract value / commission owed).
export function DealCommissionBreakdownModal({ deal, metric: metricKey, commissionsRows, onClose }) {
  const metric = METRICS[metricKey] || METRICS.revenue;
  const bfoRaw = String(deal?.[DEAL_BFO_KEY] ?? '').trim();

  const model = useMemo(() => {
    const bfo = normBfo(bfoRaw);
    const matches = bfo
      ? (commissionsRows || []).filter((r) => normBfo(r?.['BFO Name']) === bfo)
      : [];
    const projects = matches.map((r) => {
      const months = monthlyValues(r, metric);
      // Label each row by the Commissions tab's "Project Name" column.
      // Use || (not ??) so a present-but-blank Project Name still falls
      // through to the pasted opportunity Name instead of rendering as
      // "(unnamed project)".
      const projectName = String(r?.['Project Name'] ?? '').trim();
      const recordName = String(r?.['Name'] ?? '').trim();
      const name = projectName || recordName || '(unnamed project)';
      // Keep the opportunity Name as a secondary line whenever it differs
      // from the shown label, so two commission rows that share the same
      // Project Name stay split out and individually identifiable rather
      // than reading as one collapsed row.
      const sub = recordName && recordName !== name ? recordName : '';
      return {
        name,
        sub,
        months,
        total: months.reduce((s, n) => s + n, 0),
      };
    });
    // Which month columns have any value across the mapped rows — keeps the
    // table to the months that actually carry data instead of all 12.
    const activeMonthIdx = COMMISSION_MONTH_NAMES
      .map((_, i) => i)
      .filter((i) => projects.some((p) => p.months[i] !== 0));
    const received = projects.reduce((s, p) => s + p.total, 0);
    const expected = metric.expectedOf(deal);
    return { projects, activeMonthIdx, received, expected };
  }, [bfoRaw, commissionsRows, metric, deal]);

  const { projects, activeMonthIdx, received, expected } = model;
  const delta = received - expected;
  // Formatted manually rather than via fmtPercent — that helper treats any
  // value ≤ 1 as a fraction and multiplies by 100, which misreads both tiny
  // ratios and over-100% (over-paid) ratios here.
  const pctText = expected !== 0
    ? `${((received / expected) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
    : null;

  // Same status vocabulary as the grid cell: match → green, over → gold,
  // short → red, nothing yet → grey.
  let status;
  if (received === 0 && expected === 0) status = { label: 'No amounts yet', bg: '#F1F5F9', fg: '#475569', border: '#E2E8F0' };
  else if (received === expected) status = { label: 'Matches expected', bg: '#DCFCE7', fg: '#166534', border: '#BBF7D0' };
  else if (received > expected) status = { label: `Over by ${fmtCurrency(received - expected)}`, bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' };
  else status = { label: `Short by ${fmtCurrency(expected - received)}`, bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' };

  const dealName = String(deal?.['Client Name'] ?? '').trim() || String(deal?.['Agreement Name'] ?? '').trim() || '(unnamed deal)';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ background: '#fff', borderRadius: 8, width: 'min(900px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1.1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>{metric.title} breakdown</div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.15rem' }}>
              {dealName}
              {bfoRaw
                ? <> · mapped to BFO <strong style={{ color: '#334155' }}>“{bfoRaw}”</strong></>
                : <> · <span style={{ color: '#B91C1C' }}>no BFO name set on this deal</span></>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
          >×</button>
        </div>

        {/* Analysis: expected vs received */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', padding: '0.9rem 1.1rem', borderBottom: '1px solid #F1F5F9' }}>
          <StatCard
            label={metric.expectedLabel}
            value={fmtCurrency(expected)}
            sub={metric.expectedFormula}
            bg="#F8FAFC" fg="#334155" border="#E2E8F0"
          />
          <StatCard
            label={metric.receivedLabel}
            value={fmtCurrency(received)}
            sub={`${projects.length} mapped commission row${projects.length === 1 ? '' : 's'}`}
            bg="#EFF6FF" fg="#1E40AF" border="#BFDBFE"
          />
          <StatCard
            label={delta >= 0 ? 'Over / surplus' : 'Short / remaining'}
            value={fmtCurrency(Math.abs(delta))}
            sub={pctText != null ? `${pctText} of expected received` : 'no expected amount on file'}
            bg={status.bg} fg={status.fg} border={status.border}
          />
        </div>

        {/* Status line */}
        <div style={{ padding: '0.5rem 1.1rem', borderBottom: '1px solid #F1F5F9' }}>
          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: status.bg, color: status.fg, border: `1px solid ${status.border}`, fontSize: '0.72rem', fontWeight: 700 }}>
            {status.label}
          </span>
        </div>

        {/* Per-project, per-month breakdown */}
        <div style={{ padding: '0.5rem 1.1rem 1rem', overflow: 'auto' }}>
          {bfoRaw === '' ? (
            <div style={{ padding: '1rem', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.78rem' }}>
              This deal has no BFO name, so nothing on the Commissions tab can be mapped to it. Set the deal’s BFO opportunity name to pull in commission data.
            </div>
          ) : projects.length === 0 ? (
            <div style={{ padding: '1rem', color: '#991B1B', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 6, fontSize: '0.78rem' }}>
              No Commissions-tab rows are mapped to “{bfoRaw}”. Add a matching <strong>BFO Name</strong> on the Commissions tab to record {metric.title.toLowerCase()} for this deal.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                <thead>
                  <tr style={{ background: '#F1F5F9' }}>
                    <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', position: 'sticky', left: 0, background: '#F1F5F9', minWidth: 180 }}>Project</th>
                    {activeMonthIdx.map((i) => (
                      <th key={i} style={{ textAlign: 'right', padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', color: '#475569' }}>
                        {COMMISSION_MONTH_NAMES[i].slice(0, 3)}
                      </th>
                    ))}
                    <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', color: '#0F172A' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p, r) => (
                    <tr key={r}>
                      <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', position: 'sticky', left: 0, background: '#fff', color: '#334155' }}>
                        <div>{p.name}</div>
                        {p.sub && <div style={{ fontSize: '0.66rem', color: '#94A3B8', marginTop: '0.1rem' }}>{p.sub}</div>}
                      </td>
                      {activeMonthIdx.map((i) => (
                        <td key={i} style={{ textAlign: 'right', padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', fontVariantNumeric: 'tabular-nums', color: p.months[i] ? '#0F172A' : '#CBD5E1' }}>
                          {p.months[i] ? fmtCurrency(p.months[i]) : '-'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0F172A' }}>{fmtCurrency(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#F8FAFC' }}>
                    <td style={{ padding: '0.4rem 0.5rem', fontWeight: 700, color: '#0F172A', position: 'sticky', left: 0, background: '#F8FAFC' }}>Received total</td>
                    {activeMonthIdx.map((i) => {
                      const colTotal = projects.reduce((s, p) => s + p.months[i], 0);
                      return (
                        <td key={i} style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: colTotal ? '#0F172A' : '#CBD5E1' }}>
                          {colTotal ? fmtCurrency(colTotal) : '-'}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0F172A' }}>{fmtCurrency(received)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
