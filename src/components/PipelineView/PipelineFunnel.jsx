// Horizontal pipeline funnel — the Pipeline Metrics table drawn as a
// funnel so the volume of deals by stage reads at a glance.
//
// Two dimensions carry data. The band's half-height is proportional to
// the stage's actual value (pipeline $ by default, deal count on the
// toggle), and the segment's LENGTH is proportional to the stage's Avg
// Opp Life — so a stage deals sit in twice as long is drawn twice as
// long, and the funnel's shape shows both volume and time. Where a stage is
// short of its goal, the goal is drawn as a red dotted line with the
// shortfall shaded between it and the actual edge — so a "gap" is
// literally the distance between where the funnel is and where it
// should be.
//
// Every number here comes from the same values the metrics table shows
// (live BFO actuals when the BFO tab is loaded, manual cells otherwise);
// the table underneath doubles as this chart's data table.

import { useMemo, useRef, useState } from 'react';
import styles from './PipelineFunnel.module.css';

// Ordinal blue ramp, earliest stage darkest → latest lightest. Single
// hue, monotone lightness, and the light end clears the surface at
// 2.4:1 (validated as an ordinal ramp against a light chart surface).
const STAGE_FILL = {
  3: '#104281',
  4: '#1c5cab',
  5: '#2a78d6',
  6: '#6da7ec',
};

// BFO's own stage names, so the callouts read as more than a number.
const STAGE_NAME = {
  3: 'Qualify Opportunity',
  4: 'Influence & Develop',
  5: 'Prepare & Bid',
  6: 'Negotiate to Win',
};

// Reserved status colors for the goal marker — never a stage color, and
// always paired with a written "short of / above goal" label so the cue
// never rests on hue alone. Red marks a shortfall (goal line sits outside
// the band, shortfall shaded); green marks a stage that hit its goal
// (line sits inside the band, the surplus is the band itself).
const GAP_RED = '#d03b3b';
const GAP_SHADE = 'rgba(208, 59, 59, 0.14)';
const MET_GREEN = '#0ca30c';

const INK = '#0b0b0b';
const INK_MUTED = '#898781';
const CHROME = '#c3c2b7';

// Canvas. Rendered responsively via viewBox, so these are layout units.
const W = 1200;
const H = 480;
const CY = 236;          // funnel centerline
const MAX_HALF = 104;    // half-height of the tallest band
const MIN_HALF = 5;      // so a 1-deal stage still draws something
const X0 = 190;          // funnel left edge (abuts the entry bar)
const X1 = 950;          // funnel right edge (left of the exit arrow)
const SEG_GAP = 2;       // surface gap between segments
const MIN_SEG_W = 72;    // shortest a stage can be drawn, whatever its life
const CALLOUT_W = 248;   // callout text block, for anti-collision spacing

const fmtDays = (n) => (Number(n) > 0 ? `${Math.round(n)}d` : '—');

const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');

