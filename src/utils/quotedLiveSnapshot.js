// The live Quoted Projections figures, and the month-end capture of them.
//
// The YOY chart plots one reading per month. The current month is computed
// live from the Opps 2 rows and the BFO Activity paste; once a month rolls
// over, the figure it shows is whatever was captured on its last day. That
// capture used to happen only in a browser with the YOY page open, so a month
// whose last day passed with nobody on the page was never captured, and the
// chart had to rebuild it from the NEXT month's opps (the "rebuild = today's
// live figures" warning). api/quoted-projections-month-end.js now takes the
// same reading on the server on the last day of every month, so these rules
// live here, pure, for the page and the server job to share.

import { parseMoney } from './oppsMetrics.js';

// The five stored series. Spelled out rather than imported from
// quotedProjectionsStore, which pulls in the browser-side Firestore mirror;
// the server job imports this file. scripts/quotedLiveSnapshot.test.mjs
// checks the two lists stay the same.
export const QUOTED_FIELDS = ['weak', 'ok', 'expected', 'agreements', 'bfoPipe'];

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);

// Total pipeline $ from the BFO Activity table: the sum of its "Amount"
// column across every pasted row. null when there is no BFO data, so the
// chart leaves that point blank instead of plotting $0.
export function sumBfoPipe(bfo) {
  if (!bfo || !Array.isArray(bfo.rows) || bfo.rows.length === 0 || !Array.isArray(bfo.headers)) return null;
  const amountCol = bfo.headers.find(h => /^amount$/i.test(h));
  if (!amountCol) return null;
  let sum = 0;
  let any = false;
  for (const r of bfo.rows) {
    const amt = parseMoney(r[amountCol]);
    if (typeof amt === 'number' && Number.isFinite(amt)) { sum += amt; any = true; }
  }
  return any ? sum : null;
}

/**
 * Today's figures, in $K: weak / ok / expected are open quoted $ by Chance?
 * bucket, agreements is open quoted $ in Stage "Agreement Sent", bfoPipe the
 * BFO Activity Amount total. A 0 bucket is null so the line breaks rather than
 * dipping to $0. null when there are no opps at all.
 */
export function liveQuotedFigures(records, bfo) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let weak = 0, ok = 0, expected = 0, agreements = 0;
  for (const r of records) {
    const stage = String(r?.Stage || '').trim();
    if (CLOSED_STAGES.has(stage)) continue;
    const amt = parseMoney(r['Quoted Amount']) || 0;
    if (!amt) continue;
    const chance = String(r['Chance?'] ?? r['Chance'] ?? '').trim().toLowerCase();
    if (chance === 'weak') weak += amt;
    else if (chance === 'ok') ok += amt;
    else if (chance === 'expected') expected += amt;
    // "Agreement Sent" is a Stage value, not the free-text Status column.
    if (stage === 'Agreement Sent') agreements += amt;
  }
  const toK = (n) => (n > 0 ? n / 1000 : null);
  const pipe = sumBfoPipe(bfo);
  return {
    weak: toK(weak), ok: toK(ok), expected: toK(expected),
    agreements: toK(agreements), bfoPipe: pipe != null ? pipe / 1000 : null,
  };
}

// Rounded to whole $K, the way "Edit values" stores a month. null when
// nothing computed.
export function roundQuotedFigures(figures) {
  if (!figures) return null;
  const snap = {};
  let any = false;
  for (const f of QUOTED_FIELDS) {
    const v = figures[f];
    if (v != null && Number.isFinite(v)) { snap[f] = Math.round(v); any = true; }
  }
  return any ? snap : null;
}

// "YYYY-MM" for the UTC month `nowMs` falls in.
export function utcMonthKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Is `nowMs` on the last day of its month, in UTC? That is the window
// capturedAtMonthEnd (utils/quotedMonthRebuild) accepts as a month-end
// reading.
export function isLastDayOfMonthUTC(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const tomorrow = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return tomorrow.getUTCDate() === 1;
}

/**
 * Write a month-end capture of `snap` for `monthKey` into the stored table.
 * Returns the new table, or null when there is nothing to write: no figures,
 * or the month already holds a value typed through "Edit values" (no `_auto`
 * / `_rebuilt` flag), which is the user's and always stands.
 */
export function withMonthEndCapture(table, monthKey, snap, nowIso) {
  if (!snap || !monthKey) return null;
  const cur = table && typeof table === 'object' ? table : {};
  const existing = cur[monthKey];
  if (existing && !existing._auto && !existing._rebuilt) return null;
  return { ...cur, [monthKey]: { ...snap, _auto: true, _capturedAt: nowIso } };
}
