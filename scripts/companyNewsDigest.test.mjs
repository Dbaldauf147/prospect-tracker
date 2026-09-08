// Assertion tests for the acquisition-news digest's scheduling behaviour.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/companyNewsDigest.test.mjs
//
// The bug these guard against produced a *plausible-looking* email every
// week: "0 acquisitions across 0 of 21 tracked companies". Nothing in it
// said that only one company had actually been searched, or that it was
// the same company every single time. Three ways that can come back:
//
//   - researchAll going sequential again, so one slow firm eats the whole
//     budget and everyone after it is reported as "not searched";
//   - the rotation cursor not advancing (or advancing past companies that
//     were never searched), stranding the tail of the list forever;
//   - the email collapsing "found nothing", "search failed" and "never
//     searched" back into one indistinguishable line.
import {
  researchAll,
  rotateForRun,
  nextCursor,
  buildNewsEmailHtml,
  digestWindow,
} from '../api/_lib/companyNews.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

const firms = (n) => Array.from({ length: n }, (_, i) => ({
  company: `Firm ${String(i).padStart(2, '0')}`,
  isPe: true,
}));

// A stand-in for one Claude web-search pass: takes `ms`, and honours the
// abort signal the way a real aborted fetch does.
const stubResearch = (ms, deals = () => []) => (entry, since, until, { signal } = {}) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ deals: deals(entry), error: null }), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve({ deals: [], error: 'Research timed out' });
    });
  });

// ---- Concurrency ---------------------------------------------------------
{
  // 8 companies, 100ms each, 1s budget. Sequential would manage ~8 but the
  // point is the pool: with concurrency 4 this finishes in ~2 rounds.
  const started = [];
  const t0 = Date.now();
  const results = await researchAll(firms(8), 0, 0, {
    budgetMs: 60_000,
    concurrency: 4,
    research: (entry, ...rest) => { started.push(entry.company); return stubResearch(100)(entry, ...rest); },
  });
  const elapsed = Date.now() - t0;

  eq(results.length, 8, 'concurrency: every company gets a result slot');
  eq(results.filter((r) => r.skipped).length, 0, 'concurrency: nothing skipped inside a generous budget');
  ok(elapsed < 400, `concurrency: 8×100ms finishes in ~2 rounds, not 8 (took ${elapsed}ms)`);
  eq(results.map((r) => r.company), firms(8).map((f) => f.company), 'concurrency: results stay in list order');
}

{
  // Results must land at the right index even when workers finish out of
  // order — a push()-based pool would scramble these.
  const results = await researchAll(firms(6), 0, 0, {
    budgetMs: 60_000,
    concurrency: 3,
    research: (entry, ...rest) => {
      const slow = entry.company.endsWith('00') ? 200 : 10;
      return stubResearch(slow)(entry, ...rest);
    },
  });
  eq(results.map((r) => r.company), firms(6).map((f) => f.company), 'concurrency: out-of-order completion keeps indices');
}

{
  // The per-company cap is what stops one firm consuming a whole run. With
  // a 60s budget and a company that never returns, the abort must still
  // fire — here via a budget shorter than the stub's runtime.
  const results = await researchAll(firms(2), 0, 0, {
    budgetMs: 9_000,
    concurrency: 1,
    research: stubResearch(60_000),
  });
  eq(results[0].error, 'Research timed out', 'per-company cap: a hung search is aborted, not left to run');
}

{
  // Below MIN_SLICE_MS nothing new is started — those companies are marked
  // skipped rather than launched into a search that cannot finish.
  const results = await researchAll(firms(5), 0, 0, {
    budgetMs: 5_000,
    concurrency: 1,
    research: stubResearch(10),
  });
  eq(results.every((r) => r.skipped), true, 'budget: too little time left means skipped, not attempted');
  eq(results.every((r) => r.error === null), true, 'budget: a skipped company is not an error');
}

// ---- Rotation ------------------------------------------------------------
{
  const names = (list) => list.map((f) => f.company);
  eq(names(rotateForRun(firms(4), 0)), ['Firm 00', 'Firm 01', 'Firm 02', 'Firm 03'], 'rotate: cursor 0 is the plain list');
  eq(names(rotateForRun(firms(4), 2)), ['Firm 02', 'Firm 03', 'Firm 00', 'Firm 01'], 'rotate: cursor 2 wraps around');
  eq(names(rotateForRun(firms(4), 4)), ['Firm 00', 'Firm 01', 'Firm 02', 'Firm 03'], 'rotate: a full lap is cursor 0');
  eq(names(rotateForRun(firms(4), 6)), ['Firm 02', 'Firm 03', 'Firm 00', 'Firm 01'], 'rotate: cursor past the end wraps');
  eq(rotateForRun([], 3), [], 'rotate: an empty list stays empty');
  eq(names(rotateForRun(firms(3), undefined)), ['Firm 00', 'Firm 01', 'Firm 02'], 'rotate: a missing cursor starts at 0');
  eq(names(rotateForRun(firms(3), -1)), ['Firm 00', 'Firm 01', 'Firm 02'], 'rotate: a junk cursor starts at 0');
}

