import { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { TagMultiSelect } from '../common/TagMultiSelect';
import { sourceShareTrend, periodLabel } from '../../utils/sourceTrends';
import { closeRateTrend } from '../../utils/notSoldAnalysis';
import { hasBfoField } from '../../utils/bfoFields';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// Same validated categorical order as the By Service trend charts. The
// charts draw at most this many sources; the rest are grouped as Other.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_SOURCES = PALETTE.length;
const OTHER_COLOUR = '#cbd5e1';
const OTHER_KEY = '__other';
const TOTAL_KEY = '__total';
// The close-rate line over the % chart. Dark so it reads on top of every
// source colour; drawn with a white halo underneath.
const CLOSE_KEY = '__closeRate';
const CLOSE_COLOUR = '#0f172a';

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

const fmtPct = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);
const axisTick = { fontSize: 11, fill: '#64748B' };

function TrendTooltip({ active, payload, trend, items, period, colourOf, closeRate }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload.period;
  const cr = closeRate ? closeRate.overall[p] : null;
  const d = trend.totals[p];
  const rows = items
    .map(i => ({ ...i, n: i.countAt(p) }))
    .filter(i => i.n > 0)
    .sort((a, b) => b.n - a.n);
  return (
    <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.75rem', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 230 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        {periodLabel(p, period)}
        <span style={{ ...muted, fontWeight: 400 }}> · {d} opp{d === 1 ? '' : 's'} started</span>
      </div>
      {rows.length === 0 && <div style={muted}>No opps from these sources</div>}
      {rows.map(i => (
        <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: colourOf(i.key) }} />
          <span style={{ flex: 1 }}>{i.label}</span>
          <span style={{ fontWeight: 600 }}>{fmtPct(d ? (i.n / d) * 100 : null)}</span>
          <span style={{ ...muted, minWidth: 48, textAlign: 'right' }}>{i.n}/{d}</span>
        </div>
      ))}
      <div style={{ ...muted, marginTop: 4 }}>Opps from the source / opps started</div>
      {cr && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingTop: 5, borderTop: '1px solid var(--color-border, #E2E8F0)' }}>
          <span style={{ width: 12, height: 2, background: CLOSE_COLOUR }} />
          <span style={{ flex: 1 }}>Close rate (closed in {periodLabel(p, period)})</span>
          <span style={{ fontWeight: 600 }}>{fmtPct(cr.rate)}</span>
          <span style={{ ...muted, minWidth: 48, textAlign: 'right' }}>{cr.wins}/{cr.decided}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Opps > By Source > "Over time".
 *
 * The opps that started in each period (by Start Date), split by Source:
 * a stacked "% of total" chart (each period adds up to 100%, since an opp
 * has one Source) and a stacked "Total opps" chart of the counts, on the
 * same colours. The charts draw the sources picked in the Chart box, or the
 * busiest eight, with the rest grouped as Other; the table lists them all.
 * Clicking a legend entry switches that source off in both charts.
 */
