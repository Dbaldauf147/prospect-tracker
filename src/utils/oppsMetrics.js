// Shared parsing + year-bucketing over the Opps 2 records.
//
// The YOY charts and the Weekly Review both read the same opp rows, so the
// rules that decide "what year is this deal in" and "what counts as quoted"
// live here rather than being written twice. Everything is pure — the caller
// passes the already-loaded records array.

// Parse "USD 15,000.00" / "$15,000" / "15000" -> 15000. Returns null for
// blanks and anything that isn't a finite number.
export function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Pull the first standalone 4-digit year out of the value. This keeps plain
// "2026" working while still recognising date-formatted Open Year cells like
// "2026-06-01" or "6/1/2026" — stripping every non-digit first would turn
// those into 20260601 / 612026 and lose the year.
export function parseYear(v) {
  const m = String(v ?? '').match(/(?:19|20)\d{2}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1900 && n <= 2100 ? n : null;
}

// Epoch ms for a date cell ("6/1/2026" or "2026-06-01"), or null. A bare ISO
// date is read by Date.parse as UTC midnight, which lands on the previous day
// in a negative-offset timezone — so ISO strings are re-read from their UTC
// parts and rebuilt as local midnight. Slash/locale strings already parse as
// local.
export function parseDateMs(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  if (/^\d{4}-\d{2}/.test(s)) {
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Calendar year of a date cell. Mirrors parseDateMs's ISO handling so a
// 2026-01-01 close stays in 2026.
export function parseDateYear(v) {
  const ms = parseDateMs(v);
  if (ms === null) return null;
  const y = new Date(ms).getFullYear();
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

// Status values that mean the opp got priced — the Quoted+ filter behind the
// Quoted close-rate denominator.
const QUOTED_PLUS_STATUSES = new Set([
  'Quoted', 'Contracting', 'Agreement Sent', 'Sold', 'Not Sold',
]);

export function isQuotedPlus(record) {
  const status = String(record.Status || '').trim();
  if (QUOTED_PLUS_STATUSES.has(status)) return true;
  const amt = parseMoney(record['Quoted Amount']);
  return typeof amt === 'number' && amt > 0;
}

// Fraction of `year` elapsed — the annualization factor behind "Projected"
// figures. Past years are complete (1); the current year is clamped to at
// least one day so a Jan 1 run can't divide by zero.
export function yearElapsedFraction(year, nowMs = Date.now()) {
  const now = new Date(nowMs);
  if (year !== now.getFullYear()) return 1;
  const start = new Date(year, 0, 1).getTime();
  const yearMs = new Date(year + 1, 0, 1).getTime() - start;
  const frac = (now.getTime() - start) / yearMs;
  return Math.max(1 / 366, Math.min(1, frac));
}

// ---- Weekly-review aggregations ----------------------------------------
//
// A compact read of the same numbers the YOY charts plot: sold $ by year,
// close rate by year, average deal size by year, new-lead counts, and the
// open pipeline as it stands today. Deliberately narrower than the charts —
// this is the "am I on pace, and where does the funnel leak" view, not the
// full chart set.

// Year of a Sold deal: Close Date year, falling back to Open Year when the
// close date is missing or unparseable (same rule the Annual Sales chart uses).
function soldYear(r) {
  return parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
}

// Month/day of the year a timestamp falls on, as a 0-based day index. Used to
// compare "this year through today" against "last year through the same day".
function dayOfYear(ms) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), 0, 1).getTime();
  return Math.floor((ms - start) / 86400000);
}

const LATE_STAGES = new Set(['Agreement Sent', 'Contracting']);
const CLOSED_STAGES = new Set(['Sold', 'Not Sold']);

// Lead sources that mean the money is already a client's rather than new
// business — the split the Annual Sales bars are stacked by.
const CLIENT_SOURCE_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;

// The YOY "Annual Sales" chart's Projected bar: what this year finishes at
// if everything already committed lands. That is this year's Sold deals
// plus every still-open opp at Agreement Sent or Contracting — the two
// stages where the paperwork is out and the money is realistically booked.
//
// Deliberately NOT a run rate. Annualizing what has closed so far assumes
// the rest of the year repeats the first part of it; this instead adds up
// what is actually on the table. The two answer different questions and
// give different numbers, and the chart has always used this one — so the
// Weekly Report's projection tile reads it from here rather than
// recomputing, which is how the two came to disagree in the first place.
//
// Closed opps and prior-year Sold are excluded. Sold is counted once in
// the first branch, so the pipeline branch skips closed stages rather than
// double-counting them. `deals` is the contributing rows, for the chart's
// per-bar drilldown and Excel export.
export function annualSalesProjection(records, { nowMs = Date.now(), dealFor = null } = {}) {
  const list = Array.isArray(records) ? records : [];
  const currentYear = new Date(nowMs).getFullYear();
  let currentClient = 0;
  let newClient = 0;
  let soldYTD = 0;
  let lateStageAmount = 0;
  const deals = [];
  for (const r of list) {
    const stage = String(r.Stage || '').trim();
    const amt = parseMoney(r['Quoted Amount']) || 0;
    // A zero (or unpriced) opp adds nothing to any of these totals, and
    // listing it in the drilldown would just be noise.
    if (!amt) continue;
    const isSold = stage === 'Sold';
    const include = isSold
      ? soldYear(r) === currentYear
      : LATE_STAGES.has(stage);
    if (!include) continue;
    const src = String(r['Lead Source'] || r['Source'] || '');
    if (CLIENT_SOURCE_RE.test(src)) currentClient += amt;
    else newClient += amt;
    if (isSold) soldYTD += amt;
    else lateStageAmount += amt;
    if (dealFor) deals.push({ ...dealFor(r, currentYear, src, amt), Stage: stage });
  }
  return {
    currentYear,
    currentClient: Math.round(currentClient),
    newClient: Math.round(newClient),
    amount: Math.round(currentClient + newClient),
    // The two halves of that total, so a tile can say where it came from.
    soldYTD: Math.round(soldYTD),
    lateStageAmount: Math.round(lateStageAmount),
    deals,
  };
}

export function yoyReviewMetrics(records, { target = 0, nowMs = Date.now() } = {}) {
  const list = Array.isArray(records) ? records : [];
  const now = new Date(nowMs);
  const currentYear = now.getFullYear();
  const todayIndex = dayOfYear(nowMs);

  const byYear = new Map(); // year -> { sold, notSold, inProgress, quotedNotSold, soldAmount, leads }
  const bucket = (y) => {
    if (!byYear.has(y)) {
      byYear.set(y, {
        year: y, sold: 0, notSold: 0, inProgress: 0, quotedNotSold: 0,
        soldAmount: 0, soldAmountCount: 0, leads: 0,
      });
    }
    return byYear.get(y);
  };

  // Sold $ and deal counts bucket by close year; lead counts and close-rate
  // outcomes bucket by Open Year (the year the opp was created), matching the
  // YOY charts.
  let ytdSoldAmount = 0, ytdSoldDeals = 0;
  let priorSameDateAmount = 0, priorSameDateDeals = 0;
  const openStages = new Map();
  let openCount = 0, openAmount = 0, lateCount = 0, lateAmount = 0;

  for (const r of list) {
    const stage = String(r.Stage || '').trim();
    const amt = parseMoney(r['Quoted Amount']);

    const openYear = parseYear(r['Open Year']);
    if (openYear !== null) {
      const b = bucket(openYear);
      b.leads += 1;
      if (stage === 'Sold') b.sold += 1;
      else if (stage === 'Not Sold') {
        b.notSold += 1;
        if (isQuotedPlus(r)) b.quotedNotSold += 1;
      } else b.inProgress += 1;
    }

    if (stage === 'Sold') {
      const y = soldYear(r);
      if (y !== null) {
        const b = bucket(y);
        if (typeof amt === 'number') { b.soldAmount += amt; b.soldAmountCount += 1; }
        // Year-to-date pace: this year's closes so far, and last year's
        // closes through the same calendar day for an apples-to-apples read.
        const closeMs = parseDateMs(r['Close Date']);
        if (y === currentYear) {
          ytdSoldAmount += amt || 0;
          ytdSoldDeals += 1;
        } else if (y === currentYear - 1 && closeMs !== null && dayOfYear(closeMs) <= todayIndex) {
          priorSameDateAmount += amt || 0;
          priorSameDateDeals += 1;
        }
      }
    } else if (!CLOSED_STAGES.has(stage)) {
      openCount += 1;
      openAmount += amt || 0;
      const key = stage || '(no stage)';
      const s = openStages.get(key) || { stage: key, count: 0, amount: 0 };
      s.count += 1;
      s.amount += amt || 0;
      openStages.set(key, s);
      if (LATE_STAGES.has(stage)) { lateCount += 1; lateAmount += amt || 0; }
    }
  }

  const years = [...byYear.values()].sort((a, b) => a.year - b.year);
  const frac = yearElapsedFraction(currentYear, nowMs);

  return {
    currentYear,
    // One row per year the data covers, newest last.
    years: years.map(b => ({
      year: b.year,
      leads: b.leads,
      sold: b.sold,
      notSold: b.notSold,
      inProgress: b.inProgress,
      soldAmount: Math.round(b.soldAmount),
      avgDealSize: b.soldAmountCount ? Math.round(b.soldAmount / b.soldAmountCount) : null,
      // Total C/R counts every closed opp; Quoted C/R restricts the losses to
      // opps that actually got priced.
      totalCR: (b.sold + b.notSold) > 0 ? +((b.sold / (b.sold + b.notSold)) * 100).toFixed(1) : null,
      quotedCR: (b.sold + b.quotedNotSold) > 0 ? +((b.sold / (b.sold + b.quotedNotSold)) * 100).toFixed(1) : null,
    })),
    ytd: {
      year: currentYear,
      deals: ytdSoldDeals,
      amount: Math.round(ytdSoldAmount),
      target: Math.round(Number(target) || 0),
      pctOfTarget: target > 0 ? +((ytdSoldAmount / target) * 100).toFixed(1) : null,
      // Where the year lands if the rest of it closes at the same rate.
      runRateFullYear: Math.round(ytdSoldAmount / frac),
      yearElapsedPct: +(frac * 100).toFixed(1),
      // What "on pace" would look like today, and the gap to it.
      onPaceAmount: Math.round((Number(target) || 0) * frac),
      gapToTarget: Math.round((Number(target) || 0) - ytdSoldAmount),
    },
    // Where the year lands if everything already committed closes — the
    // same figure the YOY Annual Sales chart plots as its Projected bar.
    // Distinct from ytd.runRateFullYear above, which annualizes the pace
    // instead; both are reported because they disagree on purpose.
    projection: annualSalesProjection(list, { nowMs }),
    priorYearSameDate: {
      year: currentYear - 1,
      deals: priorSameDateDeals,
      amount: Math.round(priorSameDateAmount),
      // Positive = ahead of where last year stood on this date.
      deltaAmount: Math.round(ytdSoldAmount - priorSameDateAmount),
    },
    openPipeline: {
      count: openCount,
      amount: Math.round(openAmount),
      lateStageCount: lateCount,
      lateStageAmount: Math.round(lateAmount),
      byStage: [...openStages.values()]
        .map(s => ({ ...s, amount: Math.round(s.amount) }))
        .sort((a, b) => b.amount - a.amount),
    },
  };
}

// The close-out reason a record carries. Opps 2 writes both the Sold and
// the Not Sold follow-up prompts into the single "Reason Not Sold" column,
// so which side of the win/loss split a reason belongs to comes from the
// Stage, not from a second field. Import placeholders ("-", "#N/A") read
// as no reason at all.
export function closeReasonOf(r) {
  const raw = String(r?.['Reason Not Sold'] ?? '').trim();
  return raw && raw !== '-' && raw !== '#N/A' ? raw : '';
}

// Roll a list of opps up into the money + close-reason stats the By Source
// tab and its drilldown popup both show. Pure, so the summary row and the
// popup it opens can never quote different numbers for the same source.
//
//   avgDeal — mean Quoted Amount across every opp passed in that carries a
//             dollar figure. This is the pipeline-sizing number, so it
//             stays meaningful under the By Source tab's default "Active
//             only" filter, where nothing has closed yet.
//   avgWon  — mean Quoted Amount of the Sold opps only, matching the
//             "Deal Size" line on the YOY charts.
//   soldReasons / notSoldReasons — close reasons ranked by frequency,
//             ties broken alphabetically so the order is stable.
export function summarizeOppsMoneyAndReasons(rows) {
  let quotedSum = 0, quotedCount = 0, wonSum = 0, wonCount = 0;
  const soldTally = new Map();
  const notSoldTally = new Map();
  for (const r of rows || []) {
    const stage = String(r?.['Stage'] ?? '').trim();
    const amt = parseMoney(r?.['Quoted Amount']);
    // A blank or zero amount means "not quoted yet" rather than a $0 deal,
    // so it stays out of the average instead of dragging it down.
    if (amt != null && amt > 0) {
      quotedSum += amt; quotedCount += 1;
      if (stage === 'Sold') { wonSum += amt; wonCount += 1; }
    }
    const reason = closeReasonOf(r);
    if (!reason) continue;
    const tally = stage === 'Sold' ? soldTally : stage === 'Not Sold' ? notSoldTally : null;
    if (tally) tally.set(reason, (tally.get(reason) || 0) + 1);
  }
  const rank = (tally) => [...tally.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return {
    avgDeal: quotedCount > 0 ? quotedSum / quotedCount : null,
    quotedCount,
    avgWon: wonCount > 0 ? wonSum / wonCount : null,
    wonCount,
    soldReasons: rank(soldTally),
    notSoldReasons: rank(notSoldTally),
  };
}
