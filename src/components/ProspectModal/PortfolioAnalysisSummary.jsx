// "Master Analysis Summary" on the Portfolio Companies table: every saved
// Master Analysis across the firm's portfolio, side by side.
//
// Two tabs. Savings reads each company's saved workbook back (the
// Indicative Savings sheet's per-market tables) and lays the deregulated
// sites, their usage and spend, and the Low - High savings band out by
// company, then by country and state. Usage and spend the analysis had to
// estimate (italic amber on its Site Detail sheet) is shown the same way
// here, with the estimated share beside it. Compliance screens each company's sites against the ordinances,
// the same screen behind the table's Est. Max Yearly Exposure column, and
// lays the fines out by company and by jurisdiction.
//
// Workbooks are read one at a time (each is hundreds of kilobytes) and
// cached per save, so reopening the popup doesn't download them again.

import { useEffect, useMemo, useState } from 'react';
import { loadIndicativeAnalysis } from '../../utils/firestoreSync';
import { formatAnalysisDate } from '../../hooks/useSavedAnalyses';
import { siteListScreeningRows } from '../../utils/siteListFacts';
import { marketsFromWorkbook, summariseMarkets, complianceSummary, siteEstimatesFromWorkbook, applySiteEstimates } from '../../utils/portfolioAnalysisSummary';
import { downloadPortfolioAnalysisSummary } from '../../utils/portfolioAnalysisSummaryXlsx';
import { normalizeCountryName } from '../../data/countryDeregulation';

// prospect id + savedAt -> { markets, siteList } read out of that save.
const workbookCache = new Map();

const COUNTRY_NAMES = { US: 'United States', CA: 'Canada' };

function money(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const range = (lo, hi) => (lo || hi ? `${money(lo)} – ${money(hi)}` : '-');
const count = (n) => (n ? n.toLocaleString() : '-');
// A usage figure: exact up to 100,000, then K / M so the column stays narrow.
function qty(n) {
  if (!n) return '-';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e5) return `${Math.round(n / 1e3)}K`;
  return Math.round(n).toLocaleString();
}

// The amber the Master Analysis's Site Detail sheet uses for estimated
// values, so a figure reads the same way here as in the workbook.
const EST = '#B45309';

// A usage or spend figure, italic amber with its estimated share when any
// of it was estimated. `unknown` is 'all' when none of the markets behind
// the figure were found on Site Detail (so where it came from can't be
// said) and 'some' when only part of them were.
function EstValue({ value, est, format, unit, unknown }) {
  if (!value) return '-';
  const share = est > 0 ? est / value : 0;
  const pct = Math.round(share * 100);
  const title = unknown === 'all'
    ? 'Could not tell how much of this is estimated: the market\'s sites were not found on the analysis\'s Site Detail sheet.'
    : unknown === 'some'
      ? `${pct || 0}% of this ${unit} is known to be estimated. Some of its markets were not found on the analysis's Site Detail sheet, so the real share may be higher.`
      : share > 0
      ? `${pct || '<1'}% of this ${unit} is estimated (${format(est)} of ${format(value)}).`
      : `All of this ${unit} comes from the uploaded data.`;
  return (
    <span title={title} style={share > 0 ? { color: EST, fontStyle: 'italic' } : undefined}>
      {format(value)}
      {share > 0 && <span style={{ fontSize: '0.6rem', marginLeft: 4, fontWeight: 600 }}>{pct || '<1'}% est.</span>}
      {unknown && <span style={{ fontSize: '0.6rem', marginLeft: 3, color: '#94A3B8' }}>?</span>}
    </span>
  );
}

// The three usage / spend cells, shared by every savings table. Electric
// usage is shown in MWh; the workbook carries kWh.
function UsageCells({ r }) {
  const unknown = r.estUnknown > 0 ? (r.estKnown > 0 ? 'some' : 'all') : '';
  return (
    <>
      <td style={tdR}><EstValue value={r.electricUsage / 1000} est={r.electricUsageEst / 1000} format={qty} unit="electric usage" unknown={unknown} /></td>
      <td style={tdR}><EstValue value={r.gasUsage} est={r.gasUsageEst} format={qty} unit="gas usage" unknown={unknown} /></td>
      <td style={tdR}><EstValue value={r.electricCost + r.gasCost} est={r.electricCostEst + r.gasCostEst} format={money} unit="spend" unknown={unknown} /></td>
    </>
  );
}
const USAGE_HEADS = [['Electric usage (MWh/yr)', 'Deregulated electric consumption'], ['Gas usage (Dth/yr)', 'Deregulated gas consumption'], ['Energy spend/yr', 'Deregulated electric + gas spend']];

