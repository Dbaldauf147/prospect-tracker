// The one definition of what a stored/emailable Weekly Report snapshot
// looks like.
//
// The report's numbers are computed in the browser off caches that only
// exist there, so the tab publishes what it rendered and the mailer sends
// that back. Two routes accept one: api/weekly-report-schedules
// (`publishSnapshot`, on every visit to the tab) and
// api/weekly-report-send-now (a test send posts the live screen). Both run
// the payload through this builder so the two paths can't drift — a field
// the cron mails but a test send drops is exactly the bug this avoids —
// and so a posted snapshot is bounded rather than mailed as it arrived.
//
// `capturedAt` is stamped here, at the moment the tab handed the snapshot
// over. That is what the email's freshness line reads; a snapshot with no
// stamp reads "captured at an unknown time", which is what a live test
// send used to say about numbers that were seconds old.

export function clampInt(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Keep the stored snapshot small and predictable: it is written on every
// visit to the tab, and Firestore caps a document at ~1 MB.
export function trimList(items, max = 60, len = 300) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, max).map(v => String(v ?? '').slice(0, len));
}

const str = (v, len) => String(v ?? '').slice(0, len);

// Both pictures the report can carry are checked against this before they
// are stored. The string is written into an <img src> and decoded into an
// email attachment, and only base64 PNG may take either path.
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const strOrNull = (v, len) => (v ? String(v).slice(0, len) : null);

// The funnel travels as text the tab already formatted, not as raw figures:
// the email can't draw the chart, and re-deriving "$833K" server-side is a
// second copy of arithmetic that is free to disagree with the screen.
function funnelDoc(f) {
  if (!f || typeof f !== 'object') return null;
  const stages = (Array.isArray(f.stages) ? f.stages : []).slice(0, 10).map(s => ({
    label: str(s?.label, 80),
    count: clampInt(s?.count, 0, 1e9, 0),
    amount: str(s?.amount, 20),
    life: strOrNull(s?.life, 20),
    closeRate: strOrNull(s?.closeRate, 12),
  }));
  if (!stages.length) return null;
  const o = f.outcome && typeof f.outcome === 'object' ? f.outcome : null;
  return {
    stages,
    outcome: o ? {
      soldLabel: str(o.soldLabel, 40) || 'Closed YTD',
      sold: strOrNull(o.sold, 20),
      weighted: strOrNull(o.weighted, 20),
      total: strOrNull(o.total, 20),
      note: strOrNull(o.note, 100),
    } : null,
  };
}

// One trend series. A point's `value` may be null and that is load-bearing:
// for the emails series it means "no record of that month" — no recording
// from the Activity tab and a feed that cannot speak for it — which is a
// different fact from a week with no sends, and the email draws the two
// differently. clampInt would turn the first into the second.
function seriesDoc(points, max) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, max).map(p => ({
    key: str(p?.key, 10),
    label: str(p?.label, 16),
    value: p?.value == null ? null : clampInt(p.value, 0, 1e9, 0),
    // Whether the number came from the Activity tab's banked recording
    // rather than the live feed, the way the tile's "recorded Sep 3" note
    // used to say.
    recorded: p?.recorded === true,
  })).filter(p => p.label);
}

function trendsDoc(t) {
  if (!t || typeof t !== 'object') return null;
  const emailsByMonth = seriesDoc(t.emailsByMonth, 12);
  const newOppsByMonth = seriesDoc(t.newOppsByMonth, 12);
  if (!emailsByMonth.length && !newOppsByMonth.length) return null;
  return { emailsByMonth, newOppsByMonth };
}

// The close-rate trend, as text the tab already formatted — same reason the
// funnel travels that way: the email can't draw the grid's sparklines, and
// re-deriving "17%  1/6" server-side is a second copy of arithmetic free to
// disagree with the screen.
//
// Bounded on both axes. The tab asks for six months and five rows, but this
// document is rewritten on every visit to the tab and Firestore caps it at
// ~1 MB, so a payload claiming a hundred of either is trimmed rather than
// stored. Every row is padded or cut to the month count so no row can hand
// the email a short grid.
export const MAX_TREND_MONTHS = 12;
export const MAX_TREND_ROWS = 8;