// Compact money for chart labels — $1.7M / $236K / $850.
function fmtCompactMoney(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

const METRICS = {
  deals: {
    key: 'deals',
    label: 'Deals',
    heading: 'Active opportunities',
    actual: (s) => s.countActual,
    goal: (s) => s.countGoal,
    fmt: fmtInt,
    unit: (v) => (Math.abs(v) === 1 ? 'opp' : 'opps'),
  },
  amount: {
    key: 'amount',
    label: 'Pipeline $',
    heading: 'Pipeline value',
    actual: (s) => s.amtActual,
    goal: (s) => s.amtGoal,
    fmt: fmtCompactMoney,
    unit: () => '',
  },
};

// Value + unit, e.g. "7 opps" or "$1.7M".
function withUnit(metric, v) {
  const u = metric.unit(v);
  return u ? `${metric.fmt(v)} ${u}` : metric.fmt(v);
}

export function PipelineFunnel({ stages = [], outcome = null }) {
  // Pipeline $ is the default read of the funnel; Deals is a click away.
  const [metricKey, setMetricKey] = useState('amount');
  const [hover, setHover] = useState(null); // { i, x, y, w } — px inside .plot
  const plotRef = useRef(null);
  const metric = METRICS[metricKey];

  // Earliest stage first (3 → 6) so the funnel reads left to right, the
  // opposite of the metrics table's 6 → 3 ordering.
  const rows = useMemo(() => {
    const list = stages
      .map((s) => ({
        ...s,
        actual: Number(metric.actual(s)) || 0,
        goal: Number(metric.goal(s)) || 0,
      }))
      .filter((s) => Number.isFinite(s.stageNum));
    return list.sort((a, b) => a.stageNum - b.stageNum);
  }, [stages, metric]);

  const geom = useMemo(() => {
    if (!rows.length) return null;
    // Scale on the larger of actual/goal so a goal line taller than the
    // band it marks still fits inside the canvas.
    const max = Math.max(...rows.map((r) => Math.max(r.actual, r.goal)), 0);
    if (max <= 0) return null;
    const half = (v) => (v > 0 ? Math.max(MIN_HALF, (v / max) * MAX_HALF) : 0);

    // Segment LENGTH carries Avg Opp Life — a stage deals sit in twice as
    // long is drawn twice as long. Only when every stage has a life to
    // read; a partial set can't be encoded honestly, so those fall back
    // to equal lengths (and the caption says so).
    const totalW = X1 - X0;
    const lives = rows.map((r) => (Number(r.lifeActual) > 0 ? Number(r.lifeActual) : 0));
    const byLife = lives.every((d) => d > 0);
    const totalLife = lives.reduce((a, b) => a + b, 0);
    // A floor per segment keeps a short stage wide enough to hold its
    // number; the rest of the canvas is shared out in proportion.
    const flex = totalW - MIN_SEG_W * rows.length;
    const widths = byLife
      ? lives.map((d) => MIN_SEG_W + flex * (d / totalLife))
      : rows.map(() => totalW / rows.length);

    // Cumulative left edges — kept as a pure derivation so the segment
    // map below stays side-effect free.
    const starts = widths.map((_, i) => X0 + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const segs = rows.map((r, i) => {
      const w = widths[i];
      const x0 = starts[i];
      const x1 = x0 + w - SEG_GAP;
      const leftH = half(r.actual);
      // Taper toward the next stage; the final segment stays square,
      // and the exit arrow carries the eye out of the funnel.
      const nextH = i < rows.length - 1 ? half(rows[i + 1].actual) : leftH;
      const rightH = leftH + (nextH - leftH) * ((w - SEG_GAP) / w);
      const goalH = half(r.goal);
      const gap = r.goal - r.actual;
      const life = lives[i];
      const lifeGoal = Number(r.lifeGoal) || 0;
      return {
        ...r, i, x0, x1, w, cx: (x0 + x1) / 2,
        leftH, rightH, goalH,
        midH: (leftH + rightH) / 2,
        gap: gap > 0 ? gap : 0,
        over: gap < 0 ? -gap : 0,
        // A zero/blank goal has no meaningful line to draw.
        hasGoal: r.goal > 0,
        life, lifeGoal,
        // Avg Opp Life is a "less than" target — over it is the bad side.
        lifeOver: life > 0 && lifeGoal > 0 && life > lifeGoal,
        above: i % 2 === 0,
      };
    });

    // Callout anchors. Segments are no longer evenly spaced, so two
    // callouts on the same side can collide — push each one right of its
    // same-side predecessor (always two positions back, since sides
    // alternate) rather than letting the text overlap.
    const txs = [];
    for (let i = 0; i < segs.length; i += 1) {
      const prevSameSide = i >= 2 ? txs[i - 2] : -Infinity;
      const wanted = Math.max(Math.min(segs[i].x0 + 6, W - CALLOUT_W), prevSameSide + CALLOUT_W);
      txs.push(Math.min(wanted, W - CALLOUT_W));
    }
    return { segs: segs.map((g, i) => ({ ...g, tx: txs[i] })), byLife, totalLife };
  }, [rows]);

  if (!geom) {
    return (
      <div className={styles.empty}>
        No stage volume to chart yet — paste BFO Activity data, or fill in the
        Active Opportunities / Pipeline cells below.
      </div>
    );
  }

  const gapCount = geom.segs.filter((g) => g.gap > 0).length;
  const hovered = hover ? geom.segs[hover.i] : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.caption}>
          Band height = <strong>{metric.heading}</strong>, segment length ={' '}
          <strong>{geom.byLife ? 'avg opp life' : 'even (no avg opp life yet)'}</strong>
          {geom.byLife ? ` — ${Math.round(geom.totalLife)} days end to end.` : '.'}
        </div>
        <div className={styles.toggle} role="group" aria-label="Funnel metric">
          {Object.values(METRICS).map((m) => (
            <button
              key={m.key}
              type="button"
              className={m.key === metricKey ? styles.toggleOn : styles.toggleOff}
              aria-pressed={m.key === metricKey}
              onClick={() => setMetricKey(m.key)}
            >{m.label}</button>
          ))}
        </div>
      </div>

      <div className={styles.plot} ref={plotRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          role="img"
          aria-label={`Pipeline funnel — ${metric.heading} by stage, segment length by average opportunity life. ${gapCount} of ${geom.segs.length} stages are short of goal.`}
        >
          {/* Entry gate + exit arrow — chrome that frames the funnel. */}
          <rect x={X0 - 14} y={CY - MAX_HALF - 22} width={12} height={(MAX_HALF + 22) * 2} rx={2} fill="#94a3b8" />
          <path
            d={`M ${X1 + 8} ${CY - 24} L ${X1 + 52} ${CY - 24} L ${X1 + 52} ${CY - 40} L ${X1 + 96} ${CY} L ${X1 + 52} ${CY + 40} L ${X1 + 52} ${CY + 24} L ${X1 + 8} ${CY + 24} Z`}
            fill="#dfe3e8"
          />
          {outcome && (
            <>
              <text x={X1 + 108} y={CY - 4} fontSize={13} fontWeight={700} fill={INK}>{outcome.label}</text>
              <text x={X1 + 108} y={CY + 15} fontSize={13} fill={INK_MUTED}>{outcome.value}</text>
            </>
          )}

          {geom.segs.map((g) => {
            const fill = STAGE_FILL[g.stageNum] || '#2a78d6';
            const band = `M ${g.x0} ${CY - g.leftH} L ${g.x1} ${CY - g.rightH} L ${g.x1} ${CY + g.rightH} L ${g.x0} ${CY + g.leftH} Z`;
            const dim = hover && hover.i !== g.i;
            return (
              <g
                key={g.key || g.stageNum}
                onMouseMove={(e) => {
                  // Measure against the plot box (not the svg, which is
                  // centered inside it on wide screens) so the tooltip's
                  // absolute offsets line up with the cursor.
                  const box = plotRef.current?.getBoundingClientRect();
                  if (!box) return;
                  setHover({ i: g.i, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width });
                }}
                onMouseLeave={() => setHover((h) => (h && h.i === g.i ? null : h))}
                style={{ cursor: 'default' }}
              >
                <path d={band} fill={fill} opacity={dim ? 0.72 : 1} />
                {/* Shortfall: shade from the actual edge out to the goal
                    line, top and bottom, then the red dotted goal itself. */}
                {g.gap > 0 && (
                  <>
                    <path
                      d={`M ${g.x0} ${CY - g.goalH} L ${g.x1} ${CY - g.goalH} L ${g.x1} ${CY - g.rightH} L ${g.x0} ${CY - g.leftH} Z`}
                      fill={GAP_SHADE}
                    />
                    <path
                      d={`M ${g.x0} ${CY + g.goalH} L ${g.x1} ${CY + g.goalH} L ${g.x1} ${CY + g.rightH} L ${g.x0} ${CY + g.leftH} Z`}
                      fill={GAP_SHADE}
                    />
                    <line x1={g.x0} y1={CY - g.goalH} x2={g.x1} y2={CY - g.goalH} stroke={GAP_RED} strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" />
                    <line x1={g.x0} y1={CY + g.goalH} x2={g.x1} y2={CY + g.goalH} stroke={GAP_RED} strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" />
                  </>
                )}
                {/* Goal met: the same dotted marker in green. The line falls
                    inside the band here, so the band above it *is* the
                    surplus — no shading needed to read it. Each dash gets a
                    white casing, since green-on-stage-blue is too close in
                    lightness to separate on its own. */}
                {g.gap === 0 && g.hasGoal && [CY - g.goalH, CY + g.goalH].map((y, k) => (
                  <g key={`goal-${k}`}>
                    <line x1={g.x0} y1={y} x2={g.x1} y2={y} stroke="#fff" strokeWidth={5} strokeDasharray="6 5" strokeLinecap="round" opacity={0.9} />
                    <line x1={g.x0} y1={y} x2={g.x1} y2={y} stroke={MET_GREEN} strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" />
                  </g>
                ))}
                {/* Stage number, mirroring the funnel reference. A band too
                    thin to hold the circle gets the number in stage color
                    just outside it instead, so no segment goes unlabeled. */}
                {g.midH >= 26 && g.w >= 58 ? (
                  <>
                    <circle cx={g.cx} cy={CY} r={21} fill="none" stroke="#fff" strokeWidth={2} />
                    <text x={g.cx} y={CY + 7} fontSize={20} fontWeight={600} fill="#fff" textAnchor="middle">{g.stageNum}</text>
                  </>
                ) : (
                  <text
                    x={g.cx}
                    // On the opposite side from this stage's callout, so the
                    // elbow connector doesn't run through the digit — and
                    // clear of the goal line when this stage has a gap.
                    y={g.above
                      ? CY + Math.max(g.midH, g.gap > 0 ? g.goalH : 0) + 22
                      : CY - Math.max(g.midH, g.gap > 0 ? g.goalH : 0) - 10}
                    fontSize={18} fontWeight={700} fill={fill} textAnchor="middle"
                  >{g.stageNum}</text>
                )}
                <title>{`Stage ${g.stageNum} — ${STAGE_NAME[g.stageNum] || ''}\n${metric.heading}: ${withUnit(metric, g.actual)}\nGoal: ${withUnit(metric, g.goal)}${g.gap > 0 ? `\nShort by ${withUnit(metric, g.gap)}` : g.over > 0 ? `\nAbove goal by ${withUnit(metric, g.over)}` : ''}\nAvg opp life: ${fmtDays(g.life)}`}</title>
                {/* Invisible hit area so thin bands are still hoverable. */}
                <rect x={g.x0} y={CY - MAX_HALF - 10} width={g.x1 - g.x0} height={(MAX_HALF + 10) * 2} fill="transparent" />
              </g>
            );
          })}

          {/* Callouts — alternating above / below with an elbow connector. */}
          {geom.segs.map((g) => {
            const fill = STAGE_FILL[g.stageNum] || '#2a78d6';
            const elbowY = g.above ? 122 : 350;
            const edgeY = g.above ? CY - g.midH - 6 : CY + g.midH + 6;
            const tx = g.tx;
            const titleY = g.above ? 46 : 372;
            const valueY = g.above ? 66 : 392;
            const gapY = g.above ? 86 : 412;
            const lifeY = g.above ? 106 : 432;
            return (
              <g key={`c-${g.key || g.stageNum}`}>
                <polyline
                  points={`${tx + 4},${elbowY} ${g.cx},${elbowY} ${g.cx},${edgeY}`}
                  fill="none" stroke={CHROME} strokeWidth={1}
                />
                <circle cx={tx + 4} cy={elbowY} r={3} fill={CHROME} />
                <text x={tx} y={titleY} fontSize={14} fontWeight={700} fill={fill}>
                  Stage {g.stageNum} — {STAGE_NAME[g.stageNum] || ''}
                </text>
                <text x={tx} y={valueY} fontSize={13} fill={INK}>
                  {withUnit(metric, g.actual)}
                  <tspan fill={INK_MUTED}>{`  ·  goal ${withUnit(metric, g.goal)}`}</tspan>
                </text>
                {g.gap > 0 ? (
                  <text x={tx} y={gapY} fontSize={12.5} fontWeight={700} fill={GAP_RED}>
                    ▼ Gap — {withUnit(metric, g.gap)} short of goal
                  </text>
                ) : g.over > 0 ? (
                  <text x={tx} y={gapY} fontSize={12.5} fontWeight={700} fill={MET_GREEN}>
                    ▲ {withUnit(metric, g.over)} above goal
                  </text>
                ) : (
                  <text x={tx} y={gapY} fontSize={12.5} fontWeight={700} fill={g.hasGoal ? MET_GREEN : INK_MUTED}>
                    {g.hasGoal ? '✓ Exactly at goal' : 'No goal set'}
                  </text>
                )}
                {/* Avg Opp Life — the number this segment's length encodes. */}
                <text x={tx} y={lifeY} fontSize={12} fill={INK_MUTED}>
                  <tspan>⏱ avg life </tspan>
                  <tspan fill={g.lifeOver ? GAP_RED : INK} fontWeight={700}>{fmtDays(g.life)}</tspan>
                  {g.lifeGoal > 0 && <tspan>{`  ·  goal < ${fmtDays(g.lifeGoal)}`}</tspan>}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className={styles.tip}
            style={{
              left: `${hover.x}px`,
              top: `${hover.y}px`,
              // Flip to the left of the cursor past the halfway mark so the
              // panel never runs off the right edge of the chart.
              transform: hover.x > (hover.w || 0) * 0.55 ? 'translate(calc(-100% - 14px), -50%)' : 'translate(14px, -50%)',
            }}
          >
            <div className={styles.tipTitle}>
              <span className={styles.tipDot} style={{ background: STAGE_FILL[hovered.stageNum] }} />
              Stage {hovered.stageNum} — {STAGE_NAME[hovered.stageNum] || ''}
            </div>
            <div className={styles.tipRow}><span>{metric.heading}</span><strong>{withUnit(metric, hovered.actual)}</strong></div>
            <div className={styles.tipRow}><span>Goal</span><strong>{withUnit(metric, hovered.goal)}</strong></div>
            {hovered.gap > 0
              ? <div className={styles.tipGap}>▼ {withUnit(metric, hovered.gap)} short of goal</div>
              : hovered.over > 0
                ? <div className={styles.tipOk}>▲ {withUnit(metric, hovered.over)} above goal</div>
                : <div className={hovered.hasGoal ? styles.tipOk : styles.tipNote}>{hovered.hasGoal ? '✓ Exactly at goal' : 'No goal set'}</div>}
            <div className={styles.tipRow}>
              <span>Avg opp life</span>
              <strong style={hovered.lifeOver ? { color: GAP_RED } : undefined}>
                {fmtDays(hovered.life)}{hovered.lifeGoal > 0 ? ` (goal < ${fmtDays(hovered.lifeGoal)})` : ''}
              </strong>
            </div>
            {hovered.isLive && <div className={styles.tipNote}>Live from BFO Activity</div>}
          </div>
        )}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke={GAP_RED} strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" /></svg>
          Goal — stage is short, shaded band is the gap
        </span>
        <span className={styles.legendItem}>
          <svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke={MET_GREEN} strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" /></svg>
          Goal — stage is at or above it, band beyond the line is the surplus
        </span>
        <span className={styles.legendItem}>
          {gapCount === 0
            ? 'Every stage is at or above goal.'
            : `${gapCount} of ${geom.segs.length} stages below goal.`}
        </span>
        <span className={styles.legendItem}>Full numbers in the Pipeline Metrics table below.</span>
      </div>
    </div>
  );
}

export default PipelineFunnel;
