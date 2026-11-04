import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { CloseRateTrend } from '../WeeklyReportView/CloseRateTrend';
import { StageReach } from './StageReach';
import { closeRateTrendByStage } from '../../utils/pipelineFunnelData';
import { closeRateTrend, periodLabel } from '../../utils/notSoldAnalysis';
import { serviceCloseRateTrend } from '../../utils/serviceTrends';
import {
  stageCloseRateTrend, applyCloseRateFilters, trendTableRows, trendSheetRows,
  weeklyTrendSheetRows, closedOppSheetRows, stageReachSheetRows, fmtRate,
  fittedRateAxis,
} from '../../utils/closeRateDeepDive';
import {
  SETTINGS_KEY as SAVED_FILTERS_KEY, readSavedFilters, snapshotFilters, filtersFromEntry,
  matchesEntry, withSaved, withoutSaved, withDefault,
} from '../../utils/closeRateSavedFilters';
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
// Two filter buttons, both on by default, run over every section: Lead stage
// or higher, and no pull-throughs (see utils/closeRateDeepDive).

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
function TrendSection({ title, subtitle, nameHeader, trend, period, tableId, exportName, note, keepOrder = false, fitYAxis = false, settings, updateSettings }) {
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

  // fitYAxis: the axis tops out 1 point over the highest visible rate
  // instead of 100%, so low close rates use the chart's height.
  const yAxis = useMemo(
    () => (fitYAxis ? fittedRateAxis(data, lines.map(l => l.key)) : null),
    [fitYAxis, data, lines],
  );

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
  // Tables start folded away; the chart is what a visit is for, and the
  // header's Export Excel writes the full table either way.
  const [showTable, setShowTable] = useState(false);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {subtitle && <div className={styles.sectionSub}>{subtitle}</div>}
        </div>
        <div className={styles.headActions}>
          <span className={styles.headline}>
            Overall {fmtRate(trend.rate)} <span className={styles.muted}>({trend.wins}/{trend.decided})</span>
          </span>
          {trend.periods.length > 0 && (
            <>
              <button
                type="button"
                className={styles.smallBtn}
                aria-expanded={showTable}
                onClick={() => setShowTable(v => !v)}
              >{showTable ? 'Hide table' : 'Show table'}</button>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => writeWorkbook(exportName, [{ name: exportName, rows: detail }])}
                title="Every row and period with its close rate and Sold / Closed, whether or not the table is showing"
              >Export Excel</button>
            </>
          )}
        </div>
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
                <YAxis domain={yAxis?.domain || [0, 100]} ticks={yAxis?.ticks || [0, 25, 50, 75, 100]} allowDataOverflow={false} tickFormatter={(v) => `${v}%`} tick={axisTick} tickLine={false} axisLine={false} />
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
          {showTable && <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(560, 132 + rows.length * 37) }}>
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
          </div>}
        </>
      )}
      {note && <div className={styles.note}>{note}</div>}
    </section>
  );
}

