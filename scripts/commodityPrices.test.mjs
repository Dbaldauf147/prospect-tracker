// Assertion tests for the weekly commodity email — WTI crude and Henry
// Hub natural gas. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/commodityPrices.test.mjs
//
// The source chain is the part worth pinning hardest. Three feeds are
// tried in order because none is guaranteed, and two of them fail in ways
// that look like success: Stooq answers a bad symbol with a 200 and the
// body "No data", and Yahoo returns a well-formed envelope with an empty
// series. A fallback that treats either as an answer mails a flat line,
// which reads as a quiet market rather than as a broken feed.
//
// The other half is the two commodities staying apart. They are fetched
// independently, drawn in their own colours, attached under their own
// Content-IDs, and quoted in their own units — $62 and $3 side by side
// are a barrel and a million BTU, not a collapse.
import {
  COMMODITIES, commodityByKey, fetchCommoditySeries, fetchAllSeries,
  summarizeSeries, weeklyCloses, buildCommodityEmail, commodityEmailSubject,
} from '../api/_lib/commodityPrices.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const NOW = Date.parse('2026-09-14T12:00:00Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// A weekday series ending at `now`, walking from `base` by `step` a day,
// so the stats have something with a direction in them.
function closes(base, step, days = 70) {
  const out = [];
  for (let i = days; i >= 0; i -= 1) {
    const d = new Date(NOW - i * DAY);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: iso(d.getTime()), close: +(base + (days - i) * step).toFixed(2) });
  }
  return out;
}

const csv = (points) => ['Date,Open,High,Low,Close,Volume',
  ...points.map(p => `${p.date},0,0,0,${p.close},0`)].join('\n');

const ok = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => body });

// A fetch that answers per host, so a test can knock one source out and
// watch the chain fall through to the next.
function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [match, respond] of handlers) {
      if (url.includes(match)) return respond(url);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const wti = commodityByKey('wti');
const gas = commodityByKey('henryHub');

// ---- the spec table -----------------------------------------------------
{
  check('two commodities are covered', COMMODITIES.length, 2);
  check('crude is priced per barrel', wti.unit, 'bbl');
  check('gas is priced per million BTU', gas.unit, 'MMBtu');
  // Two images in one message: shared ids would make each section show the
  // other's chart, or the same one twice.
  check('the charts do not share a Content-ID', wti.chartCid === gas.chartCid, false);
  check('nor a filename', wti.chartFile === gas.chartFile, false);
  check('nor a line colour', wti.line === gas.line, false);
  check('an unknown key is null, not a crash', commodityByKey('brent'), null);
}

// ---- the source chain ---------------------------------------------------
// No EIA key: the first source is skipped rather than tried, and Stooq —
// the one that runs out of the box — answers.
{
  delete process.env.EIA_API_KEY;
  const fetchImpl = fakeFetch([['stooq.com', () => ok(csv(closes(60, 0.05)))]]);
  const s = await fetchCommoditySeries(wti, { now: NOW, fetchImpl });
  check('no EIA key → EIA is skipped, not failed',
    s.attempts.find(a => a.name === 'EIA').status, 'skipped');
  check('Stooq answers', s.attempts.find(a => a.name === 'Stooq').status, 'ok');
  check('and Yahoo is never called', fetchImpl.calls.some(u => u.includes('yahoo')), false);
  check('the series is named for its source', s.label, 'WTI crude (front-month)');
  check('the points are oldest first', s.points[0].date < s.points[s.points.length - 1].date, true);
}

// Stooq's 200-with-"No data" is the failure that matters: it must fall
// through to Yahoo rather than be mailed as an empty market.
{
  const fetchImpl = fakeFetch([
    ['stooq.com', () => ok('No data')],
    ['yahoo', () => {
      const pts = closes(3.1, 0.01);
      return ok({
        chart: { result: [{
          timestamp: pts.map(p => Date.parse(`${p.date}T00:00:00Z`) / 1000),
          indicators: { quote: [{ close: pts.map(p => p.close) }] },
        }] },
      });
    }],
  ]);
  const s = await fetchCommoditySeries(gas, { now: NOW, fetchImpl });
  check('a 200 with no CSV is an error, not an empty week',
    s.attempts.find(a => a.name === 'Stooq').status, 'error');
  check('so Yahoo is asked', s.attempts.find(a => a.name === 'Yahoo').status, 'ok');
  check('and it is asked for the gas symbol',
    fetchImpl.calls.some(u => u.includes('NG%3DF') || u.includes('NG=F')), true);
  check('the gas series is labelled as gas', s.label, 'Henry Hub natural gas (front-month)');
}

// A well-formed envelope with nothing in it is the other silent failure.
{
  const fetchImpl = fakeFetch([
    ['stooq.com', () => ok('No data')],
    ['yahoo', () => ok({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } })],
  ]);
  let threw = '';
  try { await fetchCommoditySeries(gas, { now: NOW, fetchImpl }); } catch (e) { threw = String(e.message); }
  check('every source failing throws', threw.includes('No price source answered'), true);
  check('and the message names the commodity', threw.includes('Henry Hub natural gas'), true);
}

