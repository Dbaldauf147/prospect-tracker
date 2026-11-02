import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { stageReachByPeriod, REACH_STAGES } from '../../utils/stageReach';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// The same validated categorical order the Not Sold trend uses, one hue
// per stage. Seven stages, eight colours, so nothing folds into grey.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const COLOUR = Object.fromEntries(REACH_STAGES.map((s, i) => [s, PALETTE[i]]));
const GRID = '#E2E8F0';
const AXIS_TEXT = '#64748B';

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

const fmtPct = (v) => (v == null ? '-' : `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`);

// The hover for one period: its cohort size and each visible stage's
// count and share.
function ReachTooltip({ active, payload, hidden }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.75rem', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 200 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        {row.label} <span style={{ ...muted, fontWeight: 400 }}>· {row.total} opp{row.total === 1 ? '' : 's'} started</span>
      </div>
      {row.total === 0 && <div style={muted}>No opps started in this period</div>}
      {row.total > 0 && REACH_STAGES.filter(s => !hidden.has(s)).map(s => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOUR[s] }} />
          <span style={{ flex: 1 }}>{s}</span>
          <span style={muted}>{row[`${s}__n`]}</span>
          <span style={{ fontWeight: 600, minWidth: 44, textAlign: 'right' }}>{fmtPct(row[s])}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Opps > Days in Stage > Stage Reach.
 *
 * Of the opps that started in each month / quarter / year, the share that
 * got at least as far as each stage. One line per stage, so you can see
 * whether conversion to Quoted (say) is improving cohort over cohort, and a
 * period-by-period table underneath with the cohort sizes the percentages
 * are taken of. The rules (furthest stage reached, which opps are left
 * out) live in utils/stageReach.js.
 */
export function StageReach({ records, settings, updateSettings }) {
  const [period, setPeriod] = useState('quarter');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Stages switched off from the legend.
  const [hidden, setHidden] = useState(() => new Set());

  const data = useMemo(
    () => stageReachByPeriod(records, { period, from, to }),
    [records, period, from, to],
  );

  const chartData = useMemo(() => data.rows.map(r => ({
    key: r.key, label: r.label, total: r.total,
    ...Object.fromEntries(REACH_STAGES.map(s => [s, r.pct[s]])),
    ...Object.fromEntries(REACH_STAGES.map(s => [`${s}__n`, r.reached[s]])),
  })), [data]);

  const tableRows = useMemo(() => {
    const rows = data.rows.slice().reverse().map(r => ({ id: r.key, ...r }));
    if (data.counted > 0) rows.push({ id: '__all', key: '__all', label: 'All periods', ...data.overall, isTotal: true });
    return rows;
  }, [data]);

  const columns = useMemo(() => {
    const cols = [
      {
        key: 'label',
        label: 'Started',
        defaultWidth: 120,
        getSortValue: (row) => (row.isTotal ? '9999' : row.key),
        render: (row) => <span style={{ fontWeight: row.isTotal ? 700 : 400 }}>{row.label}</span>,
      },
      {
        key: 'total',
        label: 'Opps',
        defaultWidth: 80,
        getSortValue: (row) => row.total,
        getFilterValue: (row) => String(row.total),
        exportValue: (row) => row.total,
        render: (row) => <div style={{ textAlign: 'right', fontWeight: row.isTotal ? 700 : 400 }}>{row.total}</div>,
      },
    ];
    for (const s of REACH_STAGES) {
      cols.push({
        key: `reach:${s}`,
        label: s,
        defaultWidth: 110,
        getSortValue: (row) => row.pct[s] ?? -1,
        getFilterValue: (row) => fmtPct(row.pct[s]),
        exportValue: (row) => fmtPct(row.pct[s]),
        renderHeader: (label) => (
          <span title={`Share of the period's opps that got at least as far as ${s}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOUR[s], flexShrink: 0 }} />
            {label}
          </span>
        ),
        render: (row) => (
          <div
            title={row.total ? `${row.reached[s]} of ${row.total} opps` : 'No opps started in this period'}
            style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: row.isTotal ? 700 : 400, ...(row.pct[s] == null ? muted : null) }}
          >{fmtPct(row.pct[s])}</div>
        ),
      });
    }
    return cols;
  }, []);

  const toggleStage = (s) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const leftOut = [
    data.unknown ? `${data.unknown} Not Sold opp${data.unknown === 1 ? '' : 's'} with no stage history (we can't tell how far they got)` : '',
    data.undated ? `${data.undated} with no Start Date` : '',
    data.pullThrough ? `${data.pullThrough} pull-through${data.pullThrough === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingBottom: '1.25rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <span className={styles.notSoldYears}>
          <span className={styles.filterLabel} style={{ marginRight: 2 }}>Group by start</span>
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
        {(from || to) && (
          <button type="button" className={styles.notSoldYear} onClick={() => { setFrom(''); setTo(''); }}>Clear dates</button>
        )}
      </div>

      <div style={{ fontSize: '0.72rem', ...muted }}>
        Each period is the opps that started in it (by Start Date); a stage&rsquo;s line is the share of them that got at least that far, now or at any point in their stage history.
        Recent periods are still in progress, so their later stages will keep rising.
        {leftOut.length > 0 && <> Left out: {leftOut.join(', ')}.</>}
      </div>

      {/* Legend doubles as the line toggle. */}
      <div className={styles.notSoldYears} style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {REACH_STAGES.map(s => {
          const off = hidden.has(s);
          return (
            <button
              key={s}
              type="button"
              className={styles.notSoldYear}
              onClick={() => toggleStage(s)}
              title={off ? `Show ${s}` : `Hide ${s}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: off ? 0.45 : 1, textDecoration: off ? 'line-through' : 'none' }}
            >
              <span style={{ width: 12, height: 3, borderRadius: 2, background: COLOUR[s] }} />
              {s}
              <span style={{ fontWeight: 400, opacity: 0.8 }}>{fmtPct(data.overall.pct[s])}</span>
            </button>
          );
        })}
      </div>

      {data.counted === 0 ? (
        <div style={{ padding: '2rem 0', textAlign: 'center', ...muted }}>No opps with a Start Date in this window.</div>
      ) : (
        <div style={{ height: 320, background: '#fff', border: `1px solid ${GRID}`, borderRadius: 6, padding: '8px 8px 0' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS_TEXT }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10, fill: AXIS_TEXT }} tickLine={false} axisLine={false} width={40} tickFormatter={v => `${v}%`} />
              <Tooltip content={<ReachTooltip hidden={hidden} />} cursor={{ stroke: AXIS_TEXT, strokeDasharray: '3 3' }} />
              {REACH_STAGES.filter(s => !hidden.has(s)).map(s => (
                <Line
                  key={s}
                  type="linear"
                  dataKey={s}
                  name={s}
                  stroke={COLOUR[s]}
                  strokeWidth={2}
                  dot={{ r: 2.5, strokeWidth: 0, fill: COLOUR[s] }}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* DataTable's scroll body is flex: 1 1 0, so it needs a parent with a
          height. Sized to the rows (capped) so a short table doesn't leave
          a tall empty box under it. */}
      <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(640, 140 + tableRows.length * 36) }}>
      <DataTable
        tableId="opps2-stage-reach"
        columns={columns}
        rows={tableRows}
        alwaysVisible={['label']}
        emptyMessage="No opps with a Start Date in this window."
        exportFileName="Stage reach"
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
