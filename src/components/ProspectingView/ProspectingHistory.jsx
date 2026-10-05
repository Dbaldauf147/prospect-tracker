// Prospecting > History - how far down the ladder each working day got, and
// how many opps were overdue on step 1, charted day by day. The rows are
// written by useProspectingLadder as the day goes on (see
// utils/prospectingHistory.js for what a row holds and why); this page only
// reads them back.

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  historyChartRows,
  historySnapshot,
  parseHistory,
  subscribeHistory,
  workingDaysBack,
} from '../../utils/prospectingHistory';

const RANGES = [
  { days: 10, label: '2 weeks' },
  { days: 22, label: '1 month' },
  { days: 65, label: '3 months' },
];

const PROGRESS_COLOR = '#0A66C2';
const ALL_CLEAR_COLOR = '#16A34A';
const ZERO_COLOR = '#F87171';
const OVERDUE_START_COLOR = '#94A3B8';
const OVERDUE_END_COLOR = '#0A66C2';

const AXIS_TICK = { fontSize: 11, fill: '#64748B' };

const CARD = {
  border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff',
  padding: '0.85rem 1rem 0.5rem',
};

function TooltipBox({ children }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8,
      padding: '6px 9px', fontSize: '0.72rem', color: '#1E293B',
      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)', maxWidth: 280,
    }}>{children}</div>
  );
}

function ProgressTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {row.reached == null ? (
        <div style={{ color: '#64748B' }}>Not recorded (the app wasn&apos;t open)</div>
      ) : (
        <>
          <div>{row.reached} of {row.total} steps clear</div>
          {row.reachedTitle && <div style={{ color: '#475569' }}>Furthest: {row.reachedTitle}</div>}
          {row.nextTitle
            ? <div style={{ color: '#475569' }}>Stopped at: {row.nextTitle}</div>
            : <div style={{ color: '#166534', fontWeight: 600 }}>Whole ladder clear</div>}
        </>
      )}
    </TooltipBox>
  );
}

function OverdueTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {row.overdueStart == null ? (
        <div style={{ color: '#64748B' }}>Not recorded (the app wasn&apos;t open)</div>
      ) : (
        <>
          <div>Start of day: {row.overdueStart} overdue</div>
          <div>End of day: {row.overdueEnd ?? row.overdueStart} overdue</div>
        </>
      )}
    </TooltipBox>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ ...CARD, padding: '0.6rem 0.9rem', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1E293B', lineHeight: 1.3 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{sub}</div>}
    </div>
  );
}

export function ProspectingHistory({ today, maxWidth }) {
  const raw = useSyncExternalStore(subscribeHistory, historySnapshot);
  const history = useMemo(() => parseHistory(raw), [raw]);
  const [range, setRange] = useState(RANGES[1].days);
  const [showTable, setShowTable] = useState(false);

  const rows = useMemo(
    () => historyChartRows(history, workingDaysBack(today, range, history)),
    [history, today, range],
  );
  const recorded = rows.filter(r => r.recorded);
  const maxSteps = Math.max(1, ...rows.map(r => r.total || 0));
  const maxOverdue = Math.max(1, ...rows.map(r => Math.max(r.overdueStart || 0, r.overdueEnd || 0)));

  const todayRow = rows.find(r => r.iso === today);
  const allClearDays = recorded.filter(r => r.reached != null && r.reached === r.total).length;
  const avgReached = recorded.length
    ? (recorded.reduce((n, r) => n + (r.reached || 0), 0) / recorded.length).toFixed(1)
    : null;

  // Bars need a value to draw; a day with no row plots nothing at all. A
  // recorded day that cleared nothing gets a sliver rather than nothing, so
  // "stuck on step 1" and "app not opened" don't look the same.
  const progressData = rows.map(r => ({ ...r, value: r.reached === 0 ? maxSteps * 0.02 : r.reached }));
  const overdueData = rows.map(r => ({ ...r, start: r.overdueStart, end: r.overdueEnd }));

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 300px', maxWidth: 760 }}>
          Each working day is recorded while the app is open: the furthest the ladder got (a step counts
          once every step above it is clear too), and how many opps were overdue on step 1 when the day
          started and where it was left.
        </div>
        <div role="group" aria-label="Date range" style={{ display: 'flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              onClick={() => setRange(r.days)}
              aria-pressed={range === r.days}
              style={{
                padding: '3px 10px', border: 0, fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                background: range === r.days ? '#0A66C2' : '#fff', color: range === r.days ? '#fff' : '#475569',
              }}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat
          label="Today"
          value={todayRow?.reached != null ? `${todayRow.reached} of ${todayRow.total}` : '-'}
          sub={todayRow?.reached != null ? (todayRow.nextTitle ? `Next: ${todayRow.nextTitle}` : 'Whole ladder clear') : 'Not recorded yet'}
        />
        <Stat label="Average steps clear" value={avgReached ?? '-'} sub={`${recorded.length} day${recorded.length === 1 ? '' : 's'} recorded`} />
        <Stat label="Whole ladder clear" value={recorded.length ? `${allClearDays}` : '-'} sub={`of ${recorded.length} recorded day${recorded.length === 1 ? '' : 's'}`} />
        <Stat
          label="Overdue opps now"
          value={todayRow?.overdueEnd != null ? todayRow.overdueEnd : '-'}
          sub={todayRow?.overdueStart != null ? `${todayRow.overdueStart} at start of day` : 'Not recorded yet'}
        />
      </div>

      {recorded.length === 0 && (
        <div style={{ padding: '0.75rem 1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          Nothing recorded yet. Today&apos;s progress is saved as the ladder&apos;s counts load and as you mark steps
          caught up, and each working day adds a bar from here on.
        </div>
      )}

      <div style={CARD}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Steps cleared each day</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
          How far down the ladder you got. Green bars cleared the whole ladder, a red sliver cleared nothing, and an empty day wasn&apos;t recorded.
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={progressData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} domain={[0, maxSteps]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <ReferenceLine y={maxSteps} stroke="#BBF7D0" strokeDasharray="4 3" />
            <Tooltip content={<ProgressTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
            <Bar dataKey="value" name="Steps clear" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {progressData.map(r => (
                <Cell key={r.iso} fill={r.reached === 0 ? ZERO_COLOR : (r.reached != null && r.reached === r.total ? ALL_CLEAR_COLOR : PROGRESS_COLOR)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={CARD}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Step 1: overdue opps</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
          Opps due to be called (Call In 0 or less) at the start of each day and where the day was left.
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={overdueData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} domain={[0, maxOverdue]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip content={<OverdueTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
            <Legend
              iconType="square" iconSize={10} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }}
              // Bar order, not alphabetical: start of day reads first.
              itemSorter={null}
            />
            <Bar dataKey="start" name="Start of day" fill={OVERDUE_START_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="end" name="End of day" fill={OVERDUE_END_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          style={{
            padding: '3px 10px', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6,
            fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, color: '#0A66C2', cursor: 'pointer',
          }}
        >{showTable ? 'Hide table' : 'Show as a table'}</button>
        {showTable && (
          <table style={{ marginTop: 8, borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%', background: '#fff' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748B' }}>
                {['Day', 'Steps clear', 'Stopped at', 'Overdue at start', 'Overdue at end'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', borderBottom: '1px solid #E2E8F0', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map(r => (
                <tr key={r.iso} style={{ color: r.recorded ? '#1E293B' : '#94A3B8' }}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.weekday}, {r.label}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.reached != null ? `${r.reached} of ${r.total}` : '-'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.reached == null ? '-' : (r.nextTitle || 'All clear')}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.overdueStart ?? '-'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.overdueEnd ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
