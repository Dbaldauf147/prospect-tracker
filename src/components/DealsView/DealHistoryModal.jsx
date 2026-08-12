import { useMemo } from 'react';
import { asNumber, asDate, fmtCurrency, fmtDate, fmtPercent } from '../../utils/dealsFormat';
import { DEAL_BFO_KEY, matchCommissionRowsForDeal } from '../../utils/dealCommissions';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';

// Row-level drill-down for a deal: what the contract says the deal should
// bring in (expected) against what the Commissions tab has actually
// recorded and paid (actual), plus the month-by-month history behind both
// numbers. The two metrics track the same pair the Deals grid shows in its
// Revenue Recorded / Paid to Date cells, so this modal is the long-form
// version of those two cells side by side:
//
//   • Revenue    — expected = Setup + Recurring Revenue (contract value)
//                  actual   = the "<Month> Revenue" cells on every
//                             Commissions row mapped to this deal's BFO name
//   • Commission — expected = the deal's Commission amount
//                  actual   = the "<Month>" commission cells on those rows
//
// When no Commissions row maps to the deal we fall back to whatever is
// stored on the deal's own Revenue Recorded / Paid to Date cells, exactly
// as the grid does, and say so in the read-out.

const MONTH_ABBR = COMMISSION_MONTH_NAMES.map((m) => m.slice(0, 3));

