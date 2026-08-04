import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import MASTER_ORDINANCES from '../../data/masterOrdinances.js';
import { STATES, GOV_IDS, JURISDICTIONS, CITY_ROWS } from '../../data/complianceCityLookup.js';
import {
  screenSites, lookupGovId, getMandates,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  totalEligible, eligibilityByOrdinance, totalPenalty, penaltyByOrdinance, sitesCompanyLabel,
  bpsPrioritization, penaltyBasis, auditRequirements, auditRequirementsLabel, categoryColumns,
} from '../../utils/complianceMandates';
import { buildComplianceReportHtml } from '../../utils/complianceReportHtml';
import { exportComplianceReportXlsx } from '../../utils/complianceReportXlsx';
import { schneiderLogoSvg } from '../../utils/schneiderLogo';
import { OwnershipScopeBar } from './OwnershipScopeBar.jsx';
import styles from './BuildingComplianceScreening.module.css';

const usd = (n) => n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US');
const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());
const mdY = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
// Property-type buckets the size requirements are published against, for the
// lines that have to name the bucket a building fell into.
const PT_CLASS_LABEL = { multifamily: 'multifamily', public: 'public / institutional', nonresidential: 'non-residential' };

// A source column as it should read in an export. The workbook leaves some
// dates as Excel serials — Seattle's audit due date is "45931" — which is
// unreadable in a column headed "Due Date". Everything else passes through as
// written, so the export stays a faithful copy of the reference.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function sourceValue(column, value) {
  const s = value == null ? '' : String(value).trim();
  if (!/date|deadline/i.test(column) || !/^\d{5}$/.test(s)) return value ?? '';
  const n = Number(s);
  if (n < 20000 || n > 60000) return value;
  return mdY(new Date(EXCEL_EPOCH + n * 86400000).toISOString().slice(0, 10));
}

// Compact horizontal-bar list used for the on-page eligibility/penalty
// summaries. items: [{ label, value }]. Every jurisdiction is listed — the
// lists used to stop at the top 8, which quietly dropped cities from a
// portfolio's exposure. With `onSelect`, each row becomes a button that opens
// the sites behind it.
function HBars({ items, color, fmt = String, wide = false, empty = 'No eligible sites', onSelect = null }) {
  if (!items.length) return <div className={styles.miniEmpty}>{empty}</div>;
  const max = Math.max(1, ...items.map(i => i.value));
  const rowClass = wide ? styles.hbarRowWide : styles.hbarRow;
  return (
    <div className={styles.hbars}>
      {items.map((it) => {
        const body = (
          <>
            <span className={styles.hbarLabel} title={it.label}>{it.label}</span>
            <span className={styles.hbarTrack}>
              <span className={styles.hbarFill} style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: color }} />
            </span>
            <span className={styles.hbarVal}>{fmt(it.value)}</span>
          </>
        );
        if (!onSelect) return <div key={it.label} className={rowClass}>{body}</div>;
        return (
          <button
            key={it.label}
            type="button"
            className={`${rowClass} ${styles.hbarRowBtn}`}
            onClick={() => onSelect(it.label)}
            title={`Show the ${it.label} sites behind this figure`}
          >{body}</button>
        );
      })}
    </div>
  );
}

