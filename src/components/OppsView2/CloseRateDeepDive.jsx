import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LabelList, LineChart, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { CloseRateTrend } from '../WeeklyReportView/CloseRateTrend';
import { StageReach } from './StageReach';
import { GroupEditor, ServiceSettingsPopup } from './ServiceTrends';
import { ColourPickDot } from '../common/ColourPickDot';
import { TargetsMenu } from './CloseRateTargets';
import {
  CHART_PREFS_KEY, readChartPrefs, withColour, withoutColours, withLabels, labelText,
  isLabelled, withLineLabel, labelsState, withTargets, targetsOf, targetLineProps, targetLabel,
} from '../../utils/closeRateChartPrefs';
import { closeRateTrendByStage } from '../../utils/pipelineFunnelData';
import { closeRateTrend, periodLabel } from '../../utils/notSoldAnalysis';
import { serviceCloseRateTrend, servicesOf } from '../../utils/serviceTrends';
import {
  GROUPS_KEY, EXCLUDED_KEY, groupsFromSettings, excludedFromSettings, withServiceGroup, withExcluded,
} from '../../utils/serviceTrendSettings';
import {
  stageCloseRateTrend, applyCloseRateFilters, trendTableRows, trendSheetRows,
  weeklyTrendSheetRows, closedOppSheetRows, stageReachSheetRows, fmtRate,
  oppDetailSheetRows, stageReachDetailRows,
  fittedRateAxis,
} from '../../utils/closeRateDeepDive';
import {
  SETTINGS_KEY as SAVED_FILTERS_KEY, readSavedFilters, snapshotFilters, filtersFromEntry,
  matchesEntry, withSaved, withoutSaved, withDefault,
  CHART_IDS, readChartSaved, chartSavedPatch, snapshotChart, chartMatchesEntry, chartFromEntry,
} from '../../utils/closeRateSavedFilters';
import { PRESET_LIST, WEEKLY_MONTHS, cleanWeeklyMonths } from '../../utils/closeRateWindows';
import { StageProgression } from './StageProgression';
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
// Rolling windows (utils/closeRateWindows), resolved from today each time.
const PRESETS = PRESET_LIST;

/**
 * The Close Date window as one dropdown: a rolling preset, or Custom dates
 * while the From / To boxes beside it hold a fixed range.
 */
