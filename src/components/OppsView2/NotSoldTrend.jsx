import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { TagMultiSelect } from '../common/TagMultiSelect';
import {
  notSoldTrend, notSoldFacets, periodLabel, closePeriodOf, reasonOf, sourceOf, TREND_OTHER,
  trendChartRows, sanitizeTrendViews, saveTrendView, deleteTrendView, trendViewMatches, TREND_VIEWS_KEY,
} from '../../utils/notSoldAnalysis';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// Fixed categorical order (validated for colour-blind separation). A series
// keeps its colour when filters change, see colourMap below; past eight
// everything folds into a grey Other rather than inventing a ninth hue.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOUR = '#9ca3af';
const TOP_N = PALETTE.length;

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];
const GROUPS = [
  { key: 'reason', label: 'Reason' },
  { key: 'source', label: 'Source' },
];
const MODES = [
  { key: 'count', label: 'Count' },
  { key: 'percent', label: '% of losses' },
];

// A row of toggle chips, the same look as the year filter beside it.
function Segmented({ label, options, value, onChange }) {
  return (
    <span className={styles.notSoldYears}>
      <span className={styles.filterLabel} style={{ marginRight: 2 }}>{label}</span>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          className={value === o.key ? styles.notSoldYearOn : styles.notSoldYear}
          onClick={() => onChange(o.key)}
        >{o.label}</button>
      ))}
    </span>
  );
}

function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

/**
 * Opps > Not Sold Analysis > Trend.
 *
 * The same losses as the two tables, bucketed by the period they closed in,
 * so you can see whether a reason is growing or fading and whether a
 * source's losses are getting better. Group by reason or by source, narrow
 * to the sources and reasons you care about, and read it as a stacked bar
 * chart or as a period-by-period table.
 *
 * The close window (dates and year chips) comes from the tab above, so the
 * two views always describe the same losses.
 */
