// Assertion tests for the scheduled Weekly Report email. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/weeklyReportSchedule.test.mjs
//
// Two things are worth pinning down here.
//
// The first is the timezone round trip. The user picks a local hour and day
// ("Monday at 06:00"); the client derives UTC anchors from the first
// concrete local instant, and the server recurs on those anchors with no
// knowledge of the user's zone. Get that wrong and the email arrives on the
// right day in UTC but the wrong day for the reader — west of Greenwich a
// Monday 06:00 local send is a Monday *11:00* UTC one, and a naive
// "dayOfWeek = 1, hourUtc = 6" would mail at 01:00 their time.
//
// The second is that the renderer escapes. The report body carries a
// narrative written by an LLM and opp names typed by whoever entered them;
// both reach an HTML email. Anything that renders those without escaping
// puts arbitrary markup in the reader's inbox.
import {
  buildRecurrenceFields, firstLocalRun, describeSchedule,
  normalizeRecipients, isValidEmail,
} from '../src/utils/weeklyReportSchedule.js';
import { computeNextRun } from '../api/_lib/peOppsSchedule.js';
import { computeNextRunZoned } from '../api/_lib/weeklyReportSchedule.js';
import { freshnessNote, narrativeHtml, renderWeeklyReportHtml } from '../api/_lib/weeklyReportEmail.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

// ---- recurrence: "every Monday at 06:00" ---------------------------------

// A Thursday, so the first run is a few days out rather than today.
const THU = new Date('2026-09-03T14:00:00Z');
const mondaySix = { frequency: 'weekly', hourLocal: 6, dayOfWeekLocal: 1 };
const fields = buildRecurrenceFields(mondaySix, THU);
const first = new Date(fields.nextRunAt);

check('first run is a Monday, locally', first.getDay(), 1);
check('first run is 06:00, locally', first.getHours(), 6);
check('first run is in the future', first.getTime() > THU.getTime(), true);
check('stored UTC anchors match that instant',
  [fields.dayOfWeek, fields.hourUtc], [first.getUTCDay(), first.getUTCHours()]);

// Production recurs through computeNextRunZoned, which holds the user's
// wall-clock time. Every subsequent run must still be Monday 06:00 for the
// reader, in whatever zone this test happens to run in.
let cursor = fields.nextRunAt;
for (let week = 1; week <= 4; week += 1) {
  const next = new Date(computeNextRunZoned(fields, cursor));
  check(`week +${week} still Monday 06:00 locally`, [next.getDay(), next.getHours()], [1, 6]);
  cursor = next.getTime();
}

// The shared UTC helper is the fallback for schedules saved before the zone
// was recorded. It can only promise a fixed UTC anchor seven days apart —
// it cannot hold a local hour across a DST change, and in a half-hour zone
// (Kolkata is UTC+5:30) an integer hourUtc cannot even express the chosen
// local time. That is exactly why computeNextRunZoned exists; assert the
// fallback for what it does guarantee rather than what it does not.
let utcCursor = fields.nextRunAt;
for (let week = 1; week <= 4; week += 1) {
  const next = new Date(computeNextRun(fields, utcCursor));
  check(`fallback week +${week} holds its UTC anchor`,
    [next.getUTCDay(), next.getUTCHours()], [fields.dayOfWeek, fields.hourUtc]);
  utcCursor = next.getTime();
}

// Firing at the exact scheduled instant must roll forward, never re-fire
// the same slot — the cron passes `now`, which equals nextRunAt on time.
check('a run at the exact instant rolls forward',
  computeNextRun(fields, fields.nextRunAt) > fields.nextRunAt, true);

// ---- recurrence across a DST change --------------------------------------
//
// A fixed UTC anchor cannot hold a wall-clock hour: when the zone's offset
// moves, the send moves with it. "Monday morning at 6" has to mean six in
// the morning on both sides of the change, so the zoned helper resolves
// each run against the stored IANA zone instead. Sydney gains an hour on
// 4 Oct 2026, the US on 8 Mar 2026 and 1 Nov 2026, and the EU on 29 Mar
// 2026 — each a case a fixed UTC hour gets wrong by exactly an hour.

function localHourDow(ms, timeZone) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short', hour: '2-digit',
  }).formatToParts(new Date(ms))) p[part.type] = part.value;
  return [{ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], Number(p.hour) % 24];
}

