import { LiveValue, LiveValueProvider } from '../common/LiveValue';
import { closeRateRows } from '../common/liveValueBreakdown';
import { STAGE_FILL, STAGE_FILL_DEFAULT } from '../PipelineView/funnelPalette';
import styles from './CloseRateTrend.module.css';

// Close rate by stage, month by month — the funnel's close rates with the
// time axis put back.
//
// The funnel directly above this draws one close rate per stage, on a
// rolling 365-day window. That answers "what is our close rate" and hides
// the only thing a weekly report is for: whether it is moving. This is the
// same numbers, same signals, same exclusions, cut into calendar months.
//
// A table rather than a multi-line chart, for two reasons. The denominators
// are small — a stage can close three deals in a month — so a rate with no
// count beside it is a number nobody can weigh, and only a table has room
// for both. And five series over six points is past the count where lines
// stay tellable apart; the honest form is small multiples, one single-series
// sparkline per row, which is what the Trend column holds.
//
// Every rate in the grid is hoverable, the same way the Pipeline metrics
// table's close rates are and through the same component: the panel names
// the formula, the sold / not-sold split and the deals themselves, and a
// click pins it so the list can be scrolled or exported. A rate here is
// three or four deals as often as not, and "which ones" is the first
// question anybody asks of a number that moved.

const PLOT_W = 88;
const PLOT_H = 34;
// Room for the end dot's surface ring at the extremes of the scale.
const PAD = 4;

const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * One row's shape as a sparkline: six months of close rate on a fixed
 * 0–100% scale.
 *
 * The scale is fixed rather than fitted to the row, because these are small
 * multiples: a row auto-scaled to its own range would draw a stage that
 * wobbled between 60% and 65% with the same dramatic zigzag as one that
 * collapsed from 80% to 10%, and the reader compares rows by shape.
 *
 * Months with no closed deal break the line rather than interpolating
 * across it. A stage that closed nothing in April did not "pass through
 * 45% in April", and a line drawn straight over the gap says it did.
 */