function trendCell(c) {
  if (!c || typeof c !== 'object') return null;
  const rate = str(c.rate, 8);
  if (!rate) return null;
  return { rate, count: str(c.count, 16) };
}

function closeRateTrendDoc(t) {
  if (!t || typeof t !== 'object') return null;
  const months = (Array.isArray(t.months) ? t.months : [])
    .slice(0, MAX_TREND_MONTHS).map(m => str(m, 12));
  const rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, MAX_TREND_ROWS).map((r) => {
    const overall = trendCell(r?.overall);
    // Only the four close-rate stages get a stage colour; the "All closed
    // opps" row has no stage of its own and says so with a null. Read as a
    // number before clamping — clampInt would take a null for a 0 and clamp
    // that up into the range, painting the total row as Stage 3.
    const n = Number(r?.stage);
    return {
      label: str(r?.label, 80),
      stage: Number.isInteger(n) && n >= 3 && n <= 6 ? n : null,
      cells: months.map((_, i) => trendCell(r?.cells?.[i])),
      overall: overall
        ? { ...overall, ahead: Number(r?.overall?.ahead) > 0 ? clampInt(r.overall.ahead, 1, 100, 0) : null }
        : null,
      rolling12: trendCell(r?.rolling12),
    };
  }).filter(r => r.label);
  if (!months.length || !rows.length) return null;
  return { months, rows };
}

// The two account-coverage series, bounded the same way the trend series
// are. A point's `t1` / `t2` may be null and that is load-bearing: it means
// the Progress tab recorded no snapshot for that week, which is a different
// fact from a week where no account had a contact. clampInt would turn the
// first into the second and draw a coverage collapse that never happened.
export const MAX_COVERAGE_CHARTS = 4;
// Half a year of weeks, with room to spare. The chart is drawn from these
// points, so a cap below the window the series is built over would store a
// shorter chart than the one the picture shows.
export const MAX_COVERAGE_POINTS = 40;

const covPct = (v) => (v == null ? null : clampInt(v, 0, 100, 0));

// A coverage chart is drawn from a handful of flat colours and stores as
// an indexed PNG, so it runs to a few kilobytes where the funnel's
// rasterised chart runs to hundreds. The cap is sized for that: two of
// these are written into the snapshot on every visit to the tab, and
// Firestore caps the document at ~1 MB.
export const MAX_COVERAGE_IMAGE_CHARS = 120_000;

function coverageImageDoc(v) {
  if (!v || typeof v !== 'object') return null;
  const src = String(v.src || '');
  if (src.length > MAX_COVERAGE_IMAGE_CHARS || !PNG_DATA_URL.test(src)) return null;
  const w = Number(v.width);
  const h = Number(v.height);
  if (!(w >= 1) || !(h >= 1)) return null;
  return {
    src,
    width: clampInt(w, 1, 2000, 0),
    height: clampInt(h, 1, 2000, 0),
    alt: str(v.alt, 300) || 'Account coverage by week',
  };
}

function coverageDoc(c) {
  if (!c || typeof c !== 'object') return null;
  const charts = (Array.isArray(c.charts) ? c.charts : [])
    .slice(0, MAX_COVERAGE_CHARTS)
    .map(ch => ({
      id: str(ch?.id, 40),
      title: str(ch?.title, 120),
      points: (Array.isArray(ch?.points) ? ch.points : [])
        // The RECENT end, not the oldest: a series trimmed from the front
        // would leave the card standing on a figure from months ago while
        // its chart and its summary line both spoke about this week.
        .slice(-MAX_COVERAGE_POINTS)
        .map(p => ({
          key: str(p?.key, 10),
          label: str(p?.label, 16),
          t1: covPct(p?.t1),
          t2: covPct(p?.t2),
        }))
        .filter(p => p.label),
      note: str(ch?.note, 200),
      // The chart as a picture, through the same checks the funnel image
      // goes through: this string is written into an <img src> and decoded
      // into an email attachment, and only base64 PNG may take either
      // path. Dropped rather than trimmed when it fails one - the points
      // above are still a chart, just not a drawn one.
      image: coverageImageDoc(ch?.image),
    }))
    .filter(ch => ch.title && ch.points.length);
  if (!charts.length) return null;
  return { weeks: charts[0].points.length, charts };
}