for (const [zone, start] of [
  ['Australia/Sydney', '2026-09-03T14:00:00Z'],   // +10 -> +11 on 4 Oct
  ['America/Chicago', '2026-02-25T14:00:00Z'],    // -6 -> -5 on 8 Mar
  ['America/New_York', '2026-10-20T14:00:00Z'],   // -4 -> -5 on 1 Nov
  ['Europe/Paris', '2026-03-18T14:00:00Z'],       // +1 -> +2 on 29 Mar
]) {
  const zoned = { frequency: 'weekly', hourLocal: 6, dayOfWeekLocal: 1, timeZone: zone };
  let at = Date.parse(start);
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    at = computeNextRunZoned(zoned, at);
    seen.push(localHourDow(at, zone).join(':'));
  }
  check(`${zone}: every run is Monday 06:00 local across the DST change`,
    [...new Set(seen)], ['1:6']);
}

// Without a stored zone it must behave exactly as it always did.
const zoneless = { ...fields, timeZone: '' };
check('no stored zone falls back to the shared UTC math',
  computeNextRunZoned(zoneless, THU.getTime()), computeNextRun(zoneless, THU.getTime()));
check('an unrecognised zone falls back rather than throwing',
  computeNextRunZoned({ ...fields, timeZone: 'Not/AZone' }, THU.getTime()),
  computeNextRun(zoneless, THU.getTime()));
check('a zoned run at the exact instant rolls forward', (() => {
  const z = { frequency: 'weekly', hourLocal: 6, dayOfWeekLocal: 1, timeZone: 'America/Chicago' };
  const one = computeNextRunZoned(z, THU.getTime());
  return computeNextRunZoned(z, one) > one;
})(), true);
check('zoned daily holds its local hour over a DST change', (() => {
  const z = { frequency: 'daily', hourLocal: 6, timeZone: 'America/Chicago' };
  let at = Date.parse('2026-03-05T12:00:00Z');
  const hours = new Set();
  for (let i = 0; i < 6; i += 1) { at = computeNextRunZoned(z, at); hours.add(localHourDow(at, 'America/Chicago')[1]); }
  return [...hours];
})(), [6]);

// Daily and monthly still behave, since the same UI writes them.
check('daily rolls a day', (() => {
  const f = buildRecurrenceFields({ frequency: 'daily', hourLocal: 6 }, THU);
  return (computeNextRunZoned(f, f.nextRunAt) - f.nextRunAt) / 86400000;
})(), 1);

// A half-hour zone is the other case an integer hourUtc cannot express, and
// the reason the zoned path is not merely a DST nicety: in Kolkata
// (UTC+5:30) the fallback's anchor is 30 minutes off the hour the user
// picked, every single run.
check('half-hour zone keeps the exact local hour', (() => {
  const z = { frequency: 'weekly', hourLocal: 6, dayOfWeekLocal: 1, timeZone: 'Asia/Kolkata' };
  let at = THU.getTime();
  const stamps = new Set();
  for (let i = 0; i < 4; i += 1) {
    at = computeNextRunZoned(z, at);
    stamps.add(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(at)));
  }
  return [...stamps];
})(), ['Mon 06:00']);
check('monthly clamps past day 28', buildRecurrenceFields(
  { frequency: 'monthly', hourLocal: 6, dayOfMonthLocal: 31 }, THU).dayOfMonthLocal, 28);

// An hour picked at a boundary must not wrap to the previous day.
check('23:00 stays on the chosen day', firstLocalRun(
  { frequency: 'weekly', hourLocal: 23, dayOfWeekLocal: 1 }, THU).getDay(), 1);
check('00:00 stays on the chosen day', firstLocalRun(
  { frequency: 'weekly', hourLocal: 0, dayOfWeekLocal: 1 }, THU).getDay(), 1);

check('describes the schedule', describeSchedule({ frequency: 'weekly', dayOfWeekLocal: 1, hourLocal: 6 }),
  'Weekly · Monday at 06:00');

// ---- recipients ----------------------------------------------------------

check('splits and dedupes recipients',
  normalizeRecipients('a@x.com, A@X.com\nb@x.com; b@x.com'), ['a@x.com', 'b@x.com']);
