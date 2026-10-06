// The Prospecting page's "Prospects" and "PCs" subtabs: one sortable table
// per list, with the sites, utility accounts and total energy behind each
// company and a totals row for whatever the search leaves on screen. The
// rows and where each figure comes from are worked out in
// utils/prospectingPortfolio.js; this file only lays them out.
//
// Beside the figures: whether a Master Analysis is saved against the
// company, and the biggest service still open on it with what that service
// is. The deal is the company card's own Biggest Deal reading, run per row
// (utils/prospectingDeals.js), so the two never disagree.
import { useEffect, useMemo, useState } from 'react';
import { STATUS_COLORS } from '../../data/enums.js';
import { allPcRows, myProspectRows, sumFigures } from '../../utils/prospectingPortfolio.js';
import { biggestDealFor, dealMid } from '../../utils/prospectingDeals.js';
import { useSavedAnalyses, formatAnalysisDate } from '../../hooks/useSavedAnalyses';
import { pricedServiceRows } from '../../utils/serviceRows';
import { formatMoneyRange, getServicePricing, resolvePricingBases } from '../../utils/servicePricing';
import { buildOppStagesByClient } from '../../utils/serviceCoverage';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { useAuth } from '../../contexts/AuthContext';

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
  analysis: r => (r.analysis ? (Date.parse(r.analysis.savedAt) || 1) : -1),
  deal: r => dealMid(r.deal),
  dealService: r => (r.deal?.name || '\uffff').toLowerCase(),
};

// Each record's biggest deal, remembered against the rate card and opps it
// was priced with, so an edit to one company re-prices that company rather
// than the whole list. Keyed by the record object, so a record that is
// replaced (edited) or dropped lets go of its entry.
const DEAL_CACHE = new WeakMap();
function cachedDeal(prospect, ctx, oppRecords) {
  const hit = DEAL_CACHE.get(prospect);
  if (hit && hit.ctx === ctx && hit.opps === oppRecords) return hit.deal;
  // What this company's opportunities say about each service, matched the
  // way Dropdowns > Account Potential matches them.
  const oppStages = Array.isArray(oppRecords) && oppRecords.length
    ? (buildOppStagesByClient([prospect], oppRecords, ctx.serviceRows.map(r => r.name)).get(prospect) || null)
    : null;
  const deal = biggestDealFor(prospect, { ...ctx, oppStages });
  DEAL_CACHE.set(prospect, { ctx, opps: oppRecords, deal });
  return deal;
}

