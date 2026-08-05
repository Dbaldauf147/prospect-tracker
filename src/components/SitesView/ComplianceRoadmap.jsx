import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  screenSites, buildComplianceRoadmap, sitesCompanyLabel,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
} from '../../utils/complianceMandates';
import {
  DEADLINE_JURISDICTIONS, DEADLINE_STATUS, STATUS_COLOR, STATUS_LABEL, STATUS_NOTE,
  mandateDeadlines, mandateLanes, nextMandateDeadline, statusCounts, quarterLabelOf, daysUntil,
} from '../../data/corporateComplianceDeadlines';
import { companyScreeningKey } from '../../data/corporateComplianceScreening';
import { schneiderLogoSvg } from '../../utils/schneiderLogo';
import { OwnershipScopeBar } from './OwnershipScopeBar.jsx';
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

// ---- Corporate disclosure deadlines ---------------------------------------
// One lane per jurisdiction, milestones placed on a shared date axis. Identity
// comes from the lane (labelled on the left) and from each marker's own text,
// never from colour — so colour is free to carry the thing that actually moves
// on these mandates: how firm the date is.

const MS_DAY = 86_400_000;
const dayNum = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_DAY;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
// Rough advance width for the label-collision test below. 0.56em is a little
// generous for the 8–9px sans we draw at, which is the safe direction: it
// pushes labels apart rather than letting them touch.
const textW = (s, size) => String(s || '').length * size * 0.56;

