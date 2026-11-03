import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { TagMultiSelect } from '../common/TagMultiSelect';
import { serviceShareTrend, serviceCloseRateTrend, periodLabel } from '../../utils/serviceTrends';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// The validated categorical order the other Opps trend charts use. The
// chart draws at most this many services at once; the table has them all.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_LINES = PALETTE.length;
const OVERALL_COLOUR = '#334155';
const OVERALL_KEY = '__overall';
const OTHER_COLOUR = '#cbd5e1';
const OTHER_KEY = '__other';
const TAGS_KEY = '__tags';

// The share mode's two scales. 'mix' (the default) is each service's slice
// of every service tag in the period, so a period stacks to 100%; 'opps' is
// the share of opps that include the service, which can top 100%.
const SCALES = [
  { key: 'mix', label: '% of 100', title: 'Each period stacks to 100%: each service\'s slice of all the services on the opps started' },
  { key: 'opps', label: '% of opps', title: 'Each service\'s share of the opps started (an opp with several services counts toward each)' },
];
const MIX_BLURB = 'Each period\'s service mix, adding up to 100%: of every service on the opps that started in the period (by Start Date, open or closed), the slice each service makes up. An opp with several services counts once toward each. Services not drawn are grouped as Other.';

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

const MODES = {
  share: {
    title: '% of total opps',
    dateLabel: 'Started',
    defaultPeriod: 'quarter',
    blurb: 'Of the opps that started in each period (by Start Date, open or closed), the share that include each service. An opp with several services counts toward each, so a period can add up to more than 100%.',
    empty: 'No opps with a Start Date match these filters.',
    tableId: 'opps2-service-share-trend',
    exportName: '% of total opps by service',
  },
  closeRate: {
    title: 'Close rate',
    dateLabel: 'Closed',
    defaultPeriod: 'year',
    blurb: 'Of each service\'s opps decided in a period (Sold or Not Sold, by Close Date), the share that were won. Overall counts each opp once, whatever its services.',
    empty: 'No decided opps match these filters.',
    tableId: 'opps2-service-close-rate-trend',
    exportName: 'Close rate by service',
  },
};

const fmtPct = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);

// A period cell's numbers, the same in both modes: the % and what it's of.
// `scale` only matters for share: 'mix' is out of the period's service tags.
function cellOf(mode, trend, series, p, scale = 'opps') {
  if (mode === 'share') {
    const mix = scale === 'mix';
    const d = p == null ? (mix ? trend.tagTotal : trend.total) : (mix ? trend.tagTotals[p] : trend.totals[p]);
    const n = p == null ? series.count : series.byPeriod[p].count;
    const field = mix ? 'mix' : 'share';
    const v = p == null ? series[field] : series.byPeriod[p][field];
    return { v, n, d };
  }
  const c = p == null ? series : series.byPeriod[p];
  return { v: c.rate, n: c.wins, d: c.decided };
}

function TrendTooltip({ active, payload, mode, scale, trend, lines, period, showOverall, showOther, colourOf }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload.period;
  const mix = mode === 'share' && scale === 'mix';
  const items = lines.map(s => ({ key: s.key, ...cellOf(mode, trend, s, p, scale) }))
    .filter(i => i.d > 0 && (mode === 'share' ? i.n > 0 : true))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  if (mix && showOther) {
    const o = payload[0].payload[OTHER_KEY];
    const n = trend.tagTotals[p] - lines.reduce((a, s) => a + s.byPeriod[p].count, 0);
    if (n > 0) items.push({ key: OTHER_KEY, label: 'Other', v: o, n, d: trend.tagTotals[p] });
  }
  const o = mode === 'share' ? null : trend.overall[p];
  return (
    <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.75rem', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 230 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        {periodLabel(p, period)}
        {mode === 'share' && <span style={{ ...muted, fontWeight: 400 }}> · {trend.totals[p]} opp{trend.totals[p] === 1 ? '' : 's'} started{mix ? `, ${trend.tagTotals[p]} service${trend.tagTotals[p] === 1 ? '' : 's'}` : ''}</span>}
      </div>
      {o && showOverall && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', fontWeight: 700 }}>
          <span style={{ width: 10, height: 2, background: OVERALL_COLOUR }} />
          <span style={{ flex: 1 }}>Overall</span>
          <span>{fmtPct(o.rate)}</span>
          <span style={{ ...muted, minWidth: 48, textAlign: 'right', fontWeight: 400 }}>{o.wins}/{o.decided}</span>
        </div>
      )}
      {items.length === 0 && <div style={muted}>Nothing for these services</div>}
      {items.map(i => (
        <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: colourOf(i.key) }} />
          <span style={{ flex: 1 }}>{i.label || i.key}</span>
          <span style={{ fontWeight: 600 }}>{fmtPct(i.v)}</span>
          <span style={{ ...muted, minWidth: 48, textAlign: 'right' }}>{i.n}/{i.d}</span>
        </div>
      ))}
      <div style={{ ...muted, marginTop: 4 }}>{mix ? 'Service count / all services on the opps started' : mode === 'share' ? 'Opps with the service / opps started' : 'Won / decided (Sold + Not Sold)'}</div>
    </div>
  );
}