// The Site List tab of a saved workbook as a stored-list shape, for a
// company whose site list was never saved to its card.
function siteListFromWorkbook(XLSX, wb) {
  const ws = wb.Sheets?.['Site List'];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) return null;
  const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || Object.keys(rows[0]);
  return { headers: headers.map(String), rows };
}

const th = { padding: '0.35rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.62rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border, #E2E8F0)', background: '#F8FAFC', position: 'sticky', top: 0, whiteSpace: 'nowrap' };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '0.3rem 0.5rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.72rem', verticalAlign: 'top' };
const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const totalRow = { background: '#F0FDF4', fontWeight: 700 };
const groupRow = { background: '#F8FAFC', fontWeight: 700 };

function Section({ title, hint, right, children }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.35rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#0F172A' }}>{title}</div>
        {hint && <div style={{ fontSize: '0.66rem', color: '#64748B' }}>{hint}</div>}
        {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
      </div>
      <div style={{ border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, overflow: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
      </div>
    </div>
  );
}

function Toggle({ value, options, onChange }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 5, overflow: 'hidden' }}>
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          style={{ padding: '0.2rem 0.55rem', border: 'none', fontSize: '0.66rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', background: value === k ? 'var(--color-accent, #2563EB)' : '#fff', color: value === k ? '#fff' : '#475569' }}
        >{label}</button>
      ))}
    </div>
  );
}

/**
 * companies: [{ id, company, meta, siteList }] - the portfolio companies
 * that resolve to a tracker record with a saved Master Analysis (`meta`)
 * and, when there is one, the site list saved to that record.
 */