function MandateTimeline({ lanes, today }) {
  const W = 720, padL = 92, padR = 16, padT = 30, padB = 12;
  const iw = W - padL - padR;
  const items = lanes.flatMap(l => l.items);
  // Pad the axis to whole quarters either side so the first and last markers
  // aren't pinned to the frame.
  const days = items.map(i => dayNum(i.due));
  const lo = Math.min(...days) - 45, hi = Math.max(...days) + 45;
  const span = Math.max(1, hi - lo);
  const x = (iso) => padL + ((dayNum(iso) - lo) / span) * iw;

  // Year gridlines across the visible span.
  const firstYear = new Date((lo + 45) * MS_DAY).getUTCFullYear();
  const lastYear = new Date((hi - 45) * MS_DAY).getUTCFullYear();
  const years = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);

  // Greedy row packing per lane: a marker's label drops to the next row when
  // it would overlap the one before it, so a lane with two dates a month
  // apart stays readable instead of overprinting.
  const laid = lanes.map((lane) => {
    const rowEnds = [];
    const placed = lane.items.map((it) => {
      const w = Math.max(textW(it.chip, 9), textW(it.shortDue, 8));
      const cx = x(it.due);
      // Keep the label inside the plot area. The axis is padded by 45 days
      // either side, which says nothing about how wide a chip renders at
      // 9px — so a marker near either end would otherwise print into the
      // lane-label gutter or off the right frame. Clamping moves the text
      // only; the dot stays on its true date and the leader line slants
      // across to say so.
      const lx = Math.min(Math.max(cx, padL + w / 2), W - padR - w / 2);
      const x1 = lx - w / 2, x2 = lx + w / 2;
      let row = rowEnds.findIndex(end => x1 > end + 6);
      if (row === -1) { row = rowEnds.length; rowEnds.push(x2); } else { rowEnds[row] = x2; }
      return { ...it, cx, lx, row };
    });
    return { ...lane, placed, rows: Math.max(1, rowEnds.length) };
  });

  // Variable lane heights — a lane only pays for the rows it uses.
  const ROW_H = 19, LANE_TOP = 16, LANE_PAD = 8;
  const geom = laid.reduce((acc, lane) => {
    const y = acc.length ? acc[acc.length - 1].y + acc[acc.length - 1].h : padT;
    const h = LANE_TOP + lane.rows * ROW_H + LANE_PAD;
    acc.push({ ...lane, y, h, cy: y + LANE_TOP - 4 });
    return acc;
  }, []);
  const H = (geom.length ? geom[geom.length - 1].y + geom[geom.length - 1].h : padT) + padB;
  const nowX = today >= new Date(lo * MS_DAY).toISOString().slice(0, 10)
    && today <= new Date(hi * MS_DAY).toISOString().slice(0, 10) ? x(today) : null;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Key corporate disclosure submission deadlines by jurisdiction">
      {/* Lane stripes first so the year gridlines stay visible across them. */}
      {geom.map((lane, li) => (
        li % 2 === 1 ? <rect key={lane.key} x={padL} y={lane.y} width={iw} height={lane.h} fill="#F8FAFC" /> : null
      ))}
      {years.map((y) => {
        const gx = x(`${y}-01-01`);
        return (
          <g key={y}>
            <line x1={gx} y1={padT - 12} x2={gx} y2={H - padB} stroke="#E2E8F0" strokeDasharray="3 3" />
            <text x={gx + 4} y={padT - 16} fontSize="10" fontWeight="700" fill="#94A3B8">{y}</text>
          </g>
        );
      })}
      {nowX != null && (
        <g>
          <line x1={nowX} y1={padT - 12} x2={nowX} y2={H - padB} stroke="#B91C1C" strokeWidth="1.5" />
          <text x={nowX + 4} y={H - 2} fontSize="9" fontWeight="700" fill="#B91C1C">today</text>
        </g>
      )}
      {geom.map((lane) => (
        <g key={lane.key}>
          <text x={padL - 10} y={lane.cy + 4} textAnchor="end" fontSize="11" fontWeight="800" fill="#334155">{lane.label}</text>
          <text x={padL - 10} y={lane.cy + 16} textAnchor="end" fontSize="8" fill="#94A3B8">{lane.short}</text>
          <line x1={padL} y1={lane.cy} x2={W - padR} y2={lane.cy} stroke="#E2E8F0" />
          {lane.placed.map((it) => {
            const ly = lane.cy + LANE_TOP - 6 + it.row * ROW_H;
            return (
              <g key={it.key}>
                <title>{`${lane.label} · ${it.mandate}\n${it.dueLabel}\n${it.requirement}`}</title>
                <line x1={it.cx} y1={lane.cy} x2={it.lx} y2={ly - 9} stroke="#CBD5E1" />
                <circle cx={it.cx} cy={lane.cy} r="5" fill={STATUS_COLOR[it.status]} stroke="#fff" strokeWidth="2" />
                {/* The year gridlines and the today rule run the full height
                    of the chart, behind the lanes. A white halo keeps them
                    from striking through a label that happens to sit on
                    one, without having to route labels around them. */}
                <text x={it.lx} y={ly} textAnchor="middle" fontSize="9" fontWeight="700" fill="#334155"
                  stroke="#fff" strokeWidth="3" paintOrder="stroke">{it.chip}</text>
                <text x={it.lx} y={ly + 9} textAnchor="middle" fontSize="8" fill="#64748B"
                  stroke="#fff" strokeWidth="3" paintOrder="stroke">{it.shortDue}</text>
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}{subtitle && <span className={styles.cardSub}>: {subtitle}</span>}</div>
      {children}
    </div>
  );
}

// Compliance Roadmap subtab: how compliance deadlines, the number of sites in
// scope, and the cumulative max-yearly fine exposure grow over time. Runs off
// the same screened Utility Lookup site list as the Building Compliance
// Screening subtab.
export function ComplianceRoadmap({
  sites = [],
  // The unscoped list behind `sites` — drives the ownership toggle's
  // counts and tells an ownership-emptied view apart from no upload.
  allSites = null,
  ownedOnly = false,
  onOwnedOnlyChange = null,
  settings,
}) {
  const loadedSites = allSites || sites;
  // Company identity comes off the full list — the ownership scope
  // narrows which buildings are charted, not who the portfolio is.
  const companyLabel = useMemo(() => sitesCompanyLabel(loadedSites), [loadedSites]);
  const results = useMemo(() => screenSites(sites), [sites]);
  const roadmap = useMemo(() => buildComplianceRoadmap(results), [results]);
  const { periods, totals } = roadmap;

  // First quarter that actually carries a new deadline = the "next" milestone.
  const firstActive = periods.find(p => p.newObligations > 0);

  // --- Corporate disclosure mandates ---------------------------------------
  // Which jurisdictions the loaded companies have actually screened Yes for on
  // the Corporate Compliance subtab. Those answers live under the company key
  // that page persists by, so the roadmap reads the same company the same way.
  const screenedYes = useMemo(() => {
    const screening = settings?.corporateComplianceScreening || {};
    const keys = new Set();
    // Full list, not the owned-only scope: corporate disclosure mandates
    // bind the company, so a company whose buildings are all leased still
    // counts here.
    for (const s of (loadedSites || [])) {
      const k = companyScreeningKey(s?.company);
      if (k) keys.add(k);
    }
    const out = new Set();
    for (const k of keys) {
      const answers = screening[k];
      if (!answers) continue;
      for (const j of DEADLINE_JURISDICTIONS) if (answers[j.key] === 'Yes') out.add(j.key);
    }
    return out;
  }, [settings?.corporateComplianceScreening, loadedSites]);

  // Default to the screened-in view when there is one, so the roadmap opens on
  // the deadlines that actually bite. With nothing screened yet it shows all
  // six — the reference timeline is useful before anyone has answered.
  const [onlyScreened, setOnlyScreened] = useState(true);
  const scoped = onlyScreened && screenedYes.size > 0;
  const deadlines = useMemo(
    () => mandateDeadlines(scoped ? [...screenedYes] : null),
    [scoped, screenedYes],
  );
  const lanes = useMemo(() => mandateLanes(deadlines), [deadlines]);
  const today = todayISO();
  const nextMandate = nextMandateDeadline(deadlines, today);
  const mandateStatuses = useMemo(() => statusCounts(deadlines), [deadlines]);

  function exportRoadmap() {
    if (!periods.length && !deadlines.length) { alert('No dated compliance deadlines to export.'); return; }
    const wb = XLSX.utils.book_new();
    if (periods.length) {
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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Compliance Roadmap');
    }
    if (deadlines.length) {
      const rows = deadlines.map(d => ({
        Jurisdiction: DEADLINE_JURISDICTIONS.find(j => j.key === d.jurisdictionKey)?.label || d.jurisdictionKey,
        Mandate: d.mandate,
        'Reporting On': d.reportingOn,
        Quarter: quarterLabelOf(d.due),
        'Key Submission Deadline': d.dueLabel,
        "What's Due": d.requirement,
        Status: STATUS_LABEL[d.status] || d.status,
        Notes: d.note,
        Source: d.source,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Corporate Deadlines');
    }
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
            cumulative estimated fine exposure ramps up over time: followed by the key submission deadlines
            for the corporate disclosure mandates screened on the Corporate Compliance subtab.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={exportRoadmap} disabled={!periods.length && !deadlines.length}>Export roadmap</button>
        </div>
      </div>

      {onOwnedOnlyChange && loadedSites.length > 0 && (
        <OwnershipScopeBar sites={loadedSites} ownedOnly={ownedOnly} onChange={onOwnedOnlyChange} />
      )}

      {loadedSites.length === 0 ? (
        <div className={styles.empty}>
          <strong>No site list loaded.</strong>
          <div className={styles.emptySub}>Upload a site list on the <strong>Utility Lookup</strong> subtab (with City and State) and the roadmap builds automatically.</div>
        </div>
      ) : sites.length === 0 ? (
        <div className={styles.empty}>
          <strong>No owned sites in the loaded list.</strong>
          <div className={styles.emptySub}>
            All {loadedSites.length.toLocaleString()} loaded site{loadedSites.length === 1 ? ' is' : 's are'} leased or carry
            no ownership status, so the owned-only scope leaves nothing to chart. Switch to <strong>All sites</strong> above,
            or map the Ownership column on the <strong>Utility Lookup</strong> subtab.
          </div>
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
            <div className={styles.kpi}><div className={styles.kpiNum} style={{ color: '#334155' }}>{firstActive ? firstActive.label : '-'}</div><div className={styles.kpiLbl}>next deadline window</div></div>
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
                      <td>{p.newObligations || <span className={styles.dash}>-</span>}</td>
                      <td>{p.newByCategory.bbs || <span className={styles.dash}>-</span>}</td>
                      <td>{p.newByCategory.audits || <span className={styles.dash}>-</span>}</td>
                      <td>{p.newByCategory.bps || <span className={styles.dash}>-</span>}</td>
                      <td>{p.newSites || <span className={styles.dash}>-</span>}</td>
                      <td><strong>{p.cumSites}</strong></td>
                      <td>{p.newFines ? usd(p.newFines) : <span className={styles.dash}>-</span>}</td>
                      <td><strong>{usd(p.cumFines)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      {/* Corporate disclosure mandates. Independent of the site list — these
          turn on the company, not its buildings — so this section renders even
          with nothing uploaded. */}
      <div className={styles.sectionRule}>
        <span className={styles.sectionRuleText}>Corporate disclosure mandates</span>
      </div>

      <div className={styles.header}>
        <div>
          <div className={styles.subtitle}>
            Key submission deadlines for the six jurisdictions screened on Corporate Compliance.
            Whether a mandate applies to this company is answered there; this is when it lands.
          </div>
        </div>
        <div className={styles.actions}>
          {screenedYes.size > 0 && (
            <label className={styles.toggle}>
              <input type="checkbox" checked={onlyScreened} onChange={e => setOnlyScreened(e.target.checked)} />
              Only jurisdictions screened Yes ({screenedYes.size})
            </label>
          )}
        </div>
      </div>

      {!deadlines.length ? (
        <div className={styles.empty}>
          <strong>No corporate mandates in scope.</strong>
          <div className={styles.emptySub}>
            Nothing is screened Yes for the loaded companies. Untick the filter above to see all six
            jurisdictions, or answer the questions on the <strong>Corporate Compliance</strong> subtab.
          </div>
        </div>
      ) : (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <div className={styles.kpiNum} style={{ color: '#334155' }}>{deadlines.length}</div>
              <div className={styles.kpiLbl}>{scoped ? 'deadlines in scope' : 'deadlines tracked'}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiNum} style={{ color: '#334155' }}>{lanes.length}</div>
              <div className={styles.kpiLbl}>jurisdictions shown</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiNum} style={{ color: nextMandate ? STATUS_COLOR[nextMandate.status] : '#334155', fontSize: '1rem' }}>
                {nextMandate ? `${nextMandate.chip} · ${nextMandate.shortDue}` : '-'}
              </div>
              <div className={styles.kpiLbl}>next submission</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiNum} style={{ color: '#334155' }}>
                {nextMandate ? (daysUntil(nextMandate.due, today) ?? '-') : '-'}
              </div>
              <div className={styles.kpiLbl}>days away</div>
            </div>
          </div>

          <div className={styles.legend}>
            {DEADLINE_STATUS.filter(s => mandateStatuses[s] > 0).map(s => (
              <span key={s} className={styles.legendItem} title={STATUS_NOTE[s]}>
                <span className={styles.legendSwatch} style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]} ({mandateStatuses[s]})
              </span>
            ))}
          </div>

          <ChartCard title="Key submission deadlines" subtitle="one lane per jurisdiction; colour shows how firm the date is">
            <MandateTimeline lanes={lanes} today={today} />
          </ChartCard>

          <ChartCard title="Submission detail">
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Jurisdiction</th><th>Mandate</th><th>Reporting on</th><th>Quarter</th>
                    <th>Key submission deadline</th><th>What's due</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deadlines.map(d => {
                    const j = DEADLINE_JURISDICTIONS.find(x => x.key === d.jurisdictionKey);
                    const past = d.due < today;
                    return (
                      <tr key={d.key} className={past ? styles.quietRow : undefined}>
                        <td className={styles.qCell}>{j?.label || d.jurisdictionKey}</td>
                        <td><strong>{d.mandate}</strong></td>
                        <td>{d.reportingOn}</td>
                        <td className={styles.qCell}>{quarterLabelOf(d.due)}</td>
                        <td>{d.dueLabel}</td>
                        <td className={styles.wrapCell}>
                          {d.requirement}
                          {d.note && <div className={styles.noteLine}>{d.note}</div>}
                        </td>
                        <td>
                          <span className={styles.statusPill} style={{ background: STATUS_COLOR[d.status] }} />
                          {STATUS_LABEL[d.status]}
                          {d.source && (
                            <> · <a className={styles.srcLink} href={d.source} target="_blank" rel="noreferrer">source</a></>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={styles.footnote}>
              Climate disclosure dates move: several of these shifted in the last year. Re-check the
              linked sources before putting a date in front of a client. Last reviewed 31 Jul 2026.
            </div>
          </ChartCard>
        </>
      )}
    </div>
  );
}
