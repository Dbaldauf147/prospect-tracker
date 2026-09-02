import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import MASTER_ORDINANCES from '../../data/masterOrdinances.js';
import {
  mandateFormValues, overridePatchFrom, overrideFor, THRESHOLD_KEYS, STATUS_OPTIONS,
} from '../../utils/ordinanceOverrides.js';
import { STATES, GOV_IDS, JURISDICTIONS, CITY_ROWS } from '../../data/complianceCityLookup.js';
// Counts only — the table itself is ~70k rows and is dynamic-imported inside
// the download handler, so it never lands in this page's chunk.
import { WHOLE_BUILDING_META } from '../../data/wholeBuildingUtilitiesMeta.js';
import {
  screenSites, lookupGovId, getMandates,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  totalEligible, eligibilityByOrdinance, totalPenalty, penaltyByOrdinance, sitesCompanyLabel,
  bpsPrioritization, penaltyBasis, auditRequirements, auditRequirementsLabel, categoryColumns,
  deadlinesWithRecurrence, sitesForDeadline, utilityFeedEligibility, utilityFeedSites,
} from '../../utils/complianceMandates';
import { exportComplianceReportXlsx } from '../../utils/complianceReportXlsx';
import {
  loadWholeBuildingLookup, withWholeBuildingUtilities, MATCH_LABEL,
  wholeBuildingForSite, WB_COMMODITIES,
} from '../../utils/wholeBuildingLookup';
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
// And how far back the timeline looks. Deadlines older than this are off the
// chart entirely: they're settled one way or the other, and the room they take
// belongs to the years still being planned.
const LOOKBACK_YEARS = 1;
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
// The chart lays itself out in viewBox units and scales to whatever width
// its panel has, so a WIDER canvas here means the same picture drawn with
// more room between dates — the labels come back a touch smaller, and a
// dense lane gets the space its labels need. Every position takes the
// width it is being drawn in rather than reading the constant, so one
// chart can be wider than another on the same page.
const tlX = (t, ax, W = TL.W) => TL.padL + ((t - ax.lo) / (ax.hi - ax.lo)) * (W - TL.padL - TL.padR);

// Year boundaries, so the axis reads as elapsed time rather than as a row of
// ticks. Quarters instead when the whole span is inside a couple of years,
// which is where most portfolios sit.
function axisTicks(ax, W = TL.W) {
  const out = [];
  const y0 = new Date(ax.lo).getUTCFullYear(), y1 = new Date(ax.hi).getUTCFullYear();
  const byQuarter = (ax.hi - ax.lo) < 800 * DAY;
  for (let y = y0; y <= y1; y++) {
    for (const m of (byQuarter ? [0, 3, 6, 9] : [0])) {
      const t = Date.UTC(y, m, 1);
      if (t <= ax.lo || t >= ax.hi) continue;
      out.push({ t, px: tlX(t, ax, W), label: m === 0 ? String(y) : `${MONTHS[m]} ${y}`, major: m === 0 });
    }
  }
  return out;
}