export default function PortfolioAnalysisSummary({ firmName, companies, totalCompanies, personalOrdinanceOverrides, onClose }) {
  const [tab, setTab] = useState('savings');
  const [marketView, setMarketView] = useState('combined');
  const [progress, setProgress] = useState({ done: 0, total: companies.length });
  const [loaded, setLoaded] = useState([]); // [{ id, company, meta, markets, siteList, error }]
  const [mandates, setMandates] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [XLSX, m, ExcelJS, store] = await Promise.all([import('xlsx'), import('../../utils/complianceMandates'), import('exceljs'), import('../../utils/ordinanceOverrideStore')]);
      // The ordinance corrections the Utility Lookup page screens with, so
      // this table's exposure matches that page's and the Portfolio column.
      const ordinances = await store.loadScreeningOrdinances(personalOrdinanceOverrides);
      if (cancelled) return;
      setMandates({ ...m, ordinances });
      const countryOf = (label) => COUNTRY_NAMES[m.regionOf(label)?.country] || null;
      const out = [];
      for (let i = 0; i < companies.length; i++) {
        const c = companies[i];
        const key = `${c.id}:${c.meta?.savedAt || ''}`;
        let entry = workbookCache.get(key);
        if (!entry) {
          try {
            const saved = await loadIndicativeAnalysis(c.id);
            if (!saved?.dataBase64) throw new Error('the saved analysis is empty');
            const binary = atob(saved.dataBase64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
            // cellStyles keeps each row's outline level, which is how the
            // United States roll-up row is told apart from its states.
            const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
            // The estimate flags are fonts, which only ExcelJS reads. A
            // workbook it can't open still shows its figures, just without
            // saying which are estimated.
            let sites = [];
            try {
              const xwb = new (ExcelJS.Workbook || ExcelJS.default.Workbook)();
              await xwb.xlsx.load(bytes);
              sites = siteEstimatesFromWorkbook(xwb);
            } catch (err) {
              console.error('Master Analysis summary: could not read Site Detail for', c.company, err);
            }
            entry = { markets: applySiteEstimates(marketsFromWorkbook(wb, { countryOf }), sites, { normalizeCountry: normalizeCountryName }), siteList: siteListFromWorkbook(XLSX, wb) };
            workbookCache.set(key, entry);
          } catch (err) {
            console.error('Master Analysis summary: could not read', c.company, err);
            entry = { markets: [], siteList: null, error: err?.message || 'could not be read' };
          }
        }
        if (cancelled) return;
        out.push({ ...c, ...entry, siteList: c.siteList || entry.siteList, siteListSource: c.siteList ? 'card' : (entry.siteList ? 'workbook' : '') });
        setLoaded([...out]);
        setProgress({ done: i + 1, total: companies.length });
      }
    })();
    return () => { cancelled = true; };
    // The corrections are read once, with the snapshot of companies; a
    // correction saved while this is open must not re-download every workbook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  const loading = progress.done < progress.total;
  const savings = useMemo(() => summariseMarkets(loaded.filter(c => !c.error).map(c => ({ company: c.company, markets: c.markets }))), [loaded]);
  const metaByCompany = useMemo(() => new Map(loaded.map(c => [c.company, c])), [loaded]);

  const compliance = useMemo(() => {
    if (!mandates) return null;
    const rows = [];
    const jur = new Map();
    for (const c of loaded) {
      if (!c.siteList) { rows.push({ company: c.company, none: true }); continue; }
      const sum = complianceSummary(mandates.screenSites(siteListScreeningRows(c.siteList), { ordinances: mandates.ordinances }), mandates);
      rows.push({ company: c.company, source: c.siteListSource, ...sum });
      for (const j of sum.byJurisdiction) {
        if (!jur.has(j.government)) {
          const blank = { government: j.government, sites: 0, penalty: 0, companies: [] };
          for (const k of mandates.CATEGORIES) blank[k] = { sites: 0, penalty: 0 };
          jur.set(j.government, blank);
        }
        const t = jur.get(j.government);
        t.sites += j.sites;
        t.penalty += j.penalty;
        t.companies.push(c.company);
        for (const k of mandates.CATEGORIES) { t[k].sites += j[k].sites; t[k].penalty += j[k].penalty; }
      }
    }
    rows.sort((a, b) => (b.exposure || 0) - (a.exposure || 0) || (b.sitesWithMandate || 0) - (a.sitesWithMandate || 0) || a.company.localeCompare(b.company));
    return { rows, byJurisdiction: [...jur.values()].sort((a, b) => b.penalty - a.penalty || b.sites - a.sites) };
  }, [loaded, mandates]);

  const totals = useMemo(() => {
    const keys = ['electricDeregulatedSites', 'gasDeregulatedSites', 'low', 'high', 'indicative', 'estUnknown', 'estKnown',
      'electricUsage', 'electricUsageEst', 'gasUsage', 'gasUsageEst', 'electricCost', 'electricCostEst', 'gasCost', 'gasCostEst'];
    const t = Object.fromEntries(keys.map(k => [k, 0]));
    for (const c of savings.byCompany) for (const k of keys) t[k] += c[k] || 0;
    return t;
  }, [savings]);

  const [exporting, setExporting] = useState('');
  async function exportExcel() {
    if (loading || exporting === 'busy') return;
    setExporting('busy');
    try {
      await downloadPortfolioAnalysisSummary({
        firmName,
        savings,
        compliance,
        categories: (mandates?.CATEGORIES || []).map(key => ({ key, label: mandates.CATEGORY_LABEL[key] })),
      });
      setExporting('');
    } catch (err) {
      console.error('Master Analysis summary export failed:', err);
      setExporting(err?.message || 'Export failed.');
    }
  }

  const failed = loaded.filter(c => c.error);
  const failedReasons = [...failed.reduce((m, c) => m.set(c.error, [...(m.get(c.error) || []), c.company]), new Map())];
  const noMarkets = loaded.filter(c => !c.error && c.markets.length === 0);
  const tabBtn = (k, label) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      style={{ padding: '0.5rem 0.9rem', border: 'none', borderBottom: `2px solid ${tab === k ? 'var(--color-accent, #2563EB)' : 'transparent'}`, background: 'none', color: tab === k ? 'var(--color-accent, #2563EB)' : '#64748B', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
    >{label}</button>
  );

  // Markets grouped under a heading row: by country across the whole
  // portfolio, or by company.
  const marketGroups = marketView === 'combined'
    ? savings.byCountry.map(c => ({
      key: c.country,
      head: c,
      label: c.country,
      rows: savings.byMarket.filter(m => m.country === c.country && m.market !== c.country),
    }))
    : savings.byCompany.filter(c => c.markets.length).map(c => ({ key: c.company, head: c, label: c.company, rows: c.markets }));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Master Analysis Summary"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-surface, #fff)', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', width: 'min(1200px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', fontSize: '0.8rem', color: 'var(--color-text, #1E293B)' }}
      >
        <div style={{ padding: '0.75rem 1rem 0', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Master Analysis Summary{firmName ? `: ${firmName}` : ''}</div>
            <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 2 }}>
              {companies.length} of {totalCompanies} portfolio {totalCompanies === 1 ? 'company has' : 'companies have'} a saved Master Analysis.
              {loading && ` Reading ${progress.done + 1} of ${progress.total}...`}
            </div>
          </div>
          <button
            type="button"
            onClick={exportExcel}
            disabled={loading || exporting === 'busy'}
            title={loading ? 'Available once every saved analysis has been read' : (exporting && exporting !== 'busy' ? `Could not export: ${exporting}` : 'Download both tabs as an Excel workbook in Schneider Electric formatting')}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #009530', borderRadius: 5, background: loading ? '#F1F5F9' : '#009530', color: loading ? '#94A3B8' : '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', alignSelf: 'center' }}
          >{exporting === 'busy' ? 'Exporting...' : (exporting ? '⚠ Retry export' : '↓ Export to Excel')}</button>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.3rem', lineHeight: 1, color: '#94A3B8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border, #E2E8F0)', padding: '0 0.5rem' }}>
          {tabBtn('savings', 'Savings & Deregulated Sites')}
          {tabBtn('compliance', 'Compliance')}
        </div>

        <div style={{ padding: '0.8rem 1rem', overflowY: 'auto' }}>
          {(failed.length > 0 || noMarkets.length > 0) && (
            <div style={{ fontSize: '0.68rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 5, padding: '0.35rem 0.6rem', marginBottom: '0.7rem' }}>
              {failed.length > 0 && <div>Could not read the analysis for {failed.map(c => c.company).join(', ')}.</div>}
              {/* Why, grouped: the same cause (an unreachable database, a
                  corrupt save) usually hits every company at once. */}
              {failedReasons.map(([reason, names]) => (
                <div key={reason} style={{ marginTop: 2 }}>
                  {failedReasons.length > 1 ? `${names.join(', ')}: ` : 'Reason: '}{reason}
                </div>
              ))}
              {tab === 'savings' && noMarkets.length > 0 && <div>No Indicative Savings tables in the analysis for {noMarkets.map(c => c.company).join(', ')}: re-save it from Utility Lookup.</div>}
            </div>
          )}

          {tab === 'savings' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.66rem', color: '#475569', background: '#F8FAFC', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 5, padding: '0.35rem 0.6rem', marginBottom: '0.7rem' }}>
                <span style={{ color: EST, fontStyle: 'italic', fontWeight: 600, whiteSpace: 'nowrap' }}>Italic amber = estimated</span>
                <span>
                  Usage and spend cover the deregulated sites. Where a site had no usage uploaded, the analysis modeled it from the property type; where it had no spend, it priced the usage at the indicative rate.
                  The % est. is the share of the figure that came from those estimates. Upright figures are all from uploaded data.
                </span>
              </div>
              <Section title="By portfolio company" hint="Range is each market's spend at its Low and High %, once every supply agreement is open. Year 1 counts only spend already out of contract.">
                <thead>
                  <tr>
                    <th style={th}>Company</th>
                    <th style={th}>Saved</th>
                    <th style={thR}>Electric dereg. sites</th>
                    <th style={thR}>Gas dereg. sites</th>
                    <th style={thR}>Markets</th>
                    {USAGE_HEADS.map(([h, tip]) => <th key={h} style={thR} title={tip}>{h}</th>)}
                    <th style={thR}>Annual savings range</th>
                    <th style={thR}>Indicative Year 1</th>
                    <th style={th}>Top markets</th>
                  </tr>
                </thead>
                <tbody>
                  {savings.byCompany.map(c => (
                    <tr key={c.company}>
                      <td style={{ ...td, fontWeight: 600 }}>{c.company}</td>
                      <td style={{ ...td, color: '#64748B', whiteSpace: 'nowrap' }}>{formatAnalysisDate(metaByCompany.get(c.company)?.meta?.savedAt)}</td>
                      <td style={tdR}>{count(c.electricDeregulatedSites)}</td>
                      <td style={tdR}>{count(c.gasDeregulatedSites)}</td>
                      <td style={tdR}>{count(c.markets.length)}</td>
                      <UsageCells r={c} />
                      <td style={{ ...tdR, color: '#166534', fontWeight: 600 }} title={c.unpriced ? `${c.unpriced} deregulated ${c.unpriced === 1 ? 'market has' : 'markets have'} no Low / High % (TBD) and ${c.unpriced === 1 ? 'is' : 'are'} not in the range` : undefined}>
                        {range(c.low, c.high)}{c.unpriced ? ' *' : ''}
                      </td>
                      <td style={tdR}>{money(c.indicative)}</td>
                      <td style={{ ...td, color: '#475569' }}>{c.markets.slice(0, 4).map(m => m.market).join(', ') || '-'}</td>
                    </tr>
                  ))}
                  {savings.byCompany.length > 1 && (
                    <tr style={totalRow}>
                      <td style={td}>Total ({savings.byCompany.length})</td>
                      <td style={td} />
                      <td style={tdR}>{count(totals.electricDeregulatedSites)}</td>
                      <td style={tdR}>{count(totals.gasDeregulatedSites)}</td>
                      <td style={tdR}>{count(savings.byMarket.length)}</td>
                      <UsageCells r={totals} />
                      <td style={tdR}>{range(totals.low, totals.high)}</td>
                      <td style={tdR}>{money(totals.indicative)}</td>
                      <td style={td} />
                    </tr>
                  )}
                  {savings.byCompany.length === 0 && (
                    <tr><td style={{ ...td, color: '#94A3B8' }} colSpan={11}>{loading ? 'Reading the saved analyses...' : 'Nothing to show.'}</td></tr>
                  )}
                </tbody>
              </Section>

              <Section
                title="By country / state"
                hint="Deregulated markets only. A site in a dual-fuel market counts once under electric and once under gas."
                right={<Toggle value={marketView} onChange={setMarketView} options={[['combined', 'All companies'], ['company', 'Per company']]} />}
              >
                <thead>
                  <tr>
                    <th style={th}>{marketView === 'combined' ? 'Country / state' : 'Company / market'}</th>
                    {marketView === 'company' && <th style={th}>Country</th>}
                    <th style={thR}>Electric dereg. sites</th>
                    <th style={thR}>Gas dereg. sites</th>
                    {USAGE_HEADS.map(([h, tip]) => <th key={h} style={thR} title={tip}>{h}</th>)}
                    <th style={thR}>Annual savings range</th>
                    <th style={thR}>Indicative Year 1</th>
                    {marketView === 'combined' && <th style={th}>Portfolio companies</th>}
                  </tr>
                </thead>
                <tbody>
                  {marketGroups.map(g => [
                    <tr key={`g:${g.key}`} style={groupRow}>
                      <td style={td}>{g.label}</td>
                      {marketView === 'company' && <td style={td} />}
                      <td style={tdR}>{count(g.head.electricDeregulatedSites)}</td>
                      <td style={tdR}>{count(g.head.gasDeregulatedSites)}</td>
                      <UsageCells r={g.head} />
                      <td style={tdR}>{range(g.head.low, g.head.high)}</td>
                      <td style={tdR}>{money(g.head.indicative)}</td>
                      {marketView === 'combined' && <td style={{ ...td, fontWeight: 400, color: '#475569' }}>{g.head.companies.join(', ')}</td>}
                    </tr>,
                    ...g.rows.map(m => (
                      <tr key={`m:${g.key}:${m.country}:${m.market}`}>
                        <td style={{ ...td, paddingLeft: '1.4rem' }}>{m.market}</td>
                        {marketView === 'company' && <td style={{ ...td, color: '#64748B' }}>{m.country}</td>}
                        <td style={tdR}>{count(m.electricDeregulatedSites)}</td>
                        <td style={tdR}>{count(m.gasDeregulatedSites)}</td>
                        <UsageCells r={m} />
                        <td style={tdR}>{range(m.low, m.high)}</td>
                        <td style={tdR}>{money(m.indicative)}</td>
                        {marketView === 'combined' && <td style={{ ...td, color: '#475569' }}>{m.companies.join(', ')}</td>}
                      </tr>
                    )),
                  ])}
                  {marketGroups.length === 0 && (
                    <tr><td style={{ ...td, color: '#94A3B8' }} colSpan={9}>{loading ? 'Reading the saved analyses...' : 'No deregulated markets in the saved analyses.'}</td></tr>
                  )}
                </tbody>
              </Section>
              {savings.byCompany.some(c => c.unpriced) && (
                <div style={{ fontSize: '0.66rem', color: '#64748B' }}>* Leaves out a deregulated market priced TBD (no Low / High %), such as a European market.</div>
              )}
            </>
          )}

          {tab === 'compliance' && (
            <>
              <Section title="By portfolio company" hint="Each company's sites screened against the benchmarking (BBS), energy audit and building performance (BPS) ordinances. Fines are the estimated max per year.">
                <thead>
                  <tr>
                    <th style={th}>Company</th>
                    <th style={thR}>Sites screened</th>
                    <th style={thR}>Sites w/ mandate</th>
                    <th style={thR}>Jurisdictions</th>
                    {(mandates?.CATEGORIES || []).map(k => <th key={k} style={thR}>{mandates.CATEGORY_LABEL[k]}</th>)}
                    <th style={thR}>Est. max yearly exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {(compliance?.rows || []).map(c => (
                    <tr key={c.company}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {c.company}
                        {c.source === 'workbook' && <span title="No site list saved to this company's card, so its sites were read from the analysis workbook's Site List tab" style={{ marginLeft: 6, fontSize: '0.6rem', color: '#94A3B8', fontWeight: 400 }}>from workbook</span>}
                      </td>
                      {c.none ? (
                        <td style={{ ...td, color: '#94A3B8' }} colSpan={4 + (mandates?.CATEGORIES.length || 0)}>No site list to screen.</td>
                      ) : (
                        <>
                          <td style={tdR}>{count(c.sitesScreened)}</td>
                          <td style={tdR}>{count(c.sitesWithMandate)}</td>
                          <td style={tdR}>{count(c.jurisdictions)}</td>
                          {mandates.CATEGORIES.map(k => (
                            <td key={k} style={tdR}>{c.categories[k].sites ? `${c.categories[k].sites} · ${money(c.categories[k].penalty)}` : '-'}</td>
                          ))}
                          <td style={{ ...tdR, color: c.exposure ? '#B91C1C' : undefined, fontWeight: 600 }}>{c.exposure ? money(c.exposure) : '-'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {compliance && compliance.rows.filter(c => !c.none).length > 1 && (() => {
                    const live = compliance.rows.filter(c => !c.none);
                    const sum = (f) => live.reduce((s, c) => s + f(c), 0);
                    return (
                      <tr style={totalRow}>
                        <td style={td}>Total ({live.length})</td>
                        <td style={tdR}>{count(sum(c => c.sitesScreened))}</td>
                        <td style={tdR}>{count(sum(c => c.sitesWithMandate))}</td>
                        <td style={tdR}>{count(new Set(live.flatMap(c => c.jurisdictionIds)).size)}</td>
                        {mandates.CATEGORIES.map(k => {
                          const n = sum(c => c.categories[k].sites);
                          return <td key={k} style={tdR}>{n ? `${n} · ${money(sum(c => c.categories[k].penalty))}` : '-'}</td>;
                        })}
                        <td style={tdR}>{money(sum(c => c.exposure))}</td>
                      </tr>
                    );
                  })()}
                  {(!compliance || compliance.rows.length === 0) && (
                    <tr><td style={{ ...td, color: '#94A3B8' }} colSpan={8}>{loading ? 'Reading the saved analyses...' : 'Nothing to show.'}</td></tr>
                  )}
                </tbody>
              </Section>

              <Section title="By jurisdiction" hint="Sites count once even when they owe more than one mandate. Cells read sites · est. max fine per year.">
                <thead>
                  <tr>
                    <th style={th}>Jurisdiction</th>
                    <th style={thR}>Sites w/ mandate</th>
                    {(mandates?.CATEGORIES || []).map(k => <th key={k} style={thR}>{mandates.CATEGORY_LABEL[k]}</th>)}
                    <th style={thR}>Est. max yearly exposure</th>
                    <th style={th}>Portfolio companies</th>
                  </tr>
                </thead>
                <tbody>
                  {(compliance?.byJurisdiction || []).map(j => (
                    <tr key={j.government}>
                      <td style={{ ...td, fontWeight: 600 }}>{j.government}</td>
                      <td style={tdR}>{count(j.sites)}</td>
                      {mandates.CATEGORIES.map(k => (
                        <td key={k} style={tdR}>{j[k].sites ? `${j[k].sites} · ${money(j[k].penalty)}` : '-'}</td>
                      ))}
                      <td style={{ ...tdR, color: j.penalty ? '#B91C1C' : undefined, fontWeight: 600 }}>{j.penalty ? money(j.penalty) : '-'}</td>
                      <td style={{ ...td, color: '#475569' }}>{j.companies.join(', ')}</td>
                    </tr>
                  ))}
                  {(!compliance || compliance.byJurisdiction.length === 0) && (
                    <tr><td style={{ ...td, color: '#94A3B8' }} colSpan={7}>{loading ? 'Reading the saved analyses...' : 'No site falls under a mandate.'}</td></tr>
                  )}
                </tbody>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