// One BBS / Audits / BPS cell for a screened site: applicable ✓ / below the
// size requirement, with the deadline + penalty in a tooltip. The fine is also
// printed under the pill — it's the number the conversation turns on, and it
// shouldn't need a hover to find.
function CatCell({ res }) {
  if (!res || !res.active) return <span className={styles.dash}>—</span>;
  // The ft² threshold gates applicability: the building is over the size
  // requirement (applicable) or under it (not required to report). A site with
  // no square footage is taken as meeting it, and says so.
  const thr = res.threshold != null
    ? `Size requirement ${res.threshold.toLocaleString()} ft²`
      + (res.sizeAssumed ? ' — this site has no square footage, so it is taken as meeting it'
        : res.meetsThreshold === true ? ' — building meets it'
        : res.meetsThreshold === false ? ' — building is below it, so it does not have to report'
        : '')
    : null;
  const tip = [
    res.policyName,
    res.deadline ? `Deadline ${mdY(res.deadline)}` : (res.deadlineRaw ? `Deadline ${res.deadlineRaw}` : null),
    thr,
    res.eligible === true && res.penalty != null ? `Max penalty ${usd(res.penalty)}/yr` : null,
  ].filter(Boolean).join(' · ');
  // The ordinance covers other building types but not this one — e.g. Austin's
  // audit requirement is multifamily-only, Seattle's is commercial-only.
  if (res.coveredType === false) {
    return (
      <span className={styles.catCell}>
        <span
          className={styles.pillBelow}
          title={[res.policyName, `This ordinance does not cover ${PT_CLASS_LABEL[res.ptClass] || 'this'} buildings`].filter(Boolean).join(' · ')}
        >Building type not covered</span>
        <span className={styles.catFineNone}>
          {PT_CLASS_LABEL[res.ptClass] || 'this type'} not in scope
        </span>
      </span>
    );
  }
  // Below the size requirement: the ordinance is live in this jurisdiction but
  // this building isn't covered, so no deadline and no fine ride along.
  if (res.eligible === false) {
    return (
      <span className={styles.catCell}>
        <span className={styles.pillBelow} title={tip}>Below size requirement</span>
        <span className={styles.catFineNone}>
          under {res.threshold?.toLocaleString('en-US')} ft²
        </span>
      </span>
    );
  }
  return (
    <span className={styles.catCell}>
      {/* Applicable either way — the pill says when that rests on an assumed
          size rather than a measured one. */}
      <span
        className={res.sizeAssumed ? styles.pillAssumed : styles.pillEligible}
        title={tip}
      >Applicable{res.sizeAssumed ? ' · sq ft assumed' : ''}</span>
      {res.penalty != null ? (
        <span className={styles.catFine} title="Estimated maximum yearly penalty for this mandate at this site">
          {usd(res.penalty)}/yr
        </span>
      ) : res.penaltyUnsized ? (
        <span
          className={styles.catFineNone}
          title={`${usd(res.penaltyRate)} per ft²/yr — this site has no square footage, so the yearly figure can't be worked out`}
        >{usd(res.penaltyRate)}/ft²/yr · needs sq ft</span>
      ) : (
        <span className={styles.catFineNone} title="This ordinance publishes no maximum penalty">no fine on file</span>
      )}
    </span>
  );
}

