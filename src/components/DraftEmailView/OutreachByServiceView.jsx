// Draft Emails > Outreach by Service: how much prospecting has gone out for
// each service over time, as a chart you can re-cut.
//
// The numbers come from the saved email campaigns: each campaign is tagged
// with services (Email Campaigns > Services) and each sent roster row is an
// email that went out for those services. utils/serviceOutreach.js does the
// counting; this is the controls, the chart and the totals table.
//
// The view (measure, time frame, grouping, chart type, services) is saved in
// settings.outreachByServiceView so it follows Dan between machines.
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useSavedCampaigns } from '../../hooks/useSavedCampaigns';
import { DataTable } from '../common/DataTable';
import { TagMultiSelect } from '../common/TagMultiSelect';
import {
  outreachEvents, outreachSeries, serviceOrder, rangeWindow, asShares,
  OUTREACH_PERIODS, OUTREACH_METRICS, OUTREACH_RANGES, NO_SERVICE,
} from '../../utils/serviceOutreach';

// Fixed categorical order, the same validated palette the Opps trend charts
// use. A service keeps its colour whatever is filtered: colours follow the
// all-time order, not the order on screen. Past eight, services fold into a
// grey Other rather than inventing a ninth hue.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER = 'Other services';
const OTHER_COLOUR = '#9ca3af';
// Campaigns with no service are a neutral, not a ninth service.
const NO_SERVICE_COLOUR = '#64748B';

const CHARTS = [
  { key: 'line', label: 'Lines' },
  { key: 'area', label: 'Stacked area' },
  { key: 'stacked', label: 'Stacked bars' },
  { key: 'grouped', label: 'Side-by-side bars' },
  { key: 'share', label: 'Share %' },
];

const DEFAULT_VIEW = { metric: 'sends', range: '12m', period: 'month', chart: 'stacked', services: null, from: '', to: '' };

const ink = { primary: '#1E293B', secondary: '#475569', muted: '#64748B', grid: '#E5E7EB' };

