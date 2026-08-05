import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import MASTER_ORDINANCES from '../../data/masterOrdinances.js';
import { STATES, GOV_IDS, JURISDICTIONS, CITY_ROWS } from '../../data/complianceCityLookup.js';
// Counts only — the table itself is ~70k rows and is dynamic-imported inside
// the download handler, so it never lands in this page's chunk.
import { WHOLE_BUILDING_META } from '../../data/wholeBuildingUtilitiesMeta.js';
import {
  screenSites, lookupGovId, getMandates,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  totalEligible, eligibilityByOrdinance, totalPenalty, penaltyByOrdinance, sitesCompanyLabel,
  bpsPrioritization, penaltyBasis, auditRequirements, auditRequirementsLabel, categoryColumns,
  deadlinesWithRecurrence, utilityFeedEligibility, utilityFeedSites,
} from '../../utils/complianceMandates';
import { exportComplianceReportXlsx } from '../../utils/complianceReportXlsx';
import { loadWholeBuildingLookup } from '../../utils/wholeBuildingLookup';
import { schneiderLogoSvg } from '../../utils/schneiderLogo';
import { OwnershipScopeBar } from './OwnershipScopeBar.jsx';
import styles from './BuildingComplianceScreening.module.css';

const usd = (n) => n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US');
const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());
// Filename-safe form of a jurisdiction / utility name.
const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The two Whole Building Utility Data Collection cards, in render order. Named
// once so the cards, their drill-downs and the exported workbook agree.
const FEED_CARDS = [
  { key: 'electric', abbr: 'EP', label: 'Electric Power (EP)', color: '#F2B705' },
  { key: 'gas', abbr: 'NG', label: 'Natural Gas (NG)', color: '#B5179E' },
];
const mdY = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
// Day and month only, for the timeline labels. The year is already the axis's
// job — the ticks are years, so a label's own year is a third statement of
// something its position has said twice. Dropping it is what keeps
// neighbouring labels on one tier instead of colliding. The dot's tooltip
// still carries the full date for anyone who wants it spelled out.
const md = (iso) => { if (!iso) return '-'; const [, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}`; };
// Property-type buckets the size requirements are published against, for the
// lines that have to name the bucket a building fell into.
const PT_CLASS_LABEL = { multifamily: 'multifamily', public: 'public / institutional', nonresidential: 'non-residential' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Deadlines are calendar dates, so they're compared in UTC against a UTC
// midnight "today" — a local-midnight clock would put a site in a deadline's
// last day or its first depending on the reader's timezone.
const DAY = 86400000;
// How far past the last published deadline — or past today, whichever is
// later — the recurring filings are projected.
const PROJECT_YEARS = 5;
const isoTime = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
const utcToday = () => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
};
// How far off a deadline is, in the terms someone plans in — days while it's
// close enough to act on, then months, then years.
const relDue = (days) => {
  if (days === 0) return 'due today';
  const n = Math.abs(days);
  const span = n < 45 ? `${n} day${n === 1 ? '' : 's'}`
    : n < 730 ? `${Math.round(n / 30.44)} months`
    : `${(n / 365.25).toFixed(1).replace(/\.0$/, '')} years`;
  return days < 0 ? `${span} ago` : `in ${span}`;
};

// Rides on the face of the report — this is a preliminary screen off the
// city + square footage supplied, not a compliance determination, and the
// deliverable has to say so wherever it lands.
const DISCLAIMER = 'The information provided in this document is based on the location and square footage data supplied by the requestor. This assessment is a preliminary review to help identify properties that may be subject to compliance with benchmarking (BBS), energy audit, and building performance standards (BPS) ordinances. It does not account for all jurisdiction-specific eligibility criteria such as exemptions, official validation, or special classifications. Estimated annual penalties are illustrative worst-case figures and do not constitute legal or financial advice.';

// A source column as it should read in an export. The workbook leaves some
// dates as Excel serials — Seattle's audit due date is "45931" — which is
// unreadable in a column headed "Due Date". Everything else passes through as
// written, so the export stays a faithful copy of the reference.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function sourceValue(column, value) {
  const s = value == null ? '' : String(value).trim();
  if (!/date|deadline/i.test(column) || !/^\d{5}$/.test(s)) return value ?? '';
  const n = Number(s);
  if (n < 20000 || n > 60000) return value;
  return mdY(new Date(EXCEL_EPOCH + n * 86400000).toISOString().slice(0, 10));
}

// Compact horizontal-bar list used for the on-page eligibility/penalty
// summaries. items: [{ label, value }]. Every jurisdiction is listed — the
// lists used to stop at the top 8, which quietly dropped cities from a
// portfolio's exposure. With `onSelect`, each row becomes a button that opens
// the sites behind it.
function HBars({ items, color, fmt = String, wide = false, empty = 'No eligible sites', onSelect = null }) {
  if (!items.length) return <div className={styles.miniEmpty}>{empty}</div>;
  const max = Math.max(1, ...items.map(i => i.value));
  const rowClass = wide ? styles.hbarRowWide : styles.hbarRow;
  return (
    <div className={styles.hbars}>
      {items.map((it) => {
        const body = (
          <>
            <span className={styles.hbarLabel} title={it.label}>{it.label}</span>
            <span className={styles.hbarTrack}>
              <span className={styles.hbarFill} style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: color }} />
            </span>
            <span className={styles.hbarVal}>{fmt(it.value)}</span>
          </>
        );
        if (!onSelect) return <div key={it.label} className={rowClass}>{body}</div>;
        return (
          <button
            key={it.label}
            type="button"
            className={`${rowClass} ${styles.hbarRowBtn}`}
            onClick={() => onSelect(it.label)}
            title={`Show the ${it.label} sites behind this figure`}
          >{body}</button>
        );
      })}
    </div>
  );
}

// ---- Roadmap charts -------------------------------------------------------
// Both charts share one time axis and one viewBox width, so a date sits at the
// same x in the lanes and in the fines chart below them and the two can be
// read as one picture.
const TL = { W: 960, padL: 122, padR: 36 };
const tlX = (t, ax) => TL.padL + ((t - ax.lo) / (ax.hi - ax.lo)) * (TL.W - TL.padL - TL.padR);

// Year boundaries, so the axis reads as elapsed time rather than as a row of
// ticks. Quarters instead when the whole span is inside a couple of years,
// which is where most portfolios sit.
function axisTicks(ax) {
  const out = [];
  const y0 = new Date(ax.lo).getUTCFullYear(), y1 = new Date(ax.hi).getUTCFullYear();
  const byQuarter = (ax.hi - ax.lo) < 800 * DAY;
  for (let y = y0; y <= y1; y++) {
    for (const m of (byQuarter ? [0, 3, 6, 9] : [0])) {
      const t = Date.UTC(y, m, 1);
      if (t <= ax.lo || t >= ax.hi) continue;
      out.push({ t, px: tlX(t, ax), label: m === 0 ? String(y) : `${MONTHS[m]} ${y}`, major: m === 0 });
    }
  }
  return out;
}

// Today, drawn the same way on both charts.
function TodayMark({ ax, todayTime, y1, y2, label = true }) {
  const px = tlX(todayTime, ax);
  return (
    <g>
      <line x1={px} y1={y1} x2={px} y2={y2} stroke="#DC2626" strokeWidth="1.6" />
      {label && <text x={px} y={y1 - 5} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#DC2626">TODAY</text>}
    </g>
  );
}

// One lane per mandate, each deadline a labelled dot on it — the shape a
// compliance roadmap is normally read in: which obligation, when, how much of
// the portfolio.
//
// Labels are the hard part. Deadlines cluster (a jurisdiction's dates land
// within weeks, then nothing for two years), so a label is dropped to a second
// tier when it would collide with its neighbour rather than being drawn on top
// of it, and slid sideways off its dot when even that isn't enough — the dots
// stay exactly on their true dates either way.
function DeadlineLanes({ lanes, ax, todayTime }) {
  const padT = 26, padB = 6;
  const ticks = axisTicks(ax);
  // Half the width a two-line label needs. Now that the count is a bare number
  // — the legend carries the "sites" — the wider line is the M/D date under it,
  // at worst "12/31". Tied to that line's font size: shrink the text and this
  // has to come down with it, or labels reserve room they no longer occupy and
  // drop to a lower tier (or off the chart) for a collision that wouldn't have
  // happened.
  const HALF = 10;
  const TIER_H = 19;     // vertical pitch between the stacked fallback's tiers
  const TIERS = 7;
  const PITCH = 27;      // gap between labels laid out along a run
  const RUN_GAP = 12;    // clear space between one run and the next
  const LBL_Y = 14;      // a lone label sits this far under its dot
  const BRK_Y = 14;      // the bracket tying a run to its cluster
  const RUN_Y = 30;      // a run sits below that bracket
  // Deadlines arrive in clusters — the same handful of dates every year, inside
  // a couple of months, which on a five-year axis is about one label's width of
  // room for four labels. The space *between* those clusters is meanwhile
  // enormous and empty, so a cluster's labels are laid out left to right into
  // it rather than stacked down the page. A bracket says which dots the run
  // belongs to; order within the run says which label is which date.
  //
  // The dot never moves under any of this: it is the date. A label in a run
  // does not sit over its own dot, which is the trade the bracket pays for.
  const todayX = tlX(todayTime, ax);
  const placed = lanes.map(lane => {
    const pts = lane.points.map(p => ({ ...p, cx: tlX(isoTime(p.date), ax) }));
    // A cluster is a run of dates whose labels would overlap if each sat under
    // its own dot. A date far enough from its neighbours is a cluster of one
    // and just gets a label underneath, with no bracket to explain.
    const clusters = [];
    for (const p of pts) {
      const last = clusters[clusters.length - 1];
      if (last && p.cx - last[last.length - 1].cx < HALF * 2 + 5) last.push(p);
      else clusters.push([p]);
    }
    // A run only earns its place if it fits where it wants to be, clear of
    // both neighbours. The one ahead matters as much as the one behind: a run
    // that reaches into the next cluster lands on top of whatever that cluster
    // draws. Nudging a run clear instead would walk it away from the dots it
    // describes, which is the drift this layout exists to avoid.
    //
    // The choice is made for the lane as a whole rather than per cluster. Mixed
    // lanes were tried and read badly: runs and stacks alternating year by year
    // look arbitrary, and the lane is as tall as its stacks regardless, so the
    // runs buy nothing. Either every cluster in the lane runs or none does.
    const runLayout = () => {
      const labels = [];
      const brackets = [];
      let prevRight = -Infinity;
      for (let ci = 0; ci < clusters.length; ci++) {
        const cl = clusters[ci];
        if (cl.length === 1) {
          labels.push({ ...cl[0], lx: cl[0].cx, dy: LBL_Y });
          prevRight = Math.max(prevRight, cl[0].cx + HALF);
          continue;
        }
        const mid = (cl[0].cx + cl[cl.length - 1].cx) / 2;
        const width = (cl.length - 1) * PITCH;
        const next = clusters[ci + 1];
        const nextLeft = next ? next[0].cx - HALF : Infinity;
        // Where the run may legally begin, given the axis ends and whatever
        // sits either side of it.
        let minStart = Math.max(TL.padL + HALF, prevRight + RUN_GAP + HALF);
        let maxStart = Math.min(TL.W - TL.padR - HALF - width, nextLeft - RUN_GAP - HALF - width);
        // A label in a run no longer sits at its own date, so it must at least
        // stay on the correct side of the TODAY rule: a deadline that has
        // passed, labelled to the right of it, reads as still to come, which
        // is the one thing this chart must not get wrong. Dates that straddle
        // today are left alone — a run spanning the rule is telling the truth.
        const times = cl.map(p => isoTime(p.date));
        if (times.every(t => t < todayTime)) maxStart = Math.min(maxStart, todayX - RUN_GAP - HALF - width);
        else if (times.every(t => t > todayTime)) minStart = Math.max(minStart, todayX + RUN_GAP + HALF);
        if (maxStart < minStart) return null;   // genuinely nowhere to put it
        // Centred on its cluster so it doesn't lean, then held inside those
        // bounds. The clamp only ever bites at the two ends of the axis, where
        // the first and last clusters would otherwise hang off the edge — and
        // there is no neighbour there to be confused with, so a run sitting a
        // little off-centre reads fine. Failing instead would cost the whole
        // lane its runs for the sake of one edge cluster.
        const start = Math.min(Math.max(mid - width / 2, minStart), maxStart);
        cl.forEach((p, k) => labels.push({ ...p, lx: start + k * PITCH, dy: RUN_Y }));
        brackets.push({ x1: start, x2: start + width, cx: mid });
        prevRight = start + width + HALF;
      }
      return { labels, brackets };
    };
    // Stacked fallback: straight down, one tier per collision, vertical leader.
    // A label with no free tier is left off entirely — the dot keeps its
    // tooltip, and an unreadable overprint helps nobody.
    const stackLayout = () => {
      const tierRight = Array(TIERS).fill(-Infinity);
      return {
        brackets: [],
        labels: pts.map(p => {
          const tier = tierRight.findIndex(right => p.cx - HALF >= right + 5);
          if (tier >= 0) tierRight[tier] = p.cx + HALF;
          return { ...p, lx: p.cx, dy: tier >= 0 ? LBL_Y + tier * TIER_H : null, stacked: true };
        }),
      };
    };
    return runLayout() || stackLayout();
  });
  // Each lane is only as tall as its own labels need. A fixed height sized
  // for the worst case left a lane with one deadline — or none — sitting in
  // an empty band as deep as the busiest one.
  const laneTops = [];
  const laneHeights = placed.map(({ labels }) => {
    const deepest = labels.reduce((m, p) => Math.max(m, p.dy ?? 0), 0);
    return labels.length ? 15 + deepest + 11 : 34;
  });
  laneHeights.reduce((top, h) => { laneTops.push(top); return top + h; }, padT);
  const bodyH = laneHeights.reduce((a, b) => a + b, 0);
  const H = padT + bodyH + padB;
  return (
    <svg width="100%" viewBox={`0 0 ${TL.W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Compliance deadlines by mandate over time">
      {lanes.map((lane, i) => (
        i % 2 === 1 ? (
          <rect key={`band${lane.key}`} x="0" y={laneTops[i]} width={TL.W} height={laneHeights[i]} fill="#F8FAFC" />
        ) : null
      ))}
      {ticks.map(t => (
        <g key={t.t}>
          <line x1={t.px} y1={padT - 12} x2={t.px} y2={padT + bodyH} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3 3" />
          {/* The TODAY caption owns its stretch of the header — a tick label
              under it prints as one illegible word. Compared as boxes, since
              a quarter label is twice the width of a year. */}
          {!(t.px + 4 < tlX(todayTime, ax) + 27 && t.px + 4 + (t.major ? 26 : 48) > tlX(todayTime, ax) - 27) && (
            <text x={t.px + 4} y={padT - 15} fontSize={t.major ? 11 : 9} fontWeight={t.major ? 800 : 600} fill={t.major ? '#94A3B8' : '#CBD5E1'}>{t.label}</text>
          )}
        </g>
      ))}
      <TodayMark ax={ax} todayTime={todayTime} y1={padT - 10} y2={padT + bodyH} />
      {lanes.map((lane, i) => {
        const dotY = laneTops[i] + 15;
        return (
          <g key={lane.key}>
            <text x={TL.padL - 14} y={dotY - 1} textAnchor="end" fontSize="12.5" fontWeight="800" fill="#0F172A">{lane.label}</text>
            <text x={TL.padL - 14} y={dotY + 12} textAnchor="end" fontSize="9.5" fill={lane.color} fontWeight="700">
              {lane.points.length
                ? `${lane.total} site${lane.total === 1 ? '' : 's'}`
                : 'no dated deadlines'}
            </text>
            <line x1={TL.padL} y1={dotY} x2={TL.W - TL.padR} y2={dotY} stroke="#E2E8F0" strokeWidth="1" />
            {/* One bracket per run: a stub down from the middle of the cluster,
                then a rule with a tick turned down at each end of the labels.
                The rule runs to whichever is further out, the labels or the
                cluster — a run held off-centre (by the TODAY rule, or by the
                end of the axis) would otherwise leave the stub hanging off
                thin air beyond the bracket's end. Drawn before the dots and
                labels so it sits under them. */}
            {placed[i].brackets.map(b => (
              <path
                key={`brk${b.x1}`}
                d={`M${b.cx} ${dotY + 6} L${b.cx} ${dotY + BRK_Y}
                    M${Math.min(b.x1, b.cx)} ${dotY + BRK_Y} L${Math.max(b.x2, b.cx)} ${dotY + BRK_Y}
                    M${b.x1} ${dotY + BRK_Y} L${b.x1} ${dotY + BRK_Y + 4}
                    M${b.x2} ${dotY + BRK_Y} L${b.x2} ${dotY + BRK_Y + 4}`}
                fill="none" stroke={lane.color} strokeWidth="1" opacity="0.45"
              />
            ))}
            {placed[i].labels.map(({ cx, lx, dy, stacked, ...p }) => {
              const ly = dotY + dy;
              return (
                <g key={p.date}>
                  {/* Only a stacked label below the first tier needs a leader,
                      and it is vertical by construction — the label shares its
                      dot's x. A label in a run is tied to its cluster by the
                      bracket instead. */}
                  {stacked && dy != null && dy > LBL_Y && (
                    <line x1={cx} y1={dotY + 6} x2={cx} y2={ly - 9} stroke={lane.color} strokeWidth="1" opacity="0.45" />
                  )}
                  {/* Hollow for a projected filing — it's the ordinance's
                      cycle carried forward, not a date the jurisdiction has
                      published, and the two shouldn't read alike. Kept small:
                      dots sit on their true dates, so deadlines a fortnight
                      apart land on top of each other unless they're tight. */}
                  <circle
                    cx={cx} cy={dotY} r={p.projected ? 4 : 4.5}
                    fill={p.projected ? '#fff' : lane.color}
                    stroke={p.projected ? lane.color : '#fff'}
                    strokeWidth={p.projected ? 1.75 : 1.25}
                  >
                    <title>
                      {`${lane.label} · ${mdY(p.date)}: ${p.count} site${p.count === 1 ? '' : 's'}`
                        + (p.projected ? ' (projected from the ordinance\u2019s compliance cycle)' : '')}
                    </title>
                  </circle>
                  {dy != null && (
                    <>
                      <text x={lx} y={ly} textAnchor="middle" fontSize="9.5" fontWeight={p.projected ? 700 : 800}
                        fill={p.projected ? '#64748B' : '#0F172A'} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                        {p.count}
                      </text>
                      <text x={lx} y={ly + 8} textAnchor="middle" fontSize="7"
                        fill={p.projected ? '#94A3B8' : '#475569'} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                        {md(p.date)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// One BBS / Audits / BPS cell for a screened site: applicable ✓ / below the
// size requirement, with the deadline + penalty in a tooltip. The fine is also
// printed under the pill — it's the number the conversation turns on, and it
// shouldn't need a hover to find.
function CatCell({ res }) {
  if (!res || !res.active) return <span className={styles.dash}>-</span>;
  // The ft² threshold gates applicability: the building is over the size
  // requirement (applicable) or under it (not required to report). A site with
  // no square footage is taken as meeting it, and says so.
  const thr = res.threshold != null
    ? `Size requirement ${res.threshold.toLocaleString()} ft²`
      + (res.sizeAssumed ? ': this site has no square footage, so it is taken as meeting it'
        : res.meetsThreshold === true ? ': building meets it'
        : res.meetsThreshold === false ? ': building is below it, so it does not have to report'
        : '')
    : null;
  const tip = [
    res.policyName,
    res.deadline ? `Deadline ${mdY(res.deadline)}` : (res.deadlineRaw ? `Deadline ${res.deadlineRaw}` : null),
    thr,
    res.eligible === true && res.penalty != null ? `Max penalty ${usd(res.penalty)}/yr` : null,
  ].filter(Boolean).join(' · ');
  // No date on file, so nothing is due and the site isn't counted as needing
  // to comply — Austin, Columbus and Denver publish no audit deadline.
  if (res.noDeadline) {
    return (
      <span className={styles.catCell}>
        <span
          className={styles.pillBelow}
          title={[res.policyName, 'This ordinance publishes no compliance deadline, so nothing is due here yet'].filter(Boolean).join(' · ')}
        >No deadline published</span>
        <span className={styles.catFineNone}>nothing due</span>
      </span>
    );
  }
  // The ordinance covers other building types but not this one — e.g. Austin's
  // audit requirement is multifamily-only, Seattle's is commercial-only.
  if (res.coveredType === false) {
    return (
      <span className={styles.catCell}>
        <span
          className={styles.pillBelow}
          title={[res.policyName, `This ordinance does not cover ${PT_CLASS_LABEL[res.ptClass] || 'this'} buildings`].filter(Boolean).join(' · ')}
        >Building type not covered</span>
        <span className={styles.catFineNone}>
          {PT_CLASS_LABEL[res.ptClass] || 'this type'} not in scope
        </span>
      </span>
    );
  }
  // Below the size requirement: the ordinance is live in this jurisdiction but
  // this building isn't covered, so no deadline and no fine ride along.
  if (res.eligible === false) {
    return (
      <span className={styles.catCell}>
        <span className={styles.pillBelow} title={tip}>Below size requirement</span>
        <span className={styles.catFineNone}>
          under {res.threshold?.toLocaleString('en-US')} ft²
        </span>
      </span>
    );
  }
  return (
    <span className={styles.catCell}>
      {/* Applicable either way — the pill says when that rests on an assumed
          size rather than a measured one. */}
      <span
        className={res.sizeAssumed ? styles.pillAssumed : styles.pillEligible}
        title={tip}
      >Applicable{res.sizeAssumed ? ' · sq ft assumed' : ''}</span>
      {/* The date the mandate comes due. It was only ever in the hover tip,
          which a printed page can't show — and the deadline is half of what
          the row is for. */}
      {(res.deadline || res.deadlineRaw) && (
        <span className={styles.catDue} title="Compliance deadline for this mandate">
          due {res.deadline ? mdY(res.deadline) : res.deadlineRaw}
        </span>
      )}
      {res.penalty != null ? (
        <span className={styles.catFine} title="Estimated maximum yearly penalty for this mandate at this site">
          {usd(res.penalty)}/yr
        </span>
      ) : res.penaltyUnsized ? (
        <span
          className={styles.catFineNone}
          title={`${usd(res.penaltyRate)} per ft²/yr: this site has no square footage, so the yearly figure can't be worked out`}
        >{usd(res.penaltyRate)}/ft²/yr · needs sq ft</span>
      ) : (
        <span className={styles.catFineNone} title="This ordinance publishes no maximum penalty">no fine on file</span>
      )}
    </span>
  );
}

// What an audit mandate asks this site for — an energy audit (and to which
// ASHRAE level), a water audit, retro-commissioning, a tune-up — on the row
// itself, since each is separate work to scope and "Applicable" alone doesn't
// say which. Only where the mandate reaches the building: a site that doesn't
// have to audit is on the hook for none of it.
//
// "Mandatory" / "May be required" say only how firmly the requirement applies,
// which the tag already carries; anything else the column says (an ASHRAE
// level, a scope note) is the requirement itself and is printed beside it.
const REQ_CLASS = { required: 'reqRequired', conditional: 'reqConditional', optional: 'reqOptional' };
const REQ_LEVEL_ONLY = /^(mandatory|required|may\s+be\s+required|optional|conditional)$/i;
function AuditTypeCell({ res }) {
  if (!res || res.eligible !== true) return <span className={styles.dash}>-</span>;
  const reqs = res.requirements || [];
  if (!reqs.length) {
    return (
      <span className={styles.dash} title="The reference records no audit detail for this ordinance">
        not published
      </span>
    );
  }
  return (
    <span className={styles.reqList}>
      {reqs.map(rq => (
        <span key={rq.key} className={styles.reqRow} title={`${rq.label} · ${rq.value}`}>
          <span className={styles[REQ_CLASS[rq.level]]}>{rq.label}</span>
          {!REQ_LEVEL_ONLY.test(rq.value) && <span className={styles.reqSpec}>{rq.value}</span>}
          {rq.level !== 'required' && (
            <span className={styles.reqSpec}>{rq.level === 'optional' ? 'optional' : 'may be required'}</span>
          )}
        </span>
      ))}
    </span>
  );
}

// One mandate inside the site detail popup: whether it applies, the policy
// behind it, and the arithmetic that produced the fine on the row.
function MandateDetail({ res, mandate, sqft }) {
  const cat = res?.category;
  const basis = mandate ? penaltyBasis(mandate, cat) : null;
  const m = mandate?.[cat] || {};
  if (!res?.active) {
    return (
      <div className={styles.mdBlock}>
        <div className={styles.mdHead} style={{ background: '#94A3B8' }}>{CATEGORY_LABEL[cat]}</div>
        <div className={styles.mdBody}>
          <div className={styles.mdNot}>
            Not applicable{m.status ? `: the ordinance on file is "${m.status}"` : ': no active ordinance for this jurisdiction'}.
          </div>
        </div>
      </div>
    );
  }
  // How the number on the row was reached. Three shapes: a flat annual
  // maximum, a per-ft² rate multiplied by the building, or a per-ft² rate
  // with no square footage to multiply.
  const fineLine = res.penalty != null && res.penaltyPerSqft
    ? `${usd(res.penaltyRate)} per ft²/yr × ${sqft.toLocaleString('en-US')} ft² = ${usd(res.penalty)}/yr`
    : res.penaltyUnsized
      ? `${usd(res.penaltyRate)} per ft²/yr: add this site's square footage to size it`
      : res.penalty != null
        ? `${usd(res.penalty)}/yr, as published`
        : 'This ordinance publishes no maximum penalty.';
  const row = (label, value) => value == null || value === '' ? null : (
    <div key={label} className={styles.mdRow}><span className={styles.mdKey}>{label}</span><span className={styles.mdVal}>{value}</span></div>
  );
  // Header and note follow the result: covered (measured or assumed) or under
  // the size requirement.
  const headLabel = res.eligible !== true ? 'Not required to report'
    : res.sizeAssumed ? 'Applicable: sq ft assumed'
    : 'Applicable';
  const headColor = res.eligible !== true ? '#94A3B8'
    : res.sizeAssumed ? '#D97706'
    : CATEGORY_COLOR[cat];
  return (
    <div className={styles.mdBlock}>
      <div className={styles.mdHead} style={{ background: headColor }}>{CATEGORY_LABEL[cat]}: {headLabel}</div>
      <div className={styles.mdBody}>
        {row('Policy', res.policyName || '-')}
        {row('Status', res.status || '-')}
        {row('Deadline', res.deadline ? mdY(res.deadline) : (res.deadlineRaw || '-'))}
        {row('Compliance cycle', m.complianceCycle)}
        {row('Size requirement', res.coveredType === false
          ? `None for ${PT_CLASS_LABEL[res.ptClass] || 'this'} buildings: the ordinance publishes requirements for other building types only`
          : res.threshold != null
            ? `${res.threshold.toLocaleString('en-US')} ft² (${res.thresholdKey || res.ptClass})`
              + (res.sizeAssumed ? ': square footage unknown, taken as meeting it'
                : res.meetsThreshold === true ? `: this building's ${sqft != null ? `${sqft.toLocaleString('en-US')} ft² ` : ''}meets it`
                : res.meetsThreshold === false ? `: this building's ${sqft != null ? `${sqft.toLocaleString('en-US')} ft² ` : ''}is below it`
                : '')
            : 'None published')}
        {res.noDeadline ? (
          <div className={styles.mdNote}>
            The ordinance is in force in this jurisdiction, but publishes no compliance deadline.
            There is nothing due and nothing to plan against, so this site isn&apos;t counted as
            needing an audit and carries no penalty here.
          </div>
        ) : res.coveredType === false ? (
          <div className={styles.mdNote}>
            The ordinance is in force in this jurisdiction, but it scopes itself to building types
            this site isn&apos;t one of. It publishes no requirement for {PT_CLASS_LABEL[res.ptClass] || 'this type of'} buildings,
            so this site isn&apos;t counted as needing to report and carries no penalty here.
          </div>
        ) : res.eligible === false && (
          <div className={styles.mdNote}>
            The ordinance is in force in this jurisdiction, but this building is under its size
            requirement, so it isn&apos;t counted as needing to report and carries no penalty here.
          </div>
        )}
        {res.sizeAssumed && (
          <div className={styles.mdNote}>
            This site has no square footage, so it can&apos;t be measured against the size
            requirement: it&apos;s counted as meeting it. Map a Sq Ft column on the Utility Lookup
            subtab to screen it for real.
          </div>
        )}
        {/* An audit ordinance can ask for several separate pieces of work, each
            scoped and priced on its own. "Applicable" alone doesn't say which. */}
        {res.requirements?.length > 0 && (
          <>
            <div className={styles.mdSubhead}>What this ordinance requires</div>
            {res.requirements.map(rq => row(rq.label, `${rq.value}${rq.level === 'conditional' ? ': conditional' : rq.level === 'optional' ? ': not required' : ''}`))}
          </>
        )}
        {res.active && cat === 'audits' && !res.requirements?.length && (
          <div className={styles.mdNote}>
            The reference records no energy-audit, water-audit, retro-commissioning or tune-up
            detail for this ordinance: check the jurisdiction&apos;s own guidance for what it asks for.
          </div>
        )}

        <div className={styles.mdSubhead}>How this fine was calculated</div>
        <div className={styles.mdFine}>{
          res.eligible === true ? fineLine
            : res.noDeadline
              ? 'No fine: the ordinance publishes no deadline, so nothing is due here yet.'
              : res.coveredType === false
                ? 'No fine: the mandate does not cover this building type.'
                : 'No fine: this building is under the size requirement, so the mandate does not reach it.'
        }</div>
        {basis && (
          <>
            {row('Published figure', basis.amount == null ? null
              : `${basis.amount}${basis.unit ? ` ${basis.unit}` : ''}`)}
            {row('Figure is', basis.basis)}
            {basis.rows.map(r => row(r.label, r.value))}
          </>
        )}
        {m.url || m.link ? (
          <div className={styles.mdRow}>
            <span className={styles.mdKey}>Source</span>
            <span className={styles.mdVal}>
              <a href={m.url || m.link} target="_blank" rel="noreferrer" className={styles.mdLink}>{m.url || m.link}</a>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Full screening detail for one site: what it matched, and every mandate with
// its fine worked through. Opened by clicking a row in the site table.
function SiteDetailModal({ site, onClose }) {
  const mandate = site?.govId ? getMandates(site.govId) : null;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!site) return null;
  // Only mandates the building actually has to report under contribute to its
  // exposure — one it's under the size requirement for costs it nothing.
  const total = CATEGORIES.reduce((n, c) => n + (site[c]?.eligible === true ? (site[c]?.penalty || 0) : 0), 0);
  const anyUnsized = CATEGORIES.some(c => site[c]?.eligible === true && site[c]?.penaltyUnsized);
  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Compliance detail for ${site.siteName || 'site'}`}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>{site.siteName || 'Untitled site'}</div>
            <div className={styles.modalSub}>
              {[site.city, site.state].filter(Boolean).join(', ') || 'No location'}
              {site.matched ? <> · <strong>{site.government}</strong> <span className={styles.modalGovId}>{site.govId}</span></> : ' · no jurisdiction matched'}
            </div>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.mdFacts}>
            <span><strong>{site.sqft != null ? site.sqft.toLocaleString('en-US') : '-'}</strong> ft²</span>
            <span><strong>{site.propertyType || '-'}</strong></span>
            <span>Est. exposure <strong>{usd(total)}</strong>/yr{anyUnsized ? ' + unsized' : ''}</span>
          </div>
          {!site.matched ? (
            <div className={styles.mdNot}>
              This site's city and state didn't resolve to a jurisdiction in the Master Ordinances,
              so no mandates were screened. Check the spelling, or confirm the jurisdiction has an
              ordinance on file.
            </div>
          ) : (
            CATEGORIES.map(c => (
              <MandateDetail key={c} res={site[c]} mandate={mandate} sqft={site.sqft} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// The sites behind a figure on a dashboard card: either one jurisdiction's bar
// (`government` set) or the card's whole applicable-sites total (`government`
// null), with the numbers that produced it. Exports the same rows to Excel.
function JurisdictionSitesModal({ category, government, rows, onExport, onSiteClick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const totalPenalty = rows.reduce((n, r) => n + (r[category]?.penalty || 0), 0);
  const unsized = rows.filter(r => r[category]?.penaltyUnsized).length;
  const label = CATEGORY_LABEL[category];
  // Portfolio-wide view: name the jurisdiction on each row and say how many
  // are represented, since they're no longer all the same one.
  const allJurisdictions = !government;
  const govCount = allJurisdictions ? new Set(rows.map(r => r.government)).size : 1;
  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={allJurisdictions ? `All ${label} applicable sites` : `${label} sites in ${government}`}
      >
        <div className={styles.modalHead} style={{ background: CATEGORY_COLOR[category] }}>
          <div>
            <div className={styles.modalTitle}>
              {allJurisdictions ? `${label}: all applicable sites` : `${government} · ${label}`}
            </div>
            <div className={styles.modalSub}>
              {rows.length.toLocaleString('en-US')} applicable site{rows.length === 1 ? '' : 's'}
              {allJurisdictions ? ` across ${govCount} jurisdiction${govCount === 1 ? '' : 's'}` : ''}
              {' · '}{usd(totalPenalty)}/yr max penalty
              {unsized ? ` · ${unsized} site${unsized === 1 ? '' : 's'} unsized` : ''}
            </div>
          </div>
          <div className={styles.modalHeadActions}>
            <button
              type="button"
              className={styles.modalExportBtn}
              onClick={onExport}
              title="Download these sites as an Excel workbook"
            >⬇ Export to Excel</button>
            <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className={styles.modalBody}>
          <div className={`${styles.tableScroll} ${styles.modalTableScroll}`}>
            <table className={styles.siteTable}>
              <thead>
                <tr>
                  <th>Site</th>
                  {allJurisdictions && <th>Jurisdiction</th>}
                  <th>City</th>
                  <th>State</th>
                  <th style={{ textAlign: 'right' }}>Sq Ft</th>
                  <th>Property Type</th>
                  <th>Policy</th>
                  <th>Deadline</th>
                  <th style={{ textAlign: 'right' }}>Max Yearly Penalty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e = r[category] || {};
                  return (
                    <tr
                      key={`${r.siteName}-${i}`}
                      className={styles.siteRowClickable}
                      onClick={() => onSiteClick(r)}
                      title="Open the full screening detail for this site"
                    >
                      <td className={styles.siteCell}>{r.siteName || '-'}</td>
                      {allJurisdictions && <td><strong>{r.government || '-'}</strong></td>}
                      <td>{r.city || '-'}</td>
                      <td>{r.state || '-'}</td>
                      <td style={{ textAlign: 'right' }}>{r.sqft != null ? r.sqft.toLocaleString('en-US') : '-'}</td>
                      <td>{r.propertyType || '-'}</td>
                      <td>{e.policyName || '-'}</td>
                      <td>{e.deadline ? mdY(e.deadline) : (e.deadlineRaw || '-')}</td>
                      <td style={{ textAlign: 'right' }}>
                        {e.penalty != null
                          ? usd(e.penalty)
                          : e.penaltyUnsized
                            ? <span className={styles.catFineNone}>{usd(e.penaltyRate)}/ft² · needs sq ft</span>
                            : <span className={styles.catFineNone}>no fine on file</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={allJurisdictions ? 8 : 7} style={{ fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{usd(totalPenalty)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// The sites behind a figure on a utility-feed card: either one utility's bar
// (`utility` set) or the card's whole eligible-sites total. This is the utility
// mapping view — the zip each site resolved from and the utilities it resolved
// to. Deliberately no BBS / Audits / BPS columns: eligibility is what picked
// the sites, and repeating it here buries the mapping the reader opened this
// for. The screening table above is where the compliance read lives.
function UtilityFeedSitesModal({ label, color, state, utility, rows, onExport, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const oneUtility = Boolean(utility);
  const utilCount = new Set(rows.map(r => `${r.feedState}||${r.feedUtility}`)).size;
  const stateCount = new Set(rows.map(r => r.feedState)).size;
  const title = oneUtility
    ? `${state ? `${state} · ` : ''}${utility} · ${label}`
    : `${label}: all eligible sites`;
  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHead} style={{ background: color }}>
          <div>
            <div className={styles.modalTitle}>{title}</div>
            <div className={styles.modalSub}>
              {rows.length.toLocaleString('en-US')} eligible site{rows.length === 1 ? '' : 's'}
              {oneUtility ? '' : ` · ${utilCount} utilit${utilCount === 1 ? 'y' : 'ies'} across ${stateCount} state${stateCount === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className={styles.modalHeadActions}>
            <button
              type="button"
              className={styles.modalExportBtn}
              onClick={onExport}
              title="Download these sites as an Excel workbook"
            >⬇ Export to Excel</button>
            <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className={styles.modalBody}>
          <div className={`${styles.tableScroll} ${styles.modalTableScroll}`}>
            <table className={styles.siteTable}>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>City</th>
                  <th>State</th>
                  <th>Zip</th>
                  <th>Electric Utility</th>
                  <th>Natural Gas Utility</th>
                  <th>Water Utility</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.siteName}-${i}`}>
                    <td className={styles.siteCell}>{r.siteName || '-'}</td>
                    <td>{r.city || '-'}</td>
                    <td>{r.feedState || r.state || '-'}</td>
                    <td>{r.zip || <span className={styles.dash}>-</span>}</td>
                    <td>{r.electricUtility || <span className={styles.dash}>-</span>}</td>
                    <td>{r.gasUtility || <span className={styles.dash}>-</span>}</td>
                    <td>{r.waterUtility || <span className={styles.dash}>-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Screens the Utility Lookup site list against the two-tab compliance
// reference (City Lookup → Government ID → Master Ordinances) and surfaces
// BBS / Audits / BPS eligibility, a summary dashboard, and the exportable
// branded report.
export function BuildingComplianceScreening({
  sites = [],
  // The unscoped list behind `sites` — drives the ownership toggle's
  // counts and tells an ownership-emptied view apart from no upload.
  allSites = null,
  ownedOnly = false,
  onOwnedOnlyChange = null,
  companyName = '',
}) {
  const loadedSites = allSites || sites;
  const [mode, setMode] = useState('sites'); // 'sites' | 'manual'
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  // The Whole Building Data download pulls its table over the network first.
  const [wbdBusy, setWbdBusy] = useState(false);
  const [onlyEligible, setOnlyEligible] = useState(true);
  // The screened site whose detail popup is open, if any.
  const [detailSite, setDetailSite] = useState(null);
  // The dashboard bar drilled into, as { category, government }. Opens the
  // list of sites behind that jurisdiction's count / penalty figure.
  const [drill, setDrill] = useState(null);
  // The utility-feed figure drilled into, as { commodity, state, utility }.
  // state/utility null means the card's whole eligible-sites total.
  const [feedDrill, setFeedDrill] = useState(null);
  // A pending "Export report (PDF)". Held in state rather than printed
  // straight from the click handler because the print furniture (the
  // generated-at stamp) has to be in the DOM before window.print() reads it —
  // the effect below fires on the commit that put it there.
  const [printJob, setPrintJob] = useState(null);

  const companyLabel = useMemo(() => sitesCompanyLabel(sites), [sites]);
  const results = useMemo(() => screenSites(sites), [sites]);
  const bpsRows = useMemo(() => bpsPrioritization(results), [results]);
  const matchedCount = useMemo(() => results.filter(r => r.matched).length, [results]);
  const anyEligibleCount = useMemo(
    () => results.filter(r => CATEGORIES.some(c => r[c]?.eligible === true)).length,
    [results],
  );
  // Fixed for the life of the mount, so the countdowns and the "today" marker
  // can't shift under a re-render mid-session.
  const todayTime = useMemo(() => utcToday(), []);

  // One lane per mandate: every deadline it brings due, published dates and
  // the ordinance's recurring cycle carried forward.
  const roadmapCharts = useMemo(() => {
    const todayISO = new Date(todayTime).toISOString().slice(0, 10);
    const lanes = CATEGORIES.map(c => ({
      key: c,
      label: CATEGORY_LABEL[c],
      color: CATEGORY_COLOR[c],
      points: deadlinesWithRecurrence(results, c, { todayISO, horizonYears: PROJECT_YEARS }),
      total: totalEligible(results, c),
    }));
    return { lanes };
  }, [results, todayTime]);

  // Every dated deadline across the portfolio, one row per date, counting the
  // sites each mandate brings due on it. Sorted earliest-first — the order the
  // work actually lands in.
  const roadmap = useMemo(() => {
    const map = new Map();
    for (const lane of roadmapCharts.lanes) {
      for (const p of lane.points) {
        if (!map.has(p.date)) map.set(p.date, { bbs: 0, audits: 0, bps: 0, projected: true });
        const row = map.get(p.date);
        row[lane.key] = p.count;
        // A date is only projected if nothing published lands on it.
        if (!p.projected) row.projected = false;
      }
    }
    return [...map.entries()]
      .map(([date, v]) => ({ date, ...v, total: v.bbs + v.audits + v.bps }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [roadmapCharts]);

  // The domain the lanes are drawn against. Today is inside it rather than
  // merely drawn on it, so the gap between now and the first deadline is a
  // real distance; a little padding keeps the end labels off the frame.
  const axis = useMemo(() => {
    const times = roadmapCharts.lanes.flatMap(l => l.points.map(p => isoTime(p.date)));
    let lo = Math.min(todayTime, ...times);
    let hi = Math.max(todayTime, ...times);
    if (!times.length || hi === lo) { lo = Math.min(lo, todayTime) - 120 * DAY; hi = Math.max(hi, todayTime) + 120 * DAY; }
    const pad = (hi - lo) * 0.05;
    return { lo: lo - pad, hi: hi + pad };
  }, [roadmapCharts, todayTime]);
  // The headline read on the roadmap: what's next, how much is still ahead,
  // and which single date carries the most work.
  const roadmapSummary = useMemo(() => {
    const dated = roadmap.map(r => ({ ...r, time: isoTime(r.date), days: Math.round((isoTime(r.date) - todayTime) / DAY) }));
    const ahead = dated.filter(r => r.days >= 0);
    const busiest = dated.reduce((a, b) => (b.total > (a?.total ?? -1) ? b : a), null);
    // Obligations the ordinance is silent on. They're real applicability with
    // nothing to plan against, so they can't sit on the timeline — but the
    // timeline shouldn't quietly drop them either.
    let undated = 0;
    for (const r of results) {
      for (const c of CATEGORIES) if (r[c]?.eligible === true && !r[c].deadline) undated++;
    }
    return {
      next: ahead[0] || null,
      passed: dated.length - ahead.length,
      aheadCount: ahead.length,
      aheadPublished: ahead.filter(r => !r.projected).length,
      aheadProjected: ahead.filter(r => r.projected).length,
      sitesAhead: ahead.reduce((s, r) => s + r.total, 0),
      busiest,
      undated,
    };
  }, [roadmap, results, todayTime]);
  // Whole Building Utility Data Collection reach: of the sites carrying a BBS
  // or BPS obligation, which utilities serve them.
  const utilityFeeds = useMemo(() => ({
    electric: utilityFeedEligibility(results, 'electric'),
    gas: utilityFeedEligibility(results, 'gas'),
  }), [results]);
  const jurisdictionCount = useMemo(() => new Set(results.filter(r => r.matched).map(r => r.govId)).size, [results]);

  const filtered = useMemo(() => {
    let out = results;
    if (onlyEligible) out = out.filter(r => CATEGORIES.some(c => r[c]?.eligible === true));
    const q = siteSearch.trim().toLowerCase();
    if (q) out = out.filter(r => `${r.siteName} ${r.city} ${r.state} ${r.government || ''}`.toLowerCase().includes(q));
    return out;
  }, [results, onlyEligible, siteSearch]);

  // Runs the print once the generated-at stamp has been committed to the DOM.
  // `printingReport` on the body is what src/print.css keys off to hide the
  // sidebar, subtab bar and toolbars and unwind the shell's scroll containers,
  // so an ordinary Ctrl-P elsewhere in the app is untouched.
  const printedJob = useRef(null);
  useEffect(() => {
    // StrictMode double-invokes effects in dev; without this the print dialog
    // opens twice for one click.
    if (!printJob || printedJob.current === printJob) return;
    printedJob.current = printJob;
    const body = document.body;
    body.classList.add('printingReport');
    // Some browsers fire afterprint, others just return from print() — clear
    // on both, idempotently, so the class can't outlive the dialog.
    const done = () => {
      body.classList.remove('printingReport');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try {
      window.print();
    } finally {
      // Deferred: Safari lays the print document out after print() returns.
      setTimeout(done, 1000);
    }
  }, [printJob]);

  // Manual single lookup.
  const manual = useMemo(() => {
    if (!city.trim()) return null;
    const govId = lookupGovId(city, state);
    const mandate = getMandates(govId);
    return { govId, mandate };
  }, [city, state]);

  // ---- downloads ----------------------------------------------------------
  // City Lookup: the reference table itself — every city the screening can
  // resolve, the jurisdiction it rolls up to, and that jurisdiction's headline
  // benchmarking terms. One row per city + state, so a member city (Silver
  // Spring under Montgomery County) is visible as its own line.
  function downloadCityLookup() {
    const juris = new Map(JURISDICTIONS.map(j => [j.govId, j]));
    const data = CITY_ROWS.map(([city, si, gi]) => {
      const [state, abbr, country] = STATES[si];
      const j = juris.get(GOV_IDS[gi]) || {};
      return {
        'City': city, 'State': state, 'State Abbreviation': abbr, 'Country': country,
        'Government ID': GOV_IDS[gi], 'Master City': j.masterCity || '',
        'BECS - Compliance Deadline': j.becsDeadline ? mdY(j.becsDeadline) : '',
        'BECS - Threshold': j.becsThreshold || '',
        'BECS - Policy Name': j.becsPolicyName || '',
        'BECS - Compliance Source': j.becsSource || '',
        'Efficiency - Deadline': j.efficiencyDeadline ? mdY(j.efficiencyDeadline) : '',
        'Efficiency - Threshold': j.efficiencyThreshold || '',
        'Notes': j.notes || '',
        'Data Required': j.dataRequired || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'City Lookup');
    XLSX.writeFile(wb, 'City-Lookup.xlsx');
  }
  // Master Ordinances: the full BBS/Audits/BPS reference, one row per Government ID.
  function downloadMasterOrdinances() {
    const data = MASTER_ORDINANCES.map(g => g.raw);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Ordinances Database');
    XLSX.writeFile(wb, 'Master-Ordinances-Database.xlsx');
  }
  // Whole Building Data By Utility: zip code → serving utility, and whether that
  // utility hands over aggregated whole-building data. The other two references
  // say what a site owes; this one says whether the data to report it can be
  // obtained. Fetched on click — 70k rows have no business in the page's chunk
  // for a button most sessions never press — so the button holds while it lands.
  async function downloadWholeBuildingData() {
    setWbdBusy(true);
    try {
      const { expandRows } = await import('../../data/wholeBuildingUtilities.js');
      const ws = XLSX.utils.json_to_sheet(expandRows());
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Whole Building Data');
      // SheetJS stores rather than deflates by default. On 70k rows of mostly
      // repeated text that is the difference between a 52 MB file and a 4 MB one.
      XLSX.writeFile(wb, 'Whole-Building-Data-By-Utility.xlsx', { compression: true });
    } finally {
      setWbdBusy(false);
    }
  }
  // Raw-data workbook that accompanies the PDF: a per-site screening sheet and
  // the full raw rows for every matched jurisdiction. "Applicable" is the
  // screening verdict — Yes only when the jurisdiction's ordinance is in force
  // AND the building clears the size requirement — so the column matches the
  // counts on the page. A site with no square footage is taken as clearing it
  // and reads "Yes — sq ft assumed", so the assumption travels with the data.
  //
  // `category` narrows the export to one mandate — the drill-down from a
  // dashboard bar. Those sheets carry that category's full source columns per
  // site (every "Audits - …" for an Energy Audits drill-down), so the sheet
  // answers what the ordinance requires without cross-referencing the
  // jurisdiction rows on the second tab.
  function writeRawWorkbook(rowsToExport, filename, { category = null } = {}) {
    const sourceCols = category ? categoryColumns(category) : [];
    const siteRows = rowsToExport.map(r => {
      const row = {
        Site: r.siteName, City: r.city, State: r.state,
        Jurisdiction: r.government || '', 'Government ID': r.govId || '',
        'Sq Ft': r.sqft ?? '', 'Property Type': r.propertyType || '',
        // Carried alongside the screening so the workbook holds every column
        // the site table shows, the utility feeds included.
        'Electric Utility': r.electricUtility || '', 'Natural Gas Utility': r.gasUtility || '',
      };
      for (const c of CATEGORIES) {
        const e = r[c];
        row[`${CATEGORY_LABEL[c]} Applicable`] = !e?.active ? 'No'
          : e.noDeadline ? 'No: no deadline published'
          : e.coveredType === false ? 'No: building type not covered'
          : e.eligible !== true ? 'No: below size requirement'
          : e.sizeAssumed ? 'Yes: sq ft assumed'
          : 'Yes';
        row[`${CATEGORY_LABEL[c]} Ordinance In Force`] = e?.active ? 'Yes' : 'No';
        row[`${CATEGORY_LABEL[c]} Policy`] = e?.policyName || '';
        row[`${CATEGORY_LABEL[c]} Deadline`] = e?.eligible === true ? (e.deadline ? mdY(e.deadline) : (e.deadlineRaw || '')) : '';
        row[`${CATEGORY_LABEL[c]} Size Requirement (ft²)`] = e?.threshold ?? '';
        row[`${CATEGORY_LABEL[c]} Meets Requirement`] = !e?.active ? ''
          : e.noDeadline ? 'n/a: no deadline published'
          : e.coveredType === false ? 'n/a: building type not covered'
          : e.sizeAssumed ? 'Assumed (no sq ft)'
          : e.meetsThreshold === true ? 'Yes'
          : e.meetsThreshold === false ? 'No'
          : '';
        row[`${CATEGORY_LABEL[c]} Max Yearly Penalty`] = e?.eligible === true ? (e.penalty ?? '') : '';
        // The obligations behind an Energy Audits hit — an energy audit, a
        // water audit, retro-commissioning, a tune-up — each of which is
        // separate work to scope.
        if (c === 'audits') row['Energy Audits Requirements'] = e?.active ? auditRequirementsLabel(getMandates(r.govId)) : '';
      }
      // One category's full reference columns, for a single-mandate export.
      if (sourceCols.length) {
        const raw = (r.matched && getMandates(r.govId)?.categoryRaw?.[category]) || {};
        for (const col of sourceCols) row[col] = sourceValue(col, raw[col]);
      }
      return row;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows), 'Site Screening');
    // Matched-jurisdiction raw rows. A jurisdiction split across several
    // Government IDs in the source workbook (Portland OR) contributes all of
    // them, so the reference behind a merged match is complete.
    const seen = new Set();
    const ordRows = [];
    for (const r of rowsToExport) {
      if (!r.matched || seen.has(r.govId)) continue;
      seen.add(r.govId);
      const g = getMandates(r.govId);
      for (const raw of (g?.raws?.length ? g.raws : [g?.raw])) {
        if (raw) ordRows.push(raw);
      }
    }
    if (ordRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordRows), 'Matched Ordinances');
    XLSX.writeFile(wb, filename);
  }

  // Export the deliverable: this page, printed (Save as PDF from the print
  // dialog), plus the accompanying raw-data Excel.
  //
  // This used to build a second, hand-written HTML report and print that
  // instead — a parallel implementation of the same screening that drifted
  // from the page it was meant to mirror, in palette, typography, chart
  // geometry and content alike. Printing the page itself is the only way the
  // PDF and the screen stay identical without being kept in sync by hand.
  // src/print.css hides the app chrome and unwinds the shell's scrollers for
  // the duration; `printingReport` scopes all of that to this button.
  function exportReport() {
    setPrintJob({ at: new Date().toLocaleString() });
    writeRawWorkbook(results, 'Building-Compliance-Screening-Data.xlsx');
  }
  // Formatted Excel version of the branded report (KPI tiles, roadmap +
  // penalty tables, and the same charts as images) — a spreadsheet twin of
  // the printable report, distinct from the raw-data workbook.
  async function exportExcelReport() {
    try {
      await exportComplianceReportXlsx(results, { generatedAt: new Date().toLocaleString(), siteCount: results.length, companyName: companyLabel || companyName });
    } catch (err) {
      console.error('Excel report export failed', err);
      alert('Could not build the Excel report: ' + (err?.message || 'unknown error'));
    }
  }

  // The filtered on-page view as an Excel (no report).
  function exportSiteData() {
    if (!filtered.length) { alert('No site results to export.'); return; }
    writeRawWorkbook(filtered, 'Building-Compliance-Screening.xlsx');
  }

  // The sites behind a figure on a dashboard card. With a `government` it's one
  // bar; without one it's the card's whole applicable-sites total. Both bar
  // lists drill into the same set — the dollar list is the penalty view of the
  // same applicable sites — so a jurisdiction with sites but no published fine
  // still opens. Ordered by jurisdiction then site so the portfolio-wide list
  // reads as groups rather than upload order.
  const drillRows = useMemo(() => {
    if (!drill) return [];
    const out = results.filter(r => r.matched
      && (!drill.government || r.government === drill.government)
      && r[drill.category]?.eligible === true);
    if (!drill.government) {
      out.sort((a, b) => String(a.government || '').localeCompare(String(b.government || ''))
        || String(a.siteName || '').localeCompare(String(b.siteName || '')));
    }
    return out;
  }, [results, drill]);

  function exportDrill() {
    if (!drillRows.length) return;
    writeRawWorkbook(
      drillRows,
      drill.government ? `${slug(drill.government)}-${slug(CATEGORY_LABEL[drill.category])}-Sites.xlsx` : `${slug(CATEGORY_LABEL[drill.category])}-Applicable-Sites.xlsx`,
      { category: drill.category },
    );
  }

  // The sites behind a utility-feed figure — one utility's bar, or the card's
  // whole total when no utility is set.
  const feedDrillRows = useMemo(
    () => (feedDrill ? utilityFeedSites(results, feedDrill.commodity, { state: feedDrill.state, utility: feedDrill.utility }) : []),
    [results, feedDrill],
  );

  // A utility-feed site as it reads in an export: the mapping on screen, so
  // the workbook and the modal carry the same columns. No BBS / BPS columns —
  // this sheet is the utility mapping, and the screening export is where the
  // eligibility read belongs.
  //
  // `wholeBuildingFor` adds the reference's terms for the utility this sheet
  // is about: what it meters, how it releases data, and whether that release
  // covers multifamily.
  //
  // Which utility that is has to be pinned down, because there is one set of
  // these columns and a site's utilities disagree — at 80525 the city
  // (electric, water) includes multifamily and Xcel (gas) doesn't. So the
  // sheet's own commodity decides: `feedUtility` is the electric utility on
  // the electric sheet and the gas utility on the gas sheet, which is the only
  // reading where a row describes the feed it was listed for. Blank when the
  // reference can't place the utility, rather than answering about another one.
  function feedSiteRow(r, wholeBuildingFor) {
    const row = {
      Site: r.siteName || '',
      City: r.city || '',
      State: r.feedState || r.mandateState || r.state || '',
      Zip: r.zip || '',
      'Electric Utility': r.electricUtility || '',
      'Natural Gas Utility': r.gasUtility || '',
      'Water Utility': r.waterUtility || '',
    };
    return wholeBuildingFor ? { ...row, ...wholeBuildingFor(r.zip, r.feedUtility || r.electricUtility) } : row;
  }
  // The card's bars as rows — the counts on screen, so the workbook opens on
  // the same summary the reader clicked from.
  const feedSummaryRows = (feed) => feed.rows.map(r => ({ State: r.state || '', Utility: r.utility, 'Eligible Sites': r.count }));

  function writeSheets(sheets, filename) {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of sheets) {
      if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    }
    if (!wb.SheetNames.length) return;
    XLSX.writeFile(wb, filename);
  }

  // Both utility-feed cards in one workbook: the per-utility counts and the
  // sites behind them, for each commodity.
  async function exportUtilityFeeds() {
    const wholeBuildingFor = await loadWholeBuildingLookup();
    const sheets = [];
    for (const { key, feed, label } of FEED_CARDS.map(f => ({ ...f, feed: utilityFeeds[f.key] }))) {
      if (!feed.total) continue;
      sheets.push([`${label} Summary`, feedSummaryRows(feed)]);
      sheets.push([`${label} Sites`, utilityFeedSites(results, key).map(r => feedSiteRow(r, wholeBuildingFor))]);
    }
    if (!sheets.length) { alert('No utility feed data to export.'); return; }
    writeSheets(sheets, 'Utility-Feed-Eligibility.xlsx');
  }

  async function exportFeedDrill() {
    if (!feedDrillRows.length) return;
    const card = FEED_CARDS.find(f => f.key === feedDrill.commodity);
    const name = feedDrill.utility
      ? `${slug(feedDrill.state)}-${slug(feedDrill.utility)}-${card.abbr}-Sites.xlsx`
      : `${card.abbr}-Utility-Feed-Sites.xlsx`;
    const wholeBuildingFor = await loadWholeBuildingLookup();
    writeSheets([[`${card.label} Sites`, feedDrillRows.map(r => feedSiteRow(r, wholeBuildingFor))]], name.replace(/^-+/, ''));
  }

  // Owned / All-sites control. Only rendered when the parent owns the
  // scope state — a standalone mount screens whatever it's handed. Wrapped
  // rather than styled in place: the bar is shared with the roadmap subtab and
  // carries its own inline styles, and only this page prints.
  const scopeBar = onOwnedOnlyChange
    ? (
      <div className={styles.screenOnly}>
        <OwnershipScopeBar sites={loadedSites} ownedOnly={ownedOnly} onChange={onOwnedOnlyChange} />
      </div>
    )
    : null;

  return (
    // `data-print-root` is what src/print.css keeps visible when "Export
    // report (PDF)" prints the page — everything outside it is app chrome.
    <div className={styles.wrapper} data-print-root>
      <div className={styles.brandBand}>
        <div className={styles.brandBandLeft}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {companyLabel && (
              <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.01em', lineHeight: 1.2 }}>{companyLabel}</div>
            )}
            <h1 className={styles.title} style={{ color: '#fff' }}>Building Compliance Screening &amp; Roadmap</h1>
          </div>
        </div>
        <span className={styles.brandLogo} dangerouslySetInnerHTML={{ __html: schneiderLogoSvg({ onDark: true, width: 172 }) }} />
      </div>
      <div className={styles.header}>
        <div>
          <div className={styles.subtitle}>
            Screens each Utility Lookup site: <strong>city + state → Government ID</strong> (City Lookup),
            then <strong>Government ID → BBS / Audits / BPS mandates</strong> (Master Ordinances).
            {' '}· <strong>{CITY_ROWS.length.toLocaleString('en-US')}</strong> cities across <strong>{MASTER_ORDINANCES.length}</strong> jurisdictions on file.
            {/* The mandates say what a site owes; this says whether the data to
                report it can be had. Cited here so the third reference reads as
                part of the same chain rather than an unexplained download. */}
            <br />
            Whole Building Data adds <strong>zip code → serving utility</strong>, and whether that utility
            releases aggregated whole-building data to report with.
            {' '}· <strong>{WHOLE_BUILDING_META.zips.toLocaleString('en-US')}</strong> zip codes
            across <strong>{WHOLE_BUILDING_META.utilities.toLocaleString('en-US')}</strong> utilities on file.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={downloadCityLookup} title={`Download the City Lookup table: ${CITY_ROWS.length.toLocaleString('en-US')} cities, each with the Government ID it screens against`}>City Lookup</button>
          <button type="button" className={styles.btn} onClick={downloadMasterOrdinances} title="Download the Master Ordinances Database (Government ID → BBS/Audits/BPS)">Master Ordinances</button>
          <button
            type="button"
            className={styles.btn}
            onClick={downloadWholeBuildingData}
            disabled={wbdBusy}
            title={`Download Whole Building Data By Utility: ${WHOLE_BUILDING_META.rows.toLocaleString('en-US')} zip code + utility rows, each with that utility's aggregated whole-building data offering and benchmarking contact`}
          >
            {wbdBusy ? 'Preparing…' : 'Whole Building Data'}
          </button>
          <button type="button" className={styles.btnPrimary} onClick={exportReport} title="Open the branded report (print / Save as PDF) and download the accompanying raw-data Excel">Export report (PDF)</button>
          <button type="button" className={styles.btnPrimary} onClick={exportExcelReport} disabled={sites.length === 0} title="Download the branded report as a formatted Excel workbook (KPI tiles, roadmap + penalty tables, charts)">Export report (Excel)</button>
        </div>
      </div>

      <div className={styles.modeToggle}>
        <button type="button" className={mode === 'sites' ? styles.modeActive : styles.mode} onClick={() => setMode('sites')}>Site list{sites.length ? ` (${sites.length})` : ''}</button>
        <button type="button" className={mode === 'manual' ? styles.modeActive : styles.mode} onClick={() => setMode('manual')}>Single lookup</button>
      </div>

      {mode === 'sites' ? (
        loadedSites.length === 0 ? (
          <div className={styles.noMatch}>
            <strong>No site list loaded.</strong>
            <div className={styles.noMatchSub}>
              Upload a site list on the <strong>Utility Lookup</strong> subtab (with City, State, and, for eligibility, a
              square-footage / property-type column) and every site is screened here automatically.
            </div>
          </div>
        ) : sites.length === 0 ? (
          <>
            {scopeBar}
            <div className={styles.noMatch}>
              <strong>No owned sites in the loaded list.</strong>
              <div className={styles.noMatchSub}>
                All {loadedSites.length.toLocaleString()} loaded site{loadedSites.length === 1 ? ' is' : 's are'} leased or
                carry no ownership status, so the owned-only scope leaves nothing to screen. Switch to
                {' '}<strong>All sites</strong> above, or map the Ownership column on the <strong>Utility Lookup</strong> subtab.
              </div>
            </div>
          </>
        ) : (
          <>
            {scopeBar}
            {/* Report furniture. Both the generated-at stamp and the
                disclaimer are print-only: on a live page the first has no
                meaningful "generated" time, and the second is deliverable
                boilerplate that only needs to travel with the exported PDF.
                They still live here rather than in a separate export template
                because the PDF is this page printed. */}
            <div className={styles.reportMeta}>
              <div className={styles.reportCounts}>
                {printJob && <div className={styles.printOnly}>Generated {printJob.at}</div>}
                {/* Screen only: the KPI tiles a few lines down carry sites
                    screened, sites with a mandate and jurisdictions matched, so
                    on paper this is the same three numbers twice. */}
                <div className={styles.screenOnly}><strong>{results.length}</strong> sites · <strong>{matchedCount}</strong> matched · <strong>{jurisdictionCount}</strong> jurisdictions</div>
              </div>
            </div>
            <div className={`${styles.disclaimerBox} ${styles.printOnly}`}>
              <span className={styles.disclaimerTitle}>DISCLAIMER, PLEASE READ</span>
              <span className={styles.disclaimer}>{DISCLAIMER}</span>
            </div>
            {/* KPI summary strip — portfolio-level headline figures. */}
            <div className={styles.kpiStrip}>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#009530' }} />
                <div className={styles.kpiTileVal}>{results.length}</div>
                <div className={styles.kpiTileLbl}>Sites screened</div>
              </div>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#3DCD58' }} />
                <div className={styles.kpiTileVal}>{anyEligibleCount}</div>
                <div className={styles.kpiTileLbl}>Sites with a mandate</div>
              </div>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#29ABE2' }} />
                <div className={styles.kpiTileVal}>{jurisdictionCount}</div>
                <div className={styles.kpiTileLbl}>Jurisdictions matched</div>
              </div>
              <div className={styles.kpiTile}>
                <div className={styles.kpiTileTop} style={{ background: '#F7941E' }} />
                <div className={styles.kpiTileVal}>{usd(CATEGORIES.reduce((s, c) => s + totalPenalty(results, c), 0))}</div>
                <div className={styles.kpiTileLbl}>Est. max yearly exposure</div>
              </div>
            </div>

            {/* Compliance roadmap — every dated deadline across the portfolio,
                with the sites each mandate brings due on it, beside the same
                counts as a per-category column chart. */}
            <div className={styles.sectionTitle}>Compliance Roadmap Upcoming Deadlines</div>
            {/* What's next, how much is left, and where the heaviest date is —
                the three questions asked of a roadmap before any single row
                of it matters. */}
            <div className={styles.rmSummary}>
              <div className={`${styles.rmSumTile} ${styles.rmSumNext}`}>
                <div className={styles.rmSumLbl}>Next deadline</div>
                {roadmapSummary.next ? (
                  <>
                    <div className={styles.rmSumVal}>{mdY(roadmapSummary.next.date)}</div>
                    <div className={styles.rmSumSub}>
                      {relDue(roadmapSummary.next.days)} · {roadmapSummary.next.total} site{roadmapSummary.next.total === 1 ? '' : 's'} due
                      {roadmapSummary.next.projected ? ' · projected' : ''}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.rmSumVal}>-</div>
                    <div className={styles.rmSumSub}>{roadmap.length ? 'every dated deadline has passed' : 'no dated deadlines'}</div>
                  </>
                )}
              </div>
              <div className={styles.rmSumTile}>
                <div className={styles.rmSumLbl}>Deadlines ahead</div>
                <div className={styles.rmSumVal}>{roadmapSummary.aheadCount}</div>
                <div className={styles.rmSumSub}>
                  {roadmapSummary.aheadPublished} published · {roadmapSummary.aheadProjected} projected
                </div>
              </div>
              {/* Counts every recurrence in the window, not just the first
                  filing — which is the point of projecting them. */}
              <div className={styles.rmSumTile}>
                <div className={styles.rmSumLbl}>Filings ahead</div>
                <div className={styles.rmSumVal}>{roadmapSummary.sitesAhead}</div>
                <div className={styles.rmSumSub}>site filings over the next {PROJECT_YEARS} years</div>
              </div>
              <div className={styles.rmSumTile}>
                <div className={styles.rmSumLbl}>Busiest deadline</div>
                <div className={styles.rmSumVal}>{roadmapSummary.busiest ? mdY(roadmapSummary.busiest.date) : '-'}</div>
                <div className={styles.rmSumSub}>
                  {roadmapSummary.busiest ? `${roadmapSummary.busiest.total} sites land on one date` : 'nothing scheduled'}
                </div>
              </div>
            </div>

            {/* One lane per mandate, each deadline a labelled dot on it, so
                reading across a date says what falls due and when. */}
            <div className={styles.panelWrap}>
              <div className={styles.tlHead}>
                <span className={styles.tlHeadTitle}>
                  Key compliance deadlines
                  <span className={styles.tlHeadSub}>{': '}one lane per mandate</span>
                </span>
              </div>
              <div className={styles.tlChart}>
                {roadmap.length
                  ? <DeadlineLanes lanes={roadmapCharts.lanes} ax={axis} todayTime={todayTime} />
                  : <div className={styles.miniEmpty}>No dated deadlines across the screened portfolio.</div>}
              </div>
            </div>
            {roadmapSummary.undated > 0 && (
              <div className={styles.rmFootnote}>
                <strong>{roadmapSummary.undated}</strong> applicable mandate{roadmapSummary.undated === 1 ? '' : 's'} publish
                {roadmapSummary.undated === 1 ? 'es' : ''} no compliance deadline, so {roadmapSummary.undated === 1 ? 'it isn’t' : 'they aren’t'} on
                the timeline: there is nothing due and nothing to plan against.
              </div>
            )}

            {/* Summary dashboard — the same figures the exported report charts. */}
            <div className={styles.sectionTitle}>Total Eligible Sites by Requirement</div>
            <div className={styles.dashGrid}>
              {CATEGORIES.map(c => (
                <div key={c} className={styles.dashCard}>
                  <div className={styles.dashHead} style={{ background: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]} Eligibility</div>
                  <div className={styles.dashKpis}>
                    {/* Both totals open the same list — every site this mandate
                        applies to, across all jurisdictions — so the headline
                        figure is as traceable as the per-city bars. */}
                    <button
                      type="button"
                      className={styles.dashKpiBtn}
                      onClick={() => setDrill({ category: c, government: null })}
                      disabled={totalEligible(results, c) === 0}
                      title={`Show all ${CATEGORY_LABEL[c]} applicable sites`}
                    >
                      <div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{totalEligible(results, c)}</div>
                      <div className={styles.kpiLbl}>applicable sites</div>
                    </button>
                    <button
                      type="button"
                      className={styles.dashKpiBtn}
                      onClick={() => setDrill({ category: c, government: null })}
                      disabled={totalEligible(results, c) === 0}
                      title={`Show the ${CATEGORY_LABEL[c]} sites behind this figure`}
                    >
                      <div className={styles.kpiNum} style={{ color: CATEGORY_COLOR[c] }}>{usd(totalPenalty(results, c))}</div>
                      <div className={styles.kpiLbl}>max yearly penalty</div>
                    </button>
                  </div>
                  <div className={styles.dashSubhead}>Applicable sites by jurisdiction <span className={styles.dashHint}>· click a city for its sites</span></div>
                  <HBars
                    items={eligibilityByOrdinance(results, c).map(x => ({ label: x.government, value: x.count }))}
                    color={CATEGORY_COLOR[c]}
                    onSelect={(government) => setDrill({ category: c, government })}
                  />
                  {/* The same jurisdictions in dollars — what the mandate is
                      actually worth, which the site counts alone don't say. */}
                  <div className={styles.dashSubhead}>Max yearly fines by jurisdiction <span className={styles.dashHint}>· click a city for its sites</span></div>
                  <HBars
                    items={penaltyByOrdinance(results, c).map(x => ({ label: x.government, value: x.penalty }))}
                    color={CATEGORY_COLOR[c]}
                    fmt={usd}
                    wide
                    empty="No fines on file"
                    onSelect={(government) => setDrill({ category: c, government })}
                  />
                </div>
              ))}
            </div>

            {/* BPS — Prioritization: one row per (deadline, jurisdiction) over
                the BPS-eligible sites. Mirrors the compliance exports and the
                Master Analysis overview. */}
            {bpsRows.length > 0 && (
              <div className={styles.bpsSection}>
                <div className={styles.bpsTitle}>BPS Prioritization</div>
                <div className={styles.tableScroll}>
                  <table className={styles.siteTable}>
                    <thead>
                      <tr>
                        <th>Upcoming Deadline</th>
                        <th>Compliance Government</th>
                        <th>BPS Fines for Exceeding Limits</th>
                        <th style={{ textAlign: 'right' }}>Number of eligible sites</th>
                        <th style={{ textAlign: 'right' }}>Sum of Est. Penalty for non-reporting on BPS</th>
                        <th>Fee for exceeding limits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bpsRows.map((g, i) => (
                        <tr key={i}>
                          <td>{g.deadline ? mdY(g.deadline) : '-'}</td>
                          <td><strong>{g.government || '-'}</strong></td>
                          <td>{g.fine}</td>
                          <td style={{ textAlign: 'right' }}>{g.sites.toLocaleString('en-US')}</td>
                          <td style={{ textAlign: 'right' }}>{g.penaltyKnown ? usd(g.penalty) : '-'}</td>
                          <td style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{g.feeExceeding}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Whole Building Utility Data Collection reach — the service
                behind the BBS and BPS offerings only works where the site's
                utilities publish whole-building data, so which utilities serve
                the obligated sites decides what can actually be delivered. */}
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>Eligibility per Data Stream for Utility Feeds</div>
              <button
                type="button"
                className={`${styles.btn} ${styles.sectionAction}`}
                onClick={exportUtilityFeeds}
                disabled={!utilityFeeds.electric.total && !utilityFeeds.gas.total}
                title="Download both utility feeds (the per-utility counts and the sites behind them) as an Excel workbook"
              >Export utility feeds</button>
            </div>
            <div className={styles.wbudcNote}>
              The Whole Building Utility Data Collection (WBUDC) service supports BPS and BBS offerings via
              whole-building data collection; applicability depends on whether the site&apos;s utilities provide
              this option.
            </div>
            <div className={styles.feedGrid}>
              {FEED_CARDS.map(({ key, label, color }) => {
                const feed = utilityFeeds[key];
                // The bar label carries the state, so the drill-down has to map
                // it back to the (state, utility) pair it was built from.
                const byLabel = new Map(feed.rows.map(r => [`${r.state ? `${r.state} · ` : ''}${r.utility}`, r]));
                return (
                  <div key={key} className={styles.dashCard}>
                    <div className={styles.dashHead} style={{ background: color }}>{label} Utility Feeds</div>
                    <button
                      type="button"
                      className={`${styles.feedKpi} ${styles.feedKpiBtn}`}
                      onClick={() => setFeedDrill({ commodity: key, state: null, utility: null })}
                      disabled={feed.total === 0}
                      title={`Show every ${label} eligible site`}
                    >
                      <span className={styles.feedKpiNum} style={{ borderColor: color, color }}>{feed.total}</span>
                      <span className={styles.kpiLbl}>total eligible sites</span>
                    </button>
                    <div className={styles.dashSubhead}>
                      Eligible sites per utility (grouped by state) <span className={styles.dashHint}>· click a utility for its sites</span>
                    </div>
                    <HBars
                      items={feed.rows.map(r => ({ label: `${r.state ? `${r.state} · ` : ''}${r.utility}`, value: r.count }))}
                      color={color}
                      wide
                      empty="No utilities on the obligated sites"
                      onSelect={(barLabel) => {
                        const row = byLabel.get(barLabel);
                        if (row) setFeedDrill({ commodity: key, state: row.state, utility: row.utility });
                      }}
                    />
                  </div>
                );
              })}
            </div>

            <div className={styles.sectionTitle}>Site-by-Site Mandate Detail</div>
            <div className={styles.wbudcNote}>
              Every screened site and the specific BBS / Energy Audits / BPS mandates that apply to it, each with
              its compliance deadline and estimated max yearly penalty.
            </div>
            <div className={styles.siteToolbar}>
              <input className={styles.searchInput} type="text" placeholder="Search sites, cities, jurisdictions…" value={siteSearch} onChange={e => setSiteSearch(e.target.value)} />
              <label className={styles.checkLabel}>
                <input type="checkbox" checked={onlyEligible} onChange={e => setOnlyEligible(e.target.checked)} />
                Only sites with a mandate
              </label>
              <span className={styles.siteStat}>
                <strong>{anyEligibleCount}</strong> with a mandate · {matchedCount} matched a jurisdiction · {results.length} total
              </span>
              <button type="button" className={styles.btn} onClick={exportSiteData} disabled={!filtered.length}>Export site data</button>
            </div>

            <div className={styles.tableScroll}>
              <table className={`${styles.siteTable} ${styles.siteDetailTable}`}>
                <thead>
                  <tr>
                    <th>Site</th><th>City</th><th>State</th><th>Jurisdiction</th><th>Gov ID</th><th>Sq Ft</th>
                    <th>Electric Utility</th><th>Natural Gas Utility</th>
                    <th>BBS</th><th>Energy Audits</th><th>Audit Required</th><th>BPS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr
                      key={r.id}
                      className={styles.siteRowClickable}
                      onClick={() => setDetailSite(r)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailSite(r); } }}
                      tabIndex={0}
                      role="button"
                      title="Open the mandate detail for this site"
                    >
                      <td className={styles.siteCell}>{r.siteName || <span className={styles.dash}>-</span>}</td>
                      <td>{r.city || <span className={styles.dash}>-</span>}</td>
                      <td>{r.state || <span className={styles.dash}>-</span>}</td>
                      <td>{r.matched ? r.government : <span className={styles.dash}>no match</span>}</td>
                      <td>{r.govId ? <span className={styles.govIdCell}>{r.govId}</span> : <span className={styles.dash}>-</span>}</td>
                      <td>{r.sqft != null ? r.sqft.toLocaleString() : <span className={styles.dash}>-</span>}</td>
                      {/* Same two columns, and the same source fields, as the
                          utility-feed drill-down modal. Shown for every site,
                          not just the ones the WBUDC cards count: those cards
                          total the sites carrying a BBS or BPS mandate AND a
                          known utility, which is a narrower set than this
                          table lists. */}
                      <td>{r.electricUtility || <span className={styles.dash}>-</span>}</td>
                      <td>{r.gasUtility || <span className={styles.dash}>-</span>}</td>
                      <td><CatCell res={r.bbs} /></td>
                      <td><CatCell res={r.audits} /></td>
                      <td><AuditTypeCell res={r.audits} /></td>
                      <td><CatCell res={r.bps} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={12} className={styles.emptyRow}>No sites match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {drill && (
              <JurisdictionSitesModal
                category={drill.category}
                government={drill.government}
                rows={drillRows}
                onExport={exportDrill}
                onSiteClick={(site) => { setDrill(null); setDetailSite(site); }}
                onClose={() => setDrill(null)}
              />
            )}
            {feedDrill && (
              <UtilityFeedSitesModal
                label={`${FEED_CARDS.find(f => f.key === feedDrill.commodity).label} Utility Feeds`}
                color={FEED_CARDS.find(f => f.key === feedDrill.commodity).color}
                state={feedDrill.state}
                utility={feedDrill.utility}
                rows={feedDrillRows}
                onExport={exportFeedDrill}
                onClose={() => setFeedDrill(null)}
              />
            )}
            {detailSite && <SiteDetailModal site={detailSite} onClose={() => setDetailSite(null)} />}
          </>
        )
      ) : (
        <>
          <div className={styles.lookupCard}>
            <div className={styles.fields}>
              <label className={styles.field}><span className={styles.fieldLabel}>City</span>
                <input className={styles.input} type="text" placeholder="e.g. Seattle" value={city} onChange={e => setCity(e.target.value)} autoFocus /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>State / Province</span>
                <input className={styles.input} type="text" placeholder="e.g. WA or Washington" value={state} onChange={e => setState(e.target.value)} /></label>
            </div>
            <div className={styles.hint}>Resolves the city + state to a Government ID, then shows that jurisdiction's BBS / Audits / BPS mandates.</div>
          </div>
          {!city.trim() ? (
            <div className={styles.muted}>Enter a city to run the lookup.</div>
          ) : !manual?.mandate ? (
            <div className={styles.noMatch}>
              <strong>No jurisdiction found</strong> for “{city.trim()}{state.trim() ? `, ${state.trim()}` : ''}”.
              <div className={styles.noMatchSub}>The City Lookup has no benchmarking or performance ordinance covering this city+state. A city name with no state is only resolved when one jurisdiction carries it: “Portland” could be Maine or Oregon.</div>
            </div>
          ) : (
            <div className={styles.manualResult}>
              <div className={styles.manualHead}>{manual.mandate.government}, {manual.mandate.state} <span className={styles.govId}>{manual.govId}</span></div>
              <div className={styles.dashGrid}>
                {CATEGORIES.map(c => {
                  const cat = manual.mandate[c];
                  return (
                    <div key={c} className={styles.dashCard}>
                      <div className={styles.dashHead} style={{ background: CATEGORY_COLOR[c] }}>{CATEGORY_LABEL[c]}</div>
                      <div className={styles.manualBody}>
                        <div><strong>{cat.policyName || cat.ordinanceName || '-'}</strong></div>
                        <div className={styles.manualMeta}>Status: {cat.status || '-'}</div>
                        <div className={styles.manualMeta}>Deadline: {cat.deadline ? mdY(cat.deadline) : (cat.deadlineRaw || '-')}</div>
                        <div className={styles.manualMeta}>Max penalty: {cat.maxPenalty != null ? `${usd(cat.maxPenalty)}/yr` : '-'}</div>
                        {c === 'audits' && cat.active && auditRequirements(manual.mandate).map(rq => (
                          <div key={rq.key} className={styles.manualMeta}>{rq.label}: {rq.value}</div>
                        ))}
                        {(cat.link || cat.url) && isUrl(cat.link || cat.url) && (
                          <div><a href={cat.link || cat.url} target="_blank" rel="noopener noreferrer">Ordinance link</a></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      {/* Print-only page furniture — the one thing the PDF carries that the
          screen has no use for. */}
      {printJob && (
        <div className={`${styles.printOnly} ${styles.printFooter}`}>
          <span className={styles.printFooterBrand}>Schneider Electric</span>
          {' · '}Generated {printJob.at}
          {' · '}{matchedCount} of {results.length} sites matched a jurisdiction · Public
        </div>
      )}
    </div>
  );
}
