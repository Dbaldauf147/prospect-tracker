// Pipeline > KPI Trends: six KPIs month by month and over the trailing 6 and
// 12 months, from the Opps tab (utils/kpiTrends.js), under Pipeline Metrics.
//
// Laid out like the Weekly Report's Close Rate Trend (and drawn with its
// stylesheet) so the two read as one family: a column per calendar month with
// the count each figure rests on underneath, a sparkline, then the two
// trailing windows. Every figure is a LiveValue: hover for the opps behind
// it, click to pin the panel and take them away as Excel.
//
// Each KPI has a target, typed into the last column and saved on the
// Pipeline dashboard record. The 6 mo and 12 mo figures turn green with a ▲
// when they meet it and red with a ▼ when they miss, and the sparkline draws
// it as a dashed line.
import { useMemo, useState } from 'react';
import { LiveValue, LiveValueProvider } from '../common/LiveValue';
import { mapRows } from '../common/liveValueBreakdown';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import crt from '../WeeklyReportView/CloseRateTrend.module.css';
import styles from './PipelineView.module.css';
import own from './KpiTrendsSection.module.css';
import {
  computeKpiTrends, formatKpi, formatKpiTarget, parseKpiTarget, targetStatus, targetValue,
} from '../../utils/kpiTrends';

const LINE = '#1c5cab';
const PLOT_W = 88;
const PLOT_H = 34;
const PAD = 4;

// Short names for Export all's sheets (Excel caps a sheet name at 31).
const SHEET = { generation: 'Generation', avgSize: 'Avg Size', pctQuoted: 'Pct Quoted', closeQuoted: 'Close Rate Quoted', closeOverall: 'Close Rate Overall', avgLife: 'Avg Life' };
const today = () => new Date().toISOString().slice(0, 10);
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

// What to type in each KPI's target box.
const TARGET_HINT = {
  count: 'opps per month',
  money: 'dollars',
  pct: 'percent',
  days: 'days',
};

/**
 * One KPI's months as a sparkline. A rate sits on a fixed 0-100% scale, as
 * the Close Rate Trend's do; anything else is scaled from 0 to the larger of
 * its own peak and the target, so the target line always fits in the box.
 * Months with nothing to measure break the line rather than bridging it.
 */