function Segmented({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: ink.muted, textTransform: 'uppercase', letterSpacing: '0.03em', marginRight: 2 }}>{label}</span>
      <div role="group" aria-label={label} style={{ display: 'inline-flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
        {options.map((o, i) => {
          const on = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={on}
              title={o.help || undefined}
              onClick={() => onChange(o.key)}
              style={{
                padding: '0.28rem 0.6rem', fontSize: '0.74rem', fontFamily: 'inherit', cursor: 'pointer',
                border: 'none', borderLeft: i ? '1px solid #CBD5E1' : 'none',
                background: on ? '#1D4ED8' : '#fff', color: on ? '#fff' : ink.secondary, fontWeight: on ? 700 : 500,
              }}
            >{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 150, padding: '0.6rem 0.8rem', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff' }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: ink.muted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: ink.primary, lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: ink.muted }}>{sub}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload, label, share, additive, metricLabel }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(p => p.value > 0).sort((a, b) => b.value - a.value);
  // People and companies are distinct per service, so adding them up
  // would count somebody on two services twice: no total for those.
  const total = share || !additive ? null : items.reduce((a, p) => a + p.value, 0);
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 14px rgba(15,23,42,0.12)', padding: '0.45rem 0.6rem', fontSize: '0.74rem', minWidth: 170 }}>
      <div style={{ fontWeight: 700, color: ink.primary, marginBottom: 4 }}>{label}</div>
      {items.length === 0 && <div style={{ color: ink.muted }}>None</div>}
      {items.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, color: ink.secondary, lineHeight: 1.5 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: p.color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 600, color: ink.primary }}>{share ? `${p.value}%` : p.value.toLocaleString()}</span>
        </div>
      ))}
      {total != null && items.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #F1F5F9', marginTop: 4, paddingTop: 3, color: ink.muted }}>
          <span>{metricLabel}, total</span><span style={{ fontWeight: 600, color: ink.primary }}>{total.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

export function OutreachByServiceView({ settings, updateSettings }) {
  const { campaigns, loading } = useSavedCampaigns();
  const saved = settings?.outreachByServiceView || {};
  const view = { ...DEFAULT_VIEW, ...saved };
  const setView = (patch) => updateSettings({ outreachByServiceView: { ...saved, ...patch } });
  // Legend clicks hide a series for this visit only.
  const [hidden, setHidden] = useState(() => new Set());

  const events = useMemo(() => outreachEvents(campaigns), [campaigns]);
  const order = useMemo(() => serviceOrder(events), [events]);
  const colourOf = useMemo(() => {
    const real = order.filter(s => s !== NO_SERVICE);
    const m = new Map(real.map((s, i) => [s, i < PALETTE.length ? PALETTE[i] : OTHER_COLOUR]));
    m.set(NO_SERVICE, NO_SERVICE_COLOUR);
    m.set(OTHER, OTHER_COLOUR);
    return (s) => m.get(s) || OTHER_COLOUR;
  }, [order]);

  // The services picked (null = every service). A picked name no campaign
  // carries any more is dropped quietly.
  const picked = useMemo(
    () => (Array.isArray(view.services) ? order.filter(s => view.services.includes(s)) : order),
    [view.services, order],
  );
  const toggleService = (s) => {
    const cur = new Set(picked);
    if (cur.has(s)) cur.delete(s); else cur.add(s);
    setView({ services: order.filter(x => cur.has(x)) });
  };

  const win = useMemo(
    () => rangeWindow(view.range, { events, customFrom: view.from, customTo: view.to }),
    [view.range, view.from, view.to, events],
  );
  // A week-by-week view of years of history is hundreds of bars; step the
  // grouping up for wide windows so the chart stays readable.
  const spanDays = win.from ? (win.to - win.from) / 86400000 : 0;
  const period = view.period === 'week' && spanDays > 400 ? 'month' : view.period;

  const series = useMemo(
    () => outreachSeries({ events, services: picked, period, metric: view.metric, from: win.from, to: win.to }),
    [events, picked, period, view.metric, win.from, win.to],
  );

  // Services past the eighth colour fold into Other on the chart.
  const { folded, chartKeys } = useMemo(() => {
    const real = order.filter(s => s !== NO_SERVICE);
    const fits = (s) => s === NO_SERVICE || real.indexOf(s) < PALETTE.length;
    const coloured = picked.filter(fits);
    const rest = picked.filter(s => !fits(s));
    return { folded: rest, chartKeys: rest.length ? [...coloured, OTHER] : coloured };
  }, [picked, order]);
  const chartRows = useMemo(() => {
    const base = series.rows.map(r => {
      const out = { ...r };
      if (folded.length) out[OTHER] = folded.reduce((a, s) => a + (r[s] || 0), 0);
      return out;
    });
    return view.chart === 'share' ? asShares(base, chartKeys) : base;
  }, [series.rows, folded, chartKeys, view.chart]);
  const shownKeys = chartKeys.filter(k => !hidden.has(k));

  const metricDef = OUTREACH_METRICS.find(m => m.key === view.metric) || OUTREACH_METRICS[0];
  const periodWord = OUTREACH_PERIODS.find(p => p.key === period)?.label.toLowerCase() || 'period';
  const nPeriods = series.rows.length || 1;
  const busiest = picked.reduce((best, s) => ((series.totals[s] || 0) > (series.totals[best] || 0) ? s : best), picked[0]);
  const last = series.rows[series.rows.length - 1];
  const prev = series.rows[series.rows.length - 2];

  // Totals table: one row per service picked.
  const tableRows = useMemo(() => picked.map(s => {
    const lastSent = events.filter(e => e.service === s).reduce((m, e) => (!m || e.sentAt > m ? e.sentAt : m), null);
    const inWin = (d) => (!win.from || d >= win.from) && d <= new Date(win.to.getFullYear(), win.to.getMonth(), win.to.getDate() + 1);
    const camps = new Set(events.filter(e => e.service === s && e.campaign && inWin(e.sentAt)).map(e => e.campaign));
    return {
      id: s,
      service: s,
      total: series.totals[s] || 0,
      perPeriod: Math.round(((series.totals[s] || 0) / nPeriods) * 10) / 10,
      lastPeriod: last ? (last[s] || 0) : 0,
      share: series.total ? Math.round(((series.totals[s] || 0) / picked.reduce((a, x) => a + (series.totals[x] || 0), 0)) * 1000) / 10 : 0,
      campaigns: camps.size,
      lastSent,
    };
  }), [picked, events, series, nPeriods, last, win]);

  const columns = useMemo(() => [
    {
      key: 'service', label: 'Service', defaultWidth: 220,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: colourOf(r.service), flexShrink: 0 }} />
          <span style={{ fontStyle: r.service === NO_SERVICE ? 'italic' : 'normal' }}>{r.service}</span>
        </span>
      ),
    },
    { key: 'total', label: `${metricDef.label} (window)`, defaultWidth: 140, getSortValue: (r) => r.total, render: (r) => r.total.toLocaleString() },
    { key: 'perPeriod', label: `Avg per ${periodWord}`, defaultWidth: 120, getSortValue: (r) => r.perPeriod },
    { key: 'lastPeriod', label: `This ${periodWord} so far`, defaultWidth: 110, getSortValue: (r) => r.lastPeriod },
    { key: 'share', label: 'Share', defaultWidth: 90, getSortValue: (r) => r.share, render: (r) => `${r.share}%` },
    { key: 'campaigns', label: 'Campaigns (window)', defaultWidth: 140, getSortValue: (r) => r.campaigns },
    {
      key: 'lastSent', label: 'Last sent', defaultWidth: 120,
      getSortValue: (r) => (r.lastSent ? r.lastSent.getTime() : null),
      getFilterValue: (r) => (r.lastSent ? r.lastSent.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''),
      render: (r) => (r.lastSent ? r.lastSent.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''),
    },
  ], [colourOf, metricDef.label, periodWord]);

  const toggleLegend = (o) => {
    const key = o?.dataKey;
    if (!key) return;
    setHidden(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };

  const share = view.chart === 'share';
  const axisProps = {
    x: { dataKey: 'label', tick: { fontSize: 11, fill: ink.muted }, tickLine: false, axisLine: { stroke: ink.grid }, interval: 'preserveStartEnd', minTickGap: 10 },
    y: { tick: { fontSize: 11, fill: ink.muted }, tickLine: false, axisLine: false, allowDecimals: false, width: 44, domain: share ? [0, 100] : [0, 'auto'], tickFormatter: (v) => (share ? `${v}%` : v) },
  };
  const legend = (
    <Legend
      verticalAlign="top"
      align="left"
      height={30}
      iconType="square"
      iconSize={9}
      onClick={toggleLegend}
      wrapperStyle={{ fontSize: '0.74rem', cursor: 'pointer' }}
      formatter={(v) => <span style={{ color: hidden.has(v) ? '#CBD5E1' : ink.secondary }}>{v}</span>}
    />
  );
  const tooltip = <Tooltip content={<ChartTooltip share={share} additive={view.metric === 'sends' || view.metric === 'replies'} metricLabel={metricDef.label} />} cursor={view.chart === 'line' || view.chart === 'area' ? { stroke: '#94A3B8', strokeWidth: 1 } : { fill: 'rgba(100,116,139,0.08)' }} />;
  const grid = <CartesianGrid stroke={ink.grid} vertical={false} />;
  const margin = { top: 4, right: 12, left: 0, bottom: 4 };

  let chart;
  if (view.chart === 'line') {
    chart = (
      <LineChart data={chartRows} margin={margin}>
        {grid}<XAxis {...axisProps.x} /><YAxis {...axisProps.y} />{tooltip}{legend}
        {chartKeys.map(k => (
          <Line key={k} type="monotone" dataKey={k} name={k} hide={hidden.has(k)} stroke={colourOf(k)} strokeWidth={2}
            dot={chartRows.length <= 24 ? { r: 3, strokeWidth: 0, fill: colourOf(k) } : false}
            activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </LineChart>
    );
  } else if (view.chart === 'area' || view.chart === 'share') {
    chart = (
      <AreaChart data={chartRows} margin={margin}>
        {grid}<XAxis {...axisProps.x} /><YAxis {...axisProps.y} />{tooltip}{legend}
        {chartKeys.map(k => (
          <Area key={k} type="monotone" dataKey={k} name={k} hide={hidden.has(k)} stackId="s" stroke={colourOf(k)} strokeWidth={1.5}
            fill={colourOf(k)} fillOpacity={0.75} isAnimationActive={false} />
        ))}
      </AreaChart>
    );
  } else {
    const stacked = view.chart === 'stacked';
    chart = (
      <BarChart data={chartRows} margin={margin} barCategoryGap={stacked ? '22%' : '14%'} barGap={2}>
        {grid}<XAxis {...axisProps.x} /><YAxis {...axisProps.y} />{tooltip}{legend}
        {chartKeys.map((k, i) => {
          const top = stacked ? i === chartKeys.length - 1 : true;
          return (
            <Bar key={k} dataKey={k} name={k} hide={hidden.has(k)} stackId={stacked ? 's' : undefined} fill={colourOf(k)}
              stroke="#fff" strokeWidth={stacked ? 1 : 0} radius={top ? [3, 3, 0, 0] : 0} isAnimationActive={false} maxBarSize={48} />
          );
        })}
      </BarChart>
    );
  }

  const noSends = !loading && events.length === 0;
  const onlyUntagged = !loading && order.length === 1 && order[0] === NO_SERVICE;
  const fmtDay = (d) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const delta = last && prev ? last._total - prev._total : null;

  return (
    <div data-outreach-by-service style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontSize: '0.78rem', color: ink.secondary }}>
        Campaign emails sent for each service over time. A campaign counts toward the services it is tagged with on Email Campaigns; one tagged with two services counts for both.
      </div>

      {/* Controls, one row where it fits. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.1rem', alignItems: 'center', padding: '0.6rem 0.75rem', border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC' }}>
        <Segmented label="Measure" options={OUTREACH_METRICS} value={view.metric} onChange={(k) => setView({ metric: k })} />
        <Segmented label="Time frame" options={OUTREACH_RANGES} value={view.range} onChange={(k) => setView({ range: k })} />
        {view.range === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.74rem', color: ink.secondary }}>
            <input type="date" aria-label="From" value={view.from || ''} onChange={e => setView({ from: e.target.value })} style={{ padding: '0.2rem 0.3rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.74rem' }} />
            <span>to</span>
            <input type="date" aria-label="To" value={view.to || ''} onChange={e => setView({ to: e.target.value })} style={{ padding: '0.2rem 0.3rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.74rem' }} />
          </div>
        )}
        <Segmented label="Group by" options={OUTREACH_PERIODS} value={view.period} onChange={(k) => setView({ period: k })} />
        <Segmented label="Chart" options={CHARTS} value={view.chart} onChange={(k) => setView({ chart: k })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 240 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: ink.muted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Services</span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <TagMultiSelect options={order} selected={picked} onToggle={toggleService} placeholder="Pick services..." />
          </div>
          {Array.isArray(view.services) && (
            <button type="button" onClick={() => setView({ services: null })} style={{ border: 'none', background: 'none', color: '#1D4ED8', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>All</button>
          )}
        </div>
      </div>

      {loading && <div style={{ fontSize: '0.8rem', color: ink.muted }}>Loading campaigns...</div>}
      {noSends && <div style={{ fontSize: '0.8rem', color: ink.muted }}>No campaign emails have gone out yet. Once a saved campaign's roster shows sent dates, they are charted here.</div>}
      {onlyUntagged && (
        <div style={{ fontSize: '0.78rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.45rem 0.6rem' }}>
          None of your campaigns are tagged with a service yet, so everything shows as "{NO_SERVICE}". Tag each campaign's services on the Email Campaigns tab to split this chart by service.
        </div>
      )}

      {!loading && !noSends && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            <StatTile label={`${metricDef.label}, ${fmtDay(win.from)} to ${fmtDay(win.to)}`} value={series.total.toLocaleString()} sub={`${picked.length} service${picked.length === 1 ? '' : 's'} shown`} />
            <StatTile label={`Average per ${periodWord}`} value={(Math.round((series.rows.reduce((a, r) => a + r._total, 0) / nPeriods) * 10) / 10).toLocaleString()} sub={`over ${series.rows.length} ${periodWord}${series.rows.length === 1 ? '' : 's'}`} />
            <StatTile label={`This ${periodWord} so far`} value={(last?._total || 0).toLocaleString()} sub={delta == null ? '' : `${delta >= 0 ? '+' : ''}${delta} vs the ${periodWord} before`} />
            <StatTile label="Most outreach" value={busiest && (series.totals[busiest] || 0) > 0 ? busiest : 'None'} sub={busiest && series.totals[busiest] ? `${series.totals[busiest].toLocaleString()} ${metricDef.label.toLowerCase()}` : ''} />
          </div>

          <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.6rem 0.6rem 0.3rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '0 0.3rem 0.2rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: ink.primary }}>
                {metricDef.label} by service, per {periodWord}{share ? ', as a share of each ' + periodWord : ''}
              </span>
              <span style={{ fontSize: '0.7rem', color: ink.muted }}>
                {period !== view.period ? 'Grouped by month: weeks are too many for this time frame. ' : ''}Click a legend item to hide it.
              </span>
            </div>
            {picked.length === 0 ? (
              <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink.muted, fontSize: '0.8rem' }}>Pick at least one service.</div>
            ) : (
              <div style={{ height: 340 }} data-outreach-chart={view.chart}>
                <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
              </div>
            )}
            {folded.length > 0 && (
              <div style={{ fontSize: '0.7rem', color: ink.muted, padding: '0 0.3rem 0.3rem' }}>
                {OTHER} on the chart: {folded.join(', ')}. The table below lists each one.
              </div>
            )}
            {shownKeys.length === 0 && picked.length > 0 && (
              <div style={{ fontSize: '0.7rem', color: ink.muted, padding: '0 0.3rem 0.3rem' }}>Every series is hidden. Click a legend item to show it again.</div>
            )}
          </div>

          <div style={{ height: Math.min(140 + tableRows.length * 36, 560), display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
            <DataTable
              tableId="outreach-by-service-totals"
              exportFileName="Outreach by service"
              columns={columns}
              rows={tableRows}
              alwaysVisible={['service']}
              defaultSort={{ key: 'total', direction: 'desc' }}
              emptyMessage="No services picked"
              settings={settings}
              updateSettings={updateSettings}
            />
          </div>
        </>
      )}
    </div>
  );
}