// Points outside the 90-day window are trimmed, so "90-day high" means 90
// days however much history a source volunteers.
{
  const old = [{ date: iso(NOW - 200 * DAY), close: 999 }, ...closes(60, 0.05)];
  const fetchImpl = fakeFetch([['stooq.com', () => ok(csv(old))]]);
  const s = await fetchCommoditySeries(wti, { now: NOW, fetchImpl });
  check('history older than the window is dropped',
    s.points.some(p => p.close === 999), false);
}

// ---- both commodities together ------------------------------------------
{
  const fetchImpl = fakeFetch([
    ['s=cl.f', () => ok(csv(closes(60, 0.05)))],
    ['s=ng.f', () => ok(csv(closes(3.1, 0.01)))],
  ]);
  const { series, failures: fails } = await fetchAllSeries({ now: NOW, fetchImpl });
  check('both series come back', series.length, 2);
  check('nothing failed', fails.length, 0);
  check('each carries its own spec', series.map(s => s.spec.key).join(','), 'wti,henryHub');

  const mail = buildCommodityEmail(series, { now: NOW });
  check('one attachment per chart', mail.attachments.length, 2);
  check('under their own cids',
    mail.attachments.map(a => a.cid).join(','), `${wti.chartCid},${gas.chartCid}`);
  check('no chart failed to draw', mail.chartError, null);

  // The subject is the whole point on a phone: both numbers, before the
  // mail is opened.
  check('the subject names crude', mail.subject.includes('WTI crude $'), true);
  check('the subject names gas', mail.subject.includes('Henry Hub natural gas $'), true);
  check('with the units that tell them apart',
    mail.subject.includes('/bbl') && mail.subject.includes('/MMBtu'), true);

  check('both sections render', mail.html.includes('WTI crude (front-month)')
    && mail.html.includes('Henry Hub natural gas (front-month)'), true);
  check('the gas headline carries its unit', mail.html.includes('/MMBtu'), true);
  check('and each section names its own source',
    mail.html.includes('Stooq - WTI front-month future (CL.F)')
    && mail.html.includes('Stooq - Henry Hub front-month future (NG.F)'), true);
  check('no failure banner when nothing failed',
    mail.html.includes("Not in this week's mail"), false);
}

