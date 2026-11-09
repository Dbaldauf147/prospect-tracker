import { useEffect, useMemo, useState } from 'react';
import { fmtCurrency, asNumber } from '../../utils/dealsFormat';
import { buildBfoSchedule, normBfoKey } from '../../utils/commissionBfoSchedule';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { DEAL_BFO_KEY } from '../../utils/dealCommissions';

// Commissions > All / Actively Paid: clicking a row's BFO Name opens this.
// Two month-by-month tables for the opp: Actual (revenue and commission
// recorded on the Commissions roster) and Expected (revenue and commission
// the Deals page expects, spread over each deal's term; see
// utils/commissionBfoSchedule for the rules).

const cellBase = { padding: '0.4rem 0.55rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const headBase = { padding: '0.4rem 0.55rem', borderBottom: '1px solid #E2E8F0', textAlign: 'right', whiteSpace: 'nowrap', color: '#475569', background: '#F1F5F9', fontWeight: 600 };
const stickyLeft = { position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', minWidth: 110 };

function Money({ value, bold }) {
  if (value == null) return <span style={{ color: '#CBD5E1' }}>-</span>;
  return <span style={{ color: '#0F172A', fontWeight: bold ? 700 : 400 }}>{fmtCurrency(value)}</span>;
}

// One table: a Revenue line and a Commission line across the months.
function MeasureTable({ title, note, months, data, empty }) {
  const lines = [
    { label: 'Revenue', ...data.revenue },
    { label: 'Commission', ...data.commission },
  ];
  return (
    <section style={{ marginTop: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <strong style={{ fontSize: '0.85rem', color: '#1E293B' }}>{title}</strong>
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>{note}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
          Revenue <strong>{fmtCurrency(data.revenue.total)}</strong> · Commission <strong>{fmtCurrency(data.commission.total)}</strong>
        </span>
      </div>
      {empty ? (
        <div style={{ padding: '0.75rem 1rem', color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.75rem' }}>{empty}</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.72rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...headBase, ...stickyLeft }} />
                {months.map((m) => (
                  <th
                    key={m.key}
                    title={m.isCurrent ? 'This month' : undefined}
                    style={{ ...headBase, ...(m.isCurrent ? { background: '#DBEAFE', color: '#1E3A8A' } : null) }}
                  >{m.label}</th>
                ))}
                <th style={{ ...headBase, color: '#0F172A' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td style={{ ...cellBase, ...stickyLeft, background: '#fff', color: '#334155', fontWeight: 600 }}>{l.label}</td>
                  {l.cells.map((v, i) => (
                    <td key={months[i].key} style={{ ...cellBase, ...(months[i].isCurrent ? { background: '#F8FBFF' } : null) }}><Money value={v} /></td>
                  ))}
                  <td style={{ ...cellBase, background: '#F8FAFC' }}><Money value={l.total} bold /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// `bfoName`: the BFO Name clicked. `rows`: every roster row with that BFO
// Name, ignored ones included (they're counted, then left out). `opp`: the
// linked Opps record, if any.
export function CommissionBfoModal({ bfoName, rows, opp, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The Deals-page rows whose BFO column names this opp. Re-read when the
  // deals roster is saved, so an edit on another tab shows up here.
  const [dealsVersion, setDealsVersion] = useState(0);
  useEffect(() => {
    const bump = () => setDealsVersion((v) => v + 1);
    window.addEventListener(DEALS_LIST_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => { window.removeEventListener(DEALS_LIST_EVENT, bump); window.removeEventListener('storage', bump); };
  }, []);
  const deals = useMemo(() => {
    void dealsVersion;
    const key = normBfoKey(bfoName);
    return (loadDealsList().data || []).filter((d) => key && normBfoKey(d?.[DEAL_BFO_KEY]) === key);
  }, [bfoName, dealsVersion]);

  const live = useMemo(() => (rows || []).filter((r) => !r.__ignored), [rows]);
  const ignored = (rows || []).length - live.length;
  const model = useMemo(() => buildBfoSchedule(live, { opp, deals }), [live, opp, deals]);

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
          {live.length === 0 && deals.length === 0 ? (
            <div style={{ marginTop: '0.9rem', padding: '1rem', color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem' }}>
              Every commission row for this opp is marked ignored and no deal names it, so there is nothing to show.
            </div>
          ) : (<>
            <MeasureTable
              title="Actual"
              note="Recorded on the Commissions roster"
              months={model.months}
              data={model.actual}
              empty={live.length === 0 ? 'Every commission row for this opp is marked ignored.' : ''}
            />
            <MeasureTable
              title="Expected"
              note={`From the Deals page${model.expected.deals ? ` (${model.expected.deals} deal${model.expected.deals === 1 ? '' : 's'})` : ''}: Setup and its commission in the term's first month, Recurring Revenue and the rest of the Commission spread evenly`}
              months={model.months}
              data={model.expected}
              empty={model.expected.deals === 0
                ? 'No deal on the Deals page has this BFO opp in its BFO column, so there is nothing expected to show.'
                : ''}
            />
            {model.expected.undated > 0 && (
              <div style={{ fontSize: '0.68rem', color: '#92400E', marginTop: '0.3rem' }}>
                {model.expected.undated} deal{model.expected.undated === 1 ? ' has' : 's have'} no term dates (and no dated commission rows), so {model.expected.undated === 1 ? 'it' : 'they'} can&apos;t be placed in a month.
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