// The funnel as a picture: a PNG the tab rasterised off its own chart,
// carried as a data URL and mailed as an attachment.
//
// Bounded hard, and dropped rather than trimmed when it fails a check. The
// snapshot is rewritten on every visit to the tab and Firestore caps a
// document at ~1 MB, so an image that has outgrown its budget must not be
// what pushes the whole report over — and the email has a table of the
// same figures under it either way. The pattern check is the other half:
// this string is written into an <img src> and decoded into an email
// attachment, and only base64 PNG may take either path.
export const MAX_FUNNEL_IMAGE_CHARS = 400_000;

function funnelImageDoc(v) {
  if (!v || typeof v !== 'object') return null;
  const src = String(v.src || '');
  if (src.length > MAX_FUNNEL_IMAGE_CHARS || !PNG_DATA_URL.test(src)) return null;
  // Checked before clamping: clampInt would round a 0 up to the floor and
  // call it a size, and an image the email lays out at 0 wide is not one.
  const w = Number(v.width);
  const h = Number(v.height);
  if (!(w >= 1) || !(h >= 1)) return null;
  return {
    src,
    width: clampInt(w, 1, 4000, 0),
    height: clampInt(h, 1, 4000, 0),
    alt: str(v.alt, 300) || 'Pipeline funnel',
  };
}

export function buildSnapshotDoc(input, auth) {
  const s = input || {};
  const oc = s.oppChanges || {};
  const g = s.goals || {};
  return {
    ownerUid: auth?.uid || null,
    ownerEmail: auth?.email || '',
    capturedAt: Date.now(),
    scope: s.scope === 'day' ? 'day' : 'week',
    periodLabel: str(s.periodLabel, 200),
    periodStart: Number.isFinite(Number(s.periodStart)) ? Number(s.periodStart) : null,
    periodEnd: Number.isFinite(Number(s.periodEnd)) ? Number(s.periodEnd) : null,
    kpiCards: (Array.isArray(s.kpiCards) ? s.kpiCards : []).slice(0, 6).map(c => ({
      label: str(c?.label, 80),
      value: str(c?.value, 40),
      status: ['ahead', 'behind'].includes(c?.status) ? c.status : null,
      chip: strOrNull(c?.chip, 40),
      lines: trimList(c?.lines, 6),
    })),
    funnel: funnelDoc(s.funnel),
    // Only alongside the figures it illustrates: an image with no stage
    // rows behind it is a picture the reader cannot check.
    funnelImage: s.funnel ? funnelImageDoc(s.funnelImage) : null,
    // The funnel's close-rate column with the time axis put back. Stored
    // beside the funnel because that is where it sits on the tab and in the
    // email, but on its own footing: the trend reads the Opps cache alone,
    // so it can be there on a visit where no stage volumes were.
    closeRateTrend: closeRateTrendDoc(s.closeRateTrend),
    // The two history series that replaced the "Emails sent" and "New opps"
    // tiles: emails by week, new opps by month. Stored as points rather
    // than as a rendered chart, so the email can draw its own bars.
    trends: trendsDoc(s.trends),
    // The Progress tab's two account-coverage charts, as points rather than
    // a picture, for the same reason the trends are: the email draws its
    // own bars from them.
    coverage: coverageDoc(s.coverage),
    oppChanges: {
      closed: trimList(oc.closed),
      newOpps: trimList(oc.newOpps),
      stageChanges: trimList(oc.stageChanges),
      closeDateMoves: trimList(oc.closeDateMoves),
      amountUpdates: trimList(oc.amountUpdates),
      bfoTags: trimList(oc.bfoTags),
    },
    goals: {
      created: trimList(g.created, 25),
      completed: trimList(g.completed, 25),
      active: trimList(g.active, 12),
    },
    narrative: str(s.narrative, 8000),
  };
}
