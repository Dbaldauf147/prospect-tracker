import { useEffect, useMemo } from 'react';
import { fmtCurrency, asNumber } from '../../utils/dealsFormat';
import { buildBfoSchedule } from '../../utils/commissionBfoSchedule';

// Commissions > All / Actively Paid: clicking a row's BFO Name opens this.
// Every commission row tied to that BFO opp, as two month-by-month tables:
// the revenue expected and the commission to be paid out. Recorded months
// read in solid ink; months still to come carry the projected amount in
// blue italics (see utils/commissionBfoSchedule for the rules).

const EXPECTED_FG = '#1D4ED8';
const cellBase = { padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const headBase = { padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', textAlign: 'right', whiteSpace: 'nowrap', color: '#475569', background: '#F1F5F9', fontWeight: 600 };
const stickyLeft = { position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', minWidth: 200, maxWidth: 260 };

function Amount({ cell, bold }) {
  if (!cell) return <span style={{ color: '#CBD5E1' }}>-</span>;
  const expected = cell.kind === 'expected';
  return (
    <span
      title={expected ? 'Expected: nothing recorded for this month yet' : 'Recorded on the Commissions roster'}
      style={{ color: expected ? EXPECTED_FG : '#0F172A', fontStyle: expected ? 'italic' : 'normal', fontWeight: bold ? 700 : 400 }}
    >{fmtCurrency(cell.value)}</span>
  );
}

function ScheduleTable({ title, note, months, schedule }) {
  const grand = schedule.recorded + schedule.expected;
  return (
    <section style={{ marginTop: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <strong style={{ fontSize: '0.85rem', color: '#1E293B' }}>{title}</strong>
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>{note}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
          {fmtCurrency(schedule.recorded)} recorded · <span style={{ color: EXPECTED_FG }}>{fmtCurrency(schedule.expected)} expected</span> · <strong>{fmtCurrency(grand)} total</strong>
        </span>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.72rem', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...headBase, ...stickyLeft, color: '#0F172A' }}>Project</th>
              {months.map((m) => (
                <th
                  key={m.key}
                  title={m.isCurrent ? 'This month' : m.isFuture ? 'Still to come' : undefined}
                  style={{ ...headBase, ...(m.isCurrent ? { background: '#DBEAFE', color: '#1E3A8A' } : null) }}
                >{m.label}</th>
              ))}
              <th style={{ ...headBase, color: '#0F172A' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {schedule.lines.map((l, r) => (
              <tr key={r}>
                <td style={{ ...cellBase, ...stickyLeft, background: '#fff', color: '#334155', whiteSpace: 'normal' }}>
                  <div>{l.name}</div>
                  {l.sub && <div style={{ fontSize: '0.64rem', color: '#94A3B8', marginTop: 1 }}>{l.sub}</div>}
                </td>
                {l.cells.map((c, i) => (
                  <td key={months[i].key} style={{ ...cellBase, ...(months[i].isCurrent ? { background: '#F8FBFF' } : null) }}><Amount cell={c} /></td>
                ))}
                <td style={{ ...cellBase, fontWeight: 600 }}>{fmtCurrency(l.total)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...cellBase, ...stickyLeft, background: '#F8FAFC', fontWeight: 700, color: '#0F172A', borderTop: '1px solid #E2E8F0' }}>Total</td>
              {schedule.totals.map((c, i) => (
                <td key={months[i].key} style={{ ...cellBase, background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}><Amount cell={c} bold /></td>
              ))}
              <td style={{ ...cellBase, background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontWeight: 700 }}>{fmtCurrency(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// `bfoName`: the BFO Name clicked. `rows`: every roster row with that BFO
// Name, ignored ones included (they're counted, then left out).
// `projectionOf(row)`: the row's projection or null. `opp`: the linked Opps
// record, if any.
export function CommissionBfoModal({ bfoName, rows, projectionOf, opp, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const live = useMemo(() => (rows || []).filter((r) => !r.__ignored), [rows]);
  const ignored = (rows || []).length - live.length;
  const model = useMemo(() => buildBfoSchedule(live, { projectionOf, opp }), [live, projectionOf, opp]);

  const account = String(opp?.['Account'] || live[0]?.['Account Name'] || '').trim();
  const facts = [
    account,
    opp?.['Scope'] ? `Scope: ${opp['Scope']}` : '',
    opp?.['Stage'] ? `Stage: ${opp['Stage']}` : '',
    asNumber(opp?.['Quoted Amount']) ? `Quoted ${fmtCurrency(opp['Quoted Amount'])}` : '',
  ].filter(Boolean);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Monthly schedule for ${bfoName}`}
        style={{ background: '#fff', borderRadius: 8, width: 'min(1200px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1.1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>BFO opp</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1E293B', marginTop: 2 }}>{bfoName}</div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem' }}>
              {[...facts, `${live.length} commission row${live.length === 1 ? '' : 's'}`, ignored ? `${ignored} ignored row${ignored === 1 ? '' : 's'} left out` : '']
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
          >×</button>
        </div>

        <div style={{ padding: '0.2rem 1.1rem 1.1rem', overflow: 'auto' }}>
          {live.length === 0 ? (
            <div style={{ marginTop: '0.9rem', padding: '1rem', color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem' }}>
              Every commission row for this opp is marked ignored, so there is nothing to schedule.
            </div>
          ) : (<>
            <div style={{ marginTop: '0.7rem', fontSize: '0.7rem', color: '#64748B' }}>
              Solid amounts are recorded on the roster. <span style={{ color: EXPECTED_FG, fontStyle: 'italic' }}>Blue italic</span> amounts are expected for months with nothing recorded yet, inside each row&apos;s Comm Start - End window.
            </div>
            <ScheduleTable
              title="Expected revenue"
              note="Monthly revenue on file, else the commission / %, else the opp's Quoted Amount / 12"
              months={model.months}
              schedule={model.revenue}
            />
            <ScheduleTable
              title="Commissions to be paid out"
              note="Monthly commission on file, else the projected monthly commission"
              months={model.months}
              schedule={model.commission}
            />
          </>)}
        </div>
      </div>
    </div>
  );
}