function Sparkline({ kpi, months, target }) {
  const values = kpi.cells.map(c => c.value);
  const t = targetValue(kpi, target);
  const top = kpi.format === 'pct'
    ? 1
    : Math.max(...values.filter(v => v != null), t ?? 0) * 1.1 || 1;
  const y = (v) => PAD + (1 - Math.min(v, top) / top) * (PLOT_H - PAD * 2);
  const points = values.map((v, i) => (v == null ? null : {
    x: PAD + (values.length === 1 ? (PLOT_W - PAD * 2) / 2 : (i * (PLOT_W - PAD * 2)) / (values.length - 1)),
    y: y(v),
    label: `${months[i].label} ${formatKpi(v, kpi.format)}`,
  }));
  const runs = [];
  let run = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const last = [...points].reverse().find(Boolean);
  if (!last) return <span className={crt.sparkEmpty} title={`${kpi.short}: nothing to measure in these months.`}>-</span>;

  return (
    <svg className={crt.spark} viewBox={`0 0 ${PLOT_W} ${PLOT_H}`} width={PLOT_W} height={PLOT_H} role="img" data-kpi-spark={kpi.key}
      aria-label={`${kpi.short}: ${points.filter(Boolean).map(p => p.label).join(', ')}${t != null ? `. Target ${formatKpi(t, kpi.format)}` : ''}`}>
      <line x1={0} y1={PLOT_H - PAD} x2={PLOT_W} y2={PLOT_H - PAD} stroke="#e2e8f0" strokeWidth="1" />
      {t != null && (
        <line x1={0} y1={y(t)} x2={PLOT_W} y2={y(t)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />
      )}
      {runs.filter(r => r.length > 1).map(r => (
        <polyline key={`${r[0].x}-${r.length}`} points={r.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke={LINE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {runs.filter(r => r.length === 1).map(r => (
        <circle key={`d${r[0].x}`} cx={r[0].x} cy={r[0].y} r="2.5" fill={LINE} />
      ))}
      <circle cx={last.x} cy={last.y} r="4" fill={LINE} stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

// The hover panel for one figure: what it counts, the arithmetic, and the
// opps behind it. The on-screen list is the short form; the Excel export
// carries every Opps tab column.
function breakdownFor(kpi, cell, windowLabel, target) {
  const rows = cell.rows || [];
  const exportColumns = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const t = targetValue(kpi, target);
  return {
    title: `${kpi.label} - ${windowLabel}`,
    value: formatKpi(cell.value, kpi.format),
    formula: kpi.about,
    inputs: [
      { label: 'Counted', value: cell.detail },
      ...(t != null ? [{ label: 'Target', value: formatKpi(t, kpi.format) }] : []),
    ],
    rows: {
      head: `Opps behind this figure (${rows.length})`,
      columns: ['Account', 'Stage', 'Opened', 'Closed', 'Quoted Amount'],
      aligns: ['', '', '', '', 'num'],
      ...mapRows(rows, r => [
        r.Account || '(no account)',
        r.Stage || '',
        r['Opened (as counted)'] || '',
        r['Close Date (as counted)'] || '',
        typeof r['Quoted Amount (as counted)'] === 'number' ? formatKpi(r['Quoted Amount (as counted)'], 'money') : '-',
      ], {
        exportColumns,
        exportMapFn: r => exportColumns.map(c => r[c] ?? ''),
      }),
    },
    note: 'Auto-fed from the Opps tab. Pull-through opps are left out.',
    filePrefix: 'kpi-trends',
  };
}

function MonthCell({ kpi, cell, month, target }) {
  if (cell.value == null) {
    return (
      <td className={crt.cellEmpty} title={`${kpi.short}: nothing to measure in ${month.label}. Blank rather than zero.`}>-</td>
    );
  }
  return (
    <td className={crt.cell}>
      <LiveValue id={`kpi-${kpi.key}-${month.key}`} className={crt.cellLive}
        title={`${kpi.label}, ${month.label}: ${cell.detail}.`}
        breakdown={breakdownFor(kpi, cell, month.label, target)}>
        <span className={crt.cellRate}>{formatKpi(cell.value, kpi.format)}</span>
        <span className={crt.cellCount}>{cell.sub}</span>
      </LiveValue>
    </td>
  );
}

function TotalCell({ kpi, cell, w, target, strong }) {
  if (cell.value == null) {
    return <td className={strong ? crt.rollingCell : crt.overallCell}><span className={crt.cellEmptyInline}>-</span></td>;
  }
  const status = targetStatus(kpi, cell.value, target);
  const t = targetValue(kpi, target);
  const cls = [strong ? crt.rollingCell : crt.overallCell, status === 'met' ? crt.cellBetter : '', status === 'missed' ? own.cellMissed : ''].filter(Boolean).join(' ');
  const verdict = status === 'met' ? ` Meets the ${formatKpi(t, kpi.format)} target.`
    : status === 'missed' ? ` Short of the ${formatKpi(t, kpi.format)} target.` : '';
  return (
    <td className={cls}>
      <LiveValue id={`kpi-${kpi.key}-${w.key}`}
        className={status === 'met' ? crt.betterChip : status === 'missed' ? own.missedChip : crt.cellLive}
        title={`${kpi.label}, ${w.label.toLowerCase()} (${day(w.from)} to ${day(w.to)}): ${cell.detail}.${verdict}`}
        breakdown={breakdownFor(kpi, cell, w.label, target)}>
        <span className={crt.cellRate}>
          {status && <span className={crt.betterArrow} aria-hidden="true">{status === 'met' ? '▲' : '▼'}</span>}
          {formatKpi(cell.value, kpi.format)}
        </span>
        <span className={crt.cellCount}>{cell.sub}</span>
        {status && <span className={crt.srOnly}>{status === 'met' ? ' - meets target' : ' - short of target'}</span>}
      </LiveValue>
    </td>
  );
}

export function KpiTrendsSection({ oppsRecords = [], ageRef, targets = {}, onTargetChange }) {
  const trends = useMemo(() => computeKpiTrends(oppsRecords, { ageRef }), [oppsRecords, ageRef]);
  const [error, setError] = useState('');

  const exportAll = async () => {
    setError('');
    try {
      const XLSX = await import('xlsx');
      const sheetOf = (rows, empty) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: empty }]);
        ws['!cols'] = Object.keys(rows[0] || { Note: '' }).map(h => ({ wch: Math.min(Math.max(h.length + 2, 14), 40) }));
        return ws;
      };
      const wb = XLSX.utils.book_new();
      const summary = trends.rows.map(k => ({
        KPI: k.label,
        ...Object.fromEntries(trends.months.map((m, i) => [m.label, formatKpi(k.cells[i].value, k.format)])),
        ...Object.fromEntries(trends.windows.map((w, i) => [w.label, formatKpi(k.totals[i].value, k.format)])),
        Target: formatKpiTarget(k, targets[k.key]),
        'How it is counted': k.about,
      }));
      XLSX.utils.book_append_sheet(wb, sheetOf(summary, ''), 'Summary');
      for (const k of trends.rows) {
        trends.windows.forEach((w, i) => {
          XLSX.utils.book_append_sheet(wb, sheetOf(k.totals[i].rows, 'No opps in this window.'), `${SHEET[k.key]} ${w.months}mo`.slice(0, 31));
        });
      }
      XLSX.writeFile(wb, `KPI Trends - ${today()}.xlsx`);
    } catch (err) {
      setError(`Couldn't build the export: ${err?.message || err}`);
    }
  };

  const noData = oppsRecords.length === 0;
  const [w6, w12] = trends.windows;
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>KPI TRENDS</span>
        <button type="button" onClick={exportAll} disabled={noData}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, fontSize: 11, padding: '0.15rem 0.5rem', cursor: noData ? 'default' : 'pointer', fontFamily: 'inherit' }}
          title="Download every KPI in one Excel file: a summary sheet, then the opps behind each 6 and 12 month figure."
        >Export all</button>
      </div>
      {noData ? (
        <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>Paste the Opps tab to see KPI trends.</div>
      ) : (
        <LiveValueProvider className={`${crt.wrap} ${own.wrap}`}>
          <table className={crt.table}>
            <thead>
              <tr>
                <th className={crt.stageHead} scope="col">KPI</th>
                {trends.months.map(m => <th key={m.key} className={crt.monthHead} scope="col">{m.label}</th>)}
                <th className={crt.trendHead} scope="col">Trend</th>
                <th className={crt.overallHead} scope="col" title={`Trailing 6 months, ${day(w6.from)} to ${day(w6.to)}.`}>{w6.short}</th>
                <th className={crt.rollingHead} scope="col" title={`Trailing 12 months, ${day(w12.from)} to ${day(w12.to)}.`}>{w12.short}</th>
                <th className={`${crt.overallHead} ${own.targetHead}`} scope="col" title="Your target for each KPI. The 6 mo and 12 mo figures turn green when they meet it and red when they miss.">Target</th>
              </tr>
            </thead>
            <tbody>
              {trends.rows.map(k => {
                const target = targets[k.key];
                return (
                  <tr key={k.key}>
                    <th scope="row" className={crt.stageCell} title={k.about}>
                      <span className={crt.swatch} style={{ background: LINE }} aria-hidden="true" />
                      {k.key === 'generation' ? 'Opportunity Generation (avg / month)' : k.label}
                    </th>
                    {k.cells.map((c, i) => <MonthCell key={trends.months[i].key} kpi={k} cell={c} month={trends.months[i]} target={target} />)}
                    <td className={crt.trendCell}><Sparkline kpi={k} months={trends.months} target={target} /></td>
                    <TotalCell kpi={k} cell={k.totals[0]} w={w6} target={target} />
                    <TotalCell kpi={k} cell={k.totals[1]} w={w12} target={target} strong />
                    <td className={own.targetCell}>
                      <CommitOnBlurInput
                        className={own.targetInput}
                        value={formatKpiTarget(k, target)}
                        onCommit={(v) => onTargetChange?.(k.key, parseKpiTarget(v))}
                        placeholder="Set"
                        aria-label={`${k.label} target, in ${TARGET_HINT[k.format]}`}
                        title={`Target in ${TARGET_HINT[k.format]}${k.better === 'lower' ? ' (met at or under it)' : ' (met at or over it)'}. Clear the box to remove it.`}
                        disabled={!onTargetChange}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={crt.note}>
            Each month is the opps opened (Generation, Average Size) or closed (the rest) in it; the
            current month is so far. <strong>6 mo</strong> and <strong>12 mo</strong> are the trailing 6
            and 12 months to today. Opportunity Generation is opps opened per month in every column.
            The small line under each figure is what it rests on. With a target set, the 6 mo and 12 mo
            figures turn green with a ▲ when they meet it and red with a ▼ when they miss, and the
            sparkline draws it as a dashed line. Pull-through opps are left out. Hover any figure for
            the opps behind it; click to pin that panel open, then <strong>⬇ Excel</strong> to take the list away.
          </div>
        </LiveValueProvider>
      )}
      {error && <div style={{ padding: '0.4rem 0.75rem', color: '#b91c1c', fontSize: '0.72rem' }}>{error}</div>}
    </div>
  );
}
