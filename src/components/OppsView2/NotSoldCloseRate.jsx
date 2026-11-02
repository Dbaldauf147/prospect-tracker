import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { TagMultiSelect } from '../common/TagMultiSelect';
import {
  closeRateTrend, closeRateChartRows, trendDetailRows, notSoldFacets, periodLabel, TREND_OTHER,
} from '../../utils/notSoldAnalysis';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// Same fixed categorical order as the Trend view, so a source wears the same
// colour on both subtabs.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOUR = '#9ca3af';
const OVERALL_COLOUR = '#334155';
const OVERALL_KEY = '__overall';
const TOP_N = PALETTE.length;

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

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

const fmtRate = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);

/**
 * Opps > Not Sold Analysis > Close rate by source.
 *
 * Of the opps from each source decided in a period (Sold + Not Sold, by
 * Close Date), the share that were won: the By Source tab's Win Rate,
 * bucketed over time so you can see a source improving or slipping. One line
 * per source plus an Overall line, and the same numbers as a table with the
 * won / decided counts beside every rate, because 100% of 1 deal and 100% of
 * 40 are not the same news.
 *
 * The close window, year chips and Days in stage filter come from the tab
 * above (records arrive already narrowed by Days in stage).
 */
export function NotSoldCloseRate({ records, from, to, years, extraFilters = [], settings, updateSettings }) {
  // Year by default: per-source rates by month are mostly one or two deals.
  const [period, setPeriod] = useState('year');
  const [sources, setSources] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());

  const facets = useMemo(() => notSoldFacets(records), [records]);
  const cr = useMemo(
    () => closeRateTrend(records, { from, to, years, period, sources, topN: TOP_N }),
    [records, from, to, years, period, sources],
  );

  // Colour follows the source: slots go to the busiest sources of the whole
  // window, so filtering down to a few leaves each the colour it had.
  const colourMap = useMemo(() => {
    const base = closeRateTrend(records, { from, to, years, period: 'year' });
    const map = new Map();
    base.series.slice(0, TOP_N).forEach((s, i) => map.set(s.key, PALETTE[i]));
    const shown = new Set(cr.series.map(s => s.key));
    const taken = new Set([...map.entries()].filter(([k]) => shown.has(k)).map(([, c]) => c));
    const free = PALETTE.filter(c => !taken.has(c));
    for (const s of cr.series) {
      if (s.key === TREND_OTHER || (map.has(s.key) && taken.has(map.get(s.key)))) continue;
      map.set(s.key, free.shift() || OTHER_COLOUR);
    }
    map.set(TREND_OTHER, OTHER_COLOUR);
    map.set(OVERALL_KEY, OVERALL_COLOUR);
    return map;
  }, [records, from, to, years, cr.series]);
  const colourOf = (k) => colourMap.get(k) || OTHER_COLOUR;

  const legend = [{ key: OVERALL_KEY, label: 'Overall', wins: cr.wins, decided: cr.decided }, ...cr.series.map(s => ({ key: s.key, label: s.key, wins: s.wins, decided: s.decided }))];
  const visible = cr.series.filter(s => !hidden.has(s.key));

  const chartData = useMemo(() => cr.periods.map(p => {
    const row = { period: p, label: periodLabel(p, period), [OVERALL_KEY]: cr.overall[p].rate };
    for (const s of cr.series) row[s.key] = s.byPeriod[p].rate;
    return row;
  }), [cr, period]);

  function toggle(key) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function CloseRateTooltip({ active, payload }) {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload.period;
    const o = cr.overall[p];
    const items = visible.map(s => ({ key: s.key, ...s.byPeriod[p] })).filter(i => i.decided > 0)
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
    return (
      <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.75rem', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 230 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{periodLabel(p, period)}</div>
        {!hidden.has(OVERALL_KEY) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', fontWeight: 700 }}>
            <span style={{ width: 10, height: 2, background: OVERALL_COLOUR }} />
            <span style={{ flex: 1 }}>Overall</span>
            <span>{fmtRate(o.rate)}</span>
            <span style={{ ...muted, minWidth: 48, textAlign: 'right', fontWeight: 400 }}>{o.wins}/{o.decided}</span>
          </div>
        )}
        {items.map(i => (
          <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: colourOf(i.key) }} />
            <span style={{ flex: 1 }}>{i.key}</span>
            <span style={{ fontWeight: 600 }}>{fmtRate(i.rate)}</span>
            <span style={{ ...muted, minWidth: 48, textAlign: 'right' }}>{i.wins}/{i.decided}</span>
          </div>
        ))}
        <div style={{ ...muted, marginTop: 4 }}>Won / decided (Sold + Not Sold)</div>
      </div>
    );
  }

  // ---- table ----------------------------------------------------------
  const tableRows = useMemo(() => [
    ...cr.series.map(s => ({ id: s.key, name: s.key, kind: 'series', byPeriod: s.byPeriod, wins: s.wins, decided: s.decided, rate: s.rate, folded: s.folded })),
    { id: OVERALL_KEY, name: 'Overall', kind: 'overall', byPeriod: cr.overall, wins: cr.wins, decided: cr.decided, rate: cr.rate },
  ], [cr]);

  const cellText = (c) => (c && c.decided > 0 ? `${c.rate.toFixed(1)}% (${c.wins}/${c.decided})` : '-');

  const columns = useMemo(() => {
    const cols = [{
      key: 'name',
      label: 'Source',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: row.kind === 'overall' ? 700 : 400 }}>
          <span style={{ width: 10, height: row.kind === 'overall' ? 3 : 10, borderRadius: 2, background: colourOf(row.kind === 'overall' ? OVERALL_KEY : row.name), flexShrink: 0 }} />
          <span title={row.folded ? row.folded.join('\n') : undefined}>{row.name}</span>
        </span>
      ),
    }];
    for (const p of cr.periods) {
      cols.push({
        key: `p:${p}`,
        label: periodLabel(p, period),
        defaultWidth: 130,
        render: (row) => {
          const c = row.byPeriod[p];
          if (!c || c.decided === 0) return <div style={{ textAlign: 'right', ...muted }}>-</div>;
          return (
            <div style={{ textAlign: 'right', fontWeight: row.kind === 'overall' ? 700 : 400 }} title={`${c.wins} won of ${c.decided} decided`}>
              {c.rate.toFixed(1)}% <span style={{ ...muted, fontWeight: 400 }}>({c.wins}/{c.decided})</span>
            </div>
          );
        },
        getFilterValue: (row) => cellText(row.byPeriod[p]),
        exportValue: (row) => cellText(row.byPeriod[p]),
        getSortValue: (row) => row.byPeriod[p]?.rate ?? -1,
      });
    }
    cols.push({
      key: 'total',
      label: 'Whole window',
      defaultWidth: 140,
      render: (row) => (
        <div style={{ textAlign: 'right', fontWeight: 700 }}>
          {fmtRate(row.rate)} <span style={{ ...muted, fontWeight: 400 }}>({row.wins}/{row.decided})</span>
        </div>
      ),
      getFilterValue: (row) => cellText(row),
      exportValue: (row) => cellText(row),
      getSortValue: (row) => row.rate ?? -1,
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cr, period, colourMap]);

  // The decided opps behind every rate, for the Export details sheet.
  const detailRows = useMemo(
    () => trendDetailRows(records, { from, to, years, period, groupBy: 'source', sources, topN: TOP_N, hiddenSeries: [...hidden] }),
    [records, from, to, years, period, sources, hidden],
  );

  async function exportChart() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const rows = closeRateChartRows(cr, { period, hiddenSeries: [...hidden] });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || { Period: '' }).map(h => ({ wch: Math.max(h.length + 2, 12) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Chart data');
    const wsD = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ Account: 'No opps match these filters' }]);
    wsD['!cols'] = Object.keys(detailRows[0] || { Account: '' }).map(h => ({ wch: h === 'Account' || h === 'Reason Not Sold' || h === 'BFO Link' ? 34 : Math.max(h.length + 2, 14) }));
    wsD['!autofilter'] = { ref: wsD['!ref'] };
    XLSX.utils.book_append_sheet(wb, wsD, 'Export details');
    const list = (a, none) => (a.length ? a.join(', ') : none);
    const about = [
      { Setting: 'Measure', Value: 'Close rate = Sold / (Sold + Not Sold), by Close Date' },
      { Setting: 'Period', Value: period },
      { Setting: 'Closed from', Value: from || '(any)' },
      { Setting: 'Closed to', Value: to || '(any)' },
      { Setting: 'Years', Value: list(years, 'All') },
      { Setting: 'Sources', Value: list(sources, 'All') },
      { Setting: 'Sources hidden on chart', Value: list([...hidden].filter(k => k !== OVERALL_KEY), 'None') },
      ...extraFilters,
      { Setting: 'Opps in Export details', Value: `${detailRows.filter(r => r.Stage === 'Sold').length} won, ${detailRows.filter(r => r.Stage === 'Not Sold').length} not sold` },
      { Setting: 'Exported', Value: new Date().toLocaleString() },
    ];
    const ws2 = XLSX.utils.json_to_sheet(about);
    ws2['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Filters');
    XLSX.writeFile(wb, `Close rate by source by ${period} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const toggleSource = (v) => setSources(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1.25rem 1.25rem' }}>
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel}>Source</span>
          <div style={{ flex: 1 }}>
            <TagMultiSelect options={facets.sources} selected={sources} onToggle={toggleSource} placeholder="All sources" />
          </div>
        </div>
        {sources.length > 0 && (
          <button className={styles.clearFiltersBtn} onClick={() => setSources([])}>Clear sources</button>
        )}
        <span className={styles.resultCount}>
          {cr.wins} won of {cr.decided} decided{cr.decided > 0 ? ` · ${fmtRate(cr.rate)} close rate` : ''}
          {cr.undated > 0 ? ` · ${cr.undated} without a Close Date left out` : ''}
        </span>
        <button
          type="button"
          className={styles.clearFiltersBtn}
          style={{ marginLeft: 'auto' }}
          onClick={exportChart}
          disabled={cr.periods.length === 0}
          title="Download the chart's close rates, with won and decided counts, and the opps behind them"
        >Export chart</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h3 className={styles.notSoldSectionTitle}>Close rate by source, by {period}</h3>
        {cr.periods.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', ...muted }}>No decided opps match these filters.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.85rem', fontSize: '0.74rem' }}>
              {legend.map(l => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggle(l.key)}
                  title={hidden.has(l.key) ? `Show ${l.label}` : `Hide ${l.label}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--color-text)', fontWeight: l.key === OVERALL_KEY ? 700 : 400, opacity: hidden.has(l.key) ? 0.4 : 1, textDecoration: hidden.has(l.key) ? 'line-through' : 'none' }}
                >
                  <span style={{ width: 12, height: l.key === OVERALL_KEY ? 3 : 10, borderRadius: l.key === OVERALL_KEY ? 0 : 999, background: colourOf(l.key) }} />
                  {l.label} <span style={muted}>({l.decided > 0 ? `${((l.wins / l.decided) * 100).toFixed(0)}%, ${l.wins}/${l.decided}` : '-'})</span>
                </button>
              ))}
            </div>
            <div style={{ height: 300, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<CloseRateTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                  {visible.map(s => (
                    <Line
                      key={s.key}
                      dataKey={s.key}
                      name={s.key}
                      stroke={colourOf(s.key)}
                      strokeWidth={2}
                      dot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface, #fff)', fill: colourOf(s.key) }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                  {!hidden.has(OVERALL_KEY) && (
                    <Line
                      dataKey={OVERALL_KEY}
                      name="Overall"
                      stroke={OVERALL_COLOUR}
                      strokeWidth={3}
                      strokeDasharray="6 4"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <h3 className={styles.notSoldSectionTitle}>By {period}, close rate (won / decided)</h3>
            <div style={{ height: Math.min(140 + tableRows.length * 36, 640), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <DataTable
                tableId={`opps2-close-rate-by-source-${period}`}
                columns={columns}
                rows={tableRows}
                alwaysVisible={['name']}
                rowGroup={(row) => (row.kind === 'overall' ? 1 : 0)}
                exportFileName={`Close rate by source by ${period}`}
                exportPrimarySheetName="Close rate table"
                exportExtraSheets={[{ name: 'Export details', rows: detailRows }]}
                emptyMessage="No decided opps match these filters."
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
