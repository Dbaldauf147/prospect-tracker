import { useEffect, useMemo, useState } from 'react';
import { fmtCurrency, asNumber } from '../../utils/dealsFormat';
import {
  buildBfoSchedule, normBfoKey, bfoOkSignature, bfoComparisonStates, BFO_OK_SETTINGS_KEY,
} from '../../utils/commissionBfoSchedule';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { DEAL_BFO_KEY } from '../../utils/dealCommissions';

// Commissions > All / Actively Paid: clicking a row's BFO Name opens this.
// Two month-by-month tables for the opp, Revenue and Commission. Each has an
// Actual section (recorded on the Commissions roster) and an Expected one
// (what the Deals page expects over each deal's term), split into Setup and
// Recurring; see utils/commissionBfoSchedule for the rules.
//
// Each Actual cell and its Expected twin (same line, same month) turn green
// when Actual meets or beats Expected and red when it falls short. A red pair can be marked OK by
// clicking it, or in bulk per row, per table, or for the whole opp. Marks
// live in settings[BFO_OK_SETTINGS_KEY][<bfo>] so they sync across machines.

const cellBase = { padding: '0.28rem 0.45rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const headBase = { padding: '0.3rem 0.45rem', borderBottom: '1px solid #E2E8F0', textAlign: 'right', whiteSpace: 'nowrap', color: '#475569', background: '#F1F5F9', fontWeight: 600 };
const stickyLeft = { position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', minWidth: 110 };

const STATE_STYLE = {
  match: { background: '#DCFCE7', color: '#166534' },
  ok: { background: '#F0FDF4', color: '#15803D' },
  mismatch: { background: '#FEE2E2', color: '#991B1B', cursor: 'pointer' },
  // An Actual month nothing has been recorded for yet, filled with the
  // projection. Not compared, so never red.
  projected: { background: '#F5F3FF', color: '#6D28D9', fontStyle: 'italic' },
};

function Money({ value, bold, state }) {
  const color = STATE_STYLE[state] ? STATE_STYLE[state].color : '#0F172A';
  if (value == null) return <span style={{ color: state && state !== 'none' ? color : '#CBD5E1' }}>-</span>;
  return <span style={{ color, fontWeight: bold ? 700 : 400 }}>{state === 'ok' ? '✓ ' : ''}{fmtCurrency(value)}</span>;
}

const smallBtn = {
  border: '1px solid #FCA5A5', background: '#fff', color: '#991B1B', borderRadius: 4,
  fontSize: '0.64rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', padding: '1px 6px', whiteSpace: 'nowrap',
};

function cellTitle(state, actual, expected) {
  const pair = `Actual ${fmtCurrency(actual || 0)}, expected ${fmtCurrency(expected || 0)}`;
  if (state === 'match') return `${pair}: actual meets or beats expected`;
  if (state === 'ok') return `${pair}: marked OK. Click to undo.`;
  if (state === 'mismatch') return `${pair}: actual is below expected. Click to mark OK.`;
  return undefined;
}

// A projected amount shown under a recorded one (another row recorded this
// month, this one is projected) or under the Actual total.
function ProjectedNote({ value, label = 'proj.' }) {
  if (!value) return null;
  return <div style={{ ...STATE_STYLE.projected, background: 'transparent', fontSize: '0.62rem', fontWeight: 400 }}>+{fmtCurrency(value)} {label}</div>;
}

// One table (Revenue or Commission): an Actual section and an Expected
// section, each with Setup, Recurring and a subtotal across the months.
// `stateOf(key)` reads a comparison's state; `onToggle(keys, ok)` marks the
// given comparison keys OK (or clears them).
function SectionTable({ title, measure, months, data, notes, stateOf, onToggle }) {
  const sections = [
    { key: 'actual', label: 'Actual', note: notes.actual, ...data.actual },
    { key: 'expected', label: 'Expected', note: notes.expected, ...data.expected },
  ];
  const span = months.length + 2;
  const cols = [...months.map((m) => m.key), 'total'];
  const keyOf = (line, col) => `${measure}:${line}:${col}`;
  const redKeys = (line) => cols.map((c) => keyOf(line, c)).filter((k) => stateOf(k) === 'mismatch');
  const tableReds = ['setup', 'recurring', 'total'].flatMap(redKeys);
  const toggle = (k) => {
    const st = stateOf(k);
    if (st === 'mismatch') onToggle([k], true);
    else if (st === 'ok') onToggle([k], false);
  };
  return (
    <section style={{ marginTop: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>{title}</strong>
        {tableReds.length > 0 && (
          <button type="button" onClick={() => onToggle(tableReds, true)} style={smallBtn} title={`Mark every red ${title.toLowerCase()} cell OK`}>
            Mark all red OK ({tableReds.length})
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
          Actual <strong>{fmtCurrency(data.actual.total.total)}</strong>
          {data.projected.total > 0 && (<>
            {' · '}<span style={{ color: STATE_STYLE.projected.color }}>Actual + projected <strong>{fmtCurrency(data.actual.total.total + data.projected.total)}</strong></span>
          </>)}
          {' · '}Expected <strong>{fmtCurrency(data.expected.total.total)}</strong>
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
                <td colSpan={span} style={{ padding: '0.25rem 0.55rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', borderTop: sec.key === 'expected' ? '1px solid #E2E8F0' : undefined }}>
                  <span style={{ position: 'sticky', left: '0.55rem', display: 'inline-flex', gap: '0.5rem', alignItems: 'baseline' }}>
                    <strong style={{ color: '#0F172A', fontSize: '0.74rem' }}>{sec.label}</strong>
                    <span style={{ color: '#64748B', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{sec.note}</span>
                  </span>
                </td>
              </tr>,
              ...[
                { line: 'setup', label: 'Setup' },
                { line: 'recurring', label: 'Recurring' },
                { line: 'total', label: `${sec.label} total`, bold: true },
              ].map((r) => {
                const lineData = sec[r.line];
                const other = (sec.key === 'actual' ? data.expected : data.actual)[r.line];
                const reds = redKeys(r.line);
                return (
                  <tr key={`${sec.key}:${r.line}`}>
                    <td style={{ ...cellBase, ...stickyLeft, background: '#fff', color: r.bold ? '#0F172A' : '#334155', fontWeight: r.bold ? 700 : 400, paddingLeft: r.bold ? '0.55rem' : '1.2rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {r.label}
                        {reds.length > 0 && (
                          <button type="button" onClick={() => onToggle(reds, true)} style={smallBtn} title={`Mark the ${reds.length} red cell${reds.length === 1 ? '' : 's'} in this row OK`}>OK row</button>
                        )}
                      </span>
                    </td>
                    {cols.map((c, i) => {
                      const k = keyOf(r.line, c);
                      // A projected month isn't compared, so its Expected
                      // twin shows plain.
                      const st = stateOf(k) === 'projected' && sec.key !== 'actual' ? 'none' : stateOf(k);
                      const v = c === 'total' ? lineData.total : lineData.cells[i];
                      const ov = c === 'total' ? other.total : other.cells[i];
                      const [actual, expected] = sec.key === 'actual' ? [v, ov] : [ov, v];
                      // Projected amount for this Actual cell (Recurring and
                      // the total only; Setup is never projected).
                      const pv = sec.key === 'actual' && r.line !== 'setup'
                        ? (c === 'total' ? data.projected.total : data.projected.cells[i])
                        : null;
                      const base = c === 'total'
                        ? { background: '#F8FAFC' }
                        : (months[i].isCurrent ? { background: '#F8FBFF' } : null);
                      return (
                        <td
                          key={c}
                          onClick={() => toggle(k)}
                          title={st === 'projected'
                            ? `Projected ${fmtCurrency(pv)}: nothing recorded for this month yet, so the row's latest recorded month is carried forward. Expected ${fmtCurrency(expected || 0)}.`
                            : (pv ? `${cellTitle(st, actual, expected) || ''} Plus ${fmtCurrency(pv)} projected.`.trim() : cellTitle(st, actual, expected))}
                          style={{ ...cellBase, ...base, ...(STATE_STYLE[st] || null), ...(st === 'ok' ? { cursor: 'pointer' } : null) }}
                        >
                          {st === 'projected'
                            ? <Money value={pv} bold={r.bold} state={st} />
                            : (<>
                              <Money value={v} bold={r.bold || c === 'total'} state={st} />
                              <ProjectedNote value={pv} label={c === 'total' ? 'projected' : 'proj.'} />
                            </>)}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
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
export function CommissionBfoModal({ bfoName, rows, opp, onClose, settings, updateSettings }) {
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

  // Actual vs Expected: each comparison's state, with the OK marks saved
  // for this opp.
  const bfoKey = normBfoKey(bfoName);
  const savedMarks = settings?.[BFO_OK_SETTINGS_KEY]?.[bfoKey];
  const okMarks = useMemo(() => savedMarks || {}, [savedMarks]);
  const comparisons = useMemo(() => bfoComparisonStates(model, okMarks), [model, okMarks]);
  const stateOf = (key) => comparisons.get(key)?.state || 'none';
  const allReds = [...comparisons.keys()].filter((k) => stateOf(k) === 'mismatch');
  const okCount = [...comparisons.keys()].filter((k) => stateOf(k) === 'ok').length;
  // Built on the current settings (function form), so marks saved since this
  // rendered aren't overwritten. Clearing drops the key; marks that no longer
  // hold (amounts changed) are pruned on every write.
  const toggleOk = (keys, ok) => {
    if (!updateSettings || !keys.length) return;
    updateSettings((cur) => {
      const all = cur?.[BFO_OK_SETTINGS_KEY] || {};
      const next = {};
      for (const [k, sig] of Object.entries(all[bfoKey] || {})) {
        const c = comparisons.get(k);
        if (c && sig === bfoOkSignature(c.actual, c.expected)) next[k] = sig;
      }
      for (const k of keys) {
        const c = comparisons.get(k);
        if (!c) continue;
        if (ok) next[k] = bfoOkSignature(c.actual, c.expected);
        else delete next[k];
      }
      const out = { ...all };
      if (Object.keys(next).length) out[bfoKey] = next; else delete out[bfoKey];
      return { [BFO_OK_SETTINGS_KEY]: out };
    });
  };

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
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Monthly schedule for ${bfoName}`}
        style={{ background: '#fff', borderRadius: 8, width: 'min(1800px, 98vw)', maxHeight: '97vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.6rem 1.1rem', borderBottom: '1px solid #E2E8F0' }}>
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

        <div style={{ padding: '0.1rem 1.1rem 0.8rem', overflow: 'auto' }}>
          {live.length === 0 && deals.length === 0 ? (
            <div style={{ marginTop: '0.9rem', padding: '1rem', color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem' }}>
              Every commission row for this opp is marked ignored and no deal names it, so there is nothing to show.
            </div>
          ) : (<>
            {(allReds.length > 0 || okCount > 0) && (
            <div style={{ marginTop: '0.7rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {allReds.length > 0 && (
                <button type="button" onClick={() => toggleOk(allReds, true)} style={{ ...smallBtn, fontSize: '0.7rem', padding: '3px 9px' }}>
                  Mark all red OK ({allReds.length})
                </button>
              )}
              {okCount > 0 && (
                <button
                  type="button"
                  onClick={() => toggleOk([...comparisons.keys()].filter((k) => stateOf(k) === 'ok'), false)}
                  style={{ ...smallBtn, fontSize: '0.7rem', padding: '3px 9px', borderColor: '#CBD5E1', color: '#475569' }}
                >Clear OK marks ({okCount})</button>
              )}
            </div>
            )}
            <SectionTable title="Revenue" measure="revenue" months={model.months} data={model.revenue} notes={notes} stateOf={stateOf} onToggle={toggleOk} />
            <SectionTable title="Commission" measure="commission" months={model.months} data={model.commission} notes={notes} stateOf={stateOf} onToggle={toggleOk} />
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
