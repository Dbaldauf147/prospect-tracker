import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { CloseRateTrend } from '../WeeklyReportView/CloseRateTrend';
import { closeRateTrendByStage } from '../../utils/pipelineFunnelData';
import { closeRateTrend, periodLabel } from '../../utils/notSoldAnalysis';
import { serviceCloseRateTrend } from '../../utils/serviceTrends';
import {
  stageCloseRateTrend, withoutPullThroughs, trendTableRows, trendSheetRows,
  weeklyTrendSheetRows, closedOppSheetRows, fmtRate,
} from '../../utils/closeRateDeepDive';
import styles from './CloseRateDeepDive.module.css';

// Opps > Close Rates: every close-rate trend on one page, each exportable.
//
//   1. The Weekly email's Close rate trend table, exactly as the email
//      builds it (last 6 months by stage, plus 6 mo and rolling 12 mo).
//   2. By source, 3. by service, 4. by stage - each a chart and a table over
//      the period (month / quarter / year) and Close Date window picked at
//      the top.
//
// "Export all to Excel" writes one workbook with a sheet per section plus
// the closed opps behind them; each table also has its own Export Excel.
// Pull-throughs are left out everywhere (see utils/closeRateDeepDive).

// The same validated categorical order as the By Service / By Source trend
// charts, so a series reads in the same colour on all three tabs.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_LINES = 6;
const OVERALL_COLOUR = '#0f172a';
const axisTick = { fontSize: 11, fill: '#64748B' };

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Window presets, all by Close Date. Default is two calendar years back so a
// quarter view has eight-plus points without reaching into stale history.
const PRESETS = [
  { key: '1y', label: 'Last 12 months', from: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return isoDay(d); } },
  { key: '2y', label: 'Since Jan, 2 yrs ago', from: () => `${new Date().getFullYear() - 2}-01-01` },
  { key: 'ytd', label: 'This year', from: () => `${new Date().getFullYear()}-01-01` },
  { key: 'all', label: 'All time', from: () => '' },
];

const sheetName = (s) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

