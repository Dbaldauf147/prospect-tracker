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

/** One month's cell: the rate, with the count it rests on underneath. */
function RateCell({ cell, stageLabel, monthLabel }) {
  if (cell === null) {
    return (
      <td className={styles.cellEmpty} title={`${stageLabel}: nothing closed in ${monthLabel}. No evidence isn’t a 0% rate, so this is blank rather than zero.`}>
        —
      </td>
    );
  }
  const total = cell.sold + cell.notSold;
  return (
    <td
      className={styles.cell}
      title={`${stageLabel}, ${monthLabel}: ${cell.sold} sold and ${cell.notSold} not sold of ${total} closed — ${pct(cell.rate)}.`}
    >
      <span className={styles.cellRate}>{pct(cell.rate)}</span>
      {/* The denominator, always. A close rate off three deals and one off
          thirty look identical without it, and only one of them is worth
          reacting to in a weekly report. */}
      <span className={styles.cellCount}>{cell.sold}/{total}</span>
    </td>
  );
}

export function CloseRateTrend({ trend }) {
  const { months, rows, closed } = trend;
  if (!closed) {
    return (
      <div className={styles.empty}>
        No deals closed in the last {months.length} months, or the Opps cache is empty.
        Open <strong>Opps</strong> so this year’s closes are cached and the trend can be drawn.
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.stageHead} scope="col">Stage reached</th>
            {months.map(m => (
              <th key={m.key} className={styles.monthHead} scope="col">{m.label}</th>
            ))}
            <th className={styles.trendHead} scope="col">Trend</th>
            <th className={styles.overallHead} scope="col" title="Every month in the window taken together, which is the figure each month should be read against.">
              {months.length} mo
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // The stage's own colour from the funnel above, so a stage is
            // the same blue in both pictures. The total row is deliberately
            // outside that ramp — it isn't a stage.
            const color = row.num ? (STAGE_FILL[row.num] || STAGE_FILL_DEFAULT) : '#64748b';
            return (
              <tr key={row.key} className={row.num ? undefined : styles.totalRow}>
                <th scope="row" className={styles.stageCell}>
                  <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <RateCell
                    key={months[i].key}
                    cell={cell}
                    stageLabel={row.short}
                    monthLabel={months[i].label}
                  />
                ))}
                <td className={styles.trendCell}>
                  <Sparkline cells={row.cells} months={months} color={color} label={row.short} />
                </td>
                <td className={styles.overallCell}>
                  {row.overall === null
                    ? <span className={styles.cellEmptyInline}>—</span>
                    : (
                      <span title={`${row.short}: ${row.overall.sold} sold of ${row.overall.sold + row.overall.notSold} closed across the whole window.`}>
                        <span className={styles.cellRate}>{pct(row.overall.rate)}</span>
                        <span className={styles.cellCount}>
                          {row.overall.sold}/{row.overall.sold + row.overall.notSold}
                        </span>
                      </span>
                    )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.note}>
        A deal counts toward every stage it reached, so Stage 3&rsquo;s denominator is the widest and
        Stage 6&rsquo;s the narrowest, and the rates aren&rsquo;t meant to add up. Pull-through opps are
        left out. Each month is the deals whose <strong>Close Date</strong> falls in it; a month a
        stage closed nothing is blank, not 0%.
      </div>
    </div>
  );
}

export default CloseRateTrend;
