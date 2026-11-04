import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { stageProgression, openOppChances, DAY_BANDS } from '../../utils/stageProgression';
import { fittedRateAxis } from '../../utils/closeRateDeepDive';
import styles from './CloseRateDeepDive.module.css';

// Same categorical order as the other Close Rates charts, one per stage.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const axisTick = { fontSize: 11, fill: '#64748B' };
// Under this many stints a figure is drawn faint in the table and left off
// the chart: one or two deals make a 0% or 100% that means nothing.
const MIN_N = 5;

const fmtPct = (v) => (v == null ? '-' : `${Math.round(v)}%`);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function writeWorkbook(fileBase, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing in this window.' }]);
    const keys = Object.keys(rows[0] || { Note: '' });
    ws['!cols'] = keys.map(k => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...rows.slice(0, 200).map(r => String(r[k] ?? '').length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${fileBase} - ${isoDay(new Date())}.xlsx`);
}

function ProgressTooltip({ active, payload, label, lines }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{label} in stage</div>
      {lines.map(l => {
        const c = point[`${l.stage}__cell`];
        if (!c || !c.n) return null;
        return (
          <div key={l.stage} className={styles.tooltipRow}>
            <span className={styles.swatch} style={{ background: l.colour }} />
            <span className={styles.tooltipName}>{l.stage} to {l.next}</span>
            <span className={styles.tooltipRate}>{fmtPct(c.rate)}</span>
            <span className={styles.tooltipCount}>{c.moved}/{c.n}</span>
          </div>
        );
      })}
      <div className={styles.muted} style={{ marginTop: 4 }}>Moved on / deals still in the stage this long</div>
    </div>
  );
}

const rateCell = (c) => {
  if (!c || !c.n) return <div className={styles.cellEmpty} title="No past deals stayed in this stage this long">-</div>;
  return (
    <div className={styles.cell} style={c.n < MIN_N ? { opacity: 0.5 } : undefined} title={`${c.moved} of ${c.n} past deals that were in this stage at least this long moved on${c.n < MIN_N ? '. Few deals: read with care' : ''}`}>
      <span className={styles.cellRate}>{fmtPct(c.rate)}</span>
      <span className={styles.cellCount}>{c.moved}/{c.n}</span>
    </div>
  );
};

/**
 * Opps > Close Rates > 6. Chance of moving to the next stage, by how long
 * the opp has been in its stage, from every finished stint in the stage
 * history (see utils/stageProgression). The chart draws one line per stage
 * across the day bands; the open opps table scores each live opp off the
 * band its days fall in.
 *
 *   records   the tab's opps, its filters already applied
 *   from/to   the tab's window, read against each stint's exit date
 */
export function StageProgression({ records, from = '', to = '', windowText = '', settings, updateSettings }) {
  const prog = useMemo(() => stageProgression(records, { from, to }), [records, from, to]);
  const open = useMemo(() => openOppChances(records, prog), [records, prog]);
  const shown = useMemo(() => prog.stages.filter(s => s.stints > 0), [prog]);
  const colourOf = useMemo(() => new Map(prog.stages.map((s, i) => [s.stage, PALETTE[i % PALETTE.length]])), [prog]);
  const [off, setOff] = useState(() => new Set());
  const [showTable, setShowTable] = useState(false);
  const lines = shown.filter(s => !off.has(s.stage)).map(s => ({ stage: s.stage, next: s.next, colour: colourOf.get(s.stage) }));

  const data = useMemo(() => DAY_BANDS.map((b, i) => {
    const point = { band: b.label };
    for (const s of shown) {
      const c = s.bands[i];
      point[s.stage] = c.n >= MIN_N ? c.rate : null;
      point[`${s.stage}__cell`] = c;
    }
    return point;
  }), [shown]);
  const yAxis = useMemo(() => fittedRateAxis(data, lines.map(l => l.stage)), [data, lines]);

  const toggle = (k) => setOff(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const bandColumns = useMemo(() => [
    {
      key: 'stage', label: 'Stage', defaultWidth: 220,
      getFilterValue: (s) => s.stage, exportValue: (s) => s.stage,
      render: (s) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={styles.swatch} style={{ background: colourOf.get(s.stage) }} />
          {s.stage} <span className={styles.muted}>to {s.next}</span>
        </span>
      ),
    },
    {
      key: 'all', label: 'Moved on (all)', defaultWidth: 130,
      getSortValue: (s) => s.rate ?? -1, exportValue: (s) => fmtPct(s.rate),
      render: (s) => rateCell({ rate: s.rate, moved: s.progressed, n: s.stints }),
    },
    {
      key: 'median', label: 'Median days to move on', defaultWidth: 170,
      getSortValue: (s) => s.medianDaysToMove ?? -1, exportValue: (s) => s.medianDaysToMove ?? '',
      render: (s) => <div className={styles.cell} title="Of the deals that moved on, half did so within this many days">{s.medianDaysToMove == null ? '-' : Math.round(s.medianDaysToMove)}</div>,
    },
    ...DAY_BANDS.map((b, i) => ({
      key: `b${i}`, label: b.label, defaultWidth: 120,
      getSortValue: (s) => s.bands[i].rate ?? -1,
      getFilterValue: (s) => fmtPct(s.bands[i].rate),
      exportValue: (s) => (s.bands[i].n ? `${fmtPct(s.bands[i].rate)} (${s.bands[i].moved}/${s.bands[i].n})` : ''),
      render: (s) => rateCell(s.bands[i]),
    })),
  ], [colourOf]);

  const openRows = useMemo(() => open.map((o, i) => ({ ...o, id: o.r._id || o.r.id || `o${i}` })), [open]);
  const openColumns = useMemo(() => [
    { key: 'account', label: 'Account', defaultWidth: 220, getFilterValue: (o) => String(o.r.Account || ''), exportValue: (o) => String(o.r.Account || ''), render: (o) => String(o.r.Account || '').trim() || '-' },
    { key: 'scope', label: 'Scope', defaultWidth: 200, getFilterValue: (o) => String(o.r.Scope || ''), exportValue: (o) => String(o.r.Scope || ''), render: (o) => o.r.Scope || '-' },
    {
      key: 'stage', label: 'Stage', defaultWidth: 160, getFilterValue: (o) => o.stage, exportValue: (o) => o.stage,
      render: (o) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={styles.swatch} style={{ background: colourOf.get(o.stage) }} />{o.stage}
        </span>
      ),
    },
    { key: 'next', label: 'Next stage', defaultWidth: 130, getFilterValue: (o) => o.next, exportValue: (o) => o.next, render: (o) => o.next },
    { key: 'days', label: 'Days in stage', defaultWidth: 120, getSortValue: (o) => o.days, getFilterValue: (o) => String(o.days), exportValue: (o) => o.days, render: (o) => <div className={styles.cell}>{o.days}</div> },
    {
      key: 'chance', label: 'Chance of moving on', defaultWidth: 160,
      getSortValue: (o) => o.rate ?? -1, getFilterValue: (o) => fmtPct(o.rate), exportValue: (o) => (o.rate == null ? '' : Math.round(o.rate)),
      render: (o) => (o.n
        ? (
          <div className={styles.cell} style={o.n < MIN_N ? { opacity: 0.5 } : undefined} title={`Of ${o.n} past ${o.stage} deals that stayed as long as this one (${o.band}), this share moved on${o.n < MIN_N ? '. Few deals: read with care' : ''}`}>
            <span className={styles.cellRate}>{fmtPct(o.rate)}</span>
          </div>
        )
        : <div className={styles.cellEmpty} title="No past deals stayed in this stage this long">-</div>),
    },
    { key: 'basis', label: 'Based on', defaultWidth: 150, getSortValue: (o) => o.n, exportValue: (o) => `${o.n} deals, ${o.band}`, render: (o) => <span className={styles.muted}>{o.n} deal{o.n === 1 ? '' : 's'} ({o.band})</span> },
  ], [colourOf]);

  const exportAll = () => writeWorkbook('Chance of moving on by days in stage', [
    {
      name: 'Chance by days in stage',
      rows: prog.stages.map(s => ({
        Stage: s.stage,
        'Next stage': s.next,
        'Past stints': s.stints,
        'Moved on': s.progressed,
        'Moved on %': s.rate == null ? '' : Math.round(s.rate),
        'Median days to move on': s.medianDaysToMove ?? '',
        ...Object.fromEntries(s.bands.flatMap(b => [[`${b.label} %`, b.rate == null ? '' : Math.round(b.rate)], [`${b.label} deals`, b.n]])),
      })),
    },
    {
      name: 'Open opps',
      rows: open.map(o => ({
        Account: String(o.r.Account || '').trim(), Scope: o.r.Scope || '', Stage: o.stage, 'Next stage': o.next,
        'Days in stage': o.days, Band: o.band, 'Chance of moving on %': o.rate == null ? '' : Math.round(o.rate), 'Based on (deals)': o.n,
      })),
    },
    {
      name: 'Details',
      rows: prog.stints.map(s => ({
        Account: String(s.r.Account || '').trim(), Scope: s.r.Scope || '', 'Stage today': String(s.r.Stage || '').trim(),
        'Stint stage': s.stage, 'Days in stage': s.days, 'Left stage on': s.exitedAt, 'Moved to': s.next,
        'Moved on': s.progressed ? 'Yes' : 'No', Band: DAY_BANDS.find((b, i) => s.days >= b.min && (i === DAY_BANDS.length - 1 || s.days < DAY_BANDS[i + 1].min))?.label || '',
      })).sort((a, b) => String(b['Left stage on']).localeCompare(String(a['Left stage on']))),
    },
  ]);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>6. Chance of moving to the next stage, by days in stage</h2>
          <div className={styles.sectionSub}>
            Of the past deals that sat in a stage at least this many days, the share that still moved on to a later stage (going back or Not Sold counts as not).
            Read from the stage history of {prog.withHistory} opp{prog.withHistory === 1 ? '' : 's'}, stints that ended {windowText || 'in any window'}.
            Points need {MIN_N}+ deals to be drawn.
          </div>
        </div>
        <div className={styles.headActions}>
          {shown.length > 0 && (
            <>
              <button type="button" className={styles.smallBtn} aria-expanded={showTable} onClick={() => setShowTable(v => !v)}>{showTable ? 'Hide table' : 'Show table'}</button>
              <button type="button" className={styles.smallBtn} onClick={exportAll} title="The chance table, the open opps scored, and a Details tab of every past stint behind it">Export Excel</button>
            </>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>No stage history in this window yet.</div>
      ) : (
        <>
          <div className={styles.legend}>
            {shown.map(s => (
              <button
                key={s.stage}
                type="button"
                className={off.has(s.stage) ? styles.legendOff : styles.legendItem}
                onClick={() => toggle(s.stage)}
                title={off.has(s.stage) ? 'Show on the chart' : 'Hide from the chart'}
              >
                <span className={styles.swatch} style={{ background: colourOf.get(s.stage) }} />
                {s.stage} to {s.next}
              </button>
            ))}
          </div>
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="band" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis domain={yAxis?.domain || [0, 100]} ticks={yAxis?.ticks || [0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip content={<ProgressTooltip lines={lines} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                {lines.map(l => (
                  <Line
                    key={l.stage}
                    dataKey={l.stage}
                    name={l.stage}
                    stroke={l.colour}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: l.colour }}
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {showTable && (
            <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(560, 132 + prog.stages.length * 37) }}>
              <DataTable
                tableId="close-rates-progress-bands"
                columns={bandColumns}
                rows={prog.stages.map(s => ({ ...s, id: s.stage }))}
                alwaysVisible={['stage']}
                emptyMessage="No stage history in this window."
                exportFileName="Chance of moving on by days in stage"
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
          )}
          <h3 className={styles.sectionTitle} style={{ fontSize: '0.9rem', margin: '0.9rem 0 0.25rem' }}>Open opps: chance of moving on from where they are now</h3>
          <div className={styles.sectionSub} style={{ marginBottom: 6 }}>
            Each open opp's days in its current stage (since it entered, else its Start Date), scored against that stage's history above. Faint figures rest on fewer than {MIN_N} deals.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(560, 132 + Math.max(1, openRows.length) * 37) }}>
            <DataTable
              tableId="close-rates-progress-open"
              columns={openColumns}
              rows={openRows}
              alwaysVisible={['account']}
              defaultSort={{ key: 'days', direction: 'desc' }}
              emptyMessage="No open opps in a pipeline stage."
              exportFileName="Open opps chance of moving on"
              settings={settings}
              updateSettings={updateSettings}
            />
          </div>
        </>
      )}
    </section>
  );
}