/**
 * Opps > By Service > "% of total over time" and "Close rate over time".
 *
 * One component, two measures (see utils/serviceTrends.js): `mode` 'share'
 * is each service's share of the opps started per period, 'closeRate' is
 * each service's won / decided per close period. The chart draws the
 * services picked in the Services box, or the busiest eight when none are;
 * the table underneath lists every service.
 *
 * The service choices belong to the By Service tab, not to this subtab, so
 * they carry between the two trend subtabs: `picked` / `onPickedChange` is
 * the Chart box, `linesOff` the legend's lines switched off. Clicking a
 * legend entry opens a small popup: "Show on chart" (`onLineShownChange`,
 * this visit) and "Visible by default" (`linesOffDefault` /
 * `onLineDefaultChange`, saved in settings). Hidden services (`hiddenSet`, saved in settings) are left out unless
 * `showHidden`, and `onToggleHide` hides or unhides one from this table the
 * same as from the By service table.
 */
export function ServiceTrends({
  mode, records, settings, updateSettings,
  picked = [], onPickedChange, linesOff, onLineShownChange,
  linesOffDefault = new Set(), onLineDefaultChange,
  hiddenSet = new Set(), showHidden = false, onShowHiddenChange, onToggleHide,
}) {
  const cfg = MODES[mode] || MODES.share;
  const [period, setPeriod] = useState(cfg.defaultPeriod);
  const [scaleChoice, setScale] = useState('mix');
  const scale = mode === 'share' ? scaleChoice : 'opps';
  const isMix = mode === 'share' && scale === 'mix';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const hidden = linesOff || new Set();
  const hiddenServices = useMemo(() => (showHidden ? [] : [...hiddenSet]), [showHidden, hiddenSet]);

  const trend = useMemo(() => (mode === 'share'
    ? serviceShareTrend(records, { period, from, to, hidden: hiddenServices })
    : serviceCloseRateTrend(records, { period, from, to, hidden: hiddenServices })
  ), [mode, records, period, from, to, hiddenServices]);

  const allKeys = useMemo(() => trend.series.map(s => s.key), [trend]);
  const lines = useMemo(() => {
    const keep = picked.filter(k => allKeys.includes(k));
    return keep.length
      ? trend.series.filter(s => keep.includes(s.key)).slice(0, MAX_LINES)
      : trend.series.slice(0, MAX_LINES);
  }, [trend, picked, allKeys]);
  const colourMap = useMemo(() => new Map(lines.map((s, i) => [s.key, PALETTE[i]])), [lines]);
  const colourOf = (k) => (k === OVERALL_KEY ? OVERALL_COLOUR : k === OTHER_KEY ? OTHER_COLOUR : colourMap.get(k) || '#9ca3af');
  const visible = lines.filter(s => !hidden.has(s.key));
  const showOverall = mode === 'closeRate' && !hidden.has(OVERALL_KEY);
  // The services left out of the chart, so the % of 100 stack still adds up.
  const hasOther = isMix && trend.series.length > lines.length;
  const showOther = hasOther && !hidden.has(OTHER_KEY);

  const chartData = useMemo(() => trend.periods.map(p => {
    const row = { period: p, label: periodLabel(p, period) };
    for (const s of lines) row[s.key] = cellOf(mode, trend, s, p, scale).v;
    if (mode === 'closeRate') row[OVERALL_KEY] = trend.overall[p].rate;
    if (isMix) {
      const d = trend.tagTotals[p];
      const drawn = lines.reduce((a, s) => a + s.byPeriod[p].count, 0);
      row[OTHER_KEY] = d > 0 ? ((d - drawn) / d) * 100 : null;
    }
    return row;
  }), [trend, lines, period, mode, scale, isMix]);

  // The legend popup: which entry it's open for, and where under it.
  const [linePopup, setLinePopup] = useState(null);
  const legendRef = useRef(null);
  const popupRef = useRef(null);
  useEffect(() => {
    if (!linePopup) return undefined;
    const onDown = (e) => {
      if (popupRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-legend-key]')) return;
      setLinePopup(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setLinePopup(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [linePopup]);
  const openLinePopup = (e, key) => {
    if (linePopup?.key === key) { setLinePopup(null); return; }
    const box = legendRef.current?.getBoundingClientRect();
    const btn = e.currentTarget.getBoundingClientRect();
    setLinePopup({ key, left: btn.left - (box?.left || 0), top: btn.bottom - (box?.top || 0) + 4 });
  };
  const togglePick = (v) => onPickedChange?.(picked.includes(v) ? picked.filter(x => x !== v) : [...picked, v]);

  // ---- table: every service, then the total row ------------------------
  const tableRows = useMemo(() => {
    const rows = trend.series.map(s => ({ id: s.key, name: s.key, kind: 'series', s, _hidden: hiddenSet.has(s.key) }));
    if (mode === 'closeRate') {
      rows.push({ id: OVERALL_KEY, name: 'Overall', kind: 'total', s: { wins: trend.wins, decided: trend.decided, rate: trend.rate, byPeriod: trend.overall } });
    } else {
      if (isMix) rows.push({ id: TAGS_KEY, name: 'Services on those opps', kind: 'total' });
      rows.push({ id: OVERALL_KEY, name: 'Opps started', kind: 'total' });
    }
    return rows;
  }, [trend, mode, hiddenSet, isMix]);

  const columns = useMemo(() => {
    const cell = (row, p) => {
      if (mode === 'share' && row.kind === 'total') {
        if (row.id === TAGS_KEY) {
          const n = p == null ? trend.tagTotal : trend.tagTotals[p];
          return { text: String(n), sort: n, title: `${n} services across the opps started` };
        }
        const n = p == null ? trend.total : trend.totals[p];
        return { text: String(n), sort: n, title: `${n} opps started` };
      }
      const c = cellOf(mode, trend, row.s, p, scale);
      if (!c.d || (mode === 'closeRate' && c.d === 0)) return { text: '-', sort: -1, title: '' };
      return {
        text: `${fmtPct(c.v)} (${c.n}/${c.d})`, pct: fmtPct(c.v), n: c.n, d: c.d, sort: c.v ?? -1,
        title: isMix ? `${c.n} of ${c.d} services on the opps started` : mode === 'share' ? `${c.n} of ${c.d} opps started` : `${c.n} won of ${c.d} decided`,
      };
    };
    const render = (row, p) => {
      const c = cell(row, p);
      const bold = row.kind === 'total' || p == null;
      if (c.pct == null) return <div style={{ textAlign: 'right', fontWeight: bold ? 700 : 400, ...(c.text === '-' ? muted : null) }} title={c.title}>{c.text}</div>;
      return (
        <div style={{ textAlign: 'right', fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums' }} title={c.title}>
          {c.pct} <span style={{ ...muted, fontWeight: 400 }}>({c.n}/{c.d})</span>
        </div>
      );
    };
    const cols = [{
      key: 'name',
      label: 'Service (Scope)',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: row.kind === 'total' ? 700 : 400 }}>
          {(colourMap.has(row.name) || (row.kind === 'total' && mode === 'closeRate')) && (
            <span style={{ width: 10, height: row.kind === 'total' ? 3 : 10, borderRadius: 2, background: colourOf(row.kind === 'total' ? OVERALL_KEY : row.name), flexShrink: 0 }} />
          )}
          {row.name}
        </span>
      ),
    }];
    for (const p of trend.periods) {
      cols.push({
        key: `p:${p}`,
        label: periodLabel(p, period),
        defaultWidth: 150,
        render: (row) => render(row, p),
        getFilterValue: (row) => cell(row, p).text,
        exportValue: (row) => cell(row, p).text,
        getSortValue: (row) => cell(row, p).sort,
      });
    }
    cols.push({
      key: 'total',
      label: 'Whole window',
      defaultWidth: 150,
      render: (row) => render(row, null),
      getFilterValue: (row) => cell(row, null).text,
      exportValue: (row) => cell(row, null).text,
      getSortValue: (row) => cell(row, null).sort,
    });
    if (onToggleHide) {
      cols.push({
        key: '_actions',
        label: '',
        defaultWidth: 90,
        exportValue: () => '',
        render: (row) => (row.kind !== 'series' ? null : (
          <button
            className={styles.hideServiceBtn}
            onClick={(e) => { e.stopPropagation(); onToggleHide(row.name); }}
            title={row._hidden ? 'Unhide service (on every By Service subtab)' : 'Hide service (on every By Service subtab, saved for next time)'}
          >{row._hidden ? 'Unhide' : 'Hide'}</button>
        )),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend, period, mode, scale, isMix, colourMap, onToggleHide]);

  const legend = [
    ...(mode === 'closeRate' ? [{ key: OVERALL_KEY, label: 'Overall', v: trend.rate }] : []),
    ...lines.map(s => ({ key: s.key, label: s.key, v: cellOf(mode, trend, s, null, scale).v })),
    ...(hasOther ? [{
      key: OTHER_KEY,
      label: 'Other',
      v: trend.tagTotal ? ((trend.tagTotal - lines.reduce((a, s) => a + s.count, 0)) / trend.tagTotal) * 100 : null,
    }] : []),
  ];
  const summary = mode === 'share'
    ? `${trend.total} opp${trend.total === 1 ? '' : 's'} started${trend.undated ? ` · ${trend.undated} without a Start Date left out` : ''}`
    : `${trend.wins} won of ${trend.decided} decided${trend.decided ? ` · ${fmtPct(trend.rate)} close rate` : ''}${trend.undated ? ` · ${trend.undated} without a Close Date left out` : ''}`;

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
        {mode === 'share' && (
          <span className={styles.notSoldYears}>
            <span className={styles.filterLabel} style={{ marginRight: 2 }}>Scale</span>
            {SCALES.map(o => (
              <button
                key={o.key}
                type="button"
                title={o.title}
                className={scale === o.key ? styles.notSoldYearOn : styles.notSoldYear}
                onClick={() => setScale(o.key)}
              >{o.label}</button>
            ))}
          </span>
        )}
        <label className={styles.filterLabel}>
          {cfg.dateLabel} from
          <input type="date" className={styles.filterInput} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className={styles.filterLabel}>
          to
          <input type="date" className={styles.filterInput} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel}>Chart</span>
          <div style={{ flex: 1 }} title={`Pick up to ${MAX_LINES} services to draw; none picked draws the ${MAX_LINES} busiest`}>
            <TagMultiSelect options={allKeys} selected={picked} onToggle={togglePick} placeholder={`Top ${MAX_LINES} services`} />
          </div>
        </div>
        {(picked.length > 0 || from || to) && (
          <button className={styles.clearFiltersBtn} onClick={() => { onPickedChange?.([]); setFrom(''); setTo(''); }}>Clear</button>
        )}
        {hiddenSet.size > 0 && (
          <label className={styles.showHiddenLabel}>
            <input type="checkbox" checked={showHidden} onChange={e => onShowHiddenChange?.(e.target.checked)} />
            Show {hiddenSet.size} hidden
          </label>
        )}
        <span className={styles.resultCount}>{summary}</span>
      </div>
      <div style={{ fontSize: '0.72rem', ...muted }}>
        {isMix ? MIX_BLURB : cfg.blurb}
        {picked.length > MAX_LINES && ` The chart draws the first ${MAX_LINES} picked; the table has them all.`}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {trend.periods.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', ...muted }}>{cfg.empty}</div>
        ) : (
          <>
            <div ref={legendRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.85rem', fontSize: '0.74rem' }}>
              {legend.map(l => (
                <button
                  key={l.key}
                  type="button"
                  data-legend-key={l.key}
                  onClick={(e) => openLinePopup(e, l.key)}
                  title={`${l.label}: show or hide, and set whether it's visible by default`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--color-text)', fontWeight: l.key === OVERALL_KEY ? 700 : 400, opacity: hidden.has(l.key) ? 0.4 : 1, textDecoration: hidden.has(l.key) ? 'line-through' : 'none' }}
                >
                  <span style={{ width: 12, height: l.key === OVERALL_KEY ? 3 : 10, borderRadius: l.key === OVERALL_KEY ? 0 : 999, background: colourOf(l.key) }} />
                  {l.label} <span style={muted}>({fmtPct(l.v)})</span>
                  {linesOffDefault.has(l.key) && <span style={{ ...muted, fontSize: '0.66rem' }} title="Hidden by default">(off by default)</span>}
                </button>
              ))}
              {linePopup && legend.some(l => l.key === linePopup.key) && (() => {
                const l = legend.find(x => x.key === linePopup.key);
                const shown = !hidden.has(l.key);
                const byDefault = !linesOffDefault.has(l.key);
                const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', whiteSpace: 'nowrap' };
                return (
                  <div
                    ref={popupRef}
                    role="dialog"
                    aria-label={`${l.label} line`}
                    style={{ position: 'absolute', left: linePopup.left, top: linePopup.top, zIndex: 20, background: 'var(--color-surface, #fff)', color: 'var(--color-text)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 8, padding: '0.55rem 0.75rem', boxShadow: '0 6px 20px rgba(0,0,0,0.14)', fontSize: '0.78rem', minWidth: 210 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
                      <span style={{ width: 12, height: l.key === OVERALL_KEY ? 3 : 10, borderRadius: l.key === OVERALL_KEY ? 0 : 999, background: colourOf(l.key) }} />
                      <span style={{ flex: 1 }}>{l.label}</span>
                      <button type="button" onClick={() => setLinePopup(null)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #64748B)', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                    <label style={row} title="Switch the line on or off for this visit">
                      <input type="checkbox" checked={shown} onChange={e => onLineShownChange?.(l.key, e.target.checked)} />
                      Show on chart now
                    </label>
                    <label style={row} title="Saved: the line starts this way on every visit and on both trend subtabs">
                      <input type="checkbox" checked={byDefault} onChange={e => onLineDefaultChange?.(l.key, e.target.checked)} />
                      Visible by default
                    </label>
                  </div>
                );
              })()}
            </div>
            <div style={{ height: 300, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                {isMix ? (
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      content={<TrendTooltip mode={mode} scale={scale} trend={trend} lines={visible} period={period} showOther={showOther} colourOf={colourOf} />}
                      cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }}
                    />
                    {visible.map(s => (
                      <Area
                        key={s.key}
                        type="linear"
                        dataKey={s.key}
                        name={s.key}
                        stackId="mix"
                        stroke={colourOf(s.key)}
                        strokeWidth={1}
                        fill={colourOf(s.key)}
                        fillOpacity={0.85}
                        isAnimationActive={false}
                      />
                    ))}
                    {showOther && (
                      <Area type="linear" dataKey={OTHER_KEY} name="Other" stackId="mix" stroke={OTHER_COLOUR} strokeWidth={1} fill={OTHER_COLOUR} fillOpacity={0.85} isAnimationActive={false} />
                    )}
                  </AreaChart>
                ) : (
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={44} domain={mode === 'closeRate' ? [0, 100] : [0, 'auto']} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    content={<TrendTooltip mode={mode} scale={scale} trend={trend} lines={visible} period={period} showOverall={showOverall} colourOf={colourOf} />}
                    cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }}
                  />
                  {visible.map(s => (
                    <Line
                      key={s.key}
                      dataKey={s.key}
                      name={s.key}
                      stroke={colourOf(s.key)}
                      strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 0, fill: colourOf(s.key) }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                  {showOverall && (
                    <Line dataKey={OVERALL_KEY} name="Overall" stroke={OVERALL_COLOUR} strokeWidth={3} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
                  )}
                </LineChart>
                )}
              </ResponsiveContainer>
            </div>

            <div style={{ height: Math.min(140 + tableRows.length * 36, 640), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <DataTable
                tableId={`${cfg.tableId}-${period}`}
                columns={columns}
                rows={tableRows}
                alwaysVisible={['name']}
                rowStyle={(row) => (row._hidden ? { opacity: 0.5 } : undefined)}
                rowGroup={(row) => (row.kind === 'total' ? 1 : 0)}
                exportFileName={`${cfg.exportName} by ${period}`}
                emptyMessage={cfg.empty}
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