check('drops empties', normalizeRecipients('a@x.com,,\n , '), ['a@x.com']);
check('rejects a non-address', isValidEmail('not an email'), false);
check('accepts an address', isValidEmail(' me@example.com '), true);

// ---- freshness -----------------------------------------------------------
//
// The snapshot is only as current as the last visit to the tab, so an email
// built from one captured mid-period has to say so rather than present a
// partial week as a whole one.

const periodEnd = Date.parse('2026-09-06T23:59:59Z');
check('captured mid-period reads stale',
  freshnessNote({ capturedAt: Date.parse('2026-09-04T22:12:00Z'), periodEnd }).stale, true);
check('captured after the period ends reads fresh',
  freshnessNote({ capturedAt: Date.parse('2026-09-07T05:00:00Z'), periodEnd },
    Date.parse('2026-09-07T11:00:00Z')).stale, false);
check('a snapshot with no timestamp reads stale', freshnessNote({}).stale, true);
check('a months-old snapshot reads stale',
  freshnessNote({ capturedAt: Date.parse('2026-07-01T00:00:00Z'), periodEnd: null },
    Date.parse('2026-09-07T00:00:00Z')).stale, true);

// ---- escaping ------------------------------------------------------------

const evil = narrativeHtml('## <img src=x onerror=alert(1)>\n- **kept** & <script>bad()</script>');
check('narrative escapes tags', /&lt;img/.test(evil) && /&lt;script&gt;/.test(evil), true);
check('narrative escapes ampersands', evil.includes('&amp;'), true);
check('narrative keeps intended bold', evil.includes('<strong>kept</strong>'), true);
check('narrative emits no live script tag', /<script/i.test(evil), false);

const injected = renderWeeklyReportHtml({
  capturedAt: Date.now(),
  periodLabel: '<b>label</b>',
  kpiCards: [{ label: '<b>k</b>', value: '<i>v</i>', lines: ['<u>line</u>'] }],
  tiles: [{ label: '<b>t</b>', value: 1, goal: 2 }],
  oppChanges: { newOpps: ['<script>x</script>'] },
}, { message: '<b>intro</b>' });
check('opp names are escaped', injected.includes('&lt;script&gt;x&lt;/script&gt;'), true);
check('period label is escaped', injected.includes('&lt;b&gt;label&lt;/b&gt;'), true);
check('intro message is escaped', injected.includes('&lt;b&gt;intro&lt;/b&gt;'), true);
check('no attacker tag survives anywhere', /<(script|img|u)\b/i.test(injected), false);

// ---- rendering -----------------------------------------------------------

const html = renderWeeklyReportHtml({
  capturedAt: Date.parse('2026-09-07T05:02:00Z'),
  periodEnd,
  periodLabel: 'Mon, Aug 31 – Sun, Sep 6, 2026',
  kpiCards: [
    { label: 'Progress to target', value: '36.6%', status: 'behind', chip: 'Behind pace', lines: ['$484,616 sold of $1,325,000'] },
  ],
  tiles: [
    { label: 'Emails sent', value: 0, goal: 50, accent: 'blue' },
    { label: 'New opps', value: 2, goal: 1, accent: 'green' },
  ],
  oppChanges: { newOpps: ['Acme: HQ retrofit (Discovery)'], closed: [] },
  narrative: '## Summary\nTwo new opps landed.',
});

check('renders the KPI value', html.includes('36.6%'), true);
check('renders the chip', html.includes('Behind pace'), true);
check('a missed goal draws a blue bar at 0%',
  html.includes('width:0%') && html.includes('#3B82F6'), true);
check('a met goal draws a green bar capped at 100%',
  html.includes('width:100%') && html.includes('#10B981'), true);
check('lists the opp changes', html.includes('Acme: HQ retrofit'), true);
check('omits sections with nothing in them', html.includes('Deals closed'), false);
check('includes the narrative', html.includes('Two new opps landed.'), true);

// A snapshot with nothing cached must still produce a sendable email rather
// than throwing — the cron has no user to fall back to.
const bare = renderWeeklyReportHtml({ capturedAt: Date.now() });
check('an empty snapshot still renders', bare.includes('Weekly Report'), true);
check('an empty snapshot says nothing was cached', bare.includes('No chart data'), true);
check('a null snapshot still renders', renderWeeklyReportHtml(null).includes('Weekly Report'), true);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