async function writeWorkbook(fileBase, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing in this window.' }]);
    const keys = Object.keys(rows[0] || { Note: '' });
    ws['!cols'] = keys.map(k => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...rows.slice(0, 200).map(r => String(r[k] ?? '').length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
  }
  XLSX.writeFile(wb, `${fileBase} - ${isoDay(new Date())}.xlsx`);
}

function ChartTooltip({ active, payload, label, lines }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{label}</div>
      {lines.map(l => {
        const c = point[`${l.key}__cell`];
        return (
          <div key={l.key} className={styles.tooltipRow}>
            <span className={styles.swatch} style={{ background: l.colour }} />
            <span className={styles.tooltipName}>{l.name}</span>
            <span className={styles.tooltipRate}>{c?.decided ? fmtRate(c.rate) : '-'}</span>
            <span className={styles.tooltipCount}>{c?.decided ? `${c.wins}/${c.decided}` : 'none closed'}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One trend (by source / service / stage): a line chart of the biggest
 * series plus Overall, and the full table under it.
 */
function TrendSection({ title, subtitle, nameHeader, trend, period, tableId, exportName, note, keepOrder = false, settings, updateSettings }) {
  // Colour by entity: fixed by the series' place in the full list (most
  // decided first), so hiding one in the legend never repaints the rest.
  const colourOf = useMemo(() => {
    const m = new Map();
    trend.series.forEach((s, i) => m.set(s.key, PALETTE[i % PALETTE.length]));
    return m;
  }, [trend]);
  const candidates = useMemo(
    () => trend.series.filter(s => s.decided > 0).slice(0, MAX_LINES),
    [trend],
  );
  const [off, setOff] = useState(() => new Set());
  const lines = useMemo(() => [
    ...candidates.filter(s => !off.has(s.key)).map(s => ({ key: s.key, name: s.label || s.key, colour: colourOf.get(s.key), cells: s.byPeriod })),
    ...(off.has('__overall') ? [] : [{ key: '__overall', name: 'Overall', colour: OVERALL_COLOUR, cells: trend.overall, overall: true }]),
  ], [candidates, off, colourOf, trend]);

  const data = useMemo(() => trend.periods.map(p => {
    const point = { period: periodLabel(p, period) };
    for (const l of lines) {
      const c = l.cells?.[p];
      point[l.key] = c && c.decided ? c.rate : null;
      point[`${l.key}__cell`] = c;
    }
    return point;
  }), [trend, period, lines]);

  const toggle = (key) => setOff(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rows = useMemo(() => trendTableRows(trend), [trend]);
  const columns = useMemo(() => {
    const cellOf = (row, p) => row.byPeriod?.[p];
    return [
      {
        key: 'label',
        label: nameHeader,
        defaultWidth: 220,
        getSortValue: (row) => (row.isOverall ? '￿' : String(row.label).toLowerCase()),
        getFilterValue: (row) => row.label,
        exportValue: (row) => row.label,
        render: (row) => (
          <span className={row.isOverall ? styles.overallName : undefined} title={row.folded ? `Includes ${row.folded.join(', ')}` : undefined}>
            {!row.isOverall && colourOf.has(row.key) && candidates.some(c => c.key === row.key) && (
              <span className={styles.swatch} style={{ background: colourOf.get(row.key) }} />
            )}
            {row.label}
          </span>
        ),
      },
      {
        key: 'rate',
        label: 'Close rate',
        defaultWidth: 96,
        getSortValue: (row) => row.rate ?? -1,
        getFilterValue: (row) => fmtRate(row.rate),
        exportValue: (row) => (row.rate == null ? '' : Math.round(row.rate)),
        render: (row) => <div className={`${styles.num} ${row.isOverall ? styles.overallName : ''}`}>{fmtRate(row.rate)}</div>,
      },
      {
        key: 'decided',
        label: 'Sold / Closed',
        defaultWidth: 118,
        getSortValue: (row) => row.decided,
        getFilterValue: (row) => `${row.wins}/${row.decided}`,
        exportValue: (row) => `${row.wins}/${row.decided}`,
        render: (row) => <div className={styles.num}>{row.wins}/{row.decided}</div>,
      },
      ...trend.periods.map(p => ({
        key: `p_${p}`,
        label: periodLabel(p, period),
        defaultWidth: 96,
        getSortValue: (row) => cellOf(row, p)?.rate ?? -1,
        getFilterValue: (row) => fmtRate(cellOf(row, p)?.rate),
        exportValue: (row) => { const c = cellOf(row, p); return c?.rate == null ? '' : Math.round(c.rate); },
        render: (row) => {
          const c = cellOf(row, p);
          if (!c || !c.decided) return <div className={styles.cellEmpty} title="Nothing closed in this period">-</div>;
          return (
            <div className={styles.cell} title={`${row.label}, ${periodLabel(p, period)}: ${c.wins} sold of ${c.decided} closed`}>
              <span className={styles.cellRate}>{fmtRate(c.rate)}</span>
              <span className={styles.cellCount}>{c.wins}/{c.decided}</span>
            </div>
          );
        },
      })),
    ];
  }, [trend, period, nameHeader, colourOf, candidates]);

  const detail = useMemo(() => trendSheetRows(trend, { period, nameHeader }), [trend, period, nameHeader]);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {subtitle && <div className={styles.sectionSub}>{subtitle}</div>}
        </div>
        <span className={styles.headline}>
          Overall {fmtRate(trend.rate)} <span className={styles.muted}>({trend.wins}/{trend.decided})</span>
        </span>
      </div>

      {trend.periods.length === 0 ? (
        <div className={styles.empty}>No closed opps in this window.</div>
      ) : (
        <>
          <div className={styles.legend}>
            {[...candidates.map(s => ({ key: s.key, name: s.label || s.key, colour: colourOf.get(s.key) })), { key: '__overall', name: 'Overall', colour: OVERALL_COLOUR }].map(l => (
              <button
                key={l.key}
                type="button"
                className={off.has(l.key) ? styles.legendOff : styles.legendItem}
                onClick={() => toggle(l.key)}
                title={off.has(l.key) ? 'Show on the chart' : 'Hide from the chart'}
              >
                <span className={styles.swatch} style={{ background: l.colour }} />
                {l.name}
              </button>
            ))}
            {trend.series.filter(s => s.decided > 0).length > MAX_LINES && (
              <span className={styles.muted}>Chart shows the {MAX_LINES} with the most closed opps; the table has them all.</span>
            )}
          </div>
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip lines={lines} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                {lines.map(l => (
                  <Line
                    key={l.key}
                    dataKey={l.key}
                    name={l.name}
                    stroke={l.colour}
                    strokeWidth={l.overall ? 2.5 : 2}
                    strokeDasharray={l.overall ? '6 3' : undefined}
                    dot={{ r: 3, strokeWidth: 0, fill: l.colour }}
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* DataTable's scroll body is flex: 1 1 0, so it needs a sized
              parent. Sized to the rows, capped. */}
          <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(560, 132 + rows.length * 37) }}>
            <DataTable
              key={tableId}
              tableId={tableId}
              columns={columns}
              rows={rows}
              alwaysVisible={['label']}
              rowGroup={(row) => (row.isOverall ? 1 : 0)}
              rowStyle={(row) => (row.isOverall ? { background: '#f8fafc' } : undefined)}
              // Stages read in their own order (6 down to 3); everything else
              // biggest first.
              defaultSort={keepOrder ? undefined : { key: 'decided', direction: 'desc' }}
              emptyMessage="No closed opps in this window."
              exportFileName={exportName}
              exportExtraSheets={[{ name: 'Sold-Closed detail', rows: detail }]}
              settings={settings}
              updateSettings={updateSettings}
            />
          </div>
        </>
      )}
      {note && <div className={styles.note}>{note}</div>}
    </section>
  );
}

export function CloseRateDeepDive({ records = [], hiddenServices, settings, updateSettings }) {
  const [period, setPeriod] = useState('quarter');
  const [preset, setPreset] = useState('2y');
  const [from, setFrom] = useState(() => PRESETS.find(p => p.key === '2y').from());
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const counted = useMemo(() => withoutPullThroughs(records), [records]);
  const hidden = useMemo(() => [...(hiddenServices || [])], [hiddenServices]);

  // 1. The Weekly email's table: always its own 6-month window, whatever the
  // controls say, so it matches what went out.
  const weekly = useMemo(() => closeRateTrendByStage(records, { months: 6 }), [records]);
  const bySource = useMemo(() => closeRateTrend(counted, { period, from, to }), [counted, period, from, to]);
  const byService = useMemo(() => serviceCloseRateTrend(counted, { period, from, to, hidden }), [counted, period, from, to, hidden]);
  const byStage = useMemo(() => stageCloseRateTrend(records, { period, from, to }), [records, period, from, to]);

  const periodName = PERIODS.find(p => p.key === period)?.label || period;
  const windowText = from || to
    ? `Close Date ${from || 'start'} to ${to || 'today'}`
    : 'all Close Dates';

  const pickPreset = (key) => {
    const p = PRESETS.find(x => x.key === key);
    setPreset(key);
    setFrom(p.from());
    setTo('');
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      await writeWorkbook('Close rate deep dive', [
        { name: 'Weekly email trend', rows: weeklyTrendSheetRows(weekly) },
        { name: `By source (${periodName})`, rows: trendSheetRows(bySource, { period, nameHeader: 'Source' }) },
        { name: `By service (${periodName})`, rows: trendSheetRows(byService, { period, nameHeader: 'Service' }) },
        { name: `By stage (${periodName})`, rows: trendSheetRows(byStage, { period, nameHeader: 'Stage' }) },
        { name: 'Closed opps', rows: closedOppSheetRows(records, { period, from, to }) },
        {
          name: 'About',
          rows: [
            { Item: 'Window', Value: windowText },
            { Item: 'Period', Value: periodName },
            { Item: 'Close rate', Value: 'Sold / (Sold + Not Sold), by Close Date. Rates are whole percentage points.' },
            { Item: 'Pull-throughs', Value: 'Left out of every sheet.' },
            { Item: 'Weekly email trend', Value: 'Last 6 months by stage, the same table as the Weekly email, whatever the window above.' },
            { Item: 'By stage', Value: 'An opp counts toward every stage it reached, so stage rows do not add up.' },
            { Item: 'By service', Value: 'An opp counts toward each service on its Scope. Hidden services are left out.' },
            { Item: 'Exported', Value: new Date().toLocaleString() },
          ],
        },
      ]);
    } finally {
      setExporting(false);
    }
  };

  const exportWeekly = () => writeWorkbook('Close rate trend (Weekly email)', [
    { name: 'Weekly email trend', rows: weeklyTrendSheetRows(weekly) },
  ]);

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.group} role="group" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.key} type="button" className={period === p.key ? styles.toggleOn : styles.toggle} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Close Date window">
          {PRESETS.map(p => (
            <button key={p.key} type="button" className={preset === p.key ? styles.toggleOn : styles.toggle} onClick={() => pickPreset(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <label className={styles.dateField}>
          From
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset(''); }} />
        </label>
        <label className={styles.dateField}>
          To
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset(''); }} />
        </label>
        <button type="button" className={styles.exportBtn} onClick={exportAll} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export all to Excel'}
        </button>
      </div>
      <div className={styles.scopeNote}>
        Close rate = Sold / (Sold + Not Sold), by Close Date. Pull-through opps are left out of every section.
        Sections 2 to 4 use {periodName.toLowerCase()}s over {windowText}.
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>1. Close rate trend (Weekly email)</h2>
            <div className={styles.sectionSub}>Last 6 months by the stage each closed deal reached, the same table the Weekly email sends.</div>
          </div>
          <button type="button" className={styles.smallBtn} onClick={exportWeekly}>Export Excel</button>
        </div>
        <CloseRateTrend trend={weekly} />
      </section>

      <TrendSection
        title="2. Close rate by source"
        subtitle={`Each source's close rate per ${periodName.toLowerCase()}.`}
        nameHeader="Source"
        trend={bySource}
        period={period}
        tableId={`close-rates-source-${period}`}
        exportName="Close rate by source"
        settings={settings}
        updateSettings={updateSettings}
      />

      <TrendSection
        title="3. Close rate by service"
        subtitle={`Each service's close rate per ${periodName.toLowerCase()}.`}
        nameHeader="Service"
        trend={byService}
        period={period}
        tableId={`close-rates-service-${period}`}
        exportName="Close rate by service"
        note={`An opp counts toward each service on its Scope, so service rows don't add up to Overall.${hidden.length ? ` ${hidden.length} service${hidden.length === 1 ? '' : 's'} hidden on By Service ${hidden.length === 1 ? 'is' : 'are'} left out.` : ''}`}
        settings={settings}
        updateSettings={updateSettings}
      />

      <TrendSection
        title="4. Close rate by stage"
        subtitle={`By the stages each closed opp reached, per ${periodName.toLowerCase()}, over the window above.`}
        nameHeader="Stage"
        trend={byStage}
        period={period}
        tableId={`close-rates-stage-${period}`}
        exportName="Close rate by stage"
        keepOrder
        note="An opp counts toward every stage it reached, so Stage 3 has the widest base and Stage 6 the narrowest; the rows aren't meant to add up. Overall is every closed opp."
        settings={settings}
        updateSettings={updateSettings}
      />
    </div>
  );
}
