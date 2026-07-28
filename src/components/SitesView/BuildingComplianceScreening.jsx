import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import MASTER_ORDINANCES from '../../data/masterOrdinances.js';
import {
  screenSites, lookupGovId, getMandates, classifyPropertyType,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  totalEligible, eligibilityByOrdinance, totalPenalty, sitesCompanyLabel,
  bpsPrioritization,
} from '../../utils/complianceMandates';
import { buildComplianceReportHtml } from '../../utils/complianceReportHtml';
import { exportComplianceReportXlsx } from '../../utils/complianceReportXlsx';
import { schneiderLogoSvg } from '../../utils/schneiderLogo';
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
  // Applicability follows the active ordinance; the ft² threshold is shown as
  // a listed requirement (with whether the building meets it), not a gate.
  const thr = res.threshold != null
    ? `Size requirement ${res.threshold.toLocaleString()} ft²`
      + (res.meetsThreshold === true ? ' — building meets it'
        : res.meetsThreshold === false ? ' — building below (still applicable)' : '')
    : null;
  const tip = [
    res.policyName,
    res.deadline ? `Deadline ${mdY(res.deadline)}` : (res.deadlineRaw ? `Deadline ${res.deadlineRaw}` : null),
    thr,
    res.penalty != null ? `Max penalty ${usd(res.penalty)}/yr` : null,
  ].filter(Boolean).join(' · ');
  return <span className={styles.pillEligible} title={tip}>Applicable</span>;
}

