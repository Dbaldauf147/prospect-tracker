// Contacts > History: how many contacts sit on the Key, Client and Key
// Prospect rosters, week by week.
//
// The rosters are live lists, so this reads the weekly log App keeps of
// their counts (utils/contactCountHistory, written by
// useContactCountRecorder) rather than anything it works out itself. The
// counts are the All Contacts Totals pills' own numbers at the time.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  COUNTED_ROSTERS, countChanges, countHistoryRows, countHistorySnapshot, parseCountHistory, subscribeCountHistory,
} from '../../utils/contactCountHistory';
import { weekKeyAt } from '../../utils/weeklyReportTrends';

const RANGES = [
  { weeks: 8, label: '8 weeks' },
  { weeks: 26, label: '6 months' },
  { weeks: 52, label: '1 year' },
];

// The hues of the Totals pills (contactRosters ROSTER_CATEGORIES), deepened
// enough to read as a line.
const SERIES = {
  key: { label: 'Key', color: '#D97706' },
  client: { label: 'Client', color: '#2563EB' },
  keyProspect: { label: 'Key Prospect', color: '#7C3AED' },
};

const AXIS_TICK = { fontSize: 11, fill: '#64748B' };
const CARD = {
  border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff',
  padding: '0.85rem 1rem 0.5rem',
};

function CountTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8,
      padding: '6px 9px', fontSize: '0.72rem', color: '#1E293B',
      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
    }}>
      <div style={{ fontWeight: 700 }}>Week of {row.label}</div>
      {!row.recorded ? (
        <div style={{ color: '#64748B' }}>Not recorded (the app wasn&apos;t opened that week)</div>
      ) : COUNTED_ROSTERS.map(k => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: SERIES[k].color, display: 'inline-block' }} />
          <span style={{ color: '#475569' }}>{SERIES[k].label}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, paddingLeft: 12 }}>{row[k] ?? '-'}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ rosterKey, latest, change }) {
  const s = SERIES[rosterKey];
  let sub = 'Not recorded yet';
  if (latest != null && !change) sub = 'One week recorded so far';
  if (change) {
    sub = change.delta === 0
      ? `No change since ${change.since}`
      : `${change.delta > 0 ? 'Up' : 'Down'} ${Math.abs(change.delta)} since ${change.since} (from ${change.from})`;
  }
  return (
    <div style={{ ...CARD, padding: '0.6rem 0.9rem', minWidth: 150, flex: '1 1 150px', borderTop: `3px solid ${s.color}` }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8' }}>{s.label} contacts</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1E293B', lineHeight: 1.3 }}>{latest ?? '-'}</div>
      {/* Not coloured good or bad: a Key Prospect roster that shrinks may
          just be prospects turning into opps. */}
      <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{sub}</div>
    </div>
  );
}

export function ContactHistoryView() {
  const raw = useSyncExternalStore(subscribeCountHistory, countHistorySnapshot);
  const history = useMemo(() => parseCountHistory(raw), [raw]);
  // 8 weeks to start: the log only begins the week this tab shipped, so a
  // longer default would open on a mostly empty chart for months.
  const [range, setRange] = useState(RANGES[0].weeks);
  const [showTable, setShowTable] = useState(false);

  // Read once when the tab opens: the chart ends on the week it was opened in.
  const [thisWeek] = useState(() => weekKeyAt(Date.now()));
  const rows = useMemo(() => countHistoryRows(history, thisWeek, range), [history, thisWeek, range]);
  const recorded = rows.filter(r => r.recorded);
  const changes = useMemo(() => countChanges(rows), [rows]);
  const latestOf = (k) => {
    const r = [...rows].reverse().find(x => x[k] != null);
    return r ? r[k] : null;
  };

  return (
    <div style={{ padding: '0.25rem 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 300px', maxWidth: 760 }}>
          How many contacts are on the Key, Client and Key Prospect rosters each week. The counts are the ones the
          All tab&apos;s Totals pills show, recorded automatically while the app is open. The latest reading in a week
          is the one that week keeps.
        </div>
        <div role="group" aria-label="Date range" style={{ display: 'flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
          {RANGES.map(r => (
            <button
              key={r.weeks}
              type="button"
              onClick={() => setRange(r.weeks)}
              aria-pressed={range === r.weeks}
              style={{
                padding: '3px 10px', border: 0, fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                background: range === r.weeks ? '#0A66C2' : '#fff', color: range === r.weeks ? '#fff' : '#475569',
              }}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        {COUNTED_ROSTERS.map(k => <Stat key={k} rosterKey={k} latest={latestOf(k)} change={changes[k]} />)}
      </div>

      {recorded.length === 0 && (
        <div style={{ padding: '0.75rem 1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          Nothing recorded yet. This week&apos;s counts are saved a few seconds after your contacts, accounts and
          opps finish loading, and each week adds a point from here on.
        </div>
      )}

      <div style={CARD}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Contacts on each roster</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
          One point per recorded week. A week the app wasn&apos;t opened has no point, and the line joins across it.
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip content={<CountTooltip />} cursor={{ stroke: '#CBD5E1' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }} itemSorter={null} />
            {COUNTED_ROSTERS.map(k => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                name={SERIES[k].label}
                stroke={SERIES[k].color}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES[k].color, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
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
                {['Week of', ...COUNTED_ROSTERS.map(k => SERIES[k].label)].map(h => (
                  <th key={h} style={{ padding: '4px 8px', borderBottom: '1px solid #E2E8F0', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map(r => (
                <tr key={r.week} style={{ color: r.recorded ? '#1E293B' : '#94A3B8' }}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.label}</td>
                  {COUNTED_ROSTERS.map(k => (
                    <td key={k} style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r[k] ?? '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
