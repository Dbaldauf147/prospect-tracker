// The Weekly Report email's history charts, drawn on the tab.
//
// The email carries the coverage ratio, the two account-coverage lines and
// the Emails sent / New opps columns as pictures; the tab used to compute
// all four and show none of them. These draw the same series, and every
// point is a <LiveValue>: hover shows what went into it, click pins the
// panel, and its Excel button downloads the raw rows behind the point.
//
// Plain HTML columns and an SVG line with HTML dots over it, rather than a
// chart library, because the dots have to be real elements for LiveValue
// to anchor its panel to.
import { useEffect, useRef, useState } from 'react';
import { LiveValue } from '../common/LiveValue';
import { monotonePath, numberRuns } from '../../utils/monotoneCurve';
import styles from './WeeklyReportCharts.module.css';

// Columns, one per week. A null value is a week nobody has a record of,
// drawn as an empty dashed slot rather than a zero-height bar.
export function ColumnTrendChart({ id, points = [], color, unit, breakdownFor }) {
  const max = Math.max(1, ...points.map(p => (Number.isFinite(p.value) ? p.value : 0)));
  const last = points.length - 1;
  return (
    <div className={styles.columns} role="img" aria-label={`${unit} by week`}>
      {points.map((p, i) => {
        const known = Number.isFinite(p.value);
        const h = known ? Math.max(2, (p.value / max) * 100) : 100;
        return (
          <div key={p.key} className={styles.colSlot}>
            <span className={styles.colValue}>{i === last && known ? p.value : ''}</span>
            <div className={styles.colTrack}>
              <LiveValue
                id={`${id}-${p.key}`}
                breakdown={breakdownFor(p)}
                className={known ? styles.colBar : styles.colBarEmpty}
                style={known ? { height: `${h}%`, background: color } : undefined}
                title={known ? `${p.value} ${unit}` : 'No record'}
              >
                <span className={styles.srOnly}>{known ? `${p.label}: ${p.value} ${unit}` : `${p.label}: no record`}</span>
              </LiveValue>
            </div>
            <span className={styles.colLabel}>{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Which x labels to print: the first, the last, and evenly spaced ones
// between, so a 40-week axis doesn't print 40 overlapping dates.
function labelEvery(n) {
  if (n <= 8) return 1;
  return Math.ceil(n / 6);
}

// One or two lines over the same weeks, a dot per known reading. `series`
// is [{ key, name, color }], each reading `point[key]`. `goal`, when set,
// is drawn as a dashed line. The y axis starts at zero.
export function LineTrendChart({ id, points = [], series = [], goal = null, yMax = null, fmt, breakdownFor }) {
  const values = points.flatMap(p => series.map(s => p[s.key])).filter(Number.isFinite);
  const top = yMax ?? (Math.max(Number.isFinite(goal) ? goal : 0, ...values, 0) * 1.1 || 1);
  const n = points.length;
  const x = (i) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - (v / top) * 100;
  const every = labelEvery(n);

  // A line breaks at a missing week rather than bridging it.
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = p[s.key];
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `;
      pen = true;
    });
    return { ...s, d: d.trim() };
  });

  return (
    <div className={styles.lineWrap}>
      {series.length > 1 && (
        <div className={styles.legend}>
          {series.map(s => (
            <span key={s.key} className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      )}
      <div className={styles.lineBody}>
        <div className={styles.yAxis}>
          <span>{fmt(top)}</span>
          <span>{fmt(0)}</span>
        </div>
        <div className={styles.plot}>
          <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="100" y1="100" y2="100" className={styles.baseline} />
            <line x1="0" x2="100" y1="50" y2="50" className={styles.grid} />
            {Number.isFinite(goal) && (
              <line x1="0" x2="100" y1={y(goal)} y2={y(goal)} className={styles.goalLine} />
            )}
            {paths.map(s => s.d && (
              <path key={s.key} d={s.d} fill="none" stroke={s.color} className={styles.line} />
            ))}
          </svg>
          {Number.isFinite(goal) && (
            <span className={styles.goalLabel} style={{ top: `${y(goal)}%` }}>Goal {fmt(goal)}</span>
          )}
          {points.map((p, i) => series.map(s => (Number.isFinite(p[s.key]) ? (
            <LiveValue
              key={`${s.key}-${p.key}`}
              id={`${id}-${s.key}-${p.key}`}
              breakdown={breakdownFor(p, s)}
              className={styles.dotHit}
              style={{ left: `${x(i)}%`, top: `${y(p[s.key])}%` }}
              title={`${p.label}: ${fmt(p[s.key])}`}
            >
              <span className={styles.dot} style={{ background: s.color }} />
              <span className={styles.srOnly}>{`${s.name ? `${s.name}, ` : ''}${p.label}: ${fmt(p[s.key])}`}</span>
            </LiveValue>
          ) : null)))}
        </div>
      </div>
      <div className={styles.xAxis}>
        {points.map((p, i) => (
          <span key={p.key} style={{ left: `${x(i)}%` }} className={styles.xTick}>
            {(i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every / 2) ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Account coverage, as the Progress tab draws it ----------------------
//
// The Progress tab's line chart (ProgressView's ProgressChart) restated
// without recharts, so every point can still be a <LiveValue> that opens
// the accounts behind it. Same axis (0-100% in 25s), same dashed grid,
// same monotone curve, a dot on every week that turns dark green and a
// size up at 100%, the green stretches drawn over the maxed-out runs, and
// the legend underneath. The email's picture of the chart
// (utils/coverageChartImage) draws the same things to the same sizes.

const COVERAGE_GREEN = '#15803D';
const COVERAGE_PLOT_H = 190;
const COVERAGE_TICKS = [100, 75, 50, 25, 0];
// An 11px label's width, near enough, for deciding which week labels fit.
const labelPx = (s) => String(s).length * 6.2;

// ProgressView's withGreenKeys for one series: the reading where it, or a
// neighbouring week, is at 100%.
const greenValues = (values) => values.map((v, i) => (
  v === 100 || values[i - 1] === 100 || values[i + 1] === 100 ? v : null
));

export function CoverageTrendChart({ id, points = [], series = [], breakdownFor }) {
  const plotRef = useRef(null);
  const [plotW, setPlotW] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setPlotW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const x = (i) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - v;

  const paths = (values) => numberRuns(values)
    .map(run => monotonePath(run.map(i => ({ x: x(i), y: y(values[i]) }))));

  // recharts' "preserveEnd": the last label always, then walking back,
  // each one that clears the label after it.
  const shown = new Set();
  let leftEdge = Infinity;
  for (let i = n - 1; i >= 0; i -= 1) {
    const px = (x(i) / 100) * plotW;
    const half = labelPx(points[i].label) / 2;
    if (i === n - 1 || !plotW || px + half + 5 <= leftEdge) {
      shown.add(i);
      leftEdge = px - half;
    }
  }

  return (
    <div className={styles.covWrap}>
      <div className={styles.covBody}>
        <div className={styles.covYAxis} style={{ height: COVERAGE_PLOT_H }}>
          {COVERAGE_TICKS.map(t => (
            <span key={t} className={styles.covYTick} style={{ top: `${y(t)}%` }}>{t}%</span>
          ))}
        </div>
        <div ref={plotRef} className={styles.covPlot} style={{ height: COVERAGE_PLOT_H }}>
          <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {COVERAGE_TICKS.filter(t => t > 0).map(t => (
              <line key={`h${t}`} x1="0" x2="100" y1={y(t)} y2={y(t)} className={styles.covGrid} />
            ))}
            {points.map((p, i) => (i > 0 ? (
              <line key={`v${p.key}`} x1={x(i)} x2={x(i)} y1="0" y2="100" className={styles.covGrid} />
            ) : null))}
            <line x1="0" x2="0" y1="0" y2="100" className={styles.covAxis} />
            <line x1="0" x2="100" y1="100" y2="100" className={styles.covAxis} />
            {series.map(s => paths(points.map(p => p[s.key])).map((d, k) => (
              <path key={`${s.key}-${k}`} d={d} fill="none" stroke={s.color} className={styles.covLine} />
            )))}
            {series.map(s => paths(greenValues(points.map(p => p[s.key]))).map((d, k) => (
              <path key={`${s.key}-g${k}`} d={d} fill="none" stroke={COVERAGE_GREEN} className={styles.covGreen} />
            )))}
          </svg>
          {series.map(s => points.map((p, i) => {
            const v = p[s.key];
            if (!Number.isFinite(v)) return null;
            const hit = v === 100;
            return (
              <LiveValue
                key={`${s.key}-${p.key}`}
                id={`${id}-${s.key}-${p.key}`}
                breakdown={breakdownFor(p, s)}
                className={styles.dotHit}
                style={{ left: `${x(i)}%`, top: `${y(v)}%` }}
                title={`${p.label}: ${v}%`}
              >
                <span
                  className={hit ? styles.covDotMax : styles.covDot}
                  style={{ background: hit ? COVERAGE_GREEN : s.color }}
                />
                <span className={styles.srOnly}>{`${s.name}, ${p.label}: ${v}%`}</span>
              </LiveValue>
            );
          }))}
        </div>
      </div>
      <div className={styles.covXAxis}>
        {points.map((p, i) => (shown.has(i) ? (
          <span key={p.key} className={styles.covXTick} style={{ left: `${x(i)}%` }}>{p.label}</span>
        ) : null))}
      </div>
      <div className={styles.covLegend}>
        {series.map(s => (
          <span key={s.key} className={styles.covLegendItem} style={{ color: s.color }}>
            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
              <line x1="0" x2="14" y1="5" y2="5" stroke={s.color} strokeWidth="2" />
              <circle cx="7" cy="5" r="3" fill="#fff" stroke={s.color} strokeWidth="1.5" />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
