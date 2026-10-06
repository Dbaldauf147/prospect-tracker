// The Prospecting page's "Prospects" and "PCs" subtabs: one sortable table
// per list, with the sites, utility accounts and total energy behind each
// company and a totals row for whatever the search leaves on screen. The
// rows and where each figure comes from are worked out in
// utils/prospectingPortfolio.js; this file only lays them out.
import { useMemo, useState } from 'react';
import { STATUS_COLORS } from '../../data/enums.js';
import { allPcRows, myProspectRows, sumFigures } from '../../utils/prospectingPortfolio.js';

const TH = {
  padding: '0.45rem 0.6rem', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: '#64748B', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0',
  position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
};
const TD = { padding: '0.4rem 0.6rem', fontSize: '0.76rem', color: '#1E293B', borderBottom: '1px solid #F1F5F9' };

// Where a figure came from, for the tooltip and for whether it reads as
// measured or estimated.
const SOURCE_NOTE = {
  analysis: 'From the company record (written by its Master Analysis save, or typed on its popup).',
  siteList: 'Counted off the site list saved on the company popup. Save a Master Analysis to replace it with the active-site count.',
  electric: 'Electric MWh typed on the company popup: electricity only, no gas. Save a Master Analysis to get the electric + gas total.',
  estimate: 'Estimate from the PE firm Portfolio Companies table. Add the company to the tracker and save a Master Analysis for the real figure.',
};

function Figure({ value, from, unit = '' }) {
  if (value == null) return <span style={{ color: '#CBD5E1' }}>-</span>;
  const soft = from === 'estimate' || from === 'electric';
  return (
    <span
      title={SOURCE_NOTE[from] || undefined}
      style={{ fontVariantNumeric: 'tabular-nums', color: soft ? '#94A3B8' : '#1E293B', fontStyle: soft ? 'italic' : 'normal' }}
    >
      {Math.round(value).toLocaleString()}{unit}
      {from === 'estimate' && <span style={{ fontSize: '0.62rem' }}> est.</span>}
      {from === 'electric' && <span style={{ fontSize: '0.62rem' }}> elec.</span>}
    </span>
  );
}

const SORTERS = {
  company: r => r.company.toLowerCase(),
  status: r => (r.status || '￿').toLowerCase(),
  peFirms: r => (r.peFirms[0] || '￿').toLowerCase(),
  sites: r => r.sites ?? -1,
  accounts: r => r.accounts ?? -1,
  energyMwh: r => r.energyMwh ?? -1,
};

