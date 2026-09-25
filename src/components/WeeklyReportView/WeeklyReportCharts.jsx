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
import { LiveValue } from '../common/LiveValue';
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