// One commodity down: the other still goes, and the mail says what is
// missing rather than quietly looking like a crude-only report.
{
  const fetchImpl = fakeFetch([
    ['s=cl.f', () => ok(csv(closes(60, 0.05)))],
    ['s=ng.f', () => ok('No data')],
    ['yahoo', () => ok({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } })],
  ]);
  const { series, failures: fails } = await fetchAllSeries({ now: NOW, fetchImpl });
  check('the healthy commodity still comes back', series.length, 1);
  check('and the broken one is reported', fails.length, 1);
  check('by name', fails[0].name, 'Henry Hub natural gas');

  const mail = buildCommodityEmail(series, { now: NOW, failures: fails });
  check('the mail still has a crude section', mail.html.includes('WTI crude'), true);
  check('and says gas is missing', mail.html.includes("Not in this week's mail"), true);
  check('naming it', mail.html.includes('Henry Hub natural gas:'), true);
  check('the subject only claims what it has',
    mail.subject.includes('Henry Hub'), false);
  check('one chart, not two', mail.attachments.length, 1);
}

// Everything down is the one case with no mail worth sending.
{
  const fetchImpl = fakeFetch([
    ['stooq.com', () => ok('No data')],
    ['yahoo', () => ok({ chart: { result: [] } })],
  ]);
  let threw = '';
  try { await fetchAllSeries({ now: NOW, fetchImpl }); } catch (e) { threw = String(e.message); }
  check('no commodity at all throws', threw.includes('WTI crude'), true);
  check('and names both', threw.includes('Henry Hub natural gas'), true);
}

// ---- stats --------------------------------------------------------------
{
  const points = [
    { date: '2026-06-22', close: 60 },
    { date: '2026-08-14', close: 71 },   // the window high
    { date: '2026-09-04', close: 55 },   // the window low, and ~a week back
    { date: '2026-09-11', close: 66 },
  ];
  const s = summarizeSeries(points, { now: NOW });
  check('the latest close leads', s.latest.close, 66);
  check('the high is the high', s.high.close, 71);
  check('the low is the low', s.low.close, 55);
  check('the average is the mean of the closes', +s.avg.toFixed(2), 63);
  check('the week change reads back to the last trading day on or before it',
    s.changeWeek.from.date, '2026-09-04');
  check('and states the move', s.changeWeek.abs, 11);
  // A window with one close has nothing to compare against, and must say
  // so rather than report a 0% week.
  const single = summarizeSeries([{ date: '2026-09-11', close: 66 }], { now: NOW });
  check('a single close has no week change', single.changeWeek, null);
  check('and no window change', single.changeWindow, null);
}

// Weekly collapse: one row per Monday-anchored week, the last trading day
// of each.
{
  const weeks = weeklyCloses([
    { date: '2026-09-01', close: 10 },
    { date: '2026-09-04', close: 12 },  // same week — later, so it wins
    { date: '2026-09-07', close: 14 },
  ]);
  check('one row per week', weeks.length, 2);
  check('anchored on the Monday', weeks[0].weekOf, '2026-08-31');
  check('keeping the last close of the week', weeks[0].close, 12);
  check('and the next week starts its own row', weeks[1].weekOf, '2026-09-07');
}

// ---- the preview --------------------------------------------------------
// ?dry=1 renders in a browser, which has no cid: to resolve, so the charts
// have to travel inline there and only there.
{
  const fetchImpl = fakeFetch([
    ['s=cl.f', () => ok(csv(closes(60, 0.05)))],
    ['s=ng.f', () => ok(csv(closes(3.1, 0.01)))],
  ]);
  const { series } = await fetchAllSeries({ now: NOW, fetchImpl });
  const preview = buildCommodityEmail(series, { now: NOW, inlineImage: true });
  check('a preview attaches nothing', preview.attachments.length, 0);
  check('and embeds both charts', (preview.html.match(/data:image\/png;base64,/g) || []).length, 2);
  const sent = buildCommodityEmail(series, { now: NOW });
  check('a sent mail references cids instead',
    sent.html.includes(`cid:${wti.chartCid}`) && sent.html.includes(`cid:${gas.chartCid}`), true);
  check('and embeds nothing', sent.html.includes('data:image/png'), false);
}

// A subject built from no sections must not throw — the route has already
// returned 502 by then, but the helper is exported and called elsewhere.
check('an empty subject degrades rather than throws',
  commodityEmailSubject([]).includes('90-day recap'), true);

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