function WindowSelect({ preset, onPick }) {
  return (
    <label className={styles.windowField}>
      Window
      <select value={preset || ''} onChange={e => onPick(e.target.value)} aria-label="Close Date window">
        {!preset && <option value="">Custom dates</option>}
        {PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </label>
  );
}

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

function ChartTooltip({ active, payload, label, lines, targets = [] }) {
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
      {targets.length > 0 && (
        <div className={styles.tooltipTarget}>
          {[...targets].sort((a, b) => b.value - a.value).map(t => (
            <div key={t.id} className={styles.tooltipRow}>
              <span className={styles.swatch} style={{ background: t.colour, borderRadius: 2, height: 3 }} />
              <span className={styles.tooltipName}>{targetLabel(t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * One trend (by source / service / stage): a line chart of the biggest
 * series plus Overall, and the full table under it.
 */
// Optional, for the service chart (all off elsewhere):
//   lineState   { off: Set, onShown(key, shown) } - which lines are switched
//               off, owned by the parent (By Service's shared state)
//   exclude     keys never drawn as their own line (Count in Other)
//   picked      keys to draw instead of the busiest few, when any are here
//   onNameClick(event, row)  makes each table name a button (the settings popup)
//   nameBadge(row)           a note after a name, e.g. "(group)"
//   headerExtra              controls for the section header
function TrendSection({
  title, subtitle, nameHeader, trend, period, tableId, exportName, note, keepOrder = false, fitYAxis = false,
  colours, onColourChange, onResetColours, labelled = () => false, onLabelToggle, targets = [], onTargetsChange,
  lineState, exclude, picked, onNameClick, nameBadge, headerExtra, filterBar, settings, updateSettings,
  countedHeader = 'Counted toward',
}) {
  // Colour by entity: fixed by the series' place in the full list (most
  // decided first), so hiding one in the legend never repaints the rest.
  const colourOf = useMemo(() => {
    const m = new Map();
    // A colour the user picked (saved per chart) wins over the palette.
    trend.series.forEach((s, i) => m.set(s.key, colours?.[s.key] || PALETTE[i % PALETTE.length]));
    return m;
  }, [trend, colours]);
  const overallColour = colours?.__overall || OVERALL_COLOUR;
  const candidates = useMemo(() => {
    const out = new Set(exclude || []);
    const pool = trend.series.filter(s => s.decided > 0 && !out.has(s.key));
    const keep = new Set(picked || []);
    const chosen = pool.filter(s => keep.has(s.key));
    return chosen.length ? chosen : pool.slice(0, MAX_LINES);
  }, [trend, exclude, picked]);
  const [ownOff, setOwnOff] = useState(() => new Set());
  const off = lineState?.off || ownOff;
  const lines = useMemo(() => [
    ...candidates.filter(s => !off.has(s.key)).map(s => ({ key: s.key, name: s.label || s.key, colour: colourOf.get(s.key), cells: s.byPeriod })),
    ...(off.has('__overall') ? [] : [{ key: '__overall', name: 'Overall', colour: overallColour, cells: trend.overall, overall: true }]),
  ], [candidates, off, colourOf, trend, overallColour]);

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
    // Targets count as points, so a target above every rate still shows.
    () => (fitYAxis ? fittedRateAxis([...data, ...targets.map(t => ({ __target: t.value }))], [...lines.map(l => l.key), '__target']) : null),
    [fitYAxis, data, lines, targets],
  );

  const toggle = (key) => {
    if (lineState) { lineState.onShown(key, off.has(key)); return; }
    setOwnOff(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
            {onNameClick && !row.isOverall ? (
              <button
                type="button"
                className={styles.nameBtn}
                data-service-name={row.key}
                onClick={(e) => onNameClick(e, row)}
                title="Group, visible by default, count in Other, hide"
              >{row.label}</button>
            ) : row.label}
            {nameBadge && !row.isOverall && nameBadge(row)}
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
  }, [trend, period, nameHeader, colourOf, candidates, onNameClick, nameBadge]);

  const detail = useMemo(() => trendSheetRows(trend, { period, nameHeader }), [trend, period, nameHeader]);
  // The Details sheet: every opp behind the chart, the whole record. Built
  // when an export asks for it rather than on every render.
  const details = () => oppDetailSheetRows(trend.opps, { period, countedHeader });
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
          {onTargetsChange && <TargetsMenu targets={targets} onChange={onTargetsChange} />}
          {headerExtra}
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
                onClick={() => writeWorkbook(exportName, [{ name: exportName, rows: detail }, { name: 'Details', rows: details() }])}
                title="Every row and period with its close rate and Sold / Closed, whether or not the table is showing, plus a Details tab of every opp behind the chart"
              >Export Excel</button>
            </>
          )}
        </div>
      </div>
      {filterBar}

      {trend.periods.length === 0 ? (
        <div className={styles.empty}>No closed opps in this window.</div>
      ) : (
        <>
          <div className={styles.legend}>
            {[...candidates.map(s => ({ key: s.key, name: s.label || s.key, colour: colourOf.get(s.key) })), { key: '__overall', name: 'Overall', colour: overallColour }].map(l => (
              <span key={l.key} className={off.has(l.key) ? styles.legendOff : styles.legendItem}>
                {/* The dot picks the colour; the name shows / hides the line. */}
                <ColourPickDot colour={l.colour} label={l.name} size={9} onChange={(hex) => onColourChange?.(l.key, hex)} />
                <button
                  type="button"
                  className={styles.legendToggle}
                  onClick={() => toggle(l.key)}
                  title={off.has(l.key) ? 'Show on the chart' : 'Hide from the chart'}
                >{l.name}</button>
                {onLabelToggle && (
                  <button
                    type="button"
                    className={labelled(l.key) ? styles.labelOn : styles.labelOff}
                    aria-pressed={labelled(l.key)}
                    aria-label={`Data labels for ${l.name}`}
                    onClick={() => onLabelToggle(l.key)}
                    title={labelled(l.key) ? `Hide ${l.name}'s data labels` : `Show ${l.name}'s data labels`}
                  >%</button>
                )}
              </span>
            ))}
            {colours && Object.keys(colours).length > 0 && (
              <button type="button" className={styles.resetLink} onClick={onResetColours} title="Back to the standard colours for this chart">Reset colours</button>
            )}
            {trend.series.filter(s => s.decided > 0).length > MAX_LINES && (
              <span className={styles.muted}>Chart shows the {MAX_LINES} with the most closed opps; the table has them all.</span>
            )}
          </div>
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: lines.some(l => labelled(l.key)) ? 22 : 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="period" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis domain={yAxis?.domain || [0, 100]} ticks={yAxis?.ticks || [0, 25, 50, 75, 100]} allowDataOverflow={false} tickFormatter={(v) => `${v}%`} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip lines={lines} targets={targets} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                {targetLineProps(targets).map(({ key, ...props }) => <ReferenceLine key={key} {...props} />)}
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
                  >
                    {/* Text ink, not the series colour, so labels stay
                        readable whatever colour the line is given. */}
                    {labelled(l.key) && <LabelList dataKey={l.key} position="top" offset={7} formatter={labelText} style={{ fontSize: 10, fill: '#475569', fontWeight: l.overall ? 700 : 400 }} />}
                  </Line>
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
              exportExtraSheets={[{ name: 'Sold-Closed detail', rows: detail }, { name: 'Details', rows: details() }]}
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
//   saved     { list, defaultId }
//   isActive(entry)  does the view match this entry (named on the button)
//   makeEntry(name)  the entry to store for what is on screen
//   what      the thing a star opens with ("the tab", "this chart")
function SavedFiltersMenu({ saved, isActive, makeEntry, onApply, onChange, what = 'the tab', small = false }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const active = saved.list.find(e => isActive(e));
  const save = () => {
    const label = name.trim();
    if (!label) return;
    onChange(withSaved(saved, makeEntry(label)));
    setName('');
  };
  const replacing = name.trim() && saved.list.some(e => e.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <div className={styles.savedWrap} ref={ref}>
      <button
        type="button"
        className={small ? `${styles.savedBtn} ${styles.savedBtnSmall}` : styles.savedBtn}
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
                  title={isDefault ? `${what[0].toUpperCase()}${what.slice(1)} opens with these filters. Click to stop.` : `Open ${what} with these filters`}
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

// Period, Close Date window and the two filter buttons, as one value. The
// per-chart filter bar uses it; `showWindow={false}` drops the Close Date
// window for Stage reach, which groups by Start Date instead.
function FilterControls({ value, onChange, showWindow = true }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <>
      <div className={styles.group} role="group" aria-label="Period">
        {PERIODS.map(p => (
          <button key={p.key} type="button" className={value.period === p.key ? styles.toggleOn : styles.toggle} onClick={() => set({ period: p.key })}>
            {p.label}
          </button>
        ))}
      </div>
      {showWindow && (
        <>
          <WindowSelect
            preset={value.preset}
            onPick={(key) => { const p = PRESETS.find(x => x.key === key); if (p) set({ preset: p.key, from: p.from(), to: '' }); }}
          />
          <label className={styles.dateField}>
            From
            <input type="date" value={value.from} onChange={e => set({ from: e.target.value, preset: '' })} />
          </label>
          <label className={styles.dateField}>
            To
            <input type="date" value={value.to} onChange={e => set({ to: e.target.value, preset: '' })} />
          </label>
        </>
      )}
      <button
        type="button"
        className={value.leadOrHigher ? styles.filterOn : styles.filterOff}
        aria-pressed={value.leadOrHigher}
        onClick={() => set({ leadOrHigher: !value.leadOrHigher })}
        title="Only count opps known to have reached Lead or a later stage"
      >
        <span className={styles.check} aria-hidden="true">{value.leadOrHigher ? '✓' : ''}</span>
        Lead stage or higher
      </button>
      <button
        type="button"
        className={value.noPullThroughs ? styles.filterOn : styles.filterOff}
        aria-pressed={value.noPullThroughs}
        onClick={() => set({ noPullThroughs: !value.noPullThroughs })}
        title="Leave pull-through opps out of this chart"
      >
        <span className={styles.check} aria-hidden="true">{value.noPullThroughs ? '✓' : ''}</span>
        Do not include pull-through opps
      </button>
    </>
  );
}

// One line describing a set of filters, for a chart that follows the tab.
function describeFilters(f, { showWindow = true } = {}) {
  const period = PERIODS.find(p => p.key === f.period)?.label || f.period;
  const preset = PRESETS.find(p => p.key === f.preset);
  const win = preset ? preset.label : (f.from || f.to ? `${f.from || 'start'} to ${f.to || 'today'}` : 'All time');
  return [
    period,
    ...(showWindow ? [win] : []),
    f.leadOrHigher ? 'Lead stage or higher' : 'every stage',
    f.noPullThroughs ? 'no pull-throughs' : 'pull-throughs included',
  ].join(' · ');
}

// The filter row under a chart's title: follow the tab's filters or run on
// the chart's own, plus the chart's own saved filters.
function ChartFilterBar({ filters, own, onOwnChange, saved, onSavedChange, current, onApply, showWindow = true }) {
  return (
    <div className={styles.chartFilters}>
      <div className={styles.group} role="group" aria-label="Chart filters">
        <button
          type="button"
          className={own ? styles.toggle : styles.toggleOn}
          onClick={() => onOwnChange(null)}
          title="This chart uses the filters at the top of the tab"
        >Tab filters</button>
        <button
          type="button"
          className={own ? styles.toggleOn : styles.toggle}
          onClick={() => { if (!own) onOwnChange({ ...filters }); }}
          title="Give this chart its own Period, window and filters"
        >Own filters</button>
      </div>
      {own
        ? <FilterControls value={filters} onChange={onOwnChange} showWindow={showWindow} />
        : <span className={styles.muted}>{describeFilters(filters, { showWindow })}</span>}
      <SavedFiltersMenu
        saved={saved}
        isActive={(e) => chartMatchesEntry(current, e)}
        makeEntry={(name) => snapshotChart(current, name)}
        onApply={onApply}
        onChange={onSavedChange}
        what="this chart"
        small
      />
    </div>
  );
}

// The service props come from OppsView2 and are the By Service trend
// subtabs' own, so a change here (group, visible by default, count in
// Other, hide) shows there too and the other way round.
export function CloseRateDeepDive({
  records = [], hiddenServices, settings, updateSettings,
  servicePicks, serviceLinesOff, onServiceLineShown, serviceLinesOffDefault, onServiceLineDefault, onToggleHideService,
}) {
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
  const currentFilters = useMemo(
    () => ({ period, preset, from, to, leadOrHigher, noPullThroughs }),
    [period, preset, from, to, leadOrHigher, noPullThroughs],
  );
  const saveFilters = (next) => updateSettings?.({ [SAVED_FILTERS_KEY]: next });

  // ---- Per-chart filters -------------------------------------------------
  // Each chart (source, service, stage, reach) follows the tab's filters until
  // it is given its own (`own[chart]`), and keeps its own saved sets. A chart
  // with a starred saved set opens on it, lines and all.
  const chartSaved = useMemo(
    () => Object.fromEntries(CHART_IDS.map(c => [c, readChartSaved(settings, c)])),
    [settings],
  );
  const [chartStart] = useState(() => Object.fromEntries(CHART_IDS.map(c => {
    const sv = chartSaved[c];
    const def = sv.list.find(e => e.id === sv.defaultId);
    return [c, def ? chartFromEntry(def, PRESETS) : null];
  })));
  const [own, setOwn] = useState(() => Object.fromEntries(CHART_IDS.map(c => [c, chartStart[c]?.filters || null])));
  const setOwnFor = (chart, f) => setOwn(prev => ({ ...prev, [chart]: f }));
  const eff = (chart) => own[chart] || currentFilters;
  // Lines switched off in the source / stage legends. The service chart's
  // are OppsView2's (shared with By Service); Stage reach keeps its own.
  const [linesOff, setLinesOff] = useState(() => ({
    source: chartStart.source?.off || new Set(),
    stage: chartStart.stage?.off || new Set(),
  }));
  const lineStateFor = (chart) => ({
    off: linesOff[chart],
    onShown: (key, shown) => setLinesOff(prev => {
      const next = new Set(prev[chart]);
      if (shown) next.delete(key); else next.add(key);
      return { ...prev, [chart]: next };
    }),
  });
  // Stage reach reads its own controls on mount, so applying a saved set
  // remounts it with them.
  const [reachMount, setReachMount] = useState(() => ({
    key: 0,
    start: chartStart.reach ? { ...(chartStart.reach.reach || {}), hidden: chartStart.reach.off } : null,
  }));
  const setServiceOff = useCallback((wanted) => {
    if (!onServiceLineShown) return;
    const have = serviceLinesOff || new Set();
    for (const k of new Set([...have, ...wanted])) {
      if (have.has(k) !== wanted.has(k)) onServiceLineShown(k, !wanted.has(k));
    }
  }, [serviceLinesOff, onServiceLineShown]);
  // The service chart's starred lines can only be applied once its line
  // state (OppsView2's) is here to change.
  const serviceStarted = useRef(false);
  useEffect(() => {
    if (serviceStarted.current || !chartStart.service || !onServiceLineShown) return;
    serviceStarted.current = true;
    setServiceOff(chartStart.service.off);
  }, [chartStart, onServiceLineShown, setServiceOff]);
  const applyChart = (chart, entry) => {
    const st = chartFromEntry(entry, PRESETS);
    setOwnFor(chart, st.filters);
    if (chart === 'source' || chart === 'stage') setLinesOff(prev => ({ ...prev, [chart]: st.off }));
    if (chart === 'service') setServiceOff(st.off);
    if (chart === 'reach') setReachMount(prev => ({ key: prev.key + 1, start: { ...(st.reach || {}), hidden: st.off } }));
  };
  const saveChart = (chart, next) => updateSettings?.(chartSavedPatch(settings, chart, next));

  // Chart colours and data labels, saved on settings (closeRatesChartPrefs).
  // A colour drag fires many changes, so they show at once from a draft and
  // are saved once the picking pauses.
  const savedPrefs = useMemo(() => readChartPrefs(settings), [settings]);
  const [draftPrefs, setDraftPrefs] = useState(null);
  const prefs = draftPrefs || savedPrefs;
  const labelsMode = labelsState(prefs);
  const saveTimer = useRef(null);
  const savePrefs = useCallback((next, { now = false } = {}) => {
    setDraftPrefs(next);
    clearTimeout(saveTimer.current);
    const write = () => { updateSettings?.({ [CHART_PREFS_KEY]: next }); setDraftPrefs(null); };
    if (now) write(); else saveTimer.current = setTimeout(write, 500);
  }, [updateSettings]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const colourProps = (chart) => ({
    colours: prefs.colours[chart],
    onColourChange: (key, hex) => savePrefs(withColour(prefs, chart, key, hex)),
    onResetColours: () => savePrefs(withoutColours(prefs, chart), { now: true }),
    labelled: (key) => isLabelled(prefs, chart, key),
    onLabelToggle: (key) => savePrefs(withLineLabel(prefs, chart, key, !isLabelled(prefs, chart, key)), { now: true }),
    targets: targetsOf(prefs, chart),
    onTargetsChange: (list) => savePrefs(withTargets(prefs, chart, list)),
  });

  const filtered = useMemo(
    () => applyCloseRateFilters(records, { leadOrHigher, noPullThroughs }),
    [records, leadOrHigher, noPullThroughs],
  );
  const counted = filtered.records;
  const includePullThroughs = !noPullThroughs;
  const hidden = useMemo(() => [...(hiddenServices || [])], [hiddenServices]);
  const hiddenSet = useMemo(() => new Set(hiddenServices || []), [hiddenServices]);

  // Service settings, the By Service trend subtabs' own (see above).
  const savedGroups = useMemo(() => groupsFromSettings(settings), [settings]);
  const grouping = savedGroups.on && savedGroups.groups.length > 0;
  const activeGroups = useMemo(() => (grouping ? savedGroups.groups : []), [grouping, savedGroups]);
  const groupMembers = useMemo(() => new Map(activeGroups.map(g => [g.name, g.services])), [activeGroups]);
  const excludedServices = useMemo(() => excludedFromSettings(settings), [settings]);
  const offDefault = useMemo(() => serviceLinesOffDefault || new Set(), [serviceLinesOffDefault]);
  const allServices = useMemo(() => {
    const seen = new Set();
    for (const r of records || []) for (const sv of servicesOf(r)) seen.add(sv);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [records]);
  const [svcPopup, setSvcPopup] = useState(null);
  const [editingGroups, setEditingGroups] = useState(false);
  const openSvcPopup = (e, row) => {
    e.stopPropagation();
    if (svcPopup?.name === row.key) { setSvcPopup(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setSvcPopup({ name: row.key, left: rect.left, top: rect.bottom + 4 });
  };
  const setServiceGroup = (service, groupName) => updateSettings?.({ [GROUPS_KEY]: withServiceGroup(savedGroups, service, groupName) });
  const serviceLineState = useMemo(
    () => (serviceLinesOff && onServiceLineShown ? { off: serviceLinesOff, onShown: onServiceLineShown } : undefined),
    [serviceLinesOff, onServiceLineShown],
  );
  // Section 5's own controls (closed only, Start Date range), reported back
  // so Export all writes the figures on screen.
  const [reachState, setReachState] = useState({ closedOnly: true, from: '', to: '', hidden: new Set() });
  const onReachState = useCallback((st) => setReachState(prev => (
    prev.closedOnly === st.closedOnly && prev.from === st.from && prev.to === st.to && prev.hidden === st.hidden ? prev : st
  )), []);

  // 1. The Weekly email's table: always its own 6-month window, whatever the
  // window controls say. The filter buttons do apply; it leaves pull-throughs
  // out either way, as the email does.
  // How many months the Weekly email table shows: this visit's pick over
  // the saved default (settings.closeRateWeeklyMonths, 6 when unset).
  const savedWeeklyMonths = cleanWeeklyMonths(settings?.closeRateWeeklyMonths);
  const [weeklyPick, setWeeklyPick] = useState(null);
  const weeklyMonths = weeklyPick ?? savedWeeklyMonths;
  const weekly = useMemo(() => closeRateTrendByStage(counted, { months: weeklyMonths }), [counted, weeklyMonths]);
  // Each chart's opps, through its own two filter buttons. The four
  // combinations are worked out once each, however many charts share one.
  const countedFor = useMemo(() => {
    const cache = new Map();
    return (f) => {
      const k = `${f.leadOrHigher}|${f.noPullThroughs}`;
      if (!cache.has(k)) cache.set(k, applyCloseRateFilters(records, { leadOrHigher: f.leadOrHigher, noPullThroughs: f.noPullThroughs }).records);
      return cache.get(k);
    };
  }, [records]);
  const fSource = eff('source');
  const fService = eff('service');
  const fStage = eff('stage');
  const fReach = eff('reach');
  const bySource = useMemo(
    () => closeRateTrend(countedFor(fSource), { period: fSource.period, from: fSource.from, to: fSource.to }),
    [countedFor, fSource],
  );
  const byService = useMemo(
    () => serviceCloseRateTrend(countedFor(fService), { period: fService.period, from: fService.from, to: fService.to, hidden, groups: activeGroups }),
    [countedFor, fService, hidden, activeGroups],
  );
  const byStage = useMemo(
    () => stageCloseRateTrend(countedFor(fStage), { period: fStage.period, from: fStage.from, to: fStage.to, includePullThroughs: !fStage.noPullThroughs }),
    [countedFor, fStage],
  );
  const reachRecords = countedFor(fReach);
  const periodNameOf = (f) => PERIODS.find(p => p.key === f.period)?.label || f.period;
  const windowTextOf = (f) => (f.from || f.to ? `Close Date ${f.from || 'start'} to ${f.to || 'today'}` : 'all Close Dates');
  const chartBar = (chart, current, { showWindow = true } = {}) => (
    <ChartFilterBar
      filters={eff(chart)}
      own={!!own[chart]}
      onOwnChange={(f) => setOwnFor(chart, f)}
      saved={chartSaved[chart]}
      onSavedChange={(next) => saveChart(chart, next)}
      current={current}
      onApply={(e) => applyChart(chart, e)}
      showWindow={showWindow}
    />
  );
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
        { name: `By source (${periodNameOf(fSource)})`, rows: trendSheetRows(bySource, { period: fSource.period, nameHeader: 'Source' }) },
        { name: `By service (${periodNameOf(fService)})`, rows: trendSheetRows(byService, { period: fService.period, nameHeader: 'Service' }) },
        { name: `By stage (${periodNameOf(fStage)})`, rows: trendSheetRows(byStage, { period: fStage.period, nameHeader: 'Stage' }) },
        { name: `Stage reach (${periodNameOf(fReach)})`, rows: stageReachSheetRows(reachRecords, { period: fReach.period, closedOnly: reachState.closedOnly, from: reachState.from, to: reachState.to }) },
        { name: 'Closed opps', rows: closedOppSheetRows(counted, { period, from, to, includePullThroughs }) },
        {
          name: 'About',
          rows: [
            { Item: 'Window', Value: windowText },
            { Item: 'Period', Value: periodName },
            { Item: 'Close rate', Value: 'Sold / (Sold + Not Sold), by Close Date. Rates are whole percentage points.' },
            { Item: 'Lead stage or higher', Value: leadOrHigher ? `On: opps closed before reaching Lead left out (${filtered.belowLead}). ${filtered.unknownStage} losses with no stage history kept.` : 'Off: every closed opp counted.' },
            { Item: 'Pull-throughs', Value: noPullThroughs ? `Left out (${filtered.pullThroughs}).` : 'Included, except in the Weekly email trend, which always leaves them out.' },
            { Item: 'Weekly email trend', Value: `Last ${weeklyMonths} months by stage, the Weekly email table with the filters above applied, whatever the window.` },
            { Item: 'By stage', Value: 'An opp counts toward every stage it reached, so stage rows do not add up.' },
            { Item: 'Stage reach', Value: `% of ${reachState.closedOnly ? 'closed ' : ''}opps that got at least as far as each stage, grouped by Start Date${reachState.from || reachState.to ? ` (${reachState.from || 'start'} to ${reachState.to || 'today'})` : ''}. Pull-throughs always left out; Not Sold opps with no stage history left out.` },
            { Item: 'By service', Value: 'An opp counts toward each service on its Scope. Hidden services are left out.' },
            ...[['source', 'By source', fSource], ['service', 'By service', fService], ['stage', 'By stage', fStage], ['reach', 'Stage reach', fReach]]
              .filter(([c]) => own[c])
              .map(([c, label, f]) => ({ Item: `${label} filters`, Value: `Own: ${describeFilters(f, { showWindow: c !== 'reach' })}` })),
            { Item: 'Exported', Value: new Date().toLocaleString() },
          ],
        },
      ]);
    } finally {
      setExporting(false);
    }
  };

  // The Weekly table's opps: each in its month column, or in the trailing
  // year only (the 12-month figure reaches further back than the months).
  const weeklyDetails = () => oppDetailSheetRows(weekly.opps, {
    periodHeader: 'Month',
    periodText: (o) => o.month || 'Trailing 12 months only',
    countedHeader: 'Stages reached',
    extra: (o) => ({ 'In trailing 12 months': o.inRolling ? 'Yes' : '' }),
  });
  const reachDetails = () => stageReachDetailRows(reachRecords, { period: fReach.period, closedOnly: reachState.closedOnly, from: reachState.from, to: reachState.to });

  const exportWeekly = () => writeWorkbook('Close rate trend (Weekly email)', [
    { name: 'Weekly email trend', rows: weeklyTrendSheetRows(weekly) },
    { name: 'Details', rows: weeklyDetails() },
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
        <WindowSelect preset={preset} onPick={(key) => { if (!key) return; touched.current = true; pickPreset(key); }} />
        <label className={styles.dateField}>
          From
          <input type="date" value={from} onChange={e => { touched.current = true; setFrom(e.target.value); setPreset(''); }} />
        </label>
        <label className={styles.dateField}>
          To
          <input type="date" value={to} onChange={e => { touched.current = true; setTo(e.target.value); setPreset(''); }} />
        </label>
        <button
          type="button"
          className={labelsMode !== 'none' ? styles.filterOn : styles.filterOff}
          aria-pressed={labelsMode === 'all' ? true : labelsMode === 'some' ? 'mixed' : false}
          onClick={() => savePrefs(withLabels(prefs, labelsMode !== 'all'), { now: true })}
          title={labelsMode === 'all' ? 'Turn data labels off on every line of every chart' : 'Turn data labels on for every line of every chart. To label only some lines, use the % button on each legend chip.'}
        >
          <span className={styles.check} aria-hidden="true">{labelsMode === 'all' ? '✓' : labelsMode === 'some' ? '–' : ''}</span>
          Data labels
        </button>
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
          isActive={(e) => matchesEntry(currentFilters, e)}
          makeEntry={(name) => snapshotFilters(currentFilters, name)}
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
        {' '}Charts 2 to 5 use {periodName.toLowerCase()}s over {windowText} unless a chart is set to its own filters.
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>1. Close rate trend (Weekly email)</h2>
            <div className={styles.sectionSub}>Last {weeklyMonths} months by the stage each closed deal reached: the Weekly email's table{weeklyMonths !== 6 ? ' (the email itself shows 6)' : ''} with the filters above applied. It always leaves pull-throughs out, as the email does.</div>
          </div>
          <div className={styles.headActions}>
            <label className={styles.windowField}>
              Show
              <select value={weeklyMonths} onChange={e => setWeeklyPick(Number(e.target.value))} aria-label="Months in the Weekly email table">
                {WEEKLY_MONTHS.map(n => <option key={n} value={n}>Last {n} months{n === savedWeeklyMonths ? ' (default)' : ''}</option>)}
              </select>
            </label>
            {weeklyMonths !== savedWeeklyMonths && (
              <button type="button" className={styles.resetLink} onClick={() => updateSettings?.({ closeRateWeeklyMonths: weeklyMonths })} title="Open the table with this many months every visit (saved)">Save as default</button>
            )}
            <button type="button" className={styles.smallBtn} onClick={exportWeekly}>Export Excel</button>
          </div>
        </div>
        <CloseRateTrend trend={weekly} />
      </section>

      <TrendSection
        title="2. Close rate by source"
        subtitle={`Each source's close rate per ${periodNameOf(fSource).toLowerCase()}, ${windowTextOf(fSource)}.`}
        nameHeader="Source"
        trend={bySource}
        period={fSource.period}
        tableId={`close-rates-source-${fSource.period}`}
        lineState={lineStateFor('source')}
        filterBar={chartBar('source', { filters: fSource, off: linesOff.source })}
        {...colourProps('source')}
        exportName="Close rate by source"
        countedHeader="Source counted"
        fitYAxis
        settings={settings}
        updateSettings={updateSettings}
      />

      <TrendSection
        title="3. Close rate by service"
        subtitle={`Each service's close rate per ${periodNameOf(fService).toLowerCase()}, ${windowTextOf(fService)}.`}
        nameHeader="Service"
        trend={byService}
        period={fService.period}
        tableId={`close-rates-service-${fService.period}`}
        filterBar={chartBar('service', { filters: fService, off: serviceLinesOff || new Set() })}
        {...colourProps('service')}
        exportName="Close rate by service"
        countedHeader="Services counted"
        fitYAxis
        lineState={serviceLineState}
        exclude={excludedServices}
        picked={servicePicks}
        onNameClick={openSvcPopup}
        nameBadge={(row) => (
          <>
            {groupMembers.has(row.key) && <span className={styles.badge} title={groupMembers.get(row.key).join(', ')}>group</span>}
            {excludedServices.includes(row.key) && <span className={styles.badge} title="Counts in Other by default: never drawn as its own line">Other</span>}
            {offDefault.has(row.key) && !excludedServices.includes(row.key) && <span className={styles.badge} title="Starts switched off on the chart">off by default</span>}
          </>
        )}
        headerExtra={(
          <>
            <button
              type="button"
              className={grouping ? styles.filterOn : styles.filterOff}
              aria-pressed={grouping}
              disabled={!savedGroups.groups.length}
              onClick={() => updateSettings?.({ [GROUPS_KEY]: { ...savedGroups, on: !savedGroups.on } })}
              title={savedGroups.groups.length ? 'Draw each group as one line (shared with By Service)' : 'No groups yet: click a service, or Edit groups'}
            >
              <span className={styles.check} aria-hidden="true">{grouping ? '✓' : ''}</span>
              Group
            </button>
            <button type="button" className={styles.smallBtn} onClick={() => setEditingGroups(true)}>Edit groups</button>
          </>
        )}
        note={`An opp counts toward each service on its Scope, so service rows don't add up to Overall. Click a service in the table to group it, set whether it shows by default, count it in Other, or hide it; the same settings as By Service.${hidden.length ? ` ${hidden.length} service${hidden.length === 1 ? '' : 's'} hidden on By Service ${hidden.length === 1 ? 'is' : 'are'} left out.` : ''}`}
        settings={settings}
        updateSettings={updateSettings}
      />
      {svcPopup && byService.series.some(sv => sv.key === svcPopup.name) && (
        <ServiceSettingsPopup
          popup={svcPopup}
          groups={savedGroups.groups}
          groupMembers={groupMembers}
          offDefault={offDefault}
          excluded={excludedServices}
          hidden={hiddenSet.has(svcPopup.name)}
          onSetGroup={setServiceGroup}
          onRemoveFromGroup={(sv) => setServiceGroup(sv, null)}
          onDefaultChange={(k, shown) => onServiceLineDefault?.(k, shown)}
          onOtherChange={(k, on) => updateSettings?.({ [EXCLUDED_KEY]: withExcluded(excludedServices, k, on) })}
          onToggleHide={onToggleHideService}
          onClose={() => setSvcPopup(null)}
        />
      )}
      {editingGroups && (
        <GroupEditor
          groups={savedGroups.groups}
          services={allServices}
          settings={settings}
          onClose={() => setEditingGroups(false)}
          onSave={(groups) => { updateSettings?.({ [GROUPS_KEY]: { ...savedGroups, groups, on: groups.length > 0 } }); setEditingGroups(false); }}
        />
      )}

      <TrendSection
        title="4. Close rate by stage"
        subtitle={`By the stages each closed opp reached, per ${periodNameOf(fStage).toLowerCase()}, ${windowTextOf(fStage)}.`}
        nameHeader="Stage"
        trend={byStage}
        period={fStage.period}
        tableId={`close-rates-stage-${fStage.period}`}
        lineState={lineStateFor('stage')}
        filterBar={chartBar('stage', { filters: fStage, off: linesOff.stage })}
        {...colourProps('stage')}
        exportName="Close rate by stage"
        countedHeader="Stages reached"
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
              Of the opps that started in each {periodNameOf(fReach).toLowerCase()} (by Start Date), the share that got at least as far as each stage.
              The same view as Days in Stage &gt; Stage Reach, with {own.reach ? 'this chart\'s' : 'the tab\'s'} filters applied{fReach.leadOrHigher ? ', so Lead reads 100%' : ''}.
            </div>
          </div>
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => writeWorkbook('Stage reach', [
              { name: 'Stage reach', rows: stageReachSheetRows(reachRecords, { period: fReach.period, closedOnly: reachState.closedOnly, from: reachState.from, to: reachState.to }) },
              { name: 'Details', rows: reachDetails() },
            ])}
            title="Each period's % and count per stage, whether or not the table is showing, plus a Details tab of every opp behind it"
          >Export Excel</button>
        </div>
        {chartBar('reach', {
          filters: fReach,
          off: reachState.hidden,
          reach: { scope: reachState.closedOnly ? 'closed' : 'all', preset: reachState.preset || '', from: reachState.from, to: reachState.to },
        }, { showWindow: false })}
        <StageReach
          key={reachMount.key}
          applyState={reachMount.start}
          records={reachRecords}
          period={fReach.period}
          onState={onReachState}
          collapsibleTable
          colours={prefs.colours.reach}
          onColourChange={(st, hex) => savePrefs(withColour(prefs, 'reach', st, hex))}
          labelled={(st) => isLabelled(prefs, 'reach', st)}
          onLabelToggle={(st) => savePrefs(withLineLabel(prefs, 'reach', st, !isLabelled(prefs, 'reach', st)), { now: true })}
          targets={targetsOf(prefs, 'reach')}
          onTargetsChange={(list) => savePrefs(withTargets(prefs, 'reach', list))}
          settings={settings}
          updateSettings={updateSettings}
        />
      </section>

      <StageProgression
        records={counted}
        from={from}
        to={to}
        windowText={from || to ? `between ${from || 'the start'} and ${to || 'today'}` : 'at any time'}
        settings={settings}
        updateSettings={updateSettings}
      />
    </div>
  );
}