export function ProspectingCompanies({ mode, prospects, settings, cdmName = '', onSelectProspect, maxWidth }) {
  const siteLists = settings?.companySiteLists || null;
  const baseRows = useMemo(() => (
    mode === 'pcs'
      ? allPcRows(prospects, siteLists)
      : myProspectRows(prospects, cdmName, siteLists)
  ), [mode, prospects, siteLists, cdmName]);

  // The tracker records behind the rows. A PC with no record of its own has
  // nothing saved against it and no services to price.
  const tracked = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of baseRows) {
      if (r.prospect?.id && !seen.has(r.prospect.id)) { seen.add(r.prospect.id); out.push(r.prospect); }
    }
    return out;
  }, [baseRows]);
  const savedAnalyses = useSavedAnalyses(tracked);

  // This user's opportunities, read once: an opp whose Scope names a
  // service has explored it, which the company card counts when it picks
  // the biggest deal, so this list has to as well. Until they arrive the
  // deals are priced off the service statuses alone.
  const auth = useAuth();
  const uid = auth?.user?.uid;
  const [oppRecords, setOppRecords] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadOpps2Newest(uid)
      .then(data => { if (!cancelled) setOppRecords(Array.isArray(data?.records) ? data.records : []); })
      .catch(() => { if (!cancelled) setOppRecords([]); });
    return () => { cancelled = true; };
  }, [uid]);

  // Keyed on the settings that actually feed the rate card rather than the
  // whole settings object: pricing every row costs a few milliseconds each,
  // and an unrelated save elsewhere must not re-price the whole list.
  const pricingSettings = useMemo(() => ({
    servicePricing: settings?.servicePricing,
    pricingBases: settings?.pricingBases,
    serviceOverrides: settings?.serviceOverrides,
    hiddenServices: settings?.hiddenServices,
    customServiceCategories: settings?.customServiceCategories,
    dropdownCustomLists: settings?.dropdownCustomLists,
    dropdownListLabels: settings?.dropdownListLabels,
    dropdownLists: settings?.dropdownLists,
    dropdownListsHidden: settings?.dropdownListsHidden,
  }), [settings?.servicePricing, settings?.pricingBases, settings?.serviceOverrides,
    settings?.hiddenServices, settings?.customServiceCategories, settings?.dropdownCustomLists,
    settings?.dropdownListLabels, settings?.dropdownLists, settings?.dropdownListsHidden]);
  const serviceRows = useMemo(() => pricedServiceRows(pricingSettings), [pricingSettings]);
  const dealCtx = useMemo(() => ({
    serviceRows,
    pricing: getServicePricing(pricingSettings),
    bases: resolvePricingBases(pricingSettings),
    overrides: pricingSettings.serviceOverrides || null,
  }), [serviceRows, pricingSettings]);
  const dealById = useMemo(() => {
    const m = new Map();
    for (const p of tracked) m.set(p.id, cachedDeal(p, dealCtx, oppRecords));
    return m;
  }, [tracked, dealCtx, oppRecords]);

  const rows = useMemo(() => baseRows.map(r => ({
    ...r,
    analysis: r.prospect?.id ? (savedAnalyses.get(r.prospect.id) || null) : null,
    deal: r.prospect?.id ? (dealById.get(r.prospect.id) || null) : null,
  })), [baseRows, savedAnalyses, dealById]);

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
  const totals = useMemo(() => {
    const t = sumFigures(shown);
    t.dealLow = 0; t.dealHigh = 0; t.analyses = 0;
    for (const r of shown) {
      if (r.deal) { t.dealLow += r.deal.fee; t.dealHigh += r.deal.feeHigh; }
      if (r.analysis) t.analyses += 1;
    }
    return t;
  }, [shown]);

  const clickSort = (key) => setSort(s => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'company' || key === 'status' || key === 'peFirms' || key === 'dealService' ? 'asc' : 'desc' }));
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
    { key: 'analysis', label: 'Master Analysis', tip: 'Whether a Master Analysis is saved against the company from the Utility Lookup page, and when.' },
    { key: 'deal', label: 'Biggest Deal', right: true, tip: 'The biggest service still open on the company, first-year fee, priced off its Sites, Accounts and other Scale figures through the Services Pricing rate card. The same figure as Biggest Deal on the company card.' },
    { key: 'dealService', label: 'Biggest Deal Service', tip: 'The service that biggest deal is for, plus any services its Auto-add cell sells with it.' },
  ];

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 320px' }}>
          {intro} Sites, accounts and energy come from each company Master Analysis save, and Biggest Deal is the same figure as on the company card. Grey italic figures are stand-ins until one is saved: hover them for where they came from.
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
                    <td style={TD}>
                      {r.analysis ? (
                        <span
                          title={[
                            `Master Analysis saved${r.analysis.savedAt ? ` ${new Date(r.analysis.savedAt).toLocaleString()}` : ''}.`,
                            r.analysis.fileName || '',
                          ].filter(Boolean).join('\n')}
                          style={{ fontSize: '0.7rem', fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}
                        >✓ {formatAnalysisDate(r.analysis.savedAt)}</span>
                      ) : (
                        <span title={r.prospect ? 'No Master Analysis saved yet' : 'Not in the tracker yet'} style={{ color: '#CBD5E1' }}>-</span>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {r.deal
                        ? formatMoneyRange(r.deal.fee, r.deal.feeHigh)
                        : <span title={r.prospect ? 'Nothing still open on this company can be priced' : 'Not in the tracker yet'} style={{ color: '#CBD5E1' }}>-</span>}
                    </td>
                    <td style={{ ...TD, color: '#475569' }}>
                      {r.deal ? (
                        <span title={r.deal.adds.length ? `Sold with ${r.deal.adds.join(', ')}` : undefined}>
                          {r.deal.name}
                          {r.deal.adds.length > 0 && <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}> +{r.deal.adds.length} with it</span>}
                        </span>
                      ) : <span style={{ color: '#CBD5E1' }}>-</span>}
                    </td>
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
                <td style={{ ...TD, fontWeight: 700, borderBottom: 'none', position: 'sticky', bottom: 0, background: '#F8FAFC', whiteSpace: 'nowrap' }}>
                  {totals.analyses.toLocaleString()} saved
                </td>
                <td style={{ ...TD, fontWeight: 700, textAlign: 'right', borderBottom: 'none', position: 'sticky', bottom: 0, background: '#F8FAFC', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {totals.dealHigh > 0 ? formatMoneyRange(totals.dealLow, totals.dealHigh) : '-'}
                </td>
                <td style={{ ...TD, borderBottom: 'none', position: 'sticky', bottom: 0, background: '#F8FAFC' }} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