export function NotSoldTrend({ records, from, to, years, onWindowChange, lossRows, onDrill, settings, updateSettings }) {
  const [groupBy, setGroupBy] = useState('reason');
  const [period, setPeriod] = useState('quarter');
  const [mode, setMode] = useState('count');
  const [sources, setSources] = useState([]);
  const [reasons, setReasons] = useState([]);
  // Reasons taken out of the picture altogether: chart, table, totals and
  // loss rate. Unlike the legend, which only stops drawing a series.
  const [hideReasons, setHideReasons] = useState([]);
  // Series switched off from the legend.
  const [hidden, setHidden] = useState(() => new Set());
  // The name being typed for a new saved view, or null when not saving.
  const [viewName, setViewName] = useState(null);

  // Everything that decides what the chart shows: what a saved view holds.
  const currentState = {
    groupBy, period, mode, sources, reasons, hideReasons,
    hiddenSeries: [...hidden], from, to, years,
  };
  const views = sanitizeTrendViews(settings?.[TREND_VIEWS_KEY]);
  const activeView = views.find(v => trendViewMatches(v, currentState));

  function applyView(v) {
    const st = v.state;
    setGroupBy(st.groupBy);
    setPeriod(st.period);
    setMode(st.mode);
    setSources(st.sources);
    setReasons(st.reasons);
    setHideReasons(st.hideReasons);
    setHidden(new Set(st.hiddenSeries));
    onWindowChange?.({ from: st.from, to: st.to, years: st.years });
  }
  function commitView() {
    const name = (viewName || '').trim();
    if (!name) { setViewName(null); return; }
    updateSettings?.((cur) => ({ [TREND_VIEWS_KEY]: saveTrendView(cur?.[TREND_VIEWS_KEY], { name, state: currentState }) }));
    setViewName(null);
  }
  function removeView(v) {
    if (!window.confirm(`Delete the saved view "${v.name}"?`)) return;
    updateSettings?.((cur) => ({ [TREND_VIEWS_KEY]: deleteTrendView(cur?.[TREND_VIEWS_KEY], v.id) }));
  }

  const facets = useMemo(() => notSoldFacets(records), [records]);
  const trend = useMemo(
    () => notSoldTrend(records, { from, to, years, period, groupBy, sources, reasons, hideReasons, topN: TOP_N }),
    [records, from, to, years, period, groupBy, sources, reasons, hideReasons],
  );

  // Colour follows the series, not its rank in the current filter: slots go
  // to the biggest series of the whole window first, so narrowing to two
  // sources leaves both the colour they had before. A series that only makes
  // the cut once filtered takes the next free slot.
  const colourMap = useMemo(() => {
    const base = notSoldTrend(records, { from, to, years, period: 'year', groupBy });
    const map = new Map();
    base.series.slice(0, TOP_N).forEach((s, i) => map.set(s.key, PALETTE[i]));
    // A slot is free when nothing showing holds it, so a reason taken out
    // with Hide reasons hands its colour on instead of a newcomer going grey.
    const shown = new Set(trend.series.map(s => s.key));
    const taken = new Set([...map.entries()].filter(([k]) => shown.has(k)).map(([, c]) => c));
    const free = PALETTE.filter(c => !taken.has(c));
    for (const s of trend.series) {
      if (s.key === TREND_OTHER || (map.has(s.key) && taken.has(map.get(s.key)))) continue;
      map.set(s.key, free.shift() || OTHER_COLOUR);
    }
    map.set(TREND_OTHER, OTHER_COLOUR);
    return map;
  }, [records, from, to, years, groupBy, trend.series]);

  const colourOf = (key) => colourMap.get(key) || OTHER_COLOUR;
  const visibleSeries = trend.series.filter(s => !hidden.has(s.key));

  const chartData = useMemo(() => trend.periods.map(p => {
    const t = trend.totals[p];
    const row = { period: p, label: periodLabel(p, period), losses: t.losses, wins: t.wins, lossRate: t.lossRate };
    for (const s of trend.series) {
      const n = s.counts[p] || 0;
      row[s.key] = mode === 'percent' ? pct(n, t.losses) : n;
      row[`${s.key}__n`] = n;
    }
    return row;
  }), [trend, period, mode]);

  function toggleSeries(key) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // The losses behind one series (and optionally one period), honouring
  // every filter on screen. "Other" stands for the series it folded.
  function drill(seriesKey, p) {
    const series = trend.series.find(s => s.key === seriesKey);
    const keys = new Set(seriesKey === TREND_OTHER ? (series?.folded || []) : [seriesKey]);
    const keyOf = groupBy === 'source' ? sourceOf : reasonOf;
    const rows = lossRows.filter(r => {
      if (sources.length && !sources.includes(sourceOf(r))) return false;
      if (reasons.length && !reasons.includes(reasonOf(r))) return false;
      if (hideReasons.includes(reasonOf(r))) return false;
      const rp = closePeriodOf(r, period);
      if (!rp) return false;
      if (p && rp !== p) return false;
      return seriesKey == null || keys.has(keyOf(r));
    });
    const what = seriesKey == null ? 'All losses' : `${groupBy === 'source' ? 'Source' : 'Reason'}: ${seriesKey}`;
    onDrill({
      title: p ? `${what}, ${periodLabel(p, period)}` : what,
      subtitle: `Losses closed ${p ? `in ${periodLabel(p, period)}` : 'in the trend window'}, with the Source, Reason and Hide reasons filters applied.`,
      rows,
    });
  }

  // ---- table ----------------------------------------------------------
  const TOTAL_ID = '__total';
  const WINS_ID = '__wins';
  const RATE_ID = '__rate';

  const tableRows = useMemo(() => {
    const rows = trend.series.map(s => ({ id: s.key, name: s.key, kind: 'series', counts: s.counts, total: s.total }));
    const tot = {}; const wins = {}; const rate = {};
    let winTotal = 0;
    for (const p of trend.periods) {
      tot[p] = trend.totals[p].losses;
      wins[p] = trend.totals[p].wins;
      rate[p] = trend.totals[p].lossRate;
      winTotal += wins[p];
    }
    const decided = trend.lossCount + winTotal;
    rows.push({ id: TOTAL_ID, name: 'Total losses', kind: 'total', counts: tot, total: trend.lossCount });
    rows.push({ id: WINS_ID, name: 'Won (Sold)', kind: 'wins', counts: wins, total: winTotal });
    rows.push({ id: RATE_ID, name: 'Loss rate', kind: 'rate', counts: rate, total: decided > 0 ? pct(trend.lossCount, decided) : null });
    return rows;
  }, [trend]);

  // The text a period cell shows, shared by the cell, its filter and Excel.
  const cellText = (row, p) => {
    const v = p == null ? row.total : row.counts[p];
    if (row.kind === 'rate') return v == null ? '-' : `${v.toFixed(1)}%`;
    const n = v || 0;
    if (mode === 'percent' && row.kind === 'series') {
      const d = p == null ? trend.lossCount : trend.totals[p].losses;
      return d > 0 ? `${pct(n, d).toFixed(1)}%` : '-';
    }
    return String(n);
  };

  const columns = useMemo(() => {
    const cols = [{
      key: 'name',
      label: groupBy === 'source' ? 'Source' : 'Reason Not Sold',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: row.kind === 'series' ? 400 : 700 }}>
          {row.kind === 'series' && (
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colourOf(row.name), flexShrink: 0 }} />
          )}
          <span
            title={row.name === TREND_OTHER ? (trend.series.find(s => s.key === TREND_OTHER)?.folded || []).join('\n') : undefined}
          >{row.name}</span>
        </span>
      ),
    }];
    for (const p of trend.periods) {
      cols.push({
        key: `p:${p}`,
        label: periodLabel(p, period),
        defaultWidth: period === 'month' ? 84 : 90,
        render: (row) => {
          const text = cellText(row, p);
          const zero = text === '0' || text === '-';
          return (
            <div
              style={{ textAlign: 'right', fontWeight: row.kind === 'series' ? 400 : 700, ...(zero ? muted : null), cursor: row.kind === 'series' || row.kind === 'total' ? 'pointer' : 'default' }}
              onClick={(e) => {
                if (row.kind !== 'series' && row.kind !== 'total') return;
                e.stopPropagation();
                drill(row.kind === 'total' ? null : row.name, p);
              }}
            >{text}</div>
          );
        },
        getFilterValue: (row) => cellText(row, p),
        exportValue: (row) => cellText(row, p),
        getSortValue: (row) => row.counts[p] ?? -1,
      });
    }
    cols.push({
      key: 'total',
      label: 'Total',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 700 }}>{cellText(row, null)}</div>,
      getFilterValue: (row) => cellText(row, null),
      getSortValue: (row) => row.total ?? -1,
      exportValue: (row) => cellText(row, null),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend, period, mode, groupBy, colourMap]);

  // ---- chart tooltip ----------------------------------------------------
  function TrendTooltip({ active, payload }) {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0].payload;
    const items = visibleSeries
      .map(s => ({ key: s.key, n: row[`${s.key}__n`] || 0 }))
      .filter(i => i.n > 0);
    return (
      <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.75rem', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 200 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{row.label}</div>
        {items.length === 0 && <div style={muted}>No losses</div>}
        {items.map(i => (
          <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colourOf(i.key) }} />
            <span style={{ flex: 1 }}>{i.key}</span>
            <span style={{ fontWeight: 600 }}>{i.n}</span>
            <span style={{ ...muted, minWidth: 44, textAlign: 'right' }}>{pct(i.n, row.losses).toFixed(0)}%</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--color-border, #E2E8F0)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span>{row.losses} lost, {row.wins} won</span>
          <span style={{ fontWeight: 600 }}>{row.lossRate == null ? '' : `${row.lossRate.toFixed(0)}% loss rate`}</span>
        </div>
        <div style={{ ...muted, marginTop: 2 }}>Click a bar to see those opps</div>
      </div>
    );
  }

  const filtered = sources.length > 0 || reasons.length > 0 || hideReasons.length > 0;

  // The chart's numbers as a workbook: what the bars show, period by period,
  // plus a sheet saying which filters produced them, so a file opened next
  // month still says what it is.
  async function exportChart() {
    const XLSX = await import('xlsx');
    const rows = trendChartRows(trend, { period, mode, hiddenSeries: [...hidden] });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || { Period: '' }).map(h => ({ wch: Math.max(h.length + 2, 12) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Chart data');
    const list = (a, none) => (a.length ? a.join(', ') : none);
    const about = [
      { Setting: 'View', Value: activeView ? activeView.name : '(unsaved)' },
      { Setting: 'Group by', Value: groupBy === 'source' ? 'Source' : 'Reason' },
      { Setting: 'Period', Value: period },
      { Setting: 'Values', Value: mode === 'percent' ? '% of that period\'s losses' : 'Count of losses' },
      { Setting: 'Closed from', Value: from || '(any)' },
      { Setting: 'Closed to', Value: to || '(any)' },
      { Setting: 'Years', Value: list(years, 'All') },
      { Setting: 'Sources', Value: list(sources, 'All') },
      { Setting: 'Reasons', Value: list(reasons, 'All') },
      { Setting: 'Hidden reasons', Value: list(hideReasons, 'None') },
      { Setting: 'Series hidden on chart', Value: list([...hidden], 'None') },
      { Setting: 'Exported', Value: new Date().toLocaleString() },
    ];
    const ws2 = XLSX.utils.json_to_sheet(about);
    ws2['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Filters');
    const base = activeView ? `Not Sold trend - ${activeView.name}` : `Not Sold trend by ${groupBy} by ${period}`;
    XLSX.writeFile(wb, `${base.replace(/[\\/:*?"<>|]+/g, '-')} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  const toggleIn = (setter) => (v) => setter(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1.25rem 1.25rem', overflow: 'auto' }}>
      {/* Saved views: one chip per view, lit when the screen matches it. */}
      <div className={styles.notSoldYears} style={{ gap: '0.35rem' }}>
        <span className={styles.filterLabel} style={{ marginRight: 2 }}>Views</span>
        {views.length === 0 && viewName == null && (
          <span style={{ fontSize: '0.72rem', ...muted }}>None saved yet</span>
        )}
        {views.map(v => (
          <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button
              type="button"
              className={activeView?.id === v.id ? styles.notSoldYearOn : styles.notSoldYear}
              onClick={() => applyView(v)}
              title={`Show the "${v.name}" view`}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >{v.name}</button>
            <button
              type="button"
              className={styles.notSoldYear}
              onClick={() => removeView(v)}
              title={`Delete "${v.name}"`}
              aria-label={`Delete ${v.name}`}
              style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 'none', padding: '2px 6px' }}
            >&times;</button>
          </span>
        ))}
        {viewName == null ? (
          <button
            type="button"
            className={styles.notSoldYear}
            onClick={() => setViewName(activeView ? activeView.name : '')}
            disabled={!updateSettings}
            title="Save the filters, grouping and period showing now under a name"
          >+ Save view</button>
        ) : (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              className={styles.filterInput}
              style={{ padding: '2px 8px', fontSize: '0.74rem', width: 180 }}
              placeholder="View name"
              value={viewName}
              onChange={e => setViewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitView();
                if (e.key === 'Escape') setViewName(null);
              }}
            />
            <button type="button" className={styles.notSoldYearOn} onClick={commitView} disabled={!viewName.trim()}>Save</button>
            <button type="button" className={styles.notSoldYear} onClick={() => setViewName(null)}>Cancel</button>
          </span>
        )}
        <button
          type="button"
          className={styles.clearFiltersBtn}
          style={{ marginLeft: 'auto' }}
          onClick={exportChart}
          disabled={trend.periods.length === 0}
          title="Download the chart's numbers, as shown, with the filters that produced them"
        >Export chart</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
        <Segmented label="Group by" options={GROUPS} value={groupBy} onChange={(v) => { setGroupBy(v); setHidden(new Set()); }} />
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        <Segmented label="Show" options={MODES} value={mode} onChange={setMode} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel}>Source</span>
          <div style={{ flex: 1 }}>
            <TagMultiSelect options={facets.sources} selected={sources} onToggle={toggleIn(setSources)} placeholder="All sources" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel}>Reason</span>
          <div style={{ flex: 1 }}>
            <TagMultiSelect options={facets.reasons} selected={reasons} onToggle={toggleIn(setReasons)} placeholder="All reasons" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel} title="Take these reasons out of the chart, the table and the loss rate">Hide reasons</span>
          <div style={{ flex: 1 }}>
            <TagMultiSelect options={facets.reasons} selected={hideReasons} onToggle={toggleIn(setHideReasons)} placeholder="None hidden" />
          </div>
        </div>
        {filtered && (
          <button className={styles.clearFiltersBtn} onClick={() => { setSources([]); setReasons([]); setHideReasons([]); }}>
            Clear filters
          </button>
        )}
        <span className={styles.resultCount}>
          {trend.lossCount} loss{trend.lossCount === 1 ? '' : 'es'} across {trend.periods.length} {period}{trend.periods.length === 1 ? '' : 's'}
          {trend.undated > 0 ? ` · ${trend.undated} without a Close Date left out` : ''}
        </span>
      </div>

      <h3 className={styles.notSoldSectionTitle}>
        Losses by {period}, by {groupBy}{mode === 'percent' ? ' (share of each period)' : ''}
      </h3>

      {trend.periods.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', ...muted }}>No dated losses match these filters.</div>
      ) : (
        <>
          {/* Legend: always shown, and a click hides or brings back a series. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.85rem', fontSize: '0.74rem' }}>
            {trend.series.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSeries(s.key)}
                title={hidden.has(s.key) ? `Show ${s.key}` : `Hide ${s.key}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--color-text)', opacity: hidden.has(s.key) ? 0.4 : 1, textDecoration: hidden.has(s.key) ? 'line-through' : 'none' }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 2, background: colourOf(s.key) }} />
                {s.key} <span style={muted}>({s.total})</span>
              </button>
            ))}
          </div>
          <div style={{ height: 300, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={44}
                  domain={mode === 'percent' ? [0, 100] : [0, 'auto']}
                  tickFormatter={(v) => (mode === 'percent' ? `${v}%` : v)}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
                {visibleSeries.map(s => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.key}
                    stackId="losses"
                    fill={colourOf(s.key)}
                    stroke="var(--color-surface, #fff)"
                    strokeWidth={1}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(d) => drill(s.key, d?.payload?.period)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 className={styles.notSoldSectionTitle}>
            By {period}{mode === 'percent' ? ', as a share of that period’s losses' : ''}
          </h3>
          {/* Tall enough for every row: a trend table you have to scroll inside
              a scrolling page hides the totals at the bottom. */}
          <div style={{ height: Math.min(140 + tableRows.length * 36, 640), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <DataTable
              tableId={`opps2-not-sold-trend-${period}`}
              columns={columns}
              rows={tableRows}
              alwaysVisible={['name']}
              rowGroup={(row) => (row.kind === 'series' ? 0 : 1)}
              exportFileName={`Not Sold trend by ${groupBy} by ${period}`}
              emptyMessage="No dated losses match these filters."
              onRowClick={(row) => {
                if (row.kind === 'series') drill(row.name, null);
                else if (row.kind === 'total') drill(null, null);
              }}
              settings={settings}
              updateSettings={updateSettings}
            />
          </div>
        </>
      )}
    </div>
  );
}
