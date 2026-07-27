import { useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  screenSites, buildComplianceRoadmap, sitesCompanyLabel,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
} from '../../utils/complianceMandates';
import { schneiderLogoSvg } from '../../utils/schneiderLogo';
import styles from './ComplianceRoadmap.module.css';

const usd = (n) => n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US');
const usdShort = (n) => {
  const v = Math.abs(n);
  if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
};
const shortLabel = (label) => label.replace(/(\d{2})(\d{2})$/, "'$2"); // "Q2 2026" -> "Q2 '26"

const SITES_COLOR = '#0F766E';   // teal — sites in scope
const FINES_COLOR = '#B91C1C';   // red  — fine exposure

// Stacked bars: new compliance deadlines per quarter, coloured by category.
function StackedBars({ periods }) {
  const W = 720, H = 200, padL = 34, padR = 12, padT = 14, padB = 34;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...periods.map(p => p.newObligations));
  const n = periods.length;
  const slot = iw / n;
  const bw = Math.min(38, slot * 0.62);
  const y = (v) => padT + ih - (v / max) * ih;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
      <line x1={padL} y1={padT + ih} x2={W - padR} y2={padT + ih} stroke="#E2E8F0" />
      {periods.map((p, i) => {
        const cx = padL + slot * (i + 0.5);
        let acc = 0;
        const total = p.newObligations;
        return (
          <g key={p.key}>
            {CATEGORIES.map(c => {
              const v = p.newByCategory[c];
              if (!v) return null;
              const h = (v / max) * ih;
              const yTop = y(acc + v);
              acc += v;
              return <rect key={c} x={cx - bw / 2} y={yTop} width={bw} height={h} fill={CATEGORY_COLOR[c]} />;
            })}
            {total > 0 && <text x={cx} y={y(total) - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0F172A">{total}</text>}
            <text x={cx} y={H - 12} textAnchor="middle" fontSize="9" fill="#64748B">{shortLabel(p.label)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Cumulative area + line for a single metric (sites or fines).
function CumulativeArea({ periods, valueKey, color, fmt }) {
  const W = 720, H = 200, padL = 44, padR = 14, padT = 16, padB = 34;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = periods.map(p => p[valueKey]);
  const max = Math.max(1, ...vals);
  const n = periods.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - (v / max) * ih;
  const linePts = periods.map((p, i) => `${x(i).toFixed(1)},${y(p[valueKey]).toFixed(1)}`);
  const areaPath = `M ${x(0).toFixed(1)},${(padT + ih).toFixed(1)} `
    + periods.map((p, i) => `L ${x(i).toFixed(1)},${y(p[valueKey]).toFixed(1)} `).join('')
    + `L ${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
      {/* baseline + max gridline */}
      <line x1={padL} y1={padT + ih} x2={W - padR} y2={padT + ih} stroke="#E2E8F0" />
      <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke="#F1F5F9" />
      <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize="9" fill="#94A3B8">{fmt(max)}</text>
      <text x={padL - 6} y={padT + ih} textAnchor="end" fontSize="9" fill="#94A3B8">0</text>
      <path d={areaPath} fill={color} fillOpacity="0.14" />
      <polyline points={linePts.join(' ')} fill="none" stroke={color} strokeWidth="2" />
      {periods.map((p, i) => (
        <g key={p.key}>
          <circle cx={x(i)} cy={y(p[valueKey])} r="3" fill={color} />
          <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="9" fill="#64748B">{shortLabel(p.label)}</text>
        </g>
      ))}
      {/* end-of-line total */}
      <text x={x(n - 1)} y={y(vals[n - 1]) - 8} textAnchor="end" fontSize="11" fontWeight="800" fill={color}>{fmt(vals[n - 1])}</text>
    </svg>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}{subtitle && <span className={styles.cardSub}> — {subtitle}</span>}</div>
      {children}
    </div>
  );
}

// Compliance Roadmap subtab: how compliance deadlines, the number of sites in
// scope, and the cumulative max-yearly fine exposure grow over time. Runs off
// the same screened Utility Lookup site list as the Building Compliance
// Screening subtab.
export function ComplianceRoadmap({ sites = [] }) {
  const companyLabel = useMemo(() => sitesCompanyLabel(sites), [sites]);
  const results = useMemo(() => screenSites(sites), [sites]);
  const roadmap = useMemo(() => buildComplianceRoadmap(results), [results]);
  const { periods, totals } = roadmap;

  // First quarter that actually carries a new deadline = the "next" milestone.
  const firstActive = periods.find(p => p.newObligations > 0);

  function exportRoadmap() {
    if (!periods.length) { alert('No dated compliance deadlines to export.'); return; }
    const rows = periods.map(p => ({
      Quarter: p.label,
      'New Deadlines': p.newObligations,
      'New BBS': p.newByCategory.bbs, 'New Energy Audits': p.newByCategory.audits, 'New BPS': p.newByCategory.bps,
      'New Sites In Scope': p.newSites,
      'Cumulative Sites In Scope': p.cumSites,
      'Cumulative Deadlines': p.cumObligations,
      'New Fine Exposure': p.newFines,
      'Cumulative Fine Exposure': p.cumFines,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Compliance Roadmap');
    XLSX.writeFile(wb, 'Compliance-Roadmap.xlsx');
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.brandBand}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {companyLabel && (
            <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.01em', lineHeight: 1.2 }}>{companyLabel}</div>
          )}
          <h1 className={styles.title}>Compliance Roadmap</h1>
        </div>
        <span className={styles.brandLogo} dangerouslySetInnerHTML={{ __html: schneiderLogoSvg({ onDark: true, width: 172 }) }} />
      </div>
      <div className={styles.header}>
        <div>
          <div className={styles.subtitle}>
            When each site's BBS / Audits / BPS deadlines land, how many sites come into scope, and how the
            cumulative estimated fine exposure ramps up over time.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={exportRoadmap} disabled={!periods.length}>Export roadmap</button>
        </div>
      </div>

      {sites.length === 0 ? (
        <div className={styles.empty}>
          <strong>No site list loaded.</strong>
          <div className={styles.emptySub}>Upload a site list on the <strong>Utility Lookup</strong> subtab (with City and State) and the roadmap builds automatically.</div>
        </div>
      ) : !periods.length ? (
        <div className={styles.empty}>
          <strong>No dated deadlines to chart.</strong>
          <div className={styles.emptySub}>
            {totals.obligations > 0
              ? `${totals.obligations} applicable obligation${totals.obligations === 1 ? '' : 's'} found, but none carry a parseable deadline date.`
              : 'None of the loaded sites map to a jurisdiction with an active BBS / Audits / BPS ordinance.'}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}><div className={styles.kpiNum} style={{ color: SITES_COLOR }}>{totals.sites}</div><div className={styles.kpiLbl}>sites in scope</div></div>
            <div className={styles.kpi}><div className={styles.kpiNum} style={{ color: '#334155' }}>{totals.obligations}</div><div className={styles.kpiLbl}>total deadlines</div></div>
            <div className={styles.kpi}><div className={styles.kpiNum} style={{ color: FINES_COLOR }}>{usd(totals.fines)}</div><div className={styles.kpiLbl}>max yearly fine exposure</div></div>
            <div className={styles.kpi}><div className={styles.kpiNum} style={{ color: '#334155' }}>{firstActive ? firstActive.label : '—'}</div><div className={styles.kpiLbl}>next deadline window</div></div>
          </div>

          <div className={styles.legend}>
            {CATEGORIES.map(c => (
              <span key={c} className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: CATEGORY_COLOR[c] }} />{CATEGORY_LABEL[c]}</span>
            ))}
            {totals.undated > 0 && <span className={styles.undated}>{totals.undated} undated obligation{totals.undated === 1 ? '' : 's'} not shown on the timeline</span>}
          </div>

          <ChartCard title="Compliance deadlines per quarter" subtitle="new BBS / Audits / BPS deadlines">
            <StackedBars periods={periods} />
          </ChartCard>

          <div className={styles.chartGrid}>
            <ChartCard title="Sites in scope over time" subtitle="cumulative">
              <CumulativeArea periods={periods} valueKey="cumSites" color={SITES_COLOR} fmt={(n) => String(Math.round(n))} />
            </ChartCard>
            <ChartCard title="Fine exposure over time" subtitle="cumulative max yearly">
              <CumulativeArea periods={periods} valueKey="cumFines" color={FINES_COLOR} fmt={usdShort} />
            </ChartCard>
          </div>

          <ChartCard title="Roadmap detail">
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Quarter</th><th>New deadlines</th><th>BBS</th><th>Audits</th><th>BPS</th>
                    <th>New sites</th><th>Sites in scope</th><th>New fines</th><th>Cumulative fines</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map(p => (
                    <tr key={p.key} className={p.newObligations === 0 ? styles.quietRow : undefined}>
                      <td className={styles.qCell}>{p.label}</td>
                      <td>{p.newObligations || <span className={styles.dash}>—</span>}</td>
                      <td>{p.newByCategory.bbs || <span className={styles.dash}>—</span>}</td>
                      <td>{p.newByCategory.audits || <span className={styles.dash}>—</span>}</td>
                      <td>{p.newByCategory.bps || <span className={styles.dash}>—</span>}</td>
                      <td>{p.newSites || <span className={styles.dash}>—</span>}</td>
                      <td><strong>{p.cumSites}</strong></td>
                      <td>{p.newFines ? usd(p.newFines) : <span className={styles.dash}>—</span>}</td>
                      <td><strong>{usd(p.cumFines)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}
    </div>
  );
}