// One mandate inside the site detail popup: whether it applies, the policy
// behind it, and the arithmetic that produced the fine on the row.
function MandateDetail({ res, mandate, sqft }) {
  const cat = res?.category;
  const basis = mandate ? penaltyBasis(mandate, cat) : null;
  const m = mandate?.[cat] || {};
  if (!res?.active) {
    return (
      <div className={styles.mdBlock}>
        <div className={styles.mdHead} style={{ background: '#94A3B8' }}>{CATEGORY_LABEL[cat]}</div>
        <div className={styles.mdBody}>
          <div className={styles.mdNot}>
            Not applicable{m.status ? ` — the ordinance on file is "${m.status}"` : ' — no active ordinance for this jurisdiction'}.
          </div>
        </div>
      </div>
    );
  }
  // How the number on the row was reached. Three shapes: a flat annual
  // maximum, a per-ft² rate multiplied by the building, or a per-ft² rate
  // with no square footage to multiply.
  const fineLine = res.penalty != null && res.penaltyPerSqft
    ? `${usd(res.penaltyRate)} per ft²/yr × ${sqft.toLocaleString('en-US')} ft² = ${usd(res.penalty)}/yr`
    : res.penaltyUnsized
      ? `${usd(res.penaltyRate)} per ft²/yr — add this site's square footage to size it`
      : res.penalty != null
        ? `${usd(res.penalty)}/yr, as published`
        : 'This ordinance publishes no maximum penalty.';
  const row = (label, value) => value == null || value === '' ? null : (
    <div key={label} className={styles.mdRow}><span className={styles.mdKey}>{label}</span><span className={styles.mdVal}>{value}</span></div>
  );
  // Header and note follow the result: covered (measured or assumed) or under
  // the size requirement.
  const headLabel = res.eligible !== true ? 'Not required to report'
    : res.sizeAssumed ? 'Applicable — sq ft assumed'
    : 'Applicable';
  const headColor = res.eligible !== true ? '#94A3B8'
    : res.sizeAssumed ? '#D97706'
    : CATEGORY_COLOR[cat];
  return (
    <div className={styles.mdBlock}>
      <div className={styles.mdHead} style={{ background: headColor }}>{CATEGORY_LABEL[cat]} — {headLabel}</div>
      <div className={styles.mdBody}>
        {row('Policy', res.policyName || '—')}
        {row('Status', res.status || '—')}
        {row('Deadline', res.deadline ? mdY(res.deadline) : (res.deadlineRaw || '—'))}
        {row('Compliance cycle', m.complianceCycle)}
        {row('Size requirement', res.coveredType === false
          ? `None for ${PT_CLASS_LABEL[res.ptClass] || 'this'} buildings — the ordinance publishes requirements for other building types only`
          : res.threshold != null
            ? `${res.threshold.toLocaleString('en-US')} ft² (${res.ptClass})`
              + (res.sizeAssumed ? ' — square footage unknown, taken as meeting it'
                : res.meetsThreshold === true ? ` — this building's ${sqft != null ? `${sqft.toLocaleString('en-US')} ft² ` : ''}meets it`
                : res.meetsThreshold === false ? ` — this building's ${sqft != null ? `${sqft.toLocaleString('en-US')} ft² ` : ''}is below it`
                : '')
            : 'None published')}
        {res.coveredType === false ? (
          <div className={styles.mdNote}>
            The ordinance is in force in this jurisdiction, but it scopes itself to building types
            this site isn&apos;t one of — it publishes no requirement for {PT_CLASS_LABEL[res.ptClass] || 'this type of'} buildings,
            so this site isn&apos;t counted as needing to report and carries no penalty here.
          </div>
        ) : res.eligible === false && (
          <div className={styles.mdNote}>
            The ordinance is in force in this jurisdiction, but this building is under its size
            requirement, so it isn&apos;t counted as needing to report and carries no penalty here.
          </div>
        )}
        {res.sizeAssumed && (
          <div className={styles.mdNote}>
            This site has no square footage, so it can&apos;t be measured against the size
            requirement — it&apos;s counted as meeting it. Map a Sq Ft column on the Utility Lookup
            subtab to screen it for real.
          </div>
        )}
        {/* An audit ordinance can ask for several separate pieces of work, each
            scoped and priced on its own. "Applicable" alone doesn't say which. */}
        {res.requirements?.length > 0 && (
          <>
            <div className={styles.mdSubhead}>What this ordinance requires</div>
            {res.requirements.map(rq => row(rq.label, `${rq.value}${rq.level === 'conditional' ? ' — conditional' : rq.level === 'optional' ? ' — not required' : ''}`))}
          </>
        )}
        {res.active && cat === 'audits' && !res.requirements?.length && (
          <div className={styles.mdNote}>
            The reference records no energy-audit, water-audit, retro-commissioning or tune-up
            detail for this ordinance — check the jurisdiction&apos;s own guidance for what it asks for.
          </div>
        )}

        <div className={styles.mdSubhead}>How this fine was calculated</div>
        <div className={styles.mdFine}>{
          res.eligible === true ? fineLine
            : res.coveredType === false
              ? 'No fine — the mandate does not cover this building type.'
              : 'No fine — this building is under the size requirement, so the mandate does not reach it.'
        }</div>
        {basis && (
          <>
            {row('Published figure', basis.amount == null ? null
              : `${basis.amount}${basis.unit ? ` ${basis.unit}` : ''}`)}
            {row('Figure is', basis.basis)}
            {basis.rows.map(r => row(r.label, r.value))}
          </>
        )}
        {m.url || m.link ? (
          <div className={styles.mdRow}>
            <span className={styles.mdKey}>Source</span>
            <span className={styles.mdVal}>
              <a href={m.url || m.link} target="_blank" rel="noreferrer" className={styles.mdLink}>{m.url || m.link}</a>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Full screening detail for one site: what it matched, and every mandate with
// its fine worked through. Opened by clicking a row in the site table.
function SiteDetailModal({ site, onClose }) {
  const mandate = site?.govId ? getMandates(site.govId) : null;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!site) return null;
  // Only mandates the building actually has to report under contribute to its
  // exposure — one it's under the size requirement for costs it nothing.
  const total = CATEGORIES.reduce((n, c) => n + (site[c]?.eligible === true ? (site[c]?.penalty || 0) : 0), 0);
  const anyUnsized = CATEGORIES.some(c => site[c]?.eligible === true && site[c]?.penaltyUnsized);
  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Compliance detail for ${site.siteName || 'site'}`}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>{site.siteName || 'Untitled site'}</div>
            <div className={styles.modalSub}>
              {[site.city, site.state].filter(Boolean).join(', ') || 'No location'}
              {site.matched ? <> · <strong>{site.government}</strong> <span className={styles.modalGovId}>{site.govId}</span></> : ' · no jurisdiction matched'}
            </div>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.mdFacts}>
            <span><strong>{site.sqft != null ? site.sqft.toLocaleString('en-US') : '—'}</strong> ft²</span>
            <span><strong>{site.propertyType || '—'}</strong></span>
            <span>Est. exposure <strong>{usd(total)}</strong>/yr{anyUnsized ? ' + unsized' : ''}</span>
          </div>
          {!site.matched ? (
            <div className={styles.mdNot}>
              This site's city and state didn't resolve to a jurisdiction in the Master Ordinances,
              so no mandates were screened. Check the spelling, or confirm the jurisdiction has an
              ordinance on file.
            </div>
          ) : (
            CATEGORIES.map(c => (
              <MandateDetail key={c} res={site[c]} mandate={mandate} sqft={site.sqft} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// The sites behind a figure on a dashboard card: either one jurisdiction's bar
// (`government` set) or the card's whole applicable-sites total (`government`
// null), with the numbers that produced it. Exports the same rows to Excel.
function JurisdictionSitesModal({ category, government, rows, onExport, onSiteClick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const totalPenalty = rows.reduce((n, r) => n + (r[category]?.penalty || 0), 0);
  const unsized = rows.filter(r => r[category]?.penaltyUnsized).length;
  const label = CATEGORY_LABEL[category];
  // Portfolio-wide view: name the jurisdiction on each row and say how many
  // are represented, since they're no longer all the same one.
  const allJurisdictions = !government;
  const govCount = allJurisdictions ? new Set(rows.map(r => r.government)).size : 1;
  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={allJurisdictions ? `All ${label} applicable sites` : `${label} sites in ${government}`}
      >
        <div className={styles.modalHead} style={{ background: CATEGORY_COLOR[category] }}>
          <div>
            <div className={styles.modalTitle}>
              {allJurisdictions ? `${label} — all applicable sites` : `${government} — ${label}`}
            </div>
            <div className={styles.modalSub}>
              {rows.length.toLocaleString('en-US')} applicable site{rows.length === 1 ? '' : 's'}
              {allJurisdictions ? ` across ${govCount} jurisdiction${govCount === 1 ? '' : 's'}` : ''}
              {' · '}{usd(totalPenalty)}/yr max penalty
              {unsized ? ` · ${unsized} site${unsized === 1 ? '' : 's'} unsized` : ''}
            </div>
          </div>
          <div className={styles.modalHeadActions}>
            <button
              type="button"
              className={styles.modalExportBtn}
              onClick={onExport}
              title="Download these sites as an Excel workbook"
            >⬇ Export to Excel</button>
            <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className={styles.modalBody}>
          <div className={`${styles.tableScroll} ${styles.modalTableScroll}`}>
            <table className={styles.siteTable}>
              <thead>
                <tr>
                  <th>Site</th>
                  {allJurisdictions && <th>Jurisdiction</th>}
                  <th>City</th>
                  <th>State</th>
                  <th style={{ textAlign: 'right' }}>Sq Ft</th>
                  <th>Property Type</th>
                  <th>Policy</th>
                  <th>Deadline</th>
                  <th style={{ textAlign: 'right' }}>Max Yearly Penalty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e = r[category] || {};
                  return (
                    <tr
                      key={`${r.siteName}-${i}`}
                      className={styles.siteRowClickable}
                      onClick={() => onSiteClick(r)}
                      title="Open the full screening detail for this site"
                    >
                      <td className={styles.siteCell}>{r.siteName || '—'}</td>
                      {allJurisdictions && <td><strong>{r.government || '—'}</strong></td>}
                      <td>{r.city || '—'}</td>
                      <td>{r.state || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.sqft != null ? r.sqft.toLocaleString('en-US') : '—'}</td>
                      <td>{r.propertyType || '—'}</td>
                      <td>{e.policyName || '—'}</td>
                      <td>{e.deadline ? mdY(e.deadline) : (e.deadlineRaw || '—')}</td>
                      <td style={{ textAlign: 'right' }}>
                        {e.penalty != null
                          ? usd(e.penalty)
                          : e.penaltyUnsized
                            ? <span className={styles.catFineNone}>{usd(e.penaltyRate)}/ft² · needs sq ft</span>
                            : <span className={styles.catFineNone}>no fine on file</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={allJurisdictions ? 8 : 7} style={{ fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{usd(totalPenalty)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Screens the Utility Lookup site list against the two-tab compliance
// reference (City Lookup → Government ID → Master Ordinances) and surfaces
// BBS / Audits / BPS eligibility, a summary dashboard, and the exportable
// branded report.
export function BuildingComplianceScreening({
  sites = [],
  // The unscoped list behind `sites` — drives the ownership toggle's
  // counts and tells an ownership-emptied view apart from no upload.
  allSites = null,
  ownedOnly = false,
  onOwnedOnlyChange = null,
  companyName = '',
}) {
  const loadedSites = allSites || sites;
  const [mode, setMode] = useState('sites'); // 'sites' | 'manual'
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [onlyEligible, setOnlyEligible] = useState(false);
  // The screened site whose detail popup is open, if any.
  const [detailSite, setDetailSite] = useState(null);
  // The dashboard bar drilled into, as { category, government }. Opens the
  // list of sites behind that jurisdiction's count / penalty figure.
  const [drill, setDrill] = useState(null);

  const companyLabel = useMemo(() => sitesCompanyLabel(sites), [sites]);
  const results = useMemo(() => screenSites(sites), [sites]);
  const bpsRows = useMemo(() => bpsPrioritization(results), [results]);
  const matchedCount = useMemo(() => results.filter(r => r.matched).length, [results]);
  const anyEligibleCount = useMemo(
    () => results.filter(r => CATEGORIES.some(c => r[c]?.eligible === true)).length,
    [results],
  );
  // Sites the size requirement decided against, and sites counted only because
  // a missing square footage is taken as meeting it. Both have to be visible:
  // the first explains why the totals are lower than the matched-site count,
  // the second says how much of the total rests on an assumption.
  const sizeScreened = useMemo(() => {
    let below = 0;
    let assumed = 0;
    for (const r of results) {
      if (!r.matched) continue;
      const cats = CATEGORIES.map(c => r[c]).filter(e => e?.active);
      if (!cats.length) continue;
      if (cats.some(e => e.eligible === true)) {
        // Counted — but on an assumed size if no mandate it qualifies for was
        // actually measured against the building.
        if (cats.every(e => e.eligible !== true || e.sizeAssumed)) assumed++;
        continue;
      }
      below++;
    }
    return { below, assumed };
  }, [results]);

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
  // City Lookup: the reference table itself — every city the screening can
  // resolve, the jurisdiction it rolls up to, and that jurisdiction's headline
  // benchmarking terms. One row per city + state, so a member city (Silver
  // Spring under Montgomery County) is visible as its own line.
  function downloadCityLookup() {
    const juris = new Map(JURISDICTIONS.map(j => [j.govId, j]));
    const data = CITY_ROWS.map(([city, si, gi]) => {
      const [state, abbr, country] = STATES[si];
      const j = juris.get(GOV_IDS[gi]) || {};
      return {
        'City': city, 'State': state, 'State Abbreviation': abbr, 'Country': country,
        'Government ID': GOV_IDS[gi], 'Master City': j.masterCity || '',
        'BECS - Compliance Deadline': j.becsDeadline ? mdY(j.becsDeadline) : '',
        'BECS - Threshold': j.becsThreshold || '',
        'BECS - Policy Name': j.becsPolicyName || '',
        'BECS - Compliance Source': j.becsSource || '',
        'Efficiency - Deadline': j.efficiencyDeadline ? mdY(j.efficiencyDeadline) : '',
        'Efficiency - Threshold': j.efficiencyThreshold || '',
        'Notes': j.notes || '',
        'Data Required': j.dataRequired || '',
      };
    });
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
  // Raw-data workbook that accompanies the PDF: a per-site screening sheet and
  // the full raw rows for every matched jurisdiction. "Applicable" is the
  // screening verdict — Yes only when the jurisdiction's ordinance is in force
  // AND the building clears the size requirement — so the column matches the
  // counts on the page. A site with no square footage is taken as clearing it
  // and reads "Yes — sq ft assumed", so the assumption travels with the data.
  //
  // `category` narrows the export to one mandate — the drill-down from a
  // dashboard bar. Those sheets carry that category's full source columns per
  // site (every "Audits - …" for an Energy Audits drill-down), so the sheet
  // answers what the ordinance requires without cross-referencing the
  // jurisdiction rows on the second tab.
  function writeRawWorkbook(rowsToExport, filename, { category = null } = {}) {
    const sourceCols = category ? categoryColumns(category) : [];
    const siteRows = rowsToExport.map(r => {
      const row = {
        Site: r.siteName, City: r.city, State: r.state,
        Jurisdiction: r.government || '', 'Government ID': r.govId || '',
        'Sq Ft': r.sqft ?? '', 'Property Type': r.propertyType || '',
      };
      for (const c of CATEGORIES) {
        const e = r[c];
        row[`${CATEGORY_LABEL[c]} Applicable`] = !e?.active ? 'No'
          : e.coveredType === false ? 'No — building type not covered'
          : e.eligible !== true ? 'No — below size requirement'
          : e.sizeAssumed ? 'Yes — sq ft assumed'
          : 'Yes';
        row[`${CATEGORY_LABEL[c]} Ordinance In Force`] = e?.active ? 'Yes' : 'No';
        row[`${CATEGORY_LABEL[c]} Policy`] = e?.policyName || '';
        row[`${CATEGORY_LABEL[c]} Deadline`] = e?.eligible === true ? (e.deadline ? mdY(e.deadline) : (e.deadlineRaw || '')) : '';
        row[`${CATEGORY_LABEL[c]} Size Requirement (ft²)`] = e?.threshold ?? '';
        row[`${CATEGORY_LABEL[c]} Meets Requirement`] = !e?.active ? ''
          : e.coveredType === false ? 'n/a — building type not covered'
          : e.sizeAssumed ? 'Assumed (no sq ft)'
          : e.meetsThreshold === true ? 'Yes'
          : e.meetsThreshold === false ? 'No'
          : '';
        row[`${CATEGORY_LABEL[c]} Max Yearly Penalty`] = e?.eligible === true ? (e.penalty ?? '') : '';
        // The obligations behind an Energy Audits hit — an energy audit, a
        // water audit, retro-commissioning, a tune-up — each of which is
        // separate work to scope.
        if (c === 'audits') row['Energy Audits Requirements'] = e?.active ? auditRequirementsLabel(getMandates(r.govId)) : '';
      }
      // One category's full reference columns, for a single-mandate export.
      if (sourceCols.length) {
        const raw = (r.matched && getMandates(r.govId)?.categoryRaw?.[category]) || {};
        for (const col of sourceCols) row[col] = sourceValue(col, raw[col]);
      }
      return row;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows), 'Site Screening');
    // Matched-jurisdiction raw rows. A jurisdiction split across several
    // Government IDs in the source workbook (Portland OR) contributes all of
    // them, so the reference behind a merged match is complete.
    const seen = new Set();
    const ordRows = [];
    for (const r of rowsToExport) {
      if (!r.matched || seen.has(r.govId)) continue;
      seen.add(r.govId);
      const g = getMandates(r.govId);
      for (const raw of (g?.raws?.length ? g.raws : [g?.raw])) {
        if (raw) ordRows.push(raw);
      }
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

  // The sites behind a figure on a dashboard card. With a `government` it's one
  // bar; without one it's the card's whole applicable-sites total. Both bar
  // lists drill into the same set — the dollar list is the penalty view of the
  // same applicable sites — so a jurisdiction with sites but no published fine
  // still opens. Ordered by jurisdiction then site so the portfolio-wide list
  // reads as groups rather than upload order.
  const drillRows = useMemo(() => {
    if (!drill) return [];
    const out = results.filter(r => r.matched
      && (!drill.government || r.government === drill.government)
      && r[drill.category]?.eligible === true);
    if (!drill.government) {
      out.sort((a, b) => String(a.government || '').localeCompare(String(b.government || ''))
        || String(a.siteName || '').localeCompare(String(b.siteName || '')));
    }
    return out;
  }, [results, drill]);

  function exportDrill() {
    if (!drillRows.length) return;
    const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const cat = slug(CATEGORY_LABEL[drill.category]);
    writeRawWorkbook(
      drillRows,
      drill.government ? `${slug(drill.government)}-${cat}-Sites.xlsx` : `${cat}-Applicable-Sites.xlsx`,
      { category: drill.category },
    );
  }

  // Owned / All-sites control. Only rendered when the parent owns the
  // scope state — a standalone mount screens whatever it's handed.
  const scopeBar = onOwnedOnlyChange
    ? <OwnershipScopeBar sites={loadedSites} ownedOnly={ownedOnly} onChange={onOwnedOnlyChange} />
    : null;

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
            {' '}· <strong>{CITY_ROWS.length.toLocaleString('en-US')}</strong> cities across <strong>{MASTER_ORDINANCES.length}</strong> jurisdictions on file.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={downloadCityLookup} title={`Download the City Lookup table — ${CITY_ROWS.length.toLocaleString('en-US')} cities, each with the Government ID it screens against`}>City Lookup</button>
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
        loadedSites.length === 0 ? (
          <div className={styles.noMatch}>
            <strong>No site list loaded.</strong>
            <div className={styles.noMatchSub}>
              Upload a site list on the <strong>Utility Lookup</strong> subtab (with City, State, and — for eligibility — a
              square-footage / property-type column) and every site is screened here automatically.
            </div>
          </div>
        ) : sites.length === 0 ? (
          <>
            {scopeBar}
            <div className={styles.noMatch}>
              <strong>No owned sites in the loaded list.</strong>
              <div className={styles.noMatchSub}>
                All {loadedSites.length.toLocaleString()} loaded site{loadedSites.length === 1 ? ' is' : 's are'} leased or
                carry no ownership status, so the owned-only scope leaves nothing to screen. Switch to
                {' '}<strong>All sites</strong> above, or map the Ownership column on the <strong>Utility Lookup</strong> subtab.
              </div>
            </div>
          </>
        ) : (
          <>
            {scopeBar}
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

            {/* What the size requirement did to the counts above. The sites it
                excluded are named rather than just missing, and so are the ones
                counted on an assumed size — a figure resting on a gap in the
                uploaded list should say so on the face of the page. */}
            {(sizeScreened.below > 0 || sizeScreened.assumed > 0) && (
              <div className={styles.sizeNote}>
                <strong>Screened on the size requirement.</strong> A site is counted as needing to
                report only where the ordinance is in force <em>and</em> the building meets that
                mandate&apos;s ft² threshold.
                {sizeScreened.below > 0 && (
                  <> <strong>{sizeScreened.below.toLocaleString()}</strong> matched site
                    {sizeScreened.below === 1 ? ' is' : 's are'} under the threshold for every mandate in
                    {sizeScreened.below === 1 ? ' its' : ' their'} jurisdiction.</>
                )}
                {sizeScreened.assumed > 0 && (
                  <> <strong>{sizeScreened.assumed.toLocaleString()}</strong> carr
                    {sizeScreened.assumed === 1 ? 'ies' : 'y'} no square footage and
                    {sizeScreened.assumed === 1 ? ' is' : ' are'} counted as meeting it — map a
                    Sq Ft column on the <strong>Utility Lookup</strong> subtab to screen
                    {sizeScreened.assumed === 1 ? ' it' : ' them'} for real.</>
                )}
              </div>
            )}

            {/* Summary dashboard — the same figures the exported report charts. */}
            <div className={styles.dashGrid}>
              {CATEGORIES.map(c => (
                <div key={c} className={styles.dashCard}>
                  <div className={styles.dashHead} style={{ background: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]} Eligibility</div>
                  <div className={styles.dashKpis}>
                    {/* Both totals open the same list — every site this mandate
                        applies to, across all jurisdictions — so the headline
                        figure is as traceable as the per-city bars. */}
                    <button
                      type="button"
                      className={styles.dashKpiBtn}
                      onClick={() => setDrill({ category: c, government: null })}
                      disabled={totalEligible(results, c) === 0}
                      title={`Show all ${CATEGORY_LABEL[c]} applicable sites`}
                    >
                      <div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{totalEligible(results, c)}</div>
                      <div className={styles.kpiLbl}>applicable sites</div>
                    </button>
                    <button
                      type="button"
                      className={styles.dashKpiBtn}
                      onClick={() => setDrill({ category: c, government: null })}
                      disabled={totalEligible(results, c) === 0}
                      title={`Show the ${CATEGORY_LABEL[c]} sites behind this figure`}
                    >
                      <div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{usd(totalPenalty(results, c))}</div>
                      <div className={styles.kpiLbl}>max yearly penalty</div>
                    </button>
                  </div>
                  <div className={styles.dashSubhead}>Applicable sites by jurisdiction <span className={styles.dashHint}>· click a city for its sites</span></div>
                  <HBars
                    items={eligibilityByOrdinance(results, c).map(x => ({ label: x.government, value: x.count }))}
                    color={CATEGORY_COLOR[c]}
                    onSelect={(government) => setDrill({ category: c, government })}
                  />
                  {/* The same jurisdictions in dollars — what the mandate is
                      actually worth, which the site counts alone don't say. */}
                  <div className={styles.dashSubhead}>Max yearly fines by jurisdiction <span className={styles.dashHint}>· click a city for its sites</span></div>
                  <HBars
                    items={penaltyByOrdinance(results, c).map(x => ({ label: x.government, value: x.penalty }))}
                    color={CATEGORY_COLOR[c]}
                    fmt={usd}
                    wide
                    empty="No fines on file"
                    onSelect={(government) => setDrill({ category: c, government })}
                  />
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
                    <tr
                      key={r.id}
                      className={styles.siteRowClickable}
                      onClick={() => setDetailSite(r)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailSite(r); } }}
                      tabIndex={0}
                      role="button"
                      title="Open the mandate detail for this site"
                    >
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
            {drill && (
              <JurisdictionSitesModal
                category={drill.category}
                government={drill.government}
                rows={drillRows}
                onExport={exportDrill}
                onSiteClick={(site) => { setDrill(null); setDetailSite(site); }}
                onClose={() => setDrill(null)}
              />
            )}
            {detailSite && <SiteDetailModal site={detailSite} onClose={() => setDetailSite(null)} />}
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
              <div className={styles.noMatchSub}>The City Lookup has no benchmarking or performance ordinance covering this city+state. A city name with no state is only resolved when one jurisdiction carries it — “Portland” could be Maine or Oregon.</div>
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
                        {c === 'audits' && cat.active && auditRequirements(manual.mandate).map(rq => (
                          <div key={rq.key} className={styles.manualMeta}>{rq.label}: {rq.value}</div>
                        ))}
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