// "Saved filters" menu: name and save the tab's top controls, apply a saved
// set, delete one, or star one so the tab opens with it.
function SavedFiltersMenu({ saved, current, onApply, onChange }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const active = saved.list.find(e => matchesEntry(current, e));
  const save = () => {
    const label = name.trim();
    if (!label) return;
    onChange(withSaved(saved, snapshotFilters(current, label)));
    setName('');
  };
  const replacing = name.trim() && saved.list.some(e => e.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <div className={styles.savedWrap} ref={ref}>
      <button
        type="button"
        className={styles.savedBtn}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title="Save these filters, or apply a saved set"
      >
        Saved filters{active ? `: ${active.name}` : ''}
        {saved.list.length > 0 && <span className={styles.savedCount}>{saved.list.length}</span>}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div className={styles.savedMenu} role="menu">
          <div className={styles.savedSaveRow}>
            <input
              type="text"
              placeholder="Name these filters..."
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }}
            />
            <button type="button" className={styles.savedSaveBtn} onClick={save} disabled={!name.trim()}>
              {replacing ? 'Replace' : 'Save'}
            </button>
          </div>
          {saved.list.length === 0 && <div className={styles.savedEmpty}>No saved filters yet</div>}
          {saved.list.map(e => {
            const isDefault = saved.defaultId === e.id;
            return (
              <div key={e.id} className={styles.savedItem}>
                <button
                  type="button"
                  className={isDefault ? styles.savedStarOn : styles.savedStar}
                  onClick={() => onChange(withDefault(saved, e.id))}
                  title={isDefault ? 'The tab opens with these filters. Click to stop.' : 'Open the tab with these filters'}
                  aria-label={isDefault ? `Stop opening with ${e.name}` : `Open with ${e.name}`}
                >{isDefault ? '★' : '☆'}</button>
                <button
                  type="button"
                  className={active?.id === e.id ? styles.savedNameOn : styles.savedName}
                  onClick={() => { onApply(e); setOpen(false); }}
                >{e.name}</button>
                <button
                  type="button"
                  className={styles.savedDelete}
                  onClick={() => onChange(withoutSaved(saved, e.id))}
                  title={`Delete ${e.name}`}
                  aria-label={`Delete ${e.name}`}
                >×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CloseRateDeepDive({ records = [], hiddenServices, settings, updateSettings }) {
  const saved = useMemo(() => readSavedFilters(settings), [settings]);
  // The tab opens on the starred saved filter, if there is one; otherwise on
  // Quarter, "Since Jan, 2 yrs ago" and both filter buttons on.
  const [initial] = useState(() => {
    const def = saved.list.find(e => e.id === saved.defaultId);
    return def ? filtersFromEntry(def, PRESETS) : {
      period: 'quarter', preset: '2y', from: PRESETS.find(p => p.key === '2y').from(), to: '',
      leadOrHigher: true, noPullThroughs: true,
    };
  });
  const [period, setPeriod] = useState(initial.period);
  const [preset, setPreset] = useState(initial.preset);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [exporting, setExporting] = useState(false);
  const [leadOrHigher, setLeadOrHigher] = useState(initial.leadOrHigher);
  const [noPullThroughs, setNoPullThroughs] = useState(initial.noPullThroughs);
  const applyFilters = useCallback((entry) => {
    const f = filtersFromEntry(entry, PRESETS);
    setPeriod(f.period); setPreset(f.preset); setFrom(f.from); setTo(f.to);
    setLeadOrHigher(f.leadOrHigher); setNoPullThroughs(f.noPullThroughs);
  }, []);
  // Settings can arrive after the tab has mounted (first load on a machine).
  // Apply the starred filter then, once, unless the user has already
  // touched the controls.
  const touched = useRef(false);
  const startedWithDefault = useRef(saved.defaultId != null);
  useEffect(() => {
    if (startedWithDefault.current || touched.current) return;
    const def = saved.list.find(e => e.id === saved.defaultId);
    if (!def) return;
    startedWithDefault.current = true;
    applyFilters(def);
  }, [saved, applyFilters]);
  const currentFilters = { period, preset, from, to, leadOrHigher, noPullThroughs };
  const saveFilters = (next) => updateSettings?.({ [SAVED_FILTERS_KEY]: next });

  const filtered = useMemo(
    () => applyCloseRateFilters(records, { leadOrHigher, noPullThroughs }),
    [records, leadOrHigher, noPullThroughs],
  );
  const counted = filtered.records;
  const includePullThroughs = !noPullThroughs;
  const hidden = useMemo(() => [...(hiddenServices || [])], [hiddenServices]);
  // Section 5's own controls (closed only, Start Date range), reported back
  // so Export all writes the figures on screen.
  const [reachState, setReachState] = useState({ closedOnly: true, from: '', to: '' });
  const onReachState = useCallback((st) => setReachState(prev => (
    prev.closedOnly === st.closedOnly && prev.from === st.from && prev.to === st.to ? prev : st
  )), []);

  // 1. The Weekly email's table: always its own 6-month window, whatever the
  // window controls say. The filter buttons do apply; it leaves pull-throughs
  // out either way, as the email does.
  const weekly = useMemo(() => closeRateTrendByStage(counted, { months: 6 }), [counted]);
  const bySource = useMemo(() => closeRateTrend(counted, { period, from, to }), [counted, period, from, to]);
  const byService = useMemo(() => serviceCloseRateTrend(counted, { period, from, to, hidden }), [counted, period, from, to, hidden]);
  const byStage = useMemo(() => stageCloseRateTrend(counted, { period, from, to, includePullThroughs }), [counted, period, from, to, includePullThroughs]);
  const filterText = [
    leadOrHigher ? 'Lead stage or higher only' : 'every stage',
    noPullThroughs ? 'pull-throughs left out' : 'pull-throughs included',
  ].join(', ');

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
        { name: `Stage reach (${periodName})`, rows: stageReachSheetRows(counted, { period, closedOnly: reachState.closedOnly, from: reachState.from, to: reachState.to }) },
        { name: 'Closed opps', rows: closedOppSheetRows(counted, { period, from, to, includePullThroughs }) },
        {
          name: 'About',
          rows: [
            { Item: 'Window', Value: windowText },
            { Item: 'Period', Value: periodName },
            { Item: 'Close rate', Value: 'Sold / (Sold + Not Sold), by Close Date. Rates are whole percentage points.' },
            { Item: 'Lead stage or higher', Value: leadOrHigher ? `On: opps closed before reaching Lead left out (${filtered.belowLead}). ${filtered.unknownStage} losses with no stage history kept.` : 'Off: every closed opp counted.' },
            { Item: 'Pull-throughs', Value: noPullThroughs ? `Left out (${filtered.pullThroughs}).` : 'Included, except in the Weekly email trend, which always leaves them out.' },
            { Item: 'Weekly email trend', Value: 'Last 6 months by stage, the Weekly email table with the filters above applied, whatever the window.' },
            { Item: 'By stage', Value: 'An opp counts toward every stage it reached, so stage rows do not add up.' },
            { Item: 'Stage reach', Value: `% of ${reachState.closedOnly ? 'closed ' : ''}opps that got at least as far as each stage, grouped by Start Date${reachState.from || reachState.to ? ` (${reachState.from || 'start'} to ${reachState.to || 'today'})` : ''}. Pull-throughs always left out; Not Sold opps with no stage history left out.` },
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
            <button key={p.key} type="button" className={period === p.key ? styles.toggleOn : styles.toggle} onClick={() => { touched.current = true; setPeriod(p.key); }}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Close Date window">
          {PRESETS.map(p => (
            <button key={p.key} type="button" className={preset === p.key ? styles.toggleOn : styles.toggle} onClick={() => { touched.current = true; pickPreset(p.key); }}>
              {p.label}
            </button>
          ))}
        </div>
        <label className={styles.dateField}>
          From
          <input type="date" value={from} onChange={e => { touched.current = true; setFrom(e.target.value); setPreset(''); }} />
        </label>
        <label className={styles.dateField}>
          To
          <input type="date" value={to} onChange={e => { touched.current = true; setTo(e.target.value); setPreset(''); }} />
        </label>
        <div className={styles.filterButtons} role="group" aria-label="Filters">
          <button
            type="button"
            className={leadOrHigher ? styles.filterOn : styles.filterOff}
            aria-pressed={leadOrHigher}
            onClick={() => { touched.current = true; setLeadOrHigher(v => !v); }}
            title="Only count opps known to have reached Lead or a later stage (from the opp's Stage or its stage history). Losses with no stage history can't be placed, so they stay in."
          >
            <span className={styles.check} aria-hidden="true">{leadOrHigher ? '✓' : ''}</span>
            Lead stage or higher
          </button>
          <button
            type="button"
            className={noPullThroughs ? styles.filterOn : styles.filterOff}
            aria-pressed={noPullThroughs}
            onClick={() => { touched.current = true; setNoPullThroughs(v => !v); }}
            title="Leave pull-through opps out of every section"
          >
            <span className={styles.check} aria-hidden="true">{noPullThroughs ? '✓' : ''}</span>
            Do not include pull-through opps
          </button>
        </div>
        <SavedFiltersMenu
          saved={saved}
          current={currentFilters}
          onApply={(e) => { touched.current = true; applyFilters(e); }}
          onChange={saveFilters}
        />
        <button type="button" className={styles.exportBtn} onClick={exportAll} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export all to Excel'}
        </button>
      </div>
      <div className={styles.scopeNote}>
        Close rate = Sold / (Sold + Not Sold), by Close Date, {filterText}.
        {leadOrHigher && ` ${filtered.belowLead} closed opp${filtered.belowLead === 1 ? '' : 's'} never reached Lead and ${filtered.belowLead === 1 ? 'is' : 'are'} left out${filtered.unknownStage ? `; ${filtered.unknownStage} loss${filtered.unknownStage === 1 ? '' : 'es'} with no stage history can't be placed and stay in` : ''}.`}
        {noPullThroughs && ` ${filtered.pullThroughs} closed pull-through${filtered.pullThroughs === 1 ? '' : 's'} left out.`}
        {' '}Sections 2 to 4 use {periodName.toLowerCase()}s over {windowText}.
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>1. Close rate trend (Weekly email)</h2>
            <div className={styles.sectionSub}>Last 6 months by the stage each closed deal reached: the Weekly email's table with the filters above applied. It always leaves pull-throughs out, as the email does.</div>
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
        fitYAxis
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
        fitYAxis
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
        fitYAxis
        keepOrder
        note="An opp counts toward every stage it reached, so Stage 3 has the widest base and Stage 6 the narrowest; the rows aren't meant to add up. Overall is every closed opp."
        settings={settings}
        updateSettings={updateSettings}
      />

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>5. % of deals that reached each stage</h2>
            <div className={styles.sectionSub}>
              Of the opps that started in each {periodName.toLowerCase()} (by Start Date), the share that got at least as far as each stage.
              The same view as Days in Stage &gt; Stage Reach, with the filters above applied{leadOrHigher ? ', so Lead reads 100%' : ''}.
            </div>
          </div>
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => writeWorkbook('Stage reach', [{ name: 'Stage reach', rows: stageReachSheetRows(counted, { period, closedOnly: reachState.closedOnly, from: reachState.from, to: reachState.to }) }])}
            title="Each period's % and count per stage, whether or not the table is showing"
          >Export Excel</button>
        </div>
        <StageReach
          records={counted}
          period={period}
          onState={onReachState}
          collapsibleTable
          settings={settings}
          updateSettings={updateSettings}
        />
      </section>
    </div>
  );
}