{
  const res = (n, skippedFrom) => Array.from({ length: n }, (_, i) => ({ skipped: i >= skippedFrom }));
  eq(nextCursor(0, res(21, 12)), 12, 'cursor: advances by the number actually searched');
  eq(nextCursor(12, res(21, 9)), 0, 'cursor: wraps exactly at the end of the list');
  eq(nextCursor(18, res(21, 6)), 3, 'cursor: wraps past the end');
  eq(nextCursor(0, res(21, 21)), 0, 'cursor: a full sweep returns to the start');
  eq(nextCursor(7, res(21, 0)), 7, 'cursor: a run that searched nothing does not advance');
  eq(nextCursor(5, []), 0, 'cursor: no companies means no cursor');
}

{
  // The whole point, end to end: three short runs must cover all 7 firms,
  // not re-search the first 3 forever.
  const seen = new Set();
  let cursor = 0;
  const all = firms(7);
  for (let run = 0; run < 3; run++) {
    const ordered = rotateForRun(all, cursor);
    const results = ordered.map((f, i) => ({ ...f, skipped: i >= 3 }));
    results.filter((r) => !r.skipped).forEach((r) => seen.add(r.company));
    cursor = nextCursor(cursor, results);
  }
  eq([...seen].sort(), all.map((f) => f.company), 'rotation: three partial runs cover the whole list');
}

// ---- The digest window ---------------------------------------------------
// A deal only lands if web search has indexed it, and indexing lags the
// announcement by days. A window that started exactly where the last one
// ended meant a late-indexed deal fell between two digests and was never
// seen by either — so every window now reaches back at least 14 days, and
// consecutive digests deliberately overlap.
{
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-08T00:00:00Z');
  const days = (w) => Math.round((w.until - w.since) / DAY);

  eq(days(digestWindow(null, now)), 14, 'window: a first run looks back 14 days');
  eq(days(digestWindow(0, now)), 14, 'window: a never-sent schedule looks back 14 days');
  eq(days(digestWindow(now - 7 * DAY, now)), 14, 'window: a weekly schedule is widened to 14 days');
  eq(days(digestWindow(now - 1 * DAY, now)), 14, 'window: a daily schedule is widened to 14 days');
  eq(days(digestWindow(now - 30 * DAY, now)), 30, 'window: a longer gap keeps its own anchor');
  eq(days(digestWindow(now - 365 * DAY, now)), 60, 'window: a long-paused schedule is still capped at 60 days');
  eq(digestWindow(now - 7 * DAY, now).until, now, 'window: always ends now');

  // Consecutive weekly runs must overlap — that overlap is the whole point.
  const first = digestWindow(now - 7 * DAY, now);
  const second = digestWindow(now, now + 7 * DAY);
  ok(second.since < first.until, 'window: consecutive weekly digests overlap rather than abut');

  // A typed test lookback is taken literally, not widened.
  eq(days(digestWindow(now - 3 * DAY, now, { minLookbackDays: 3 })), 3, 'window: an explicit 3-day test lookback stays 3 days');
  eq(days(digestWindow(now - 7 * DAY, now, { minLookbackDays: 0 })), 7, 'window: a zero minimum honours the anchor exactly');
  eq(days(digestWindow(now - 7 * DAY, now, { minLookbackDays: NaN })), 14, 'window: a junk minimum falls back to the default');
}

// ---- Email copy ----------------------------------------------------------
{
  const results = [
    { company: 'Quiet Co', isPe: true, deals: [], error: null, skipped: false },
    { company: 'Broken Co', isPe: true, deals: [], error: 'Research timed out', skipped: false },
    { company: 'Unreached Co', isPe: true, deals: [], error: null, skipped: true },
  ];
  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });

  ok(html.includes('No acquisitions found (1)'), 'email: searched-and-empty gets its own count');
  ok(html.includes('Search failed (1)'), 'email: a failure is not filed under "no acquisitions found"');
  ok(html.includes('Research timed out'), 'email: the failure reason is actually printed');
  ok(html.includes('Not searched this run'), 'email: unreached companies are called out');
  ok(html.includes('0 of 2 searched'), 'email: the header counts searched companies, not tracked ones');
  ok(html.includes('(3 tracked)'), 'email: the header still says how many are tracked');
  ok(html.includes('this run reached'), 'email: an empty digest says it did not cover everything');
}

{
  // A full sweep should not nag about partial coverage.
  const results = [
    { company: 'Quiet Co', isPe: true, deals: [], error: null, skipped: false },
    { company: 'Also Quiet', isPe: true, deals: [], error: null, skipped: false },
  ];
  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });
  ok(!html.includes('tracked)'), 'email: a full sweep drops the "(n tracked)" caveat');
  ok(!html.includes('this run reached'), 'email: a full sweep does not claim partial coverage');
  ok(!html.includes('Not searched'), 'email: a full sweep has no "not searched" block');
}

{
  // Error text is company-controlled only in the sense that it echoes an API
  // response — escape it anyway.
  const results = [{ company: 'X<script>', isPe: false, deals: [], error: '<img onerror=1>', skipped: false }];
  const html = buildNewsEmailHtml(results, { since: 0, until: 1 });
  ok(!html.includes('<script>'), 'email: company names are escaped');
  ok(!html.includes('<img onerror'), 'email: error text is escaped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
