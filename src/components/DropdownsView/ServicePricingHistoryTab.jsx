import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  parseServicePricingHistory,
  recordServicePricing,
  servicePricingCoverage,
  servicePricingHistoryRows,
  servicePricingHistorySnapshot,
  subscribeServicePricingHistory,
} from '../../utils/servicePricingHistory';
import { todayISO } from '../../utils/prospectingStatus';

// Dropdowns > Service Pricing History. The Services Pricing subtab's
// "% priced or no fee" figure, one reading a day, so the rate card's
// progress can be seen moving rather than only read off as today's number.
// The readings are written by useServicePricingRecorder whenever the app is
// open, and by this tab on the way in so today's point is never stale.
// The first reading is also written as the day before (marked seeded), so
// the line starts as a line.

// The progress bar's own colours, so the two read as the same figure.
const PRICED = '#059669';
const NO_FEE = '#6EE7B7';
const AXIS_TICK = { fontSize: 11, fill: '#64748B' };
const CARD = {
  border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff',
  padding: '0.85rem 1rem 0.5rem', marginTop: '0.75rem',
};

const share = (n, total) => (n == null || !total ? null : Math.round((n / total) * 1000) / 10);

function dayLabel(iso, opts = { month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

// One point per recorded day. A day the app wasn't open (a weekend, most
// often) is simply not on the axis: as a gap it would leave a Monday reading
// between two gaps with nothing to draw.
function chartRows(rows) {
  return rows.map(r => ({
    iso: r.iso,
    label: dayLabel(r.iso),
    row: r,
    priced: share(r.priced, r.total),
    noFee: share(r.noFee, r.total),
  }));
}

function HistoryTooltip({ active, payload }) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  const r = p.row;
  return (
    <div style={{
      background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8,
      padding: '6px 9px', fontSize: '0.72rem', color: '#1E293B',
      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)', maxWidth: 280,
    }}>
      <div style={{ fontWeight: 700 }}>{dayLabel(p.iso, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
      <div><strong>{r.answeredPct}%</strong> priced or no fee ({r.answered} of {r.total})</div>
      <div style={{ color: '#475569' }}>Priced {r.priced}, no fee {r.noFee}, unpriced {r.total - r.answered}</div>
      {r.seeded && <div style={{ color: '#64748B' }}>Carried back from the first reading</div>}
    </div>
  );
}

export function ServicePricingHistoryTab({ settings }) {
  // Today's reading on the way in, from the settings on screen.
  const coverage = useMemo(() => {
    try { return servicePricingCoverage(settings); } catch { return null; }
  }, [settings]);
  useEffect(() => {
    if (coverage) recordServicePricing(todayISO(), coverage);
  }, [coverage]);

  const raw = useSyncExternalStore(subscribeServicePricingHistory, servicePricingHistorySnapshot);
  const rows = useMemo(() => servicePricingHistoryRows(parseServicePricingHistory(raw)), [raw]);
  const data = useMemo(() => chartRows(rows), [rows]);
  const latest = rows[rows.length - 1] || null;
  // Newest first in the table, each with the move from the reading before.
  const tableRows = useMemo(() => rows.map((r, i) => ({
    ...r,
    delta: i > 0 ? Math.round((r.answeredPct - rows[i - 1].answeredPct) * 10) / 10 : null,
  })).reverse(), [rows]);

  if (!rows.length) {
    return (
      <div style={{ padding: '1rem 0', color: '#64748B', fontSize: '0.85rem' }}>
        No readings yet. The first one is taken once the service list has loaded.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: '#475569', margin: '0.5rem 0' }}>
        The share of tracked services on the Services Pricing tab that are priced or marked no fee, one reading a day.
        A day is recorded whenever the app is open, and only recorded days are charted. The first reading is also shown as the day before it.
      </div>

      <div style={CARD}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', fontSize: '0.78rem', color: '#475569' }}>
          <span style={{ fontSize: '1.1rem', color: '#1E293B' }}><strong>{latest.answeredPct}%</strong></span>
          <span>priced or no fee ({latest.answered} of {latest.total}) on {dayLabel(latest.iso, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: PRICED }} /> Priced {latest.priced}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: NO_FEE }} /> No fee {latest.noFee}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip content={<HistoryTooltip />} cursor={{ stroke: '#94A3B8', strokeWidth: 1 }} />
            {[{ key: 'priced', name: 'Priced', color: PRICED }, { key: 'noFee', name: 'No fee', color: NO_FEE }].map(b => (
              <Area
                key={b.key}
                type="linear"
                dataKey={b.key}
                name={b.name}
                stackId="pricing"
                fill={b.color}
                fillOpacity={0.85}
                stroke="#fff"
                strokeWidth={1.5}
                activeDot={{ r: 4, fill: b.color, stroke: '#fff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ ...CARD, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: '#F8FAFC', color: '#475569', textAlign: 'left' }}>
              {['Day', '% priced or no fee', 'Change', 'Priced', 'No fee', 'Unpriced', 'Tracked'].map((h, i) => (
                <th key={h} style={{ padding: '6px 10px', fontWeight: 600, textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map(r => (
              <tr key={r.iso} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '5px 10px' }}>
                  {dayLabel(r.iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  {r.seeded && <span style={{ color: '#94A3B8' }} title="Carried back from the first reading"> (from first reading)</span>}
                </td>
                <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{r.answeredPct}%</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', color: r.delta > 0 ? '#059669' : r.delta < 0 ? '#B91C1C' : '#94A3B8' }}>
                  {r.delta == null ? '-' : `${r.delta > 0 ? '+' : ''}${r.delta} pts`}
                </td>
                <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.priced}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.noFee}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.total - r.answered}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