// Screens the Utility Lookup site list against the two-tab compliance
// reference (City Lookup → Government ID → Master Ordinances) and surfaces
// BBS / Audits / BPS eligibility, a summary dashboard, and the exportable
// branded report.
export function BuildingComplianceScreening({ sites = [], companyName = '' }) {
  const [mode, setMode] = useState('sites'); // 'sites' | 'manual'
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [onlyEligible, setOnlyEligible] = useState(false);

  const companyLabel = useMemo(() => sitesCompanyLabel(sites), [sites]);
  const results = useMemo(() => screenSites(sites), [sites]);
  const bpsRows = useMemo(() => bpsPrioritization(results), [results]);
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
  // Raw-data workbook that accompanies the PDF: a per-site screening sheet
  // (with the ft² threshold listed as a requirement, plus whether the building
  // meets it — informational, not a gate) and the full raw rows for every
  // matched jurisdiction.
  function writeRawWorkbook(rowsToExport, filename) {
    const siteRows = rowsToExport.map(r => {
      const row = {
        Site: r.siteName, City: r.city, State: r.state,
        Jurisdiction: r.government || '', 'Government ID': r.govId || '',
        'Sq Ft': r.sqft ?? '', 'Property Type': r.propertyType || '',
      };
      for (const c of CATEGORIES) {
        const e = r[c];
        row[`${CATEGORY_LABEL[c]} Applicable`] = e?.active ? 'Yes' : 'No';
        row[`${CATEGORY_LABEL[c]} Policy`] = e?.policyName || '';
        row[`${CATEGORY_LABEL[c]} Deadline`] = e?.deadline ? mdY(e.deadline) : (e?.deadlineRaw || '');
        row[`${CATEGORY_LABEL[c]} Size Requirement (ft²)`] = e?.threshold ?? '';
        row[`${CATEGORY_LABEL[c]} Meets Requirement`] = !e?.active ? '' : e.meetsThreshold === true ? 'Yes' : e.meetsThreshold === false ? 'No' : 'Unknown';
        row[`${CATEGORY_LABEL[c]} Max Yearly Penalty`] = e?.penalty ?? '';
      }
      return row;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows), 'Site Screening');
    // Matched-jurisdiction raw rows (one per Government ID).
    const seen = new Set();
    const ordRows = [];
    for (const r of rowsToExport) {
      if (!r.matched || seen.has(r.govId)) continue;
      seen.add(r.govId);
      const g = getMandates(r.govId);
      if (g?.raw) ordRows.push(g.raw);
    }
    if (ordRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordRows), 'Matched Ordinances');
    XLSX.writeFile(wb, filename);
  }

  // Export the deliverable: the branded PDF-ready report (new tab; print /
  // Save as PDF) AND the accompanying raw-data Excel.
  function exportReport() {
    const html = buildComplianceReportHtml(results, { generatedAt: new Date().toLocaleString(), siteCount: results.length });
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else alert('Allow pop-ups to open the printable report. The raw-data Excel will still download.');
    writeRawWorkbook(results, 'Building-Compliance-Screening-Data.xlsx');
  }
  // Formatted Excel version of the branded report (KPI tiles, roadmap +
  // penalty tables, and the same charts as images) — a spreadsheet twin of
  // the printable report, distinct from the raw-data workbook.
  async function exportExcelReport() {
    try {
      await exportComplianceReportXlsx(results, { generatedAt: new Date().toLocaleString(), siteCount: results.length, companyName: companyLabel || companyName });
    } catch (err) {
      console.error('Excel report export failed', err);
      alert('Could not build the Excel report: ' + (err?.message || 'unknown error'));
    }
  }

  // The filtered on-page view as an Excel (no report).
  function exportSiteData() {
    if (!filtered.length) { alert('No site results to export.'); return; }
    writeRawWorkbook(filtered, 'Building-Compliance-Screening.xlsx');
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.brandBand}>
        <div className={styles.brandBandLeft}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {companyLabel && (
              <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.01em', lineHeight: 1.2 }}>{companyLabel}</div>
            )}
            <h1 className={styles.title} style={{ color: '#fff' }}>Building Compliance Screening &amp; Roadmap</h1>
          </div>
        </div>
        <span className={styles.brandLogo} dangerouslySetInnerHTML={{ __html: schneiderLogoSvg({ onDark: true, width: 172 }) }} />
      </div>
      <div className={styles.header}>
        <div>
          <div className={styles.subtitle}>
            Screens each Utility Lookup site: <strong>city + state → Government ID</strong> (City Lookup),
            then <strong>Government ID → BBS / Audits / BPS mandates</strong> (Master Ordinances).
            {' '}· <strong>{MASTER_ORDINANCES.length}</strong> jurisdictions on file.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={downloadCityLookup} title="Download the City Lookup table (city + state → Government ID)">City Lookup</button>
          <button type="button" className={styles.btn} onClick={downloadMasterOrdinances} title="Download the Master Ordinances Database (Government ID → BBS/Audits/BPS)">Master Ordinances</button>
          <button type="button" className={styles.btnPrimary} onClick={exportReport} title="Open the branded report (print / Save as PDF) and download the accompanying raw-data Excel">Export report (PDF)</button>
          <button type="button" className={styles.btnPrimary} onClick={exportExcelReport} disabled={sites.length === 0} title="Download the branded report as a formatted Excel workbook (KPI tiles, roadmap + penalty tables, charts)">Export report (Excel)</button>
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
            {/* KPI summary strip — portfolio-level headline figures. */}
            <div className={styles.kpiStrip}>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#009530' }} />
                <div className={styles.kpiTileVal}>{results.length}</div>
                <div className={styles.kpiTileLbl}>Sites screened</div>
              </div>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#3DCD58' }} />
                <div className={styles.kpiTileVal}>{anyEligibleCount}</div>
                <div className={styles.kpiTileLbl}>Sites with a mandate</div>
              </div>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#29ABE2' }} />
                <div className={styles.kpiTileVal}>{new Set(results.filter(r => r.matched).map(r => r.govId)).size}</div>
                <div className={styles.kpiTileLbl}>Jurisdictions matched</div>
              </div>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#F7941E' }} />
                <div className={styles.kpiTileVal}>{usd(CATEGORIES.reduce((s, c) => s + totalPenalty(results, c), 0))}</div>
                <div className={styles.kpiTileLbl}>Est. max yearly exposure</div>
              </div>
            </div>

            {/* Summary dashboard — the same figures the exported report charts. */}
            <div className={styles.dashGrid}>
              {CATEGORIES.map(c => (
                <div key={c} className={styles.dashCard}>
                  <div className={styles.dashHead} style={{ background: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]} Eligibility</div>
                  <div className={styles.dashKpis}>
                    <div><div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{totalEligible(results, c)}</div><div className={styles.kpiLbl}>applicable sites</div></div>
                    <div><div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{usd(totalPenalty(results, c))}</div><div className={styles.kpiLbl}>max yearly penalty</div></div>
                  </div>
                  <HBars items={eligibilityByOrdinance(results, c).slice(0, 8).map(x => ({ label: x.government, value: x.count }))} color={CATEGORY_COLOR[c]} />
                </div>
              ))}
            </div>

            {/* BPS — Prioritization: one row per (deadline, jurisdiction) over
                the BPS-eligible sites. Mirrors the compliance exports and the
                Master Analysis overview. */}
            {bpsRows.length > 0 && (
              <div className={styles.bpsSection}>
                <div className={styles.bpsTitle}>BPS — Prioritization</div>
                <div className={styles.tableScroll}>
                  <table className={styles.siteTable}>
                    <thead>
                      <tr>
                        <th>Upcoming Deadline</th>
                        <th>Compliance Government</th>
                        <th>BPS Fines for Exceeding Limits</th>
                        <th style={{ textAlign: 'right' }}>Number of eligible sites</th>
                        <th style={{ textAlign: 'right' }}>Sum of Est. Penalty for non-reporting on BPS</th>
                        <th>Fee for exceeding limits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bpsRows.map((g, i) => (
                        <tr key={i}>
                          <td>{g.deadline ? mdY(g.deadline) : '—'}</td>
                          <td><strong>{g.government || '—'}</strong></td>
                          <td>{g.fine}</td>
                          <td style={{ textAlign: 'right' }}>{g.sites.toLocaleString('en-US')}</td>
                          <td style={{ textAlign: 'right' }}>{g.penaltyKnown ? usd(g.penalty) : '—'}</td>
                          <td style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{g.feeExceeding}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className={styles.siteToolbar}>
              <input className={styles.searchInput} type="text" placeholder="Search sites, cities, jurisdictions…" value={siteSearch} onChange={e => setSiteSearch(e.target.value)} />
              <label className={styles.checkLabel}>
                <input type="checkbox" checked={onlyEligible} onChange={e => setOnlyEligible(e.target.checked)} />
                Only sites with a mandate
              </label>
              <span className={styles.siteStat}>
                <strong>{anyEligibleCount}</strong> with a mandate · {matchedCount} matched a jurisdiction · {results.length} total
              </span>
              <button type="button" className={styles.btn} onClick={exportSiteData} disabled={!filtered.length}>Export site data</button>
            </div>

            <div className={styles.tableScroll}>
              <table className={styles.siteTable}>
                <thead>
                  <tr>
                    <th>Site</th><th>City</th><th>State</th><th>Jurisdiction</th><th>Gov ID</th><th>Sq Ft</th>
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
                      <td>{r.govId ? <span className={styles.govIdCell}>{r.govId}</span> : <span className={styles.dash}>—</span>}</td>
                      <td>{r.sqft != null ? r.sqft.toLocaleString() : <span className={styles.dash}>—</span>}</td>
                      <td><CatCell res={r.bbs} /></td>
                      <td><CatCell res={r.audits} /></td>
                      <td><CatCell res={r.bps} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className={styles.emptyRow}>No sites match the current filters.</td></tr>
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