export function SourceTrends({ records: allRecords, settings, updateSettings, onSourceClick }) {
  const [period, setPeriod] = useState('quarter');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [activity, setActivity] = useState('all');
  const [picked, setPicked] = useState([]);
  const [off, setOff] = useState(() => new Set());
  const [showCloseRate, setShowCloseRate] = useState(true);
  // "Has BFO Opp Name only": keep just the opps tied to a BFO opportunity
  // (a real BFO Link, not blank / "-" / #N/A). Narrows both charts, the
  // close-rate line and the table, same rule as Not Sold Analysis.
  const [bfoNamedOnly, setBfoNamedOnly] = useState(false);
  const { records, unnamed } = useMemo(() => {
    if (!bfoNamedOnly) return { records: allRecords, unnamed: 0 };
    const out = [];
    let left = 0;
    for (const r of allRecords || []) {
      if (hasBfoField(r?.['BFO Link'])) out.push(r); else left += 1;
    }
    return { records: out, unnamed: left };
  }, [allRecords, bfoNamedOnly]);

  const trend = useMemo(
    () => sourceShareTrend(records, { period, from, to, activity }),
    [records, period, from, to, activity],
  );
  // Close rate of the opps CLOSED in each period (Sold / (Sold + Not Sold),
  // by Close Date), the same rule as Not Sold Analysis. Every source, so it
  // doesn't move when sources are hidden or picked.
  const closeRate = useMemo(() => closeRateTrend(records, { period }), [records, period]);
  const allKeys = useMemo(() => trend.series.map(s => s.key), [trend]);
  const lines = useMemo(() => {
    const keep = picked.filter(k => allKeys.includes(k));
    return keep.length
      ? trend.series.filter(s => keep.includes(s.key)).slice(0, MAX_SOURCES)
      : trend.series.slice(0, MAX_SOURCES);
  }, [trend, picked, allKeys]);
  const colourMap = useMemo(() => new Map(lines.map((s, i) => [s.key, PALETTE[i]])), [lines]);
  const colourOf = (k) => (k === OTHER_KEY ? OTHER_COLOUR : colourMap.get(k) || '#9ca3af');
  const hasOther = trend.series.length > lines.length;

  // Everything the charts can draw, in stack order, Other last.
  const items = useMemo(() => [
    ...lines.map(s => ({ key: s.key, label: s.key, count: s.count, countAt: (p) => s.byPeriod[p].count })),
    ...(hasOther ? [{
      key: OTHER_KEY,
      label: 'Other',
      count: trend.total - lines.reduce((a, s) => a + s.count, 0),
      countAt: (p) => trend.totals[p] - lines.reduce((a, s) => a + s.byPeriod[p].count, 0),
    }] : []),
  ], [lines, hasOther, trend]);
  const visible = items.filter(i => !off.has(i.key));

  const chartData = useMemo(() => trend.periods.map(p => {
    const d = trend.totals[p];
    const row = { period: p, label: periodLabel(p, period), [TOTAL_KEY]: d };
    for (const i of items) {
      const n = i.countAt(p);
      row[`n:${i.key}`] = n;
      row[`s:${i.key}`] = d > 0 ? (n / d) * 100 : null;
    }
    row[CLOSE_KEY] = closeRate.overall[p]?.rate ?? null;
    return row;
  }), [trend, items, period, closeRate]);

  const toggleOff = (key) => setOff(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const togglePick = (v) => setPicked(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

  // ---- table: every source, then the total row --------------------------
  const tableRows = useMemo(() => [
    ...trend.series.map(s => ({ id: s.key, name: s.key, kind: 'series', s })),
    { id: TOTAL_KEY, name: 'Opps started', kind: 'total' },
  ], [trend]);

  const columns = useMemo(() => {
    const cell = (row, p) => {
      if (row.kind === 'total') {
        const n = p == null ? trend.total : trend.totals[p];
        return { text: String(n), sort: n, title: `${n} opps started` };
      }
      const n = p == null ? row.s.count : row.s.byPeriod[p].count;
      const d = p == null ? trend.total : trend.totals[p];
      if (!d) return { text: '-', sort: -1, title: '' };
      const v = p == null ? row.s.share : row.s.byPeriod[p].share;
      return { text: `${fmtPct(v)} (${n})`, pct: fmtPct(v), n, sort: v ?? -1, title: `${n} of ${d} opps started` };
    };
    const render = (row, p) => {
      const c = cell(row, p);
      const bold = row.kind === 'total' || p == null;
      if (c.pct == null) return <div style={{ textAlign: 'right', fontWeight: bold ? 700 : 400, ...(c.text === '-' ? muted : null) }} title={c.title}>{c.text}</div>;
      return (
        <div style={{ textAlign: 'right', fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums' }} title={c.title}>
          {c.pct} <span style={{ ...muted, fontWeight: 400 }}>({c.n})</span>
        </div>
      );
    };
    const cols = [{
      key: 'name',
      label: 'Source',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: row.kind === 'total' ? 700 : 400 }}>
          {colourMap.has(row.name) && row.kind === 'series' && (
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colourMap.get(row.name), flexShrink: 0 }} />
          )}
          {row.kind === 'series' && onSourceClick ? (
            <span style={{ color: 'var(--color-link, #2563EB)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{row.name}</span>
          ) : row.name}
        </span>
      ),
    }];
    for (const p of trend.periods) {
      cols.push({
        key: `p:${p}`,
        label: periodLabel(p, period),
        defaultWidth: 130,
        render: (row) => render(row, p),
        getFilterValue: (row) => cell(row, p).text,
        exportValue: (row) => cell(row, p).text,
        getSortValue: (row) => cell(row, p).sort,
      });
    }
    cols.push({
      key: 'total',
      label: 'Whole window',
      defaultWidth: 140,
      render: (row) => render(row, null),
      getFilterValue: (row) => cell(row, null).text,
      exportValue: (row) => cell(row, null).text,
      getSortValue: (row) => cell(row, null).sort,
    });
    return cols;
  }, [trend, period, colourMap, onSourceClick]);

  const activityWord = activity === 'active' ? 'active ' : activity === 'closed' ? 'closed ' : '';
  const summary = `${trend.total} ${activityWord}opp${trend.total === 1 ? '' : 's'} started${trend.undated ? ` · ${trend.undated} without a Start Date left out` : ''}`;
  const tooltip = <TrendTooltip trend={trend} items={visible} period={period} colourOf={colourOf} closeRate={showCloseRate ? closeRate : null} />;
  const chartTitle = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text)', margin: '0.25rem 0 0.15rem' };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1.25rem 1.25rem' }}>
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
        <span className={styles.notSoldYears}>
          <span className={styles.filterLabel} style={{ marginRight: 2 }}>Period</span>
          {PERIODS.map(o => (
            <button
              key={o.key}
              type="button"
              className={period === o.key ? styles.notSoldYearOn : styles.notSoldYear}
              onClick={() => setPeriod(o.key)}
            >{o.label}</button>
          ))}
        </span>
        <label className={styles.filterLabel}>
          Started from
          <input type="date" className={styles.filterInput} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className={styles.filterLabel}>
          to
          <input type="date" className={styles.filterInput} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </label>
        <label className={styles.filterLabel}>
          Show
          <select className={styles.filterInput} value={activity} onChange={e => setActivity(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="closed">Closed only</option>
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel}>Chart</span>
          <div style={{ flex: 1 }} title={`Pick up to ${MAX_SOURCES} sources to draw; none picked draws the ${MAX_SOURCES} busiest`}>
            <TagMultiSelect options={allKeys} selected={picked} onToggle={togglePick} placeholder={`Top ${MAX_SOURCES} sources`} />
          </div>
        </div>
        <button
          type="button"
          className={bfoNamedOnly ? styles.notSoldYearOn : styles.notSoldYear}
          onClick={() => setBfoNamedOnly(v => !v)}
          title="Only count opps that have a BFO Opportunity Name"
          aria-pressed={bfoNamedOnly}
        >Has BFO Opp Name only</button>
        {(picked.length > 0 || from || to || activity !== 'all' || bfoNamedOnly) && (
          <button className={styles.clearFiltersBtn} onClick={() => { setPicked([]); setFrom(''); setTo(''); setActivity('all'); setBfoNamedOnly(false); }}>Clear</button>
        )}
        <span className={styles.resultCount}>{summary}</span>
        {bfoNamedOnly && unnamed > 0 && (
          <span className={styles.resultCount} style={{ color: '#92400E' }}>
            {unnamed} left out - no BFO Opportunity Name
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.72rem', ...muted }}>
        The opps that started in each period (by Start Date), split by Source. Each opp has one Source, so a period's % of total adds up to 100%. Sources not drawn are grouped as Other.
        {picked.length > MAX_SOURCES && ` The charts draw the first ${MAX_SOURCES} picked; the table has them all.`}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {trend.periods.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', ...muted }}>No opps with a Start Date match these filters.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.85rem', fontSize: '0.74rem' }}>
              {items.map(i => (
                <button
                  key={i.key}
                  type="button"
                  onClick={() => toggleOff(i.key)}
                  title={off.has(i.key) ? `Show ${i.label}` : `Hide ${i.label}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--color-text)', opacity: off.has(i.key) ? 0.4 : 1, textDecoration: off.has(i.key) ? 'line-through' : 'none' }}
                >
                  <span style={{ width: 12, height: 10, borderRadius: 999, background: colourOf(i.key) }} />
                  {i.label} <span style={muted}>({fmtPct(trend.total ? (i.count / trend.total) * 100 : null)}, {i.count})</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCloseRate(v => !v)}
                title={`${showCloseRate ? 'Hide' : 'Show'} the close rate line: Sold / (Sold + Not Sold) of the opps closed in each period, by Close Date`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--color-text)', opacity: showCloseRate ? 1 : 0.4, textDecoration: showCloseRate ? 'none' : 'line-through' }}
              >
                <span style={{ width: 14, height: 3, borderRadius: 999, background: CLOSE_COLOUR }} />
                Close rate <span style={muted}>({fmtPct(closeRate.rate)}, {closeRate.wins}/{closeRate.decided})</span>
              </button>
            </div>

            <div style={chartTitle}>% of total{showCloseRate ? ', with the close rate of opps closed in each period' : ''}</div>
            <div style={{ height: 260, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={tooltip} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                  {visible.map(i => (
                    <Area key={i.key} type="linear" dataKey={`s:${i.key}`} name={i.label} stackId="share" stroke={colourOf(i.key)} strokeWidth={1} fill={colourOf(i.key)} fillOpacity={0.85} isAnimationActive={false} />
                  ))}
                  {showCloseRate && (
                    <Line key="halo" type="linear" dataKey={CLOSE_KEY} stroke="#ffffff" strokeWidth={5} dot={false} activeDot={false} legendType="none" tooltipType="none" isAnimationActive={false} />
                  )}
                  {showCloseRate && (
                    <Line
                      key="close"
                      type="linear"
                      dataKey={CLOSE_KEY}
                      name="Close rate"
                      stroke={CLOSE_COLOUR}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CLOSE_COLOUR, stroke: '#fff', strokeWidth: 1.5 }}
                      activeDot={{ r: 5, fill: CLOSE_COLOUR, stroke: '#fff', strokeWidth: 2 }}
                      isAnimationActive={false}
                    >
                      {period === 'year' && (
                        <LabelList dataKey={CLOSE_KEY} position="top" formatter={(v) => (v == null ? '' : `${Math.round(v)}%`)} style={{ fontSize: 10, fill: CLOSE_COLOUR, fontWeight: 700, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }} />
                      )}
                    </Line>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={chartTitle}>Total opps started</div>
            <div style={{ height: 240, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                  <Tooltip content={tooltip} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
                  {visible.map((i, idx) => (
                    <Bar key={i.key} dataKey={`n:${i.key}`} name={i.label} stackId="count" fill={colourOf(i.key)} isAnimationActive={false}>
                      {idx === visible.length - 1 && (
                        <LabelList
                          position="top"
                          valueAccessor={(entry) => {
                            const n = visible.reduce((a, v) => a + (entry.payload?.[`n:${v.key}`] || 0), 0);
                            return n || '';
                          }}
                          style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }}
                        />
                      )}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ height: Math.min(140 + tableRows.length * 36, 640), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <DataTable
                tableId={`opps2-source-trend-${period}`}
                columns={columns}
                rows={tableRows}
                alwaysVisible={['name']}
                rowGroup={(row) => (row.kind === 'total' ? 1 : 0)}
                onRowClick={onSourceClick ? (row) => { if (row.kind === 'series') onSourceClick(row.name); } : undefined}
                exportFileName={`Opps by source by ${period}`}
                emptyMessage="No opps with a Start Date match these filters."
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