export function ProspectingCompanies({ mode, prospects, settings, cdmName = '', onSelectProspect, maxWidth }) {
  const siteLists = settings?.companySiteLists || null;
  const rows = useMemo(() => (
    mode === 'pcs'
      ? allPcRows(prospects, siteLists)
      : myProspectRows(prospects, cdmName, siteLists)
  ), [mode, prospects, siteLists, cdmName]);

  const [query, setQuery] = useState('');
  // Biggest first by default: the point of the list is where the volume is.
  const [sort, setSort] = useState({ key: 'energyMwh', dir: 'desc' });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r => r.company.toLowerCase().includes(q)
        || r.peFirms.some(f => f.toLowerCase().includes(q))
        || r.status.toLowerCase().includes(q))
      : rows;
    const get = SORTERS[sort.key] || SORTERS.company;
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return a.company.localeCompare(b.company);
    });
  }, [rows, query, sort]);
  const totals = useMemo(() => sumFigures(shown), [shown]);

  const clickSort = (key) => setSort(s => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'company' || key === 'status' || key === 'peFirms' ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const isPcs = mode === 'pcs';
  const loading = prospects == null;
  const intro = isPcs
    ? 'Every portfolio company mapped on a PE firm Portfolio Companies table, once each.'
    : `Every company in the tracker with ${cdmName || 'you'} as its CDM.`;

  const cols = [
    { key: 'company', label: 'Company' },
    { key: 'status', label: 'Status' },
    ...(isPcs ? [{ key: 'peFirms', label: 'PE Firm' }] : []),
    { key: 'sites', label: 'Sites', right: true, tip: 'Number of sites: from the company record, else counted off its saved site list.' },
    { key: 'accounts', label: 'Accounts', right: true, tip: 'Number of utility accounts, written onto the company by its Master Analysis save.' },
    { key: 'energyMwh', label: 'Total Energy (MWh)', right: true, tip: 'Electric + gas use per year in MWh, written onto the company by its Master Analysis save.' },
  ];

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 320px' }}>
          {intro} Sites, accounts and energy come from each company Master Analysis save. Grey italic figures are stand-ins until one is saved: hover them for where they came from.
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={isPcs ? 'Search companies or PE firms' : 'Search companies'}
          style={{ padding: '0.35rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'inherit', width: 240 }}
        />
      </div>
      {loading ? (
        <div style={{ fontSize: '0.75rem', color: '#94A3B8', padding: '1rem 0' }}>Loading companies…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          {isPcs
            ? 'No portfolio companies are mapped yet. Add them on a PE firm popup, under Portfolio.'
            : `No companies in the tracker list ${cdmName || 'you'} as their CDM.`}
        </div>
      ) : (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {cols.map(c => (
                  <th
                    key={c.key}
                    onClick={() => clickSort(c.key)}
                    title={c.tip}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ ...TH, textAlign: c.right ? 'right' : 'left' }}
                  >{c.label}{arrow(c.key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const color = STATUS_COLORS[r.status] || '#64748B';
                return (
                  <tr key={r.key}>
                    <td style={{ ...TD, fontWeight: 600 }}>
                      {r.prospect && onSelectProspect ? (
                        <button
                          type="button"
                          onClick={() => onSelectProspect(r.prospect)}
                          title={`Open ${r.company}`}
                          style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#0A66C2', cursor: 'pointer', textAlign: 'left' }}
                        >{r.company}</button>
                      ) : (
                        <span title={isPcs ? 'Not in the tracker yet' : undefined}>{r.company}</span>
                      )}
                    </td>
                    <td style={TD}>
                      {r.status
                        ? <span style={{ fontSize: '0.68rem', fontWeight: 700, color, background: `${color}1A`, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.status}</span>
                        : <span style={{ color: '#CBD5E1' }}>-</span>}
                    </td>
                    {isPcs && (
                      <td style={{ ...TD, color: '#475569' }} title={r.peFirms.join('\n')}>
                        {r.peFirms.length === 0 ? '-' : r.peFirms.length === 1 ? r.peFirms[0] : `${r.peFirms[0]} +${r.peFirms.length - 1}`}
                      </td>
                    )}
                    <td style={{ ...TD, textAlign: 'right' }}><Figure value={r.sites} from={r.sitesFrom} /></td>
                    <td style={{ ...TD, textAlign: 'right' }}><Figure value={r.accounts} from={r.accountsFrom} /></td>
                    <td style={{ ...TD, textAlign: 'right' }}><Figure value={r.energyMwh} from={r.energyFrom} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F8FAFC' }} title="Sums every figure shown above, grey stand-ins included.">
                <td style={{ ...TD, fontWeight: 700, borderBottom: 'none', position: 'sticky', bottom: 0, background: '#F8FAFC' }} colSpan={isPcs ? 3 : 2}>
                  Total ({totals.count.toLocaleString()} {totals.count === 1 ? 'company' : 'companies'})
                </td>
                {['sites', 'accounts', 'energyMwh'].map(k => (
                  <td key={k} style={{ ...TD, fontWeight: 700, textAlign: 'right', borderBottom: 'none', position: 'sticky', bottom: 0, background: '#F8FAFC', fontVariantNumeric: 'tabular-nums' }}>
                    {totals[k] > 0 ? Math.round(totals[k]).toLocaleString() : '-'}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