// Today, drawn the same way on both charts.
function TodayMark({ ax, todayTime, y1, y2, label = true, W = TL.W }) {
  const px = tlX(todayTime, ax, W);
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
// within weeks, then nothing for two years), so the dates that arrive together
// are labelled together: one block of "count · date" rows, tied to the dots it
// describes by a single leader. Every date keeps its own dot on its own true
// date — what the grouping changes is only where the reading of it is printed.
function DeadlineLanes({ lanes, ax, todayTime, onPick = null }) {
  const padT = 26, padB = 6;
  const W = TL.W;
  // A row prints the count right-aligned and the date left-aligned either side
  // of the block's spine, so the numbers line up as a little table. These are
  // rough advance widths at the two font sizes below — generous, which is the
  // safe direction: it groups a shade earlier rather than letting two blocks
  // touch.
  const NUM_CH = 6.2, DATE_CH = 4.6;
  const numW = (p) => String(p.count).length * NUM_CH + 3;
  const ROW_H = 12;      // vertical pitch between rows inside a block
  const ROW1 = 22;       // baseline of a block's first row, under its dots
  const TIE_Y = 6;       // the tie that spans a group's dots
  const GAP = 10;        // clear space between one block and the next

  const todayX = tlX(todayTime, ax, W);
  const placed = lanes.map(lane => {
    const pts = lane.points.map(p => ({ ...p, cx: tlX(isoTime(p.date), ax, W) }));
    // A block hangs under the middle of the dates it covers, clamped to stay
    // inside the plot — a group at either end of the axis would otherwise
    // print into the lane-label gutter or off the right frame.
    const blockOf = (cl) => {
      // A date's year is normally the axis's job — the ticks are years, and the
      // block sits under the year it belongs to. A group that has swallowed a
      // year boundary can't lean on that, so those rows carry the year too;
      // otherwise "12/31" over "5/1" reads as the wrong way round.
      const spansYears = cl[0].date.slice(0, 4) !== cl[cl.length - 1].date.slice(0, 4);
      const rows = cl.map(p => ({ ...p, dateLabel: spansYears ? `${md(p.date)}/${p.date.slice(2, 4)}` : md(p.date) }));
      const lw = Math.max(...rows.map(numW));
      const rw = Math.max(...rows.map(p => p.dateLabel.length * DATE_CH + 3));
      const mid = (rows[0].cx + rows[rows.length - 1].cx) / 2;
      const gx = Math.min(Math.max(mid, TL.padL + lw), W - TL.padR - rw);
      return { cl: rows, lw, rw, gx };
    };
    // Start with one block per date and merge neighbours until none overlap.
    // Merging is free vertically — a block grows a row, not a column — so
    // dates that land within weeks of each other end up reading as the one
    // group they are, instead of as a thicket of leader lines.
    let blocks = pts.map(p => blockOf([p]));
    for (let guard = 0; guard < pts.length; guard += 1) {
      const i = blocks.findIndex((b, k) => {
        const next = blocks[k + 1];
        return next && b.gx + b.rw + GAP > next.gx - next.lw;
      });
      if (i === -1) break;
      blocks.splice(i, 2, blockOf([...blocks[i].cl, ...blocks[i + 1].cl]));
    }
    const labels = [];
    const ties = [];
    for (const b of blocks) {
      b.cl.forEach((p, k) => labels.push({ ...p, gx: b.gx, lw: b.lw, rw: b.rw, dy: ROW1 + k * ROW_H }));
      const x1 = Math.min(b.cl[0].cx, b.gx), x2 = Math.max(b.cl[b.cl.length - 1].cx, b.gx);
      ties.push({ gx: b.gx, x1, x2, spread: x2 - x1 > 2 });
    }
    return { labels, ties };
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
  const ticks = axisTicks(ax, W);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Compliance deadlines by mandate over time">
      {lanes.map((lane, i) => (
        i % 2 === 1 ? (
          <rect key={`band${lane.key}`} x="0" y={laneTops[i]} width={W} height={laneHeights[i]} fill="#F8FAFC" />
        ) : null
      ))}
      {ticks.map(t => (
        <g key={t.t}>
          <line x1={t.px} y1={padT - 12} x2={t.px} y2={padT + bodyH} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3 3" />
          {/* The TODAY caption owns its stretch of the header — a tick label
              under it prints as one illegible word. Compared as boxes, since
              a quarter label is twice the width of a year. */}
          {!(t.px + 4 < todayX + 27 && t.px + 4 + (t.major ? 26 : 48) > todayX - 27) && (
            <text x={t.px + 4} y={padT - 15} fontSize={t.major ? 11 : 9} fontWeight={t.major ? 800 : 600} fill={t.major ? '#94A3B8' : '#CBD5E1'}>{t.label}</text>
          )}
        </g>
      ))}
      <TodayMark ax={ax} todayTime={todayTime} y1={padT - 10} y2={padT + bodyH} W={W} />
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
            <line x1={TL.padL} y1={dotY} x2={W - TL.padR} y2={dotY} stroke="#E2E8F0" strokeWidth="1" />
            {/* One leader per group, drawn before the dots and labels so it
                sits under them: a tie under the dots the group covers, with a
                turned-down tick at each end, and a single line running from
                that tie down into the block of dates. A group of one gets the
                line alone — there is nothing to gather. */}
            {placed[i].ties.map(t => (
              <path
                key={`tie${t.gx}-${t.x1}`}
                d={(t.spread
                  ? `M${t.x1} ${dotY + TIE_Y} L${t.x2} ${dotY + TIE_Y}
                     M${t.x1} ${dotY + TIE_Y} L${t.x1} ${dotY + TIE_Y - 4}
                     M${t.x2} ${dotY + TIE_Y} L${t.x2} ${dotY + TIE_Y - 4} `
                  : '')
                  + `M${t.gx} ${dotY + TIE_Y} L${t.gx} ${dotY + ROW1 - 9}`}
                fill="none" stroke={lane.color} strokeWidth="1" opacity="0.45"
              />
            ))}
            {placed[i].labels.map(({ cx, gx, lw, rw, dy, ...p }) => {
              const ly = dotY + dy;
              // The dot and its label are one target: the question they raise
              // ("which sites are those?") is the same for both, and hitting a
              // 4px circle with a mouse is not a fair ask.
              const pick = onPick ? () => onPick({ category: lane.key, date: p.date, projected: !!p.projected, count: p.count }) : null;
              return (
                <g
                  key={p.date}
                  onClick={pick || undefined}
                  onKeyDown={pick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } : undefined}
                  role={pick ? 'button' : undefined}
                  tabIndex={pick ? 0 : undefined}
                  style={pick ? { cursor: 'pointer' } : undefined}
                  aria-label={pick ? `${lane.label} ${mdY(p.date)}: ${p.count} site${p.count === 1 ? '' : 's'} — open the list` : undefined}
                >
                  {/* Hollow for a projected filing — it's the ordinance's
                      cycle carried forward, not a date the jurisdiction has
                      published, and the two shouldn't read alike. Kept small:
                      dots sit on their true dates, so deadlines a fortnight
                      apart land on top of each other unless they're tight. */}
                  {/* A transparent disc over the dot: the dot itself is 4px
                      in a canvas that scales down, which is not a target
                      anybody can hit on purpose. */}
                  {pick && <circle cx={cx} cy={dotY} r="9" fill="transparent" />}
                  <circle
                    cx={cx} cy={dotY} r={p.projected ? 4 : 4.5}
                    fill={p.projected ? '#fff' : lane.color}
                    stroke={p.projected ? lane.color : '#fff'}
                    strokeWidth={p.projected ? 1.75 : 1.25}
                  >
                    <title>
                      {`${lane.label} · ${mdY(p.date)}: ${p.count} site${p.count === 1 ? '' : 's'}`
                        + (p.projected ? ' (projected from the ordinance\u2019s compliance cycle)' : '')
                        + (onPick ? ' · click for the list' : '')}
                    </title>
                  </circle>
                  {/* Count and date on one line, hung either side of the
                      group's spine: the counts line up as a column and the
                      dates read down as a list, which is what a group of
                      dates is. */}
                  {pick && (
                    <rect
                      x={gx - lw} y={ly - 9} width={lw + rw} height={ROW_H}
                      fill="transparent"
                    />
                  )}
                  <text x={gx - 3} y={ly} textAnchor="end" fontSize="9.5" fontWeight={p.projected ? 700 : 800}
                    fill={p.projected ? '#64748B' : '#0F172A'} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                    {p.count}
                  </text>
                  <text x={gx + 3} y={ly} textAnchor="start" fontSize="8"
                    fill={p.projected ? '#94A3B8' : '#475569'} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                    {p.dateLabel}
                  </text>
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
// Whether the utility serving this site hands over aggregated whole-building
// data for one commodity.
//
// Four states, and the distinction that matters most is between the last two:
// "No" is the utility saying it does not release the data, "not on file" is
// the reference having no answer — which it doesn't for 2,024 of its 2,137
// utilities. Rendering those alike would turn an open question into a closed
// door and stop somebody making a phone call worth making.
function WholeBuildingCell({ state, commodity }) {
  if (!state) {
    return <span className={styles.dash} title="The Whole Building Data reference is still loading">…</span>;
  }
  const { verdict, value, utility } = state;
  const who = utility ? ` (per ${utility})` : '';
  // "Yes (4/50)" carries a qualification worth keeping; a bare "Yes" doesn't.
  const qualifier = value && !/^yes$/i.test(value) ? value.replace(/^yes\s*/i, '') : '';

  if (verdict === 'yes') {
    return (
      <span
        className={styles.wbYes}
        title={`${utility || 'The serving utility'} releases aggregated whole-building ${commodity} data${qualifier ? `: "${value}"` : ''}`}
      >Yes{qualifier ? ` ${qualifier}` : ''}</span>
    );
  }
  if (verdict === 'no') {
    return <span className={styles.wbNo} title={`No aggregated whole-building ${commodity} data${who}`}>No</span>;
  }
  if (verdict === 'other') {
    return <span className={styles.wbOther} title={`The reference says "${value}" for whole-building ${commodity} data${who}`}>{value}</span>;
  }
  return (
    <span
      className={styles.dash}
      title={utility
        ? `The reference has no whole-building ${commodity} answer for ${utility}. That is an open question, not a refusal: it may be worth asking them.`
        : `No ${commodity} utility on file for this site to look the answer up against`}
    >not on file</span>
  );
}

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


// The mandate reference, editable.
//
// The seed behind this screening is a workbook snapshot: a jurisdiction
// moves a deadline, publishes a penalty the sheet never had, or adopts a
// standard that is still on file as "Pre-Development", and every figure
// downstream is wrong until someone rebuilds the seed. This is the way to
// correct it from the page — and because the correction is applied to the
// reference before anything is screened, it lands on every exposure
// total, deadline chart and export, not just the popup it was typed into.
//
// Only the fields that change an answer are here. Everything else stays as
// published, and one button puts the whole category back.
function MandateEditor({ govId, category, mandate, overrides, onSave, onDone }) {
  const [values, setValues] = useState(() => mandateFormValues(mandate, category, overrides));
  // What the save did. A correction is meant for everyone screening this
  // jurisdiction, so a write that only reached this browser has to say so
  // rather than close and look like it published.
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const set = (key, value) => setValues(v => ({ ...v, [key]: value }));
  const setThreshold = (key, value) => setValues(v => ({ ...v, thresholds: { ...v.thresholds, [key]: value } }));
  const keys = THRESHOLD_KEYS[category] || [];

  const field = (label, input, hint) => (
    <label className={styles.mdEditRow} key={label}>
      <span className={styles.mdEditKey}>{label}</span>
      <span className={styles.mdEditVal}>{input}{hint && <span className={styles.mdEditHint}>{hint}</span>}</span>
    </label>
  );

  return (
    <div className={styles.mdEdit}>
      <div className={styles.mdEditIntro}>
        Corrects the {CATEGORY_LABEL[category]} reference for {mandate?.government || 'this jurisdiction'} —
        for every site here, every export, and everyone else signed in.
      </div>
      {field('Policy', (
        <input
          className={styles.mdEditInput}
          value={values.policyName}
          onChange={e => set('policyName', e.target.value)}
          placeholder="Policy name"
        />
      ))}
      {field('Status', (
        <select
          className={styles.mdEditInput}
          value={STATUS_OPTIONS.some(o => o.value === values.status) ? values.status : ''}
          onChange={(e) => {
            const opt = STATUS_OPTIONS.find(o => o.value === e.target.value);
            setValues(v => ({ ...v, status: e.target.value, active: opt ? opt.active : v.active }));
          }}
        >
          {!STATUS_OPTIONS.some(o => o.value === values.status) && <option value="">{values.status || '(not published)'}</option>}
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
        </select>
      ))}
      {field('In force', (
        <span className={styles.mdEditCheck}>
          <input type="checkbox" checked={!!values.active} onChange={e => set('active', e.target.checked)} />
          <span>Counts toward exposure and deadlines</span>
        </span>
      ), 'Untick for a voluntary or not-yet-adopted programme: nothing screens under it.')}
      {field('Deadline', (
        <input
          className={styles.mdEditInput}
          type="date"
          value={values.deadline || ''}
          onChange={e => set('deadline', e.target.value)}
        />
      ), category === 'audits' ? 'With no date, an audit mandate has nothing due and carries no penalty.' : '')}
      {keys.map(([key, label]) => field(`${label} ft²`, (
        <input
          className={styles.mdEditInput}
          inputMode="numeric"
          value={values.thresholds?.[key] == null ? '' : values.thresholds[key]}
          onChange={e => setThreshold(key, e.target.value)}
          placeholder="none published"
        />
      )))}
      {/* BBS and audit penalties are flat annual maxima, so the label says
          so and there is nothing else to explain. A BPS penalty can be a
          per-ft² rate — the unit below decides — so its label stays
          unqualified rather than promising a year it may not be in. */}
      {field(category === 'bps' ? 'Max penalty' : 'Max penalty per year', (
        <input
          className={styles.mdEditInput}
          inputMode="numeric"
          value={values.maxPenalty == null ? '' : values.maxPenalty}
          onChange={e => set('maxPenalty', e.target.value)}
          placeholder="none published"
        />
      ), category === 'bps' ? 'The published maximum. The unit below decides whether it is a flat yearly fee or a per-ft² rate.' : '')}
      {category === 'bps' && field('Penalty unit', (
        <input
          className={styles.mdEditInput}
          value={values.penaltyUom || ''}
          onChange={e => set('penaltyUom', e.target.value)}
          placeholder="$ per Year"
        />
      ), 'A per-ft² unit ("$ per sq ft per year") is multiplied by the building.')}
      {field('Source', (
        <input
          className={styles.mdEditInput}
          value={values.url || ''}
          onChange={e => set('url', e.target.value)}
          placeholder="https://"
        />
      ))}
      <div className={styles.mdEditActions}>
        <button
          type="button"
          className={styles.mdEditSave}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setSaved(null);
            const res = await onSave(govId, category, overridePatchFrom(values));
            setSaving(false);
            // A shared save is done and the form can close over it. One
            // that fell back to this browser stays open with the reason,
            // because it is a different outcome from the one asked for.
            if (res?.shared) onDone();
            else setSaved(res);
          }}
        >{saving ? 'Saving…' : 'Save for everyone'}</button>
        <button type="button" className={styles.mdEditBtn} onClick={onDone} disabled={saving}>Cancel</button>
        {overrideFor(overrides, govId, category) && (
          <button
            type="button"
            className={styles.mdEditBtn}
            disabled={saving}
            onClick={async () => { await onSave(govId, category, null); onDone(); }}
            title="Drop this correction and go back to the published reference"
          >Reset to published</button>
        )}
      </div>
      {saved && !saved.shared && (
        <div className={styles.mdEditWarn}>
          {saved.ok
            ? 'Saved for you only: the shared reference refused the write, so this correction '
              + 'screens on this account and nobody else’s.'
            : 'Couldn’t save that correction.'}
          {saved.error ? ` (${saved.error})` : ''}
        </div>
      )}
    </div>
  );
}

// One mandate inside the site detail popup: whether it applies, the policy
// behind it, and the arithmetic that produced the fine on the row.
function MandateDetail({ res, mandate, sqft, overrides = null, onSaveOverride = null }) {
  const cat = res?.category;
  const [editing, setEditing] = useState(false);
  const govId = mandate?.govId || '';
  const edited = !!mandate?.[cat]?.edited;
  // The reference can be corrected whether or not the ordinance is in
  // force here — switching a "Pre-Development" standard on is exactly the
  // correction a jurisdiction that has since adopted one needs.
  const editButton = onSaveOverride && govId ? (
    <button
      type="button"
      className={styles.mdEditToggle}
      onClick={() => setEditing(e => !e)}
      title={`Correct the ${CATEGORY_LABEL[cat]} reference for ${mandate?.government || 'this jurisdiction'}. It applies to every site here, and to the exports.`}
    >{editing ? 'Close' : edited ? 'Edit ✎ (edited)' : 'Edit ✎'}</button>
  ) : null;
  const editor = editing ? (
    <MandateEditor
      govId={govId}
      category={cat}
      mandate={mandate}
      overrides={overrides}
      onSave={onSaveOverride}
      onDone={() => setEditing(false)}
    />
  ) : null;
  const basis = mandate ? penaltyBasis(mandate, cat) : null;
  const m = mandate?.[cat] || {};
  if (!res?.active) {
    return (
      <div className={styles.mdBlock}>
        <div className={styles.mdHead} style={{ background: '#94A3B8' }}>
          {CATEGORY_LABEL[cat]}{editButton}
        </div>
        <div className={styles.mdBody}>
          <div className={styles.mdNot}>
            Not applicable{m.status ? `: the ordinance on file is "${m.status}"` : ': no active ordinance for this jurisdiction'}.
          </div>
          {editor}
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
        ? `${usd(res.penalty)}/yr, ${edited ? 'as corrected here' : 'as published'}`
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
      <div className={styles.mdHead} style={{ background: headColor }}>
        {CATEGORY_LABEL[cat]}: {headLabel}{editButton}
      </div>
      <div className={styles.mdBody}>
        {editor}
        {edited && (
          <div className={styles.mdEdited}>
            Hand-corrected: these figures were edited here, not taken from the published
            reference. Every site in this jurisdiction is screened against them.
          </div>
        )}
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
function SiteDetailModal({ site, onClose, ordinances = MASTER_ORDINANCES, overrides = null, onSaveOverride = null }) {
  const mandate = site?.govId ? getMandates(site.govId, ordinances) : null;
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
              <MandateDetail
                key={c}
                res={site[c]}
                mandate={mandate}
                sqft={site.sqft}
                overrides={overrides}
                onSaveOverride={onSaveOverride}
              />
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
function JurisdictionSitesModal({ category, government, rows, onExport, onSiteClick, onClose, title = '', subtitle = '' }) {
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
              {title || (allJurisdictions ? `${label}: all applicable sites` : `${government} · ${label}`)}
            </div>
            <div className={styles.modalSub}>
              {subtitle || (
                <>
                  {rows.length.toLocaleString('en-US')} applicable site{rows.length === 1 ? '' : 's'}
                  {allJurisdictions ? ` across ${govCount} jurisdiction${govCount === 1 ? '' : 's'}` : ''}
                </>
              )}
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
  // The mandate reference, with the user's corrections already applied.
  // Passed in rather than read here so the page's exports screen against
  // exactly the same figures the subtab shows.
  ordinances = MASTER_ORDINANCES,
  // The corrections themselves, and the way to write one — the detail
  // popup edits them in place.
  overrides = null,
  onSaveOverride = null,
  // The unscoped list behind `sites` — drives the ownership toggle's
  // counts and tells an ownership-emptied view apart from no upload.
  allSites = null,
  excludeLeased = false,
  onExcludeLeasedChange = null,
  companyName = '',
  // The Utility Lookup's active Division scope, when one is set. The
  // sites handed in are already narrowed to it; this is so the report
  // says which slice of the portfolio it covers — on screen, in the
  // printed PDF, and in the Excel export's header.
  scopeLabel = '',
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
  // The deadline drilled into, as { category, date, projected, count } — the
  // sites due on one date under one mandate.
  const [deadlineDrill, setDeadlineDrill] = useState(null);
  // The utility-feed figure drilled into, as { commodity, state, utility }.
  // state/utility null means the card's whole eligible-sites total.
  const [feedDrill, setFeedDrill] = useState(null);
  // A pending "Export report (PDF)". Held in state rather than printed
  // straight from the click handler because the print furniture (the
  // generated-at stamp) has to be in the DOM before window.print() reads it —
  // the effect below fires on the commit that put it there.
  const [printJob, setPrintJob] = useState(null);

  const companyLabel = useMemo(() => sitesCompanyLabel(sites), [sites]);
  const results = useMemo(() => screenSites(sites, { ordinances }), [sites, ordinances]);
  const bpsRows = useMemo(() => bpsPrioritization(results, ordinances), [results, ordinances]);
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
  //
  // History is cut off a year back. A portfolio can carry a published deadline
  // from years ago, and the axis then spends half its width on dates nobody can
  // act on any more — squeezing the years that are actually being planned into
  // the right-hand third. A year of hindsight is enough to see what has just
  // passed; anything older is dropped rather than drawn, and said so under the
  // chart title.
  const roadmapCharts = useMemo(() => {
    const todayISO = new Date(todayTime).toISOString().slice(0, 10);
    // The same calendar day, LOOKBACK_YEARS back — a round date to print,
    // where counting days lands on an arbitrary-looking one.
    const t = new Date(todayTime);
    const cutoffISO = new Date(Date.UTC(t.getUTCFullYear() - LOOKBACK_YEARS, t.getUTCMonth(), t.getUTCDate()))
      .toISOString().slice(0, 10);
    const dropped = new Set();
    const lanes = CATEGORIES.map(c => {
      const all = deadlinesWithRecurrence(results, c, { todayISO, horizonYears: PROJECT_YEARS });
      for (const p of all) if (p.date < cutoffISO) dropped.add(p.date);
      return {
        key: c,
        label: CATEGORY_LABEL[c],
        color: CATEGORY_COLOR[c],
        points: all.filter(p => p.date >= cutoffISO),
        total: totalEligible(results, c),
      };
    });
    return { lanes, cutoffISO, dropped: dropped.size };
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
  // The Whole Building Data reference, loaded for the WBUDC section below —
  // which utility serves a zip is the workbook's answer to give, not the site
  // list's. Dynamic-imported (it's ~70k rows), so the section renders off it
  // once it arrives rather than blocking the page on it.
  const [wholeBuilding, setWholeBuilding] = useState(null);
  useEffect(() => {
    let live = true;
    loadWholeBuildingLookup().then((l) => { if (live) setWholeBuilding(l); }).catch(() => {});
    return () => { live = false; };
  }, []);
  // The screened sites with their utilities re-sourced from that reference.
  // Only the WBUDC section reads these — the site-by-site table below still
  // shows the utilities the portfolio was uploaded with.
  const feedResults = useMemo(() => withWholeBuildingUtilities(results, wholeBuilding), [results, wholeBuilding]);

  // Whole Building Utility Data Collection reach: of the sites carrying a BBS
  // or BPS obligation, which utilities serve them.
  const utilityFeeds = useMemo(() => ({
    electric: utilityFeedEligibility(feedResults, 'electric'),
    gas: utilityFeedEligibility(feedResults, 'gas'),
  }), [feedResults]);
  // Obligated sites the card leaves out, and why. A card counts a site only
  // where the reference says its utility hands that commodity over, so the
  // total is smaller than the obligation — which reads as sites gone missing
  // unless the difference is stated and split into its two reasons.
  const feedOmitted = useMemo(() => {
    const obligated = feedResults.filter(r => r.matched && (r.bbs?.eligible === true || r.bps?.eligible === true));
    return Object.fromEntries(FEED_CARDS.map(({ key }) => {
      const counted = new Set(utilityFeedSites(feedResults, key).map(s => s.id));
      const left = obligated.filter(r => !counted.has(r.id));
      return [key, {
        obligated: obligated.length,
        // The reference named a utility and said it doesn't hand this over —
        // or said nothing about it, which is not a feed either.
        noFeed: left.filter(r => r.wbSource?.[key] === 'reference').length,
        // Nothing in the reference to ask: the zip isn't in the file, or no
        // utility on the site to look up.
        unlisted: left.filter(r => r.wbSource?.[key] !== 'reference').length,
        total: left.length,
      }];
    }));
  }, [feedResults]);
  const jurisdictionCount = useMemo(() => new Set(results.filter(r => r.matched).map(r => r.govId)).size, [results]);

  const filtered = useMemo(() => {
    let out = results;
    if (onlyEligible) out = out.filter(r => CATEGORIES.some(c => r[c]?.eligible === true));
    const q = siteSearch.trim().toLowerCase();
    if (q) out = out.filter(r => `${r.siteName} ${r.city} ${r.state} ${r.government || ''}`.toLowerCase().includes(q));
    return out;
  }, [results, onlyEligible, siteSearch]);

  // Whether the data needed to REPORT each mandate can be had, per commodity.
  // Read off feedResults rather than the raw results: those carry the utility
  // names the reference itself uses (and a water utility, which the uploaded
  // portfolio has no column for), so a site resolves under the spelling the
  // reference files it under rather than the one it was billed under.
  //
  // Keyed by site id so re-filtering doesn't re-walk the zip map for rows
  // already answered. Empty until the reference lands — the table renders
  // straight away and these columns fill in.
  const wbBySite = useMemo(() => {
    const out = new Map();
    if (!wholeBuilding) return out;
    for (const r of feedResults) out.set(r.id, wholeBuildingForSite(wholeBuilding, r));
    return out;
  }, [wholeBuilding, feedResults]);

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
    const govId = lookupGovId(city, state, undefined, ordinances);
    const mandate = getMandates(govId, ordinances);
    return { govId, mandate };
  }, [city, state, ordinances]);

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
    const sourceCols = category ? categoryColumns(category, ordinances) : [];
    const siteRows = rowsToExport.map(r => {
      const row = {
        Site: r.siteName, City: r.city, State: r.state,
        Jurisdiction: r.government || '', 'Government ID': r.govId || '',
        'Sq Ft': r.sqft ?? '', 'Property Type': r.propertyType || '',
        'Owned / Leased': r.ownership || '',
        // Carried alongside the screening so the workbook holds every column
        // the site table shows, the utility feeds included.
        'Electric Utility': r.electricUtility || '', 'Natural Gas Utility': r.gasUtility || '',
      };
      // The same three columns the table shows. Blank rather than a
      // placeholder when the reference hasn't loaded: a spreadsheet cell has
      // no tooltip to explain one, so an empty cell is the honest cell.
      const wb = wbBySite.get(r.id);
      for (const c of WB_COMMODITIES) {
        const state = wb?.[c.key];
        row[`Whole-Building ${c.label} Data`] = !state ? ''
          : state.verdict === 'unknown' ? 'Not on file'
          : (state.value || '');
      }
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
        if (c === 'audits') row['Energy Audits Requirements'] = e?.active ? auditRequirementsLabel(getMandates(r.govId, ordinances)) : '';
      }
      // One category's full reference columns, for a single-mandate export.
      if (sourceCols.length) {
        const raw = (r.matched && getMandates(r.govId, ordinances)?.categoryRaw?.[category]) || {};
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
      const g = getMandates(r.govId, ordinances);
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
      await exportComplianceReportXlsx(results, { generatedAt: new Date().toLocaleString(), siteCount: results.length, companyName: [companyLabel || companyName, scopeLabel].filter(Boolean).join(' \u2014 ') });
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

  // The sites behind one dot on the deadlines chart. Read through
  // sitesForDeadline so the list can't disagree with the number that was
  // clicked — same eligibility, same recurrence walk.
  const deadlineDrillRows = useMemo(() => {
    if (!deadlineDrill) return [];
    return sitesForDeadline(results, deadlineDrill.category, deadlineDrill.date, {
      todayISO: new Date(todayTime).toISOString().slice(0, 10),
      horizonYears: PROJECT_YEARS,
      ordinances,
    });
  }, [results, deadlineDrill, todayTime, ordinances]);

  function exportDeadlineDrill() {
    if (!deadlineDrillRows.length) return;
    writeRawWorkbook(
      deadlineDrillRows,
      `${slug(CATEGORY_LABEL[deadlineDrill.category])}-${deadlineDrill.date}-Sites.xlsx`,
      { category: deadlineDrill.category },
    );
  }

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
    () => (feedDrill ? utilityFeedSites(feedResults, feedDrill.commodity, { state: feedDrill.state, utility: feedDrill.utility }) : []),
    [feedResults, feedDrill],
  );

  // A utility-feed site as it reads in an export: the mapping on screen, so
  // the workbook and the modal carry the same columns. No BBS / BPS columns —
  // this sheet is the utility mapping, and the screening export is where the
  // eligibility read belongs.
  //
  // The three utility columns are the reference's own answer for the site's
  // zip, same as the cards. `Utility Source` says where each row's utility
  // came from: the sheet's own commodity is always the reference's, since
  // that's what a site is listed here on, but the other two columns fall back
  // to the uploaded name where the workbook doesn't list the zip.
  //
  // `terms` adds the reference's terms for the utility this sheet is about:
  // what it meters, how it releases data, and whether that release covers
  // multifamily.
  //
  // Which utility that is has to be pinned down, because there is one set of
  // these columns and a site's utilities disagree — at 80525 the city
  // (electric, water) includes multifamily and Xcel (gas) doesn't. So the
  // sheet's own commodity decides: `feedUtility` is the electric utility on
  // the electric sheet and the gas utility on the gas sheet, which is the only
  // reading where a row describes the feed it was listed for. Blank when the
  // reference can't place the utility, rather than answering about another one.
  function feedSiteRow(r, lookup, commodity) {
    const row = {
      Site: r.siteName || '',
      City: r.city || '',
      State: r.feedState || r.mandateState || r.state || '',
      Zip: r.zip || '',
      'Electric Utility': r.electricUtility || '',
      'Natural Gas Utility': r.gasUtility || '',
      'Water Utility': r.waterUtility || '',
      'Utility Source': r.wbSource?.[commodity] === 'reference' ? 'Whole Building Data' : 'Site record',
    };
    if (!lookup) return row;
    // Say whether the file could answer for this utility, not just what it
    // said. The whole-building columns are blank on a miss and the file writes
    // "Not Available" into them on a hit, so without this the two read alike.
    const { values, status } = lookup.termsWithMatch(r.zip, r.feedUtility || r.electricUtility);
    return { ...row, 'Whole Building Data Match': MATCH_LABEL[status] || '', ...values };
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
    const lookup = wholeBuilding || await loadWholeBuildingLookup();
    const sheets = [];
    for (const { key, feed, label } of FEED_CARDS.map(f => ({ ...f, feed: utilityFeeds[f.key] }))) {
      if (!feed.total) continue;
      sheets.push([`${label} Summary`, feedSummaryRows(feed)]);
      sheets.push([`${label} Sites`, utilityFeedSites(feedResults, key).map(r => feedSiteRow(r, lookup, key))]);
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
    const lookup = wholeBuilding || await loadWholeBuildingLookup();
    writeSheets([[`${card.label} Sites`, feedDrillRows.map(r => feedSiteRow(r, lookup, feedDrill.commodity))]], name.replace(/^-+/, ''));
  }

  // Owned / All-sites control. Only rendered when the parent owns the
  // scope state — a standalone mount screens whatever it's handed. Wrapped
  // rather than styled in place: the bar is shared with the roadmap subtab and
  // carries its own inline styles, and only this page prints.
  const scopeBar = onExcludeLeasedChange
    ? (
      <div className={styles.screenOnly}>
        <OwnershipScopeBar sites={loadedSites} excludeLeased={excludeLeased} onChange={onExcludeLeasedChange} />
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
            {(companyLabel || scopeLabel) && (
              <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.01em', lineHeight: 1.2 }}>
                {[companyLabel, scopeLabel].filter(Boolean).join(' \u2014 ')}
              </div>
            )}
            <h1 className={styles.title} style={{ color: '#fff' }}>Building Compliance Screening &amp; Roadmap</h1>
          </div>
        </div>
        <span className={styles.brandLogo} dangerouslySetInnerHTML={{ __html: schneiderLogoSvg({ onDark: true, width: 172 }) }} />
      </div>
      {/* The strap explaining the lookup chain and its row counts used to sit
          here. It said the same thing on every visit, so it is gone — the
          three download buttons carry the same detail in their tooltips. */}
      <div className={styles.header}>
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
              <strong>Every loaded site is leased.</strong>
              <div className={styles.noMatchSub}>
                All {loadedSites.length.toLocaleString()} loaded site{loadedSites.length === 1 ? ' is' : 's are'} marked
                Leased, so excluding leased buildings leaves nothing to screen — these obligations fall on the owner.
                Switch to {' '}<strong>All sites</strong> above to screen them anyway.
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
                  <span className={styles.tlHeadSub}>
                    {': '}one lane per mandate · click a deadline for its sites
                    {roadmapCharts.dropped > 0 && ` · ${roadmapCharts.dropped} deadline date${roadmapCharts.dropped === 1 ? '' : 's'} before ${mdY(roadmapCharts.cutoffISO)} not shown`}
                  </span>
                </span>
              </div>
              <div className={styles.tlChart}>
                {roadmap.length
                  ? <DeadlineLanes lanes={roadmapCharts.lanes} ax={axis} todayTime={todayTime} onPick={setDeadlineDrill} />
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

            {/* Summary dashboard — the same figures the exported report charts.
                Opens the second sheet of the PDF: everything above describes
                the portfolio, everything from here describes what applies to
                it. The break alone isn't enough — see the print block, which
                also has to keep the preamble down to one sheet, or this lands
                on the third. */}
            <div className={`${styles.sectionTitle} ${styles.startsSheet}`}>Total Eligible Sites by Requirement</div>
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
                        <th>Number of eligible sites</th>
                        <th>Sum of Est. Penalty for non-reporting on BPS</th>
                        <th>Fee for exceeding limits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bpsRows.map((g, i) => (
                        <tr key={i}>
                          <td>{g.deadline ? mdY(g.deadline) : '-'}</td>
                          <td><strong>{g.government || '-'}</strong></td>
                          <td>{g.fine}</td>
                          <td>{g.sites.toLocaleString('en-US')}</td>
                          <td>{g.penaltyKnown ? usd(g.penalty) : '-'}</td>
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
              this option. Each site&apos;s utility is the one the Whole Building Data file names for its zip
              code, and a site counts here only where that file says the utility hands the commodity over —
              <strong> Electric? = Yes</strong> for EP, <strong>Gas? = Yes</strong> for NG.
            </div>
            {/* Held back until the reference is in. The counts are a different
                number without it — every site with a utility, rather than
                every site with a collectible feed — and a headline figure
                that lands and then drops is worse than one that arrives a
                moment late. */}
            {!wholeBuilding ? (
              <div className={styles.miniEmpty}>Reading the Whole Building Data file…</div>
            ) : (
            <div className={styles.feedGrid}>
              {FEED_CARDS.map(({ key, label, abbr, color }) => {
                const feed = utilityFeeds[key];
                const omitted = feedOmitted[key];
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
                    {/* The gap between the obligation and the feed. Without
                        it the card reads as though the sites it can't serve
                        were never obligated, and the two reasons want telling
                        apart: a utility that doesn't offer the data is a
                        closed door, a zip the file doesn't list is an open
                        question. */}
                    {omitted.total > 0 && (
                      <div className={styles.feedSource}>
                        {feed.total} of {omitted.obligated} obligated sites ·{' '}
                        {omitted.noFeed > 0 && <>{omitted.noFeed} whose utility isn&apos;t marked {abbr === 'EP' ? 'Electric?' : 'Gas?'} = Yes</>}
                        {omitted.noFeed > 0 && omitted.unlisted > 0 && ' · '}
                        {omitted.unlisted > 0 && <>{omitted.unlisted} not in the Whole Building Data file</>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}

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
                    {/* Sits with Sq Ft — both describe the building rather
                        than where it is — and ahead of the mandates, since
                        these obligations fall on the owner, which is what
                        the ownership scope above the table turns on. */}
                    <th title="Owned or Leased, from the Ownership column mapped on the Utility Lookup upload">Owned / Leased</th>
                    <th>Electric Utility</th><th>Natural Gas Utility</th>
                    {/* Whether the data needed to REPORT the mandates in the
                        columns to the right can actually be obtained. */}
                    {WB_COMMODITIES.map(c => (
                      <th
                        key={c.key}
                        title={`Does the utility serving this site release aggregated whole-building ${c.label.toLowerCase()} data?`}
                      >{c.label} WBD</th>
                    ))}
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
                      <td>{r.ownership || <span className={styles.dash}>-</span>}</td>
                      {/* The utilities the portfolio was uploaded with, as
                          they were uploaded. The WBUDC cards above re-source
                          the same two columns from the Whole Building Data
                          file, so the names there are that workbook's — this
                          table is what the site list said, which is what
                          someone checking their own upload came here for.
                          Shown for every site, not just the ones those cards
                          count: they total the sites carrying a BBS or BPS
                          mandate AND a known utility, a narrower set than
                          this table lists. */}
                      <td>{r.electricUtility || <span className={styles.dash}>-</span>}</td>
                      <td>{r.gasUtility || <span className={styles.dash}>-</span>}</td>
                      {WB_COMMODITIES.map(c => (
                        <td key={c.key}>
                          <WholeBuildingCell state={wbBySite.get(r.id)?.[c.key]} commodity={c.label.toLowerCase()} />
                        </td>
                      ))}
                      <td><CatCell res={r.bbs} /></td>
                      <td><CatCell res={r.audits} /></td>
                      <td><AuditTypeCell res={r.audits} /></td>
                      <td><CatCell res={r.bps} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={12 + WB_COMMODITIES.length} className={styles.emptyRow}>No sites match the current filters.</td></tr>
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
            {deadlineDrill && (
              <JurisdictionSitesModal
                category={deadlineDrill.category}
                rows={deadlineDrillRows}
                title={`${CATEGORY_LABEL[deadlineDrill.category]} due ${mdY(deadlineDrill.date)}`}
                subtitle={`${deadlineDrillRows.length.toLocaleString('en-US')} site${deadlineDrillRows.length === 1 ? '' : 's'} filing on this date`
                  + (deadlineDrill.projected ? ' · projected from the ordinance’s compliance cycle' : '')}
                onExport={exportDeadlineDrill}
                onSiteClick={(site) => { setDeadlineDrill(null); setDetailSite(site); }}
                onClose={() => setDeadlineDrill(null)}
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
            {detailSite && (
              <SiteDetailModal
                // Re-read from the current screening rather than the row
                // that was clicked: correcting a mandate from inside this
                // popup has to change the popup too, not just the table
                // behind it.
                site={results.find(r => r.id === detailSite.id) || detailSite}
                onClose={() => setDetailSite(null)}
                ordinances={ordinances}
                overrides={overrides}
                onSaveOverride={onSaveOverride}
              />
            )}
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
