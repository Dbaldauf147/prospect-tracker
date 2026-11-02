import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { peSoldBreakdown, dealAmount } from '../../utils/peSoldDeals';

const muted = { color: '#64748B' };

function money(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// One headline number: how many deals, what they add up to, and how many of
// them that total actually covers.
function StatTile({ label, totals, accent }) {
  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.6rem 0.9rem', minWidth: 220 }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', ...muted }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginTop: 2 }}>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: accent }}>{totals.count}</span>
        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>{money(totals.amount)}</span>
      </div>
      <div style={{ fontSize: '0.68rem', ...muted }}>
        {totals.count === totals.priced
          ? 'Quoted Amount on every deal'
          : `Quoted Amount on ${totals.priced} of ${totals.count} deals`}
      </div>
    </div>
  );
}

const sectionTitle = {
  margin: '0.35rem 0 0.25rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#64748B',
};

/**
 * PE Portfolio > PE Sold.
 *
 * Every deal the PE channel brought in (Source = PE partner) that was sold,
 * and every one out for signature at Agreement Sent. Sold is all time,
 * narrowed by close-year chips; Agreement Sent is always the live list.
 * Each deal shows which PE firm it belongs to (the account itself when it
 * is a PE firm, else its PE Owner), and the account opens its company
 * popup.
 */
export function PESoldDealsTab({ oppsRecords, oppsMissing, findProspect, onSelectProspect, settings, updateSettings }) {
  const [years, setYears] = useState([]);
  const data = useMemo(() => peSoldBreakdown(oppsRecords, { years }), [oppsRecords, years]);

  // Each account's company record, looked up once per account rather than
  // on every cell render (the match is a scan of every prospect).
  const prospectByAccount = useMemo(() => {
    const m = new Map();
    for (const r of [...data.sold, ...data.agreementSent]) {
      const a = r['Account'] || '';
      if (!m.has(a)) m.set(a, findProspect(a));
    }
    return m;
  }, [data, findProspect]);
  const prospectOf = (account) => prospectByAccount.get(account || '') || null;

  // Which PE firm a deal sits under: the account itself when it is a PE
  // firm, otherwise the PE Owner on its company record.
  const firmOf = (account) => {
    const p = prospectOf(account);
    if (!p) return '';
    if (p.type === 'Private Equity') return p.company || '';
    return String(p.peOwner || '').trim();
  };

  const columns = (dateField, dateLabel) => [
    {
      key: 'Account',
      label: 'Account',
      defaultWidth: 240,
      render: (r) => {
        const p = prospectOf(r['Account']);
        return p ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectProspect?.(p); }}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#2563EB', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer', textAlign: 'left' }}
            title="Open the company"
          >{r['Account'] || '-'}</button>
        ) : <span style={{ fontWeight: 600 }}>{r['Account'] || '-'}</span>;
      },
    },
    {
      key: '_firm',
      label: 'PE Firm',
      defaultWidth: 200,
      render: (r) => firmOf(r['Account']) || <span style={muted}>-</span>,
      getFilterValue: (r) => firmOf(r['Account']),
      exportValue: (r) => firmOf(r['Account']),
    },
    { key: 'Scope', label: 'Scope', defaultWidth: 220 },
    {
      key: 'Quoted Amount',
      label: 'Quoted Amount',
      defaultWidth: 130,
      render: (r) => {
        const a = dealAmount(r);
        return <div style={{ textAlign: 'right', fontWeight: 600 }}>{a == null ? <span style={muted}>-</span> : money(a)}</div>;
      },
      getSortValue: (r) => dealAmount(r) ?? -1,
      exportValue: (r) => dealAmount(r) ?? '',
    },
    { key: dateField, label: dateLabel, defaultWidth: 110 },
    { key: 'Sales Partner', label: 'Sales Partner', defaultWidth: 150 },
    { key: 'Contact', label: 'Contact', defaultWidth: 160 },
    { key: 'Status', label: 'Status', defaultWidth: 130 },
    { key: 'Next Steps', label: 'Next Steps', defaultWidth: 240 },
    {
      key: 'BFO Link',
      label: 'BFO Link',
      defaultWidth: 90,
      render: (r) => (r['BFO Link']
        ? <a href={r['BFO Link']} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#2563EB' }}>Open</a>
        : <span style={muted}>-</span>),
      exportValue: (r) => r['BFO Link'] || '',
    },
  ];

  const toggleYear = (y) => setYears(prev => (prev.includes(y) ? prev.filter(v => v !== y) : [...prev, y]));
  const chip = (on) => ({
    padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
    border: `1px solid ${on ? '#7C3AED' : '#E2E8F0'}`, background: on ? '#7C3AED' : '#fff', color: on ? '#fff' : '#64748B',
  });

  if (oppsMissing) {
    return <div style={{ padding: '2rem', textAlign: 'center', ...muted }}>No Opps data loaded yet.</div>;
  }

  const withId = (rows) => rows.map(r => ({ ...r, id: r._id ?? `${r['Account']}-${r['Close Date'] || r['Start Date'] || ''}` }));

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1.25rem 1.25rem' }}>
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <StatTile label={years.length ? `Sold, closed ${[...years].sort().join(', ')}` : 'Sold, all time'} totals={data.soldTotals} accent="#15803D" />
        <StatTile label="At Agreement Sent now" totals={data.agreementTotals} accent="#7C3AED" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.7rem', ...muted }}>
            Opps with Source = <strong>PE partner</strong>. Year filters the Sold list by Close Date.
          </span>
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', ...muted, marginRight: 2 }}>Years</span>
            <button type="button" style={chip(years.length === 0)} onClick={() => setYears([])}>All</button>
            {data.years.map(y => (
              <button key={y} type="button" style={chip(years.includes(y))} onClick={() => toggleYear(y)}>{y}</button>
            ))}
            {data.undatedSold > 0 && (
              <span style={{ fontSize: '0.7rem', color: '#92400E', marginLeft: 6 }}>{data.undatedSold} sold with no Close Date not counted</span>
            )}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h3 style={sectionTitle}>Agreement Sent ({data.agreementSent.length})</h3>
        <div style={{ height: Math.min(150 + Math.max(data.agreementSent.length, 1) * 36, 420), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <DataTable
            tableId="pe-sold-agreement-sent"
            columns={columns('Start Date', 'Start Date')}
            rows={withId(data.agreementSent)}
            alwaysVisible={['Account']}
            exportFileName="PE deals at Agreement Sent"
            emptyMessage="No PE-sourced deals are at Agreement Sent."
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>

        <h3 style={sectionTitle}>Sold ({data.sold.length})</h3>
        <div style={{ height: Math.min(150 + Math.max(data.sold.length, 1) * 36, 640), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <DataTable
            tableId="pe-sold-deals"
            columns={columns('Close Date', 'Close Date')}
            rows={withId(data.sold)}
            alwaysVisible={['Account']}
            exportFileName="PE sold deals"
            emptyMessage={years.length ? 'No PE-sourced deals closed Sold in those years.' : 'No PE-sourced deals are Sold yet.'}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      </div>
    </div>
  );
}