// Whole calendar months from `a` through `b`, inclusive of both endpoints'
// months. Returns null when either date is missing.
function monthsInclusive(a, b) {
  if (!a || !b) return null;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

// [a, a+b, a+b+c, …] — the cumulative row under each monthly series.
function runningTotal(series) {
  const out = [];
  let sum = 0;
  for (const n of series) { sum += n; out.push(sum); }
  return out;
}

function minDate(dates) {
  return dates.length ? dates.reduce((m, d) => (d.getTime() < m.getTime() ? d : m)) : null;
}
function maxDate(dates) {
  return dates.length ? dates.reduce((m, d) => (d.getTime() > m.getTime() ? d : m)) : null;
}

// Same status vocabulary as the grid cell and the per-metric breakdown:
// match → green, over → gold, short → red, nothing yet → grey.
function statusFor(actual, expected) {
  if (actual === 0 && expected === 0) return { label: 'Nothing on file yet', bg: '#F1F5F9', fg: '#475569', border: '#E2E8F0' };
  if (actual === expected) return { label: 'Matches expected', bg: '#DCFCE7', fg: '#166534', border: '#BBF7D0' };
  if (actual > expected) return { label: `Over by ${fmtCurrency(actual - expected)}`, bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' };
  return { label: `Short by ${fmtCurrency(expected - actual)}`, bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' };
}

// Formatted manually rather than via fmtPercent — that helper treats any
// value ≤ 1 as a fraction and multiplies by 100, which misreads both tiny
// ratios and over-100% (over-collected) ratios here.
function pctText(actual, expected) {
  if (!expected) return null;
  return `${((actual / expected) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function Figure({ label, value, sub, fg = '#334155' }) {
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums', marginTop: '0.1rem' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.66rem', color: '#94A3B8', marginTop: '0.1rem' }}>{sub}</div>}
    </div>
  );
}

// Horizontal "collected against expected" bar. The filled portion is the
// actual; the dashed marker is where a straight-line pace through the
// commission window says the deal should be by today, so a deal that is
// simply young reads as on-pace rather than short.
function ProgressBar({ actual, expected, pace, color }) {
  if (!expected) return null;
  const pct = Math.max(0, Math.min(100, (actual / expected) * 100));
  const pacePct = pace == null ? null : Math.max(0, Math.min(100, (pace / expected) * 100));
  return (
    <div style={{ position: 'relative', height: 8, background: '#E2E8F0', borderRadius: 999, marginTop: '0.5rem' }}>
      <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: color, borderRadius: 999 }} />
      {pacePct != null && (
        <div
          title={`Straight-line pace to date: ${fmtCurrency(pace)}`}
          style={{ position: 'absolute', top: -2, bottom: -2, left: `calc(${pacePct}% - 1px)`, width: 2, background: '#0F172A', opacity: 0.55, borderRadius: 2 }}
        />
      )}
    </div>
  );
}

// One metric block: expected, actual, delta, and the pace read-out.
function MetricPanel({ metric, onOpenBreakdown }) {
  const { title, expected, expectedFormula, actual, actualSource, pace, paceFormula, color, breakdownKey } = metric;
  const delta = actual - expected;
  const status = statusFor(actual, expected);
  const pctOfExpected = pctText(actual, expected);
  const paceDelta = pace == null ? null : actual - pace;

  return (
    <div style={{ flex: '1 1 320px', minWidth: 280, border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.75rem 0.85rem', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A' }}>{title}</div>
        <span style={{ padding: '2px 9px', borderRadius: 999, background: status.bg, color: status.fg, border: `1px solid ${status.border}`, fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {status.label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.6rem' }}>
        <Figure label="Expected" value={fmtCurrency(expected)} sub={expectedFormula} />
        <Figure label="Actual" value={fmtCurrency(actual)} sub={actualSource} fg={status.fg === '#475569' ? '#334155' : status.fg} />
        <Figure
          label={delta >= 0 ? 'Surplus' : 'Remaining'}
          value={fmtCurrency(Math.abs(delta))}
          sub={pctOfExpected ? `${pctOfExpected} of expected` : 'no expected amount on file'}
        />
      </div>

      <ProgressBar actual={actual} expected={expected} pace={pace} color={color} />

      <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.45rem', lineHeight: 1.45 }}>
        {pace == null ? (
          <span style={{ color: '#94A3B8' }}>
            No commission window on file (Comm Start / End Date), so there’s no pace to measure against — only the contract total above.
          </span>
        ) : (
          <>
            <strong style={{ color: '#334155' }}>Expected to date: {fmtCurrency(pace)}</strong>{' '}
            <span style={{ color: '#94A3B8' }}>({paceFormula})</span>
            <div style={{ marginTop: '0.15rem', color: paceDelta >= 0 ? '#166534' : '#991B1B', fontWeight: 600 }}>
              {paceDelta >= 0
                ? `${fmtCurrency(paceDelta)} ahead of pace`
                : `${fmtCurrency(-paceDelta)} behind pace`}
            </div>
          </>
        )}
      </div>

      {onOpenBreakdown && (
        <button
          type="button"
          onClick={() => onOpenBreakdown(breakdownKey)}
          style={{ marginTop: '0.55rem', background: 'transparent', border: '1px solid #CBD5E1', borderRadius: 6, color: '#334155', fontSize: '0.68rem', fontWeight: 600, padding: '3px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Per-project monthly breakdown →
        </button>
      )}
    </div>
  );
}

export function DealHistoryModal({ deal, commissionsRows, onClose, onOpenBreakdown }) {
  const model = useMemo(() => {
    const matches = matchCommissionRowsForDeal(deal, commissionsRows);

    // Per-project monthly series for both metrics, and the column totals
    // that drive the history table.
    const projects = matches.map((r) => {
      const revenue = COMMISSION_MONTH_NAMES.map((m) => asNumber(r?.[`${m} Revenue`]) ?? 0);
      const commission = COMMISSION_MONTH_NAMES.map((m) => asNumber(r?.[m]) ?? 0);
      // Label each row by the Commissions tab's Project Name, falling back
      // to the pasted opportunity Name. Use || (not ??) so a present-but-
      // blank Project Name still falls through.
      const projectName = String(r?.['Project Name'] ?? '').trim();
      const recordName = String(r?.['Name'] ?? '').trim();
      const name = projectName || recordName || '(unnamed project)';
      return {
        name,
        // Keep the opportunity Name as a secondary line whenever it differs
        // from the shown label, so two commission rows sharing a Project
        // Name stay individually identifiable.
        sub: recordName && recordName !== name ? recordName : '',
        start: asDate(r?.['Comm Start Date']),
        end: asDate(r?.['Comm End Date']),
        rate: r?.['%'],
        revenue,
        commission,
        revenueTotal: revenue.reduce((s, n) => s + n, 0),
        commissionTotal: commission.reduce((s, n) => s + n, 0),
      };
    });

    const revenueByMonth = COMMISSION_MONTH_NAMES.map((_, i) => projects.reduce((s, p) => s + p.revenue[i], 0));
    const commissionByMonth = COMMISSION_MONTH_NAMES.map((_, i) => projects.reduce((s, p) => s + p.commission[i], 0));
    // Running totals down the month columns — the "history" half of the
    // question: not just what has landed, but when it landed.
    const cumulativeRevenue = runningTotal(revenueByMonth);
    const cumulativeCommission = runningTotal(commissionByMonth);

    // Contract side of the comparison — identical to what the grid's
    // Revenue Recorded / Paid to Date denominators use.
    const setup = asNumber(deal?.['Setup']) ?? 0;
    const recurring = asNumber(deal?.['Recurring Revenue']) ?? 0;
    const expectedRevenue = setup + recurring;
    const expectedCommission = asNumber(deal?.['Commission']) ?? 0;

    // Mapped Commissions rows are the source of truth for the actuals. With
    // none mapped, fall back to the deal's own stored cells so a legacy
    // hand-typed deal still reads sensibly — same fallback the grid uses.
    const mapped = projects.length > 0;
    const actualRevenue = mapped
      ? revenueByMonth.reduce((s, n) => s + n, 0)
      : (asNumber(deal?.['Revenue Recorded']) ?? 0);
    const actualCommission = mapped
      ? commissionByMonth.reduce((s, n) => s + n, 0)
      : (asNumber(deal?.['Paid to Date']) ?? 0);

    // Commission window: earliest start / latest end across the mapped
    // rows, falling back to the deal's own contract dates when the
    // Commissions tab doesn't carry them.
    const start = minDate(projects.map((p) => p.start).filter(Boolean))
      || asDate(deal?.['Current Term Start Date'])
      || asDate(deal?.['Original Contract Start']);
    const end = maxDate(projects.map((p) => p.end).filter(Boolean))
      || asDate(deal?.['End Date']);
    const span = monthsInclusive(start, end);
    const today = new Date();
    let elapsed = null;
    if (span && span > 0) {
      const raw = monthsInclusive(start, today);
      elapsed = Math.max(0, Math.min(span, raw));
    }

    // Straight-line pace. Setup is a one-time fee so it's expected in full
    // the moment the window opens; recurring revenue and the commission
    // accrue evenly across the window's months.
    let paceRevenue = null;
    let paceCommission = null;
    if (elapsed != null && span) {
      const frac = elapsed / span;
      paceRevenue = (elapsed > 0 ? setup : 0) + recurring * frac;
      paceCommission = expectedCommission * frac;
    }

    // Only render month columns that carry data on either metric, so the
    // table stays scannable instead of always showing all twelve.
    const activeMonthIdx = COMMISSION_MONTH_NAMES
      .map((_, i) => i)
      .filter((i) => revenueByMonth[i] !== 0 || commissionByMonth[i] !== 0);

    return {
      projects, revenueByMonth, commissionByMonth, activeMonthIdx,
    cumulativeRevenue, cumulativeCommission,
      expectedRevenue, expectedCommission, actualRevenue, actualCommission,
      mapped, setup, recurring, start, end, span, elapsed,
      paceRevenue, paceCommission,
    };
  }, [deal, commissionsRows]);

  const {
    projects, revenueByMonth, commissionByMonth, activeMonthIdx,
    cumulativeRevenue, cumulativeCommission,
    expectedRevenue, expectedCommission, actualRevenue, actualCommission,
    mapped, setup, recurring, start, end, span, elapsed,
    paceRevenue, paceCommission,
  } = model;

  const bfoRaw = String(deal?.[DEAL_BFO_KEY] ?? '').trim();
  const dealName = String(deal?.['Client Name'] ?? '').trim() || String(deal?.['Agreement Name'] ?? '').trim() || '(unnamed deal)';
  const agreement = String(deal?.['Agreement Name'] ?? '').trim();
  const sourceNote = mapped
    ? `${projects.length} mapped commission row${projects.length === 1 ? '' : 's'}`
    : 'from the deal’s stored cell — no Commissions rows mapped';

  const paceWindowNote = elapsed != null && span
    ? `month ${elapsed} of ${span}`
    : null;

  const metrics = [
    {
      title: 'Revenue',
      breakdownKey: 'revenue',
      expected: expectedRevenue,
      expectedFormula: `Setup ${fmtCurrency(setup)} + Recurring ${fmtCurrency(recurring)}`,
      actual: actualRevenue,
      actualSource: sourceNote,
      pace: paceRevenue,
      paceFormula: paceWindowNote ? `Setup up front + recurring straight-line, ${paceWindowNote}` : '',
      color: '#3B82F6',
    },
    {
      title: 'Commission',
      breakdownKey: 'paid',
      expected: expectedCommission,
      expectedFormula: deal?.['Commission Rate'] != null && String(deal['Commission Rate']).trim() !== ''
        ? `Commission owed · rate ${fmtPercent(deal['Commission Rate'])}`
        : 'Commission owed on this deal',
      actual: actualCommission,
      actualSource: sourceNote,
      pace: paceCommission,
      paceFormula: paceWindowNote ? `straight-line across the window, ${paceWindowNote}` : '',
      color: '#8B5CF6',
    },
  ];

  const th = { textAlign: 'right', padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', color: '#475569', fontWeight: 600 };
  const thLeft = { ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#F1F5F9', minWidth: 170 };
  const td = { textAlign: 'right', padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', fontVariantNumeric: 'tabular-nums' };
  const tdLeft = { ...td, textAlign: 'left', position: 'sticky', left: 0, background: '#fff', color: '#334155', fontWeight: 600 };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 4900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ background: '#fff', borderRadius: 8, width: 'min(1040px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1.1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>
              {dealName} — commissions &amp; revenue history
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem', lineHeight: 1.5 }}>
              {agreement && agreement !== dealName && <>{agreement} · </>}
              {bfoRaw
                ? <>mapped to BFO <strong style={{ color: '#334155' }}>“{bfoRaw}”</strong></>
                : <span style={{ color: '#B91C1C' }}>no BFO name set on this deal</span>}
              {(start || end) && (
                <> · window <strong style={{ color: '#334155' }}>{start ? fmtDate(start) : '?'} – {end ? fmtDate(end) : '?'}</strong>
                  {span ? <> ({span} month{span === 1 ? '' : 's'})</> : null}
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
          >×</button>
        </div>

        <div style={{ overflow: 'auto', padding: '0.9rem 1.1rem 1.1rem' }}>
          {/* Expected vs actual, one panel per metric */}
          <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
            {metrics.map((m) => (
              <MetricPanel
                key={m.breakdownKey}
                metric={m}
                onOpenBreakdown={mapped && onOpenBreakdown ? onOpenBreakdown : null}
              />
            ))}
          </div>

          {/* Month-by-month history */}
          <div style={{ marginTop: '1.1rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>Month-by-month history</div>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.1rem' }}>
              Actuals as recorded on the Commissions tab, with the running total after each month.
            </div>
            {!bfoRaw ? (
              <div style={{ marginTop: '0.5rem', padding: '0.75rem', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.75rem' }}>
                This deal has no BFO opportunity name, so nothing on the Commissions tab can be mapped to it. Set the deal’s BFO name to pull in its commission history.
              </div>
            ) : projects.length === 0 ? (
              <div style={{ marginTop: '0.5rem', padding: '0.75rem', color: '#991B1B', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 6, fontSize: '0.75rem' }}>
                No Commissions-tab rows are mapped to “{bfoRaw}”. Add a matching <strong>BFO Name</strong> on the Commissions tab to record revenue and commissions against this deal.
              </div>
            ) : activeMonthIdx.length === 0 ? (
              <div style={{ marginTop: '0.5rem', padding: '0.75rem', color: '#475569', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.75rem' }}>
                {projects.length} commission row{projects.length === 1 ? ' is' : 's are'} mapped to this deal, but no month carries an amount yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: '0.45rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr style={{ background: '#F1F5F9' }}>
                      <th style={thLeft}>&nbsp;</th>
                      {activeMonthIdx.map((i) => <th key={i} style={th}>{MONTH_ABBR[i]}</th>)}
                      <th style={{ ...th, color: '#0F172A' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={tdLeft}>Revenue</td>
                      {activeMonthIdx.map((i) => (
                        <td key={i} style={{ ...td, color: revenueByMonth[i] ? '#0F172A' : '#CBD5E1' }}>
                          {revenueByMonth[i] ? fmtCurrency(revenueByMonth[i]) : '-'}
                        </td>
                      ))}
                      <td style={{ ...td, fontWeight: 700, color: '#0F172A' }}>{fmtCurrency(actualRevenue)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdLeft, fontWeight: 400, color: '#94A3B8', paddingLeft: '1.1rem' }}>cumulative</td>
                      {activeMonthIdx.map((i) => (
                        <td key={i} style={{ ...td, color: '#94A3B8' }}>{fmtCurrency(cumulativeRevenue[i])}</td>
                      ))}
                      <td style={{ ...td, color: '#94A3B8' }} />
                    </tr>
                    <tr>
                      <td style={tdLeft}>Commission</td>
                      {activeMonthIdx.map((i) => (
                        <td key={i} style={{ ...td, color: commissionByMonth[i] ? '#0F172A' : '#CBD5E1' }}>
                          {commissionByMonth[i] ? fmtCurrency(commissionByMonth[i]) : '-'}
                        </td>
                      ))}
                      <td style={{ ...td, fontWeight: 700, color: '#0F172A' }}>{fmtCurrency(actualCommission)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdLeft, fontWeight: 400, color: '#94A3B8', paddingLeft: '1.1rem' }}>cumulative</td>
                      {activeMonthIdx.map((i) => (
                        <td key={i} style={{ ...td, color: '#94A3B8' }}>{fmtCurrency(cumulativeCommission[i])}</td>
                      ))}
                      <td style={{ ...td, color: '#94A3B8' }} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Per-project totals */}
          {projects.length > 0 && (
            <div style={{ marginTop: '1.1rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>Mapped commission rows</div>
              <div style={{ overflowX: 'auto', marginTop: '0.45rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr style={{ background: '#F1F5F9' }}>
                      <th style={{ ...thLeft, minWidth: 220 }}>Project</th>
                      <th style={{ ...th, textAlign: 'left' }}>Comm window</th>
                      <th style={th}>Rate</th>
                      <th style={th}>Revenue</th>
                      <th style={th}>Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p, i) => (
                      <tr key={i}>
                        <td style={tdLeft}>
                          <div>{p.name}</div>
                          {p.sub && <div style={{ fontSize: '0.66rem', color: '#94A3B8', fontWeight: 400 }}>{p.sub}</div>}
                        </td>
                        <td style={{ ...td, textAlign: 'left', color: '#475569' }}>
                          {p.start || p.end ? `${p.start ? fmtDate(p.start) : '?'} – ${p.end ? fmtDate(p.end) : '?'}` : <span style={{ color: '#CBD5E1' }}>-</span>}
                        </td>
                        <td style={{ ...td, color: '#475569' }}>
                          {p.rate == null || String(p.rate).trim() === '' ? <span style={{ color: '#CBD5E1' }}>-</span> : fmtPercent(p.rate)}
                        </td>
                        <td style={{ ...td, color: '#0F172A' }}>{fmtCurrency(p.revenueTotal)}</td>
                        <td style={{ ...td, color: '#0F172A' }}>{fmtCurrency(p.commissionTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F8FAFC' }}>
                      <td style={{ ...tdLeft, background: '#F8FAFC' }}>Total</td>
                      <td style={td} />
                      <td style={td} />
                      <td style={{ ...td, fontWeight: 700, color: '#0F172A' }}>{fmtCurrency(actualRevenue)}</td>
                      <td style={{ ...td, fontWeight: 700, color: '#0F172A' }}>{fmtCurrency(actualCommission)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
