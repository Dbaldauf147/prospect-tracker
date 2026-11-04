import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { stageProgression, openOppChances, DAY_BANDS } from '../../utils/stageProgression';
import { fittedRateAxis } from '../../utils/closeRateDeepDive';
import { fitMoveOnModel, scoreLikelihood, calibrationOf, modelWeights, MIN_TRAINING } from '../../utils/closeLikelihood';
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

// The two ways the chart and band table read the history.
const MODES = [
  { key: 'stage', label: 'Days in stage', title: 'How long the deal had sat in the stage' },
  { key: 'heard', label: 'Days since heard from contact', title: 'How long since we last heard from the contact when the deal left the stage' },
];

function ProgressTooltip({ active, payload, label, lines, mode }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{label} {mode === 'heard' ? 'since heard from the contact' : 'in stage'}</div>
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
      <div className={styles.muted} style={{ marginTop: 4 }}>{mode === 'heard' ? 'Moved on / deals that had gone this long without hearing back' : 'Moved on / deals still in the stage this long'}</div>
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
// Optional, from the Close Rates tab: `title` (a node, e.g. an editable
// title), `filterBar` (rendered under the header), and `lineState`
// ({ off: Set, onShown(stage, shown) }) to own the legend's on / off.
export function StageProgression({ records, from = '', to = '', windowText = '', settings, updateSettings, title, filterBar, lineState }) {
  const prog = useMemo(() => stageProgression(records, { from, to }), [records, from, to]);
  // One likelihood to close per open opp: the stage-move model (fitted to
  // the history) times each later stage's usual rate. See closeLikelihood.
  const model = useMemo(() => fitMoveOnModel(prog.stints), [prog]);
  const open = useMemo(() => scoreLikelihood(openOppChances(records, prog), prog, model), [records, prog, model]);
  const calibration = useMemo(() => calibrationOf(model, prog.stints), [model, prog]);
  const shown = useMemo(() => prog.stages.filter(s => s.stints > 0), [prog]);
  const colourOf = useMemo(() => new Map(prog.stages.map((s, i) => [s.stage, PALETTE[i % PALETTE.length]])), [prog]);
  const [ownOff, setOff] = useState(() => new Set());
  const off = lineState?.off || ownOff;
  const [showTable, setShowTable] = useState(false);
  // 'stage': by days in stage; 'heard': by days since we heard from the
  // contact when the deal left the stage.
  const [mode, setMode] = useState('stage');
  const bandsOf = (st) => (mode === 'heard' ? st.silenceBands : st.bands);
  const withSilence = prog.stages.reduce((n, st) => n + st.withSilence, 0);
  const lines = shown.filter(s => !off.has(s.stage)).map(s => ({ stage: s.stage, next: s.next, colour: colourOf.get(s.stage) }));

  const data = useMemo(() => DAY_BANDS.map((b, i) => {
    const point = { band: b.label };
    for (const s of shown) {
      const c = (mode === 'heard' ? s.silenceBands : s.bands)[i];
      point[s.stage] = c.n >= MIN_N ? c.rate : null;
      point[`${s.stage}__cell`] = c;
    }
    return point;
  }), [shown, mode]);
  const yAxis = useMemo(() => fittedRateAxis(data, lines.map(l => l.stage)), [data, lines]);

  const toggle = (k) => (lineState ? lineState.onShown(k, off.has(k)) : setOff(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  }));

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
      key: `b${i}`, label: mode === 'heard' ? `${b.label} silent` : b.label, defaultWidth: 120,
      getSortValue: (s) => bandsOf(s)[i].rate ?? -1,
      getFilterValue: (s) => fmtPct(bandsOf(s)[i].rate),
      exportValue: (s) => (bandsOf(s)[i].n ? `${fmtPct(bandsOf(s)[i].rate)} (${bandsOf(s)[i].moved}/${bandsOf(s)[i].n})` : ''),
      render: (s) => rateCell(bandsOf(s)[i]),
    })),
  // bandsOf reads `mode`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [colourOf, mode]);

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
    {
      key: 'likelihood', label: 'Likelihood to close', defaultWidth: 150,
      getSortValue: (o) => o.likelihood ?? -1, getFilterValue: (o) => fmtPct(o.likelihood == null ? null : o.likelihood * 100),
      exportValue: (o) => (o.likelihood == null ? '' : Math.round(o.likelihood * 100)),
      render: (o) => {
        if (o.likelihood == null) return <div className={styles.cellEmpty} title={`Needs ${MIN_TRAINING}+ past stage moves to learn from`}>-</div>;
        const pct = o.likelihood * 100;
        const tone = pct >= 40 ? '#15803D' : pct >= 15 ? '#B45309' : '#B91C1C';
        const why = [
          `Moves on from ${o.stage}: ${fmtPct(o.moveOn * 100)} (${o.days} day${o.days === 1 ? '' : 's'} in stage, ${o.silence == null ? 'never heard from' : `${o.silence} day${o.silence === 1 ? '' : 's'} since heard from`})`,
          ...o.steps.slice(1).map(st => `then ${st.stage} to ${st.next}: ${fmtPct(st.chance * 100)} (usual rate)`),
          `= ${fmtPct(pct)} to close`,
        ].join('\n');
        return (
          <div className={styles.cell} title={why}>
            <span className={styles.cellRate} style={{ color: tone }}>{fmtPct(pct)}</span>
            <span className={styles.cellCount}>{fmtPct(o.moveOn * 100)} next</span>
          </div>
        );
      },
    },
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
    { key: 'contact', label: 'Contact (starred)', defaultWidth: 160, getFilterValue: (o) => o.contact, exportValue: (o) => o.contact, render: (o) => o.contact || <span className={styles.muted}>-</span> },
    {
      key: 'silence', label: 'Days since heard from', defaultWidth: 160,
      getSortValue: (o) => o.silence ?? -1, getFilterValue: (o) => (o.silence == null ? '' : String(o.silence)), exportValue: (o) => o.silence ?? '',
      render: (o) => {
        if (o.silence == null) return <div className={styles.cellEmpty} title="No Last Client Heard From Us date on this opp">-</div>;
        const late = o.usualGap != null && o.silence > o.usualGap;
        return (
          <div className={styles.cell} style={late ? { color: '#B91C1C' } : undefined} title={late ? `Longer than their usual ${Math.round(o.usualGap)} days` : undefined}>
            {o.silence}
          </div>
        );
      },
    },
    {
      key: 'usual', label: 'Usual gap', defaultWidth: 100,
      getSortValue: (o) => o.usualGap ?? -1, exportValue: (o) => (o.usualGap == null ? '' : Math.round(o.usualGap)),
      render: (o) => <div className={styles.cell} title="The contact's median days between replies so far">{o.usualGap == null ? '-' : Math.round(o.usualGap)}</div>,
    },
    {
      key: 'silenceChance', label: 'Chance (by silence)', defaultWidth: 160,
      getSortValue: (o) => o.silenceRate ?? -1, getFilterValue: (o) => fmtPct(o.silenceRate), exportValue: (o) => (o.silenceRate == null ? '' : Math.round(o.silenceRate)),
      render: (o) => (o.silenceN
        ? (
          <div className={styles.cell} style={o.silenceN < MIN_N ? { opacity: 0.5 } : undefined} title={`Of ${o.silenceN} past ${o.stage} deals that had gone at least as long without hearing back (${o.silenceBand}), this share moved on${o.silenceN < MIN_N ? '. Few deals: read with care' : ''}`}>
            <span className={styles.cellRate}>{fmtPct(o.silenceRate)}</span>
            <span className={styles.cellCount}>{o.silenceN}</span>
          </div>
        )
        : <div className={styles.cellEmpty} title={o.silence == null ? 'No heard-from date on this opp' : 'No past deals in this stage went this long without hearing back'}>-</div>),
    },
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
      name: 'Chance by days silent',
      rows: prog.stages.map(s => ({
        Stage: s.stage,
        'Next stage': s.next,
        'Past stints with a heard-from date': s.withSilence,
        ...Object.fromEntries(s.silenceBands.flatMap(b => [[`${b.label} silent %`, b.rate == null ? '' : Math.round(b.rate)], [`${b.label} silent deals`, b.n]])),
      })),
    },
    {
      name: 'Open opps',
      rows: open.map(o => ({
        Account: String(o.r.Account || '').trim(), Scope: o.r.Scope || '', Stage: o.stage, 'Next stage': o.next,
        'Days in stage': o.days, Band: o.band, 'Chance of moving on %': o.rate == null ? '' : Math.round(o.rate), 'Based on (deals)': o.n,
        'Likelihood to close %': o.likelihood == null ? '' : Math.round(o.likelihood * 100),
        'Chance of moving on now (model) %': o.moveOn == null ? '' : Math.round(o.moveOn * 100),
        'How it multiplies': o.steps.map(st => `${st.stage} to ${st.next} ${Math.round(st.chance * 100)}%${st.from === 'model' ? ' (model)' : ''}`).join(' x '),
        'Contact (starred)': o.contact, 'Days since heard from': o.silence ?? '', 'Usual gap (days)': o.usualGap == null ? '' : Math.round(o.usualGap),
        'Chance by silence %': o.silenceRate == null ? '' : Math.round(o.silenceRate), 'Silence based on (deals)': o.silenceN,
      })),
    },
    {
      name: 'Model check',
      rows: [
        ...calibration.map(c => ({ Item: `Past stage moves it scored ${c.label}`, 'Stage moves': c.n, 'It said (avg)': c.predicted == null ? '' : `${Math.round(c.predicted * 100)}%`, 'Moved on': c.actual == null ? '' : `${Math.round(c.actual * 100)}%` })),
        ...modelWeights(model).map(w => ({ Item: `Weight: ${w.Input}`, 'Stage moves': '', 'It said (avg)': w.Weight, 'Moved on': w.Weight > 0 ? 'pushes up' : w.Weight < 0 ? 'pushes down' : '' })),
        { Item: 'Learned from', 'Stage moves': model ? model.trainedOn : 0, 'It said (avg)': '', 'Moved on': '' },
      ],
    },
    {
      name: 'Details',
      rows: prog.stints.map(s => ({
        Account: String(s.r.Account || '').trim(), Scope: s.r.Scope || '', 'Stage today': String(s.r.Stage || '').trim(),
        'Stint stage': s.stage, 'Days in stage': s.days, 'Left stage on': s.exitedAt, 'Moved to': s.next,
        'Moved on': s.progressed ? 'Yes' : 'No', 'Days since heard from at exit': s.silence ?? '', Band: DAY_BANDS.find((b, i) => s.days >= b.min && (i === DAY_BANDS.length - 1 || s.days < DAY_BANDS[i + 1].min))?.label || '',
      })).sort((a, b) => String(b['Left stage on']).localeCompare(String(a['Left stage on']))),
    },
  ]);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{title || '6. Chance of moving to the next stage, by days in stage'}</h2>
          <div className={styles.sectionSub}>
            Of the past deals that sat in a stage at least this many days, the share that still moved on to a later stage (going back or Not Sold counts as not).
            Read from the stage history of {prog.withHistory} opp{prog.withHistory === 1 ? '' : 's'}, stints that ended {windowText || 'in any window'}.
            Points need {MIN_N}+ deals to be drawn.
            {mode === 'heard' && <> By days since heard from: how long it had been since we last heard from the contact when the deal left the stage ({withSilence} past stint{withSilence === 1 ? '' : 's'} have a heard-from date to go on).</>}
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
      {filterBar}

      {shown.length === 0 ? (
        <div className={styles.empty}>No stage history in this window yet.</div>
      ) : (
        <>
          <div className={styles.group} role="group" aria-label="Measure by" style={{ marginBottom: 6 }}>
            {MODES.map(m => (
              <button key={m.key} type="button" title={m.title} className={mode === m.key ? styles.toggleOn : styles.toggle} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          {mode === 'heard' && withSilence === 0 && (
            <div className={styles.empty}>No past deals have a heard-from date before they left a stage yet. This fills in as Last Client Heard From Us dates are logged.</div>
          )}
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
                <Tooltip content={<ProgressTooltip lines={lines} mode={mode} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
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
          <h3 className={styles.sectionTitle} style={{ fontSize: '0.9rem', margin: '0.9rem 0 0.25rem' }}>Open opps: likelihood to close</h3>
          <div className={styles.sectionSub} style={{ marginBottom: 4 }}>
            {model ? (
              <>
                <strong>Likelihood to close</strong> = the chance it moves on from its stage now, times each later stage's usual rate up to Sold.
                The first step comes from a model of {model.trainedOn} past stage moves, which weighs the stage, days in stage, days since heard from the contact and the opp's age by how much each mattered before. Hover a score for the steps.
                {(() => {
                  const filled = calibration.filter(c => c.n >= 10);
                  return filled.length >= 2
                    ? <> Check of that first step on past deals: {filled.map(c => `scored ${c.label}, ${Math.round(c.actual * 100)}% moved on`).join('; ')}.</>
                    : null;
                })()}
              </>
            ) : (
              <>Likelihood to close needs at least {MIN_TRAINING} past stage moves with both outcomes to learn from; {prog.stints.length} so far.</>
            )}
          </div>
          <div className={styles.sectionSub} style={{ marginBottom: 6 }}>
            Each open opp's days in its current stage (since it entered, else its Start Date), scored against that stage's history above. Days since heard from is from Last Client Heard From Us (red when longer than the starred contact's usual gap), and Chance (by silence) scores that against past deals in the same stage. Faint figures rest on fewer than {MIN_N} deals.
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