function Sparkline({ cells, months, color, label }) {
  const points = cells.map((cell, i) => (cell === null ? null : {
    x: PAD + (cells.length === 1 ? (PLOT_W - PAD * 2) / 2 : (i * (PLOT_W - PAD * 2)) / (cells.length - 1)),
    y: PAD + (1 - cell.rate) * (PLOT_H - PAD * 2),
    rate: cell.rate,
    month: months[i]?.label || '',
  }));

  // Runs of consecutive months that actually have a rate. A run of one is a
  // lone dot; anything longer is drawn as a line.
  const runs = [];
  let run = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);

  const last = [...points].reverse().find(Boolean);
  const drawn = points.filter(Boolean).length;

  if (drawn === 0) {
    return <span className={styles.sparkEmpty} title={`${label}: nothing closed in this window.`}>—</span>;
  }

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      width={PLOT_W}
      height={PLOT_H}
      role="img"
      aria-label={`${label}: ${points.map(p => (p ? `${p.month} ${pct(p.rate)}` : null)).filter(Boolean).join(', ')}`}
    >
      {/* The 0% floor, so a low run reads as low rather than as "near the
          bottom of whatever this box is". Hairline, solid, one step off the
          surface — chrome, not data. */}
      <line
        x1={0} y1={PLOT_H - PAD} x2={PLOT_W} y2={PLOT_H - PAD}
        stroke="#e2e8f0" strokeWidth="1"
      />
      {runs.filter(r => r.length > 1).map((r) => (
        <polyline
          key={`${r[0].x}-${r.length}`}
          points={r.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* A month standing on its own has no line to appear in, so it gets a
          dot — otherwise a stage that closed deals in two separate months
          would draw as nothing at all. */}
      {runs.filter(r => r.length === 1).map(r => (
        <circle key={`d${r[0].x}`} cx={r[0].x} cy={r[0].y} r="2.5" fill={color} />
      ))}
      {/* Where it ends up. Ringed in the surface colour so it stays legible
          where it sits on the line or the floor. */}
      {last && (
        <circle cx={last.x} cy={last.y} r="4" fill={color} stroke="#fff" strokeWidth="2" />
      )}
    </svg>
  );
}

/**
 * What one figure in this grid is made of, as the hover panel reads it.
 *
 * The same shape the Pipeline metrics table hands its close-rate cells (see
 * components/common/LiveValue): the arithmetic, its two inputs, and the
 * closed opps themselves, newest first. `window` is the phrase that says
 * WHICH deals — "closed in Apr", "closed in the last 365 days" — because
 * the three columns that use this differ in nothing else.
 */
function closeRateBreakdown({ tally, row, windowLabel, windowPhrase }) {
  const total = tally.sold + tally.notSold;
  return {
    title: `${row.short}: Close Rate — ${windowLabel}`,
    value: `${pct(tally.rate)}  (${tally.sold}/${total})`,
    formula: row.signal
      ? `Sold ÷ (Sold + Not Sold), over opps ${windowPhrase} that reached this stage (signal: ${row.signal}) with a Scope without "pull through".`
      : `Sold ÷ (Sold + Not Sold), over every opp ${windowPhrase}, whatever stage it reached, with a Scope without "pull through".`,
    inputs: [
      { label: 'Sold', value: tally.sold },
      { label: 'Not Sold', value: tally.notSold },
      { label: 'Close rate', value: pct(tally.rate) },
    ],
    rows: closeRateRows(tally.included, `Opps ${windowPhrase} (newest close first)`),
    note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
    // Names the export file after this table rather than the pipeline
    // dashboard the panel came from.
    filePrefix: 'close-rate',
  };
}

/** One month's cell: the rate, with the count it rests on underneath. */
function RateCell({ cell, row, month }) {
  if (cell === null) {
    return (
      <td className={styles.cellEmpty} title={`${row.short}: nothing closed in ${month.label}. No evidence isn’t a 0% rate, so this is blank rather than zero.`}>
        —
      </td>
    );
  }
  const total = cell.sold + cell.notSold;
  return (
    <td className={styles.cell}>
      <LiveValue
        id={`crt-${row.key}-${month.key}`}
        className={styles.cellLive}
        title={`${row.short}, ${month.label}: ${cell.sold} sold and ${cell.notSold} not sold of ${total} closed — ${pct(cell.rate)}.`}
        breakdown={closeRateBreakdown({
          tally: cell,
          row,
          windowLabel: month.label,
          windowPhrase: `closed in ${month.label}`,
        })}
      >
        <span className={styles.cellRate}>{pct(cell.rate)}</span>
        {/* The denominator, always. A close rate off three deals and one off
            thirty look identical without it, and only one of them is worth
            reacting to in a weekly report. */}
        <span className={styles.cellCount}>{cell.sold}/{total}</span>
      </LiveValue>
    </td>
  );
}

/**
 * One of the two aggregate columns at the right: a rate with the count
 * under it, or a dash.
 *
 * Shared by both because they are the same figure over different windows,
 * and two copies of this markup is how they'd end up formatting the same
 * number two ways.
 */
function TotalCell({ tally, row, id, title, windowLabel, windowPhrase, strong, better, betterBy }) {
  if (tally === null) {
    return <td className={styles.overallCell}><span className={styles.cellEmptyInline}>—</span></td>;
  }
  const total = tally.sold + tally.notSold;
  const cls = [
    strong ? styles.rollingCell : styles.overallCell,
    better ? styles.cellBetter : '',
  ].filter(Boolean).join(' ');
  return (
    <td className={cls}>
      {/* An inset chip rather than a fill on the cell itself: green cells
          stack down this column, and edge-to-edge backgrounds on adjacent
          rows merge into one tall block that reads as a single highlighted
          region. The chip leaves a gap in the surface colour between them,
          and keeps the row rules on the cell where they belong. */}
      <LiveValue
        id={id}
        className={better ? styles.betterChip : styles.cellLive}
        title={better
          ? `${title} ${tally.sold} sold of ${total} closed — ${pct(tally.rate)}, ${betterBy} points above the rolling year. The recent months are running ahead of it.`
          : `${title} ${tally.sold} sold of ${total} closed — ${pct(tally.rate)}.`}
        breakdown={closeRateBreakdown({ tally, row, windowLabel, windowPhrase })}
      >
        <span className={styles.cellRate}>
          {/* The arrow, not just the green. A status colour on its own is
              unreadable to anyone who can't separate it from the ink beside
              it, and this cell has no legend to fall back on. */}
          {better && <span className={styles.betterArrow} aria-hidden="true">▲</span>}
          {pct(tally.rate)}
        </span>
        <span className={styles.cellCount}>{tally.sold}/{total}</span>
        {better && <span className={styles.srOnly}> — ahead of the rolling year</span>}
      </LiveValue>
    </td>
  );
}

/**
 * Is the six months shown running ahead of the trailing year?
 *
 * Compared on the ROUNDED figures, the ones actually printed. Two cells
 * both reading 46% must not have one of them green because the numbers
 * behind them differ in the first decimal — a cue the reader can't check
 * against what's on the page is worse than no cue.
 */
function aheadOfYear(overall, rolling12) {
  if (!overall || !rolling12) return null;
  const six = Math.round(overall.rate * 100);
  const year = Math.round(rolling12.rate * 100);
  return six > year ? six - year : null;
}

export function CloseRateTrend({ trend }) {
  const { months, rows, closed, closedRolling } = trend;
  // Nothing in the months shown AND nothing in the trailing year: only then
  // is there no table. A book that closed nothing since the spring still has
  // a 12-month rate worth printing, and the grid says so with dashes.
  if (!closed && !closedRolling) {
    return (
      <div className={styles.empty}>
        No deals closed in the last 12 months, or the Opps cache is empty.
        Open <strong>Opps</strong> so this year’s closes are cached and the trend can be drawn.
      </div>
    );
  }

  return (
    // The table's own box doubles as the region the breakdown panels belong
    // to, so a click anywhere in it unpins one — the same gesture as on the
    // Pipeline tab, because it is the same component.
    <LiveValueProvider className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.stageHead} scope="col">Stage reached</th>
            {months.map(m => (
              <th key={m.key} className={styles.monthHead} scope="col">{m.label}</th>
            ))}
            <th className={styles.trendHead} scope="col">Trend</th>
            <th className={styles.overallHead} scope="col" title={`The ${months.length} months shown, added together.`}>
              {months.length} mo
            </th>
            {/* The trailing year — the same rolling-365-day figure the funnel
                above draws and Pipeline Metrics prints, so the row ends on a
                number that can be checked against both. It reaches back
                further than the columns to its left, which is the point: it
                is what the recent months are a departure from. */}
            <th className={styles.rollingHead} scope="col" title="A rolling 365 days to today — the same window the pipeline funnel and Pipeline Metrics use for Close Rate, so this figure matches theirs. Reaches further back than the months on the left.">
              12 mo
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // The stage's own colour from the funnel above, so a stage is
            // the same blue in both pictures. The total row is deliberately
            // outside that ramp — it isn't a stage.
            const color = row.num ? (STAGE_FILL[row.num] || STAGE_FILL_DEFAULT) : '#64748b';
            // Points the recent half-year is running above the rolling
            // year, or null when it isn't ahead. Green marks the good
            // direction only; a row that has slipped is left in plain ink
            // rather than painted red, because a close rate below its own
            // year average is normal noise, not a fault to flag.
            const ahead = aheadOfYear(row.overall, row.rolling12);
            return (
              <tr key={row.key} className={row.num ? undefined : styles.totalRow}>
                <th scope="row" className={styles.stageCell}>
                  <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <RateCell key={months[i].key} cell={cell} row={row} month={months[i]} />
                ))}
                <td className={styles.trendCell}>
                  <Sparkline cells={row.cells} months={months} color={color} label={row.short} />
                </td>
                <TotalCell
                  tally={row.overall}
                  row={row}
                  id={`crt-${row.key}-overall`}
                  better={ahead !== null}
                  betterBy={ahead}
                  title={`${row.short}, across the ${months.length} months shown:`}
                  windowLabel={`the ${months.length} months shown`}
                  windowPhrase={`closed in the ${months.length} months shown`}
                />
                <TotalCell
                  tally={row.rolling12}
                  row={row}
                  id={`crt-${row.key}-rolling12`}
                  strong
                  title={`${row.short}, rolling 365 days:`}
                  windowLabel="rolling 365 days"
                  windowPhrase="closed in the last 365 days"
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.note}>
        A deal counts toward every stage it reached, so Stage 3&rsquo;s denominator is the widest and
        Stage 6&rsquo;s the narrowest, and the rates aren&rsquo;t meant to add up. Pull-through opps are
        left out. Each month is the deals whose <strong>Close Date</strong> falls in it; a month a
        stage closed nothing is blank, not 0%. <strong>{months.length} mo</strong> adds up the months
        shown; <strong>12 mo</strong> is a rolling 365 days, the same window the funnel above uses, so it
        reaches back past the first column. A <strong>6 mo</strong> figure in green with a ▲ is
        running above the rolling year — the recent months are better than the run rate behind them.
        Hover any rate for the deals behind it; click to pin that panel open, then
        <strong> ⬇ Excel</strong> to take the full list away.
      </div>
    </LiveValueProvider>
  );
}

export default CloseRateTrend;
