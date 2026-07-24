import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import MASTER_ORDINANCES from '../../data/masterOrdinances.js';
import {
  screenSites, lookupGovId, getMandates, classifyPropertyType,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  totalEligible, eligibilityByOrdinance, totalPenalty,
} from '../../utils/complianceMandates';
import { buildComplianceReportHtml } from '../../utils/complianceReportHtml';
import styles from './BuildingComplianceScreening.module.css';

const usd = (n) => n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US');
const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());
const mdY = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

// Compact horizontal-bar list used for the on-page eligibility/penalty
// summaries. items: [{ label, value }].
function HBars({ items, color, fmt = String }) {
  if (!items.length) return <div className={styles.miniEmpty}>No eligible sites</div>;
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div className={styles.hbars}>
      {items.map((it) => (
        <div key={it.label} className={styles.hbarRow}>
          <span className={styles.hbarLabel} title={it.label}>{it.label}</span>
          <span className={styles.hbarTrack}>
            <span className={styles.hbarFill} style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: color }} />
          </span>
          <span className={styles.hbarVal}>{fmt(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

// One BBS / Audits / BPS cell for a screened site: eligible ✓ / not / unknown,
// with the deadline + penalty in a tooltip.
function CatCell({ res }) {
  if (!res || !res.active) return <span className={styles.dash}>—</span>;
  const tip = [
    res.policyName,
    res.deadline ? `Deadline ${mdY(res.deadline)}` : (res.deadlineRaw ? `Deadline ${res.deadlineRaw}` : null),
    res.threshold != null ? `Threshold ${res.threshold.toLocaleString()} ft²` : null,
    res.penalty != null ? `Max penalty ${usd(res.penalty)}/yr` : null,
  ].filter(Boolean).join(' · ');
  if (res.eligible === true) return <span className={styles.pillEligible} title={tip}>Eligible</span>;
  if (res.eligible === false) return <span className={styles.pillBelow} title={tip}>Below threshold</span>;
  return <span className={styles.pillUnknown} title={tip}>Active — size?</span>;
}

// Screens the Utility Lookup site list against the two-tab compliance
// reference (City Lookup → Government ID → Master Ordinances) and surfaces
// BBS / Audits / BPS eligibility, a summary dashboard, and the exportable
// branded report.
export function BuildingComplianceScreening({ sites = [] }) {
  const [mode, setMode] = useState('sites'); // 'sites' | 'manual'
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [onlyEligible, setOnlyEligible] = useState(false);

  const results = useMemo(() => screenSites(sites), [sites]);
  const matchedCount = useMemo(() => results.filter(r => r.matched).length, [results]);
  const anyEligibleCount = useMemo(
    () => results.filter(r => CATEGORIES.some(c => r[c]?.eligible === true)).length,
    [results],
  );

  const filtered = useMemo(() => {
    let out = results;
    if (onlyEligible) out = out.filter(r => CATEGORIES.some(c => r[c]?.eligible === true));
    const q = siteSearch.trim().toLowerCase();
    if (q) out = out.filter(r => `${r.siteName} ${r.city} ${r.state} ${r.government || ''}`.toLowerCase().includes(q));
    return out;
  }, [results, onlyEligible, siteSearch]);

  // Manual single lookup.
  const manual = useMemo(() => {
    if (!city.trim()) return null;
    const govId = lookupGovId(city, state);
    const mandate = getMandates(govId);
    return { govId, mandate };
  }, [city, state]);

  // ---- downloads ----------------------------------------------------------
  // City Lookup: the human-readable city+state → Government ID table.
  function downloadCityLookup() {
    const data = MASTER_ORDINANCES.map(g => ({ 'City / Government': g.government, 'State': g.state, 'Government ID': g.govId }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'City Lookup');
    XLSX.writeFile(wb, 'City-Lookup.xlsx');
  }
  // Master Ordinances: the full BBS/Audits/BPS reference, one row per Government ID.
  function downloadMasterOrdinances() {
    const data = MASTER_ORDINANCES.map(g => g.raw);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Ordinances Database');
    XLSX.writeFile(wb, 'Master-Ordinances-Database.xlsx');
  }
  // Branded applicability report (opens in a new tab; print / Save as PDF).
  function exportReport() {
    const html = buildComplianceReportHtml(results, { generatedAt: new Date().toLocaleString(), siteCount: results.length });
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to open the report, then try again.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  // Per-site results as a flat Excel.
  function exportSiteData() {
    const data = filtered.map(r => {
      const row = { Site: r.siteName, City: r.city, State: r.state, 'Government': r.government || '', 'Government ID': r.govId || '', 'Sq Ft': r.sqft ?? '' };
      for (const c of CATEGORIES) {
        const e = r[c];
        row[`${CATEGORY_LABEL[c]} Eligible`] = !e?.active ? '' : e.eligible === true ? 'Yes' : e.eligible === false ? 'No' : 'Unknown';
        row[`${CATEGORY_LABEL[c]} Deadline`] = e?.deadline ? mdY(e.deadline) : '';
        row[`${CATEGORY_LABEL[c]} Max Penalty`] = e?.penalty ?? '';
      }
      return row;
    });
    if (!data.length) { alert('No site results to export.'); return; }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Site Compliance');
    XLSX.writeFile(wb, 'Building-Compliance-Screening.xlsx');
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Building Compliance Screening</h1>
          <div className={styles.subtitle}>
            Screens each Utility Lookup site: <strong>city + state → Government ID</strong> (City Lookup),
            then <strong>Government ID → BBS / Audits / BPS mandates</strong> (Master Ordinances).
            {' '}· <strong>{MASTER_ORDINANCES.length}</strong> jurisdictions on file.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={downloadCityLookup} title="Download the City Lookup table (city + state → Government ID)">City Lookup</button>
          <button type="button" className={styles.btn} onClick={downloadMasterOrdinances} title="Download the Master Ordinances Database (Government ID → BBS/Audits/BPS)">Master Ordinances</button>
          <button type="button" className={styles.btnPrimary} onClick={exportReport} title="Open the branded applicability report — print or Save as PDF">Export report</button>
        </div>
      </div>

      <div className={styles.modeToggle}>
        <button type="button" className={mode === 'sites' ? styles.modeActive : styles.mode} onClick={() => setMode('sites')}>Site list{sites.length ? ` (${sites.length})` : ''}</button>
        <button type="button" className={mode === 'manual' ? styles.modeActive : styles.mode} onClick={() => setMode('manual')}>Single lookup</button>
      </div>

      {mode === 'sites' ? (
        sites.length === 0 ? (
          <div className={styles.noMatch}>
            <strong>No site list loaded.</strong>
            <div className={styles.noMatchSub}>
              Upload a site list on the <strong>Utility Lookup</strong> subtab (with City, State, and — for eligibility — a
              square-footage / property-type column) and every site is screened here automatically.
            </div>
          </div>
        ) : (
          <>
            {/* Summary dashboard — the same figures the exported report charts. */}
            <div className={styles.dashGrid}>
              {CATEGORIES.map(c => (
                <div key={c} className={styles.dashCard}>
                  <div className={styles.dashHead} style={{ background: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]} Eligibility</div>
                  <div className={styles.dashKpis}>
                    <div><div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{totalEligible(results, c)}</div><div className={styles.kpiLbl}>eligible sites</div></div>
                    <div><div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{usd(totalPenalty(results, c))}</div><div className={styles.kpiLbl}>max yearly penalty</div></div>
                  </div>
                  <HBars items={eligibilityByOrdinance(results, c).slice(0, 8).map(x => ({ label: x.government, value: x.count }))} color={CATEGORY_COLOR[c]} />
                </div>
              ))}
            </div>

            <div className={styles.siteToolbar}>
              <input className={styles.searchInput} type="text" placeholder="Search sites, cities, jurisdictions…" value={siteSearch} onChange={e => setSiteSearch(e.target.value)} />
              <label className={styles.checkLabel}>
                <input type="checkbox" checked={onlyEligible} onChange={e => setOnlyEligible(e.target.checked)} />
                Only eligible sites
              </label>
              <span className={styles.siteStat}>
                <strong>{anyEligibleCount}</strong> eligible · {matchedCount} matched a jurisdiction · {results.length} total
              </span>
              <button type="button" className={styles.btn} onClick={exportSiteData} disabled={!filtered.length}>Export site data</button>
            </div>

            <div className={styles.tableScroll}>
              <table className={styles.siteTable}>
                <thead>
                  <tr>
                    <th>Site</th><th>City</th><th>State</th><th>Jurisdiction</th><th>Sq Ft</th>
                    <th>BBS</th><th>Energy Audits</th><th>BPS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id}>
                      <td className={styles.siteCell}>{r.siteName || <span className={styles.dash}>—</span>}</td>
                      <td>{r.city || <span className={styles.dash}>—</span>}</td>
                      <td>{r.state || <span className={styles.dash}>—</span>}</td>
                      <td>{r.matched ? r.government : <span className={styles.dash}>no match</span>}</td>
                      <td>{r.sqft != null ? r.sqft.toLocaleString() : <span className={styles.dash}>—</span>}</td>
                      <td><CatCell res={r.bbs} /></td>
                      <td><CatCell res={r.audits} /></td>
                      <td><CatCell res={r.bps} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className={styles.emptyRow}>No sites match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <>
          <div className={styles.lookupCard}>
            <div className={styles.fields}>
              <label className={styles.field}><span className={styles.fieldLabel}>City</span>
                <input className={styles.input} type="text" placeholder="e.g. Seattle" value={city} onChange={e => setCity(e.target.value)} autoFocus /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>State / Province</span>
                <input className={styles.input} type="text" placeholder="e.g. WA or Washington" value={state} onChange={e => setState(e.target.value)} /></label>
            </div>
            <div className={styles.hint}>Resolves the city + state to a Government ID, then shows that jurisdiction's BBS / Audits / BPS mandates.</div>
          </div>
          {!city.trim() ? (
            <div className={styles.muted}>Enter a city to run the lookup.</div>
          ) : !manual?.mandate ? (
            <div className={styles.noMatch}>
              <strong>No jurisdiction found</strong> for “{city.trim()}{state.trim() ? `, ${state.trim()}` : ''}”.
              <div className={styles.noMatchSub}>The city+state isn't in the City Lookup. Member cities of county / state ordinances need the full City Lookup tab.</div>
            </div>
          ) : (
            <div className={styles.manualResult}>
              <div className={styles.manualHead}>{manual.mandate.government}, {manual.mandate.state} <span className={styles.govId}>{manual.govId}</span></div>
              <div className={styles.dashGrid}>
                {CATEGORIES.map(c => {
                  const cat = manual.mandate[c];
                  return (
                    <div key={c} className={styles.dashCard}>
                      <div className={styles.dashHead} style={{ background: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]}</div>
                      <div className={styles.manualBody}>
                        <div><strong>{cat.policyName || cat.ordinanceName || '—'}</strong></div>
                        <div className={styles.manualMeta}>Status: {cat.status || '—'}</div>
                        <div className={styles.manualMeta}>Deadline: {cat.deadline ? mdY(cat.deadline) : (cat.deadlineRaw || '—')}</div>
                        <div className={styles.manualMeta}>Max penalty: {cat.maxPenalty != null ? `${usd(cat.maxPenalty)}/yr` : '—'}</div>
                        {(cat.link || cat.url) && isUrl(cat.link || cat.url) && (
                          <div><a href={cat.link || cat.url} target="_blank" rel="noopener noreferrer">Ordinance link</a></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
