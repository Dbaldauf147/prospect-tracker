import { useEffect, useMemo, useState } from 'react';
import { fmtCurrency, asNumber } from '../../utils/dealsFormat';
import { buildBfoSchedule, normBfoKey } from '../../utils/commissionBfoSchedule';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { DEAL_BFO_KEY } from '../../utils/dealCommissions';

// Commissions > All / Actively Paid: clicking a row's BFO Name opens this.
// Two month-by-month tables for the opp, Revenue and Commission. Each has an
// Actual section (recorded on the Commissions roster) and an Expected one
// (what the Deals page expects over each deal's term), split into Setup and
// Recurring; see utils/commissionBfoSchedule for the rules.

const cellBase = { padding: '0.4rem 0.55rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const headBase = { padding: '0.4rem 0.55rem', borderBottom: '1px solid #E2E8F0', textAlign: 'right', whiteSpace: 'nowrap', color: '#475569', background: '#F1F5F9', fontWeight: 600 };
const stickyLeft = { position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', minWidth: 110 };

function Money({ value, bold }) {
  if (value == null) return <span style={{ color: '#CBD5E1' }}>-</span>;
  return <span style={{ color: '#0F172A', fontWeight: bold ? 700 : 400 }}>{fmtCurrency(value)}</span>;
}

// One table (Revenue or Commission): an Actual section and an Expected
// section, each with Setup, Recurring and a subtotal across the months.
function SectionTable({ title, months, data, notes }) {
  const sections = [
    { key: 'actual', label: 'Actual', note: notes.actual, ...data.actual },
    { key: 'expected', label: 'Expected', note: notes.expected, ...data.expected },
  ];
  const span = months.length + 2;
  return (
    <section style={{ marginTop: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>{title}</strong>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
          Actual <strong>{fmtCurrency(data.actual.total.total)}</strong> · Expected <strong>{fmtCurrency(data.expected.total.total)}</strong>
        </span>
      </div>
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
            {sections.map((sec) => [
              <tr key={`${sec.key}:head`}>
                <td colSpan={span} style={{ padding: '0.4rem 0.55rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', borderTop: sec.key === 'expected' ? '1px solid #E2E8F0' : undefined }}>
                  <span style={{ position: 'sticky', left: '0.55rem', display: 'inline-flex', gap: '0.5rem', alignItems: 'baseline' }}>
                    <strong style={{ color: '#0F172A', fontSize: '0.74rem' }}>{sec.label}</strong>
                    <span style={{ color: '#64748B', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{sec.note}</span>
                  </span>
                </td>
              </tr>,
              ...[
                { label: 'Setup', line: sec.setup },
                { label: 'Recurring', line: sec.recurring },
                { label: `${sec.label} total`, line: sec.total, bold: true },
              ].map((r) => (
                <tr key={`${sec.key}:${r.label}`}>
                  <td style={{ ...cellBase, ...stickyLeft, background: '#fff', color: r.bold ? '#0F172A' : '#334155', fontWeight: r.bold ? 700 : 400, paddingLeft: r.bold ? '0.55rem' : '1.2rem' }}>{r.label}</td>
                  {r.line.cells.map((v, i) => (
                    <td key={months[i].key} style={{ ...cellBase, ...(months[i].isCurrent ? { background: '#F8FBFF' } : null) }}><Money value={v} bold={r.bold} /></td>
                  ))}
                  <td style={{ ...cellBase, background: '#F8FAFC' }}><Money value={r.line.total} bold /></td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
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

  const notes = {
    actual: live.length ? 'Recorded on the Commissions roster' : 'Every commission row for this opp is marked ignored',
    expected: model.deals
      ? `From the Deals page (${model.deals} deal${model.deals === 1 ? '' : 's'}): Setup in the term's first month, Recurring spread evenly over the term`
      : 'No deal on the Deals page has this BFO opp in its BFO column',
  };

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
            <div style={{ marginTop: '0.7rem', fontSize: '0.7rem', color: '#64748B' }}>
              A roster row counts as Setup when its project name reads as a one-time line (NonRecurring, Setup, One-time, Implementation); every other row is Recurring.
            </div>
            <SectionTable title="Revenue" months={model.months} data={model.revenue} notes={notes} />
            <SectionTable title="Commission" months={model.months} data={model.commission} notes={notes} />
            {model.undated > 0 && (
              <div style={{ fontSize: '0.68rem', color: '#92400E', marginTop: '0.3rem' }}>
                {model.undated} deal{model.undated === 1 ? ' has' : 's have'} no term dates (and no dated commission rows), so {model.undated === 1 ? 'it' : 'they'} can&apos;t be placed in a month.
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
