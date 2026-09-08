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
// The third is that the email carries what the tab shows. It is built from
// a snapshot rather than recomputed, so anything the snapshot drops is
// silently missing from the reader's copy — which is how a week of sent
// mail once arrived as "Emails sent 0" beside a screen reading 27.
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
import { buildSnapshotDoc } from '../api/_lib/weeklyReportSnapshot.js';

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
  tiles: [{ label: '<b>t</b>', value: 1, goal: 2, sub: '<u>sub</u>' }],
  funnel: {
    caption: '<b>cap</b>',
    stages: [{ label: '<img src=x>', count: 1, amount: '<i>$1</i>', life: '<u>1</u>', closeRate: '<b>1%</b>' }],
    outcome: { soldLabel: '<b>sold</b>', sold: '<i>$1</i>', weighted: '<u>$2</u>', total: '<b>$3</b>', note: '<script>n</script>' },
  },
  closeRateTrend: {
    months: ['<b>Apr</b>'],
    rows: [{
      label: '<img src=x>', stage: 5,
      cells: [{ rate: '<i>17%</i>', count: '<u>1/6</u>' }],
      overall: { rate: '<b>44%</b>', count: '<u>7/16</u>', ahead: 25 },
      rolling12: { rate: '<script>19%</script>', count: '9/47' },
    }],
  },
  goals: { active: ['<script>g</script>'] },
  oppChanges: { newOpps: ['<script>x</script>'] },
}, { message: '<b>intro</b>' });
check('opp names are escaped', injected.includes('&lt;script&gt;x&lt;/script&gt;'), true);
check('period label is escaped', injected.includes('&lt;b&gt;label&lt;/b&gt;'), true);
check('intro message is escaped', injected.includes('&lt;b&gt;intro&lt;/b&gt;'), true);
check('goal text is escaped', injected.includes('&lt;script&gt;g&lt;/script&gt;'), true);
check('funnel stage names are escaped', injected.includes('&lt;img src=x&gt;'), true);
check('trend rates are escaped', injected.includes('&lt;i&gt;17%&lt;/i&gt;'), true);
check('trend month heads are escaped', injected.includes('&lt;b&gt;Apr&lt;/b&gt;'), true);
check('no attacker tag survives anywhere', /<(script|img|u)\b/i.test(injected), false);

// ---- snapshot builder ----------------------------------------------------
//
// Both the publish route and a test send run their payload through this, so
// a field one path carries and the other drops can't happen. The capture
// stamp is the point: a live test send posts what the tab is showing right
// now, and without a stamp the email told the reader it was "captured at an
// unknown time" about numbers seconds old.

const built = buildSnapshotDoc({
  scope: 'week',
  periodLabel: 'Mon, Aug 31 – Sun, Sep 6, 2026',
  kpiNote: 'Year to date — not scoped to the week picker',
  tiles: [{ label: 'Emails sent', value: 27, goal: 50, accent: 'blue', sub: 'recorded Sep 3' }],
  funnel: {
    caption: 'Band height = pipeline value.',
    stages: [{ label: 'Stage 3: Qualify Opportunity', count: 3, amount: '$402,000', life: '120 days', closeRate: '25%' }],
    outcome: { soldLabel: 'Closed YTD', sold: '$485K', weighted: '$349K', total: '$833K', note: '63% of $1.3M target' },
  },
  goals: { created: ['Book two site walks'], completed: [], active: ['#1 Close Berkshire'] },
}, { uid: 'u1', email: 'me@example.com' });

check('a posted snapshot is stamped with a capture time',
  Number.isFinite(built.capturedAt) && Math.abs(Date.now() - built.capturedAt) < 5000, true);
check('an unstamped snapshot no longer reads as unknown',
  freshnessNote(built).text.startsWith('Captured at an unknown time'), false);
check('ownership comes from the token, not the payload', built.ownerUid, 'u1');
check('the tile provenance note survives', built.tiles[0].sub, 'recorded Sep 3');
check('the funnel survives', built.funnel.stages[0].count, 3);
check('the goals survive', [built.goals.created.length, built.goals.active.length], [1, 1]);
check('a snapshot with no funnel stores none', buildSnapshotDoc({ funnel: { stages: [] } }, {}).funnel, null);

// ---- the funnel picture ---------------------------------------------------
// The tab rasterises its own chart and publishes the PNG, because no mail
// client renders an inline <svg>. What arrives here is a string that will
// be written into an <img src> and decoded into an attachment, so it is
// checked rather than trusted, and dropped rather than trimmed: the image
// must never be what pushes a snapshot past Firestore's 1 MB document cap,
// and the email carries the same figures as a table underneath it.
{
  const funnel = { stages: [{ label: 'Stage 3', count: 1, amount: '$1' }] };
  const png = `data:image/png;base64,${'iVBORw0KGgo='.repeat(4)}`;
  const shot = (funnelImage) => buildSnapshotDoc({ funnel, funnelImage }, {}).funnelImage;

  check('a PNG data URL is kept', shot({ src: png, width: 1600, height: 349 })?.src, png);
  check('its pixel size is kept', shot({ src: png, width: 1600, height: 349 })?.width, 1600);
  check('the alt text defaults rather than going empty',
    shot({ src: png, width: 10, height: 10 })?.alt, 'Pipeline funnel');
  check('an SVG data URL is refused',
    shot({ src: 'data:image/svg+xml;base64,AAAA', width: 10, height: 10 }), null);
  check('a remote URL is refused',
    shot({ src: 'https://example.com/chart.png', width: 10, height: 10 }), null);
  check('something that only looks like base64 is refused',
    shot({ src: 'data:image/png;base64,<script>', width: 10, height: 10 }), null);
  check('an oversized picture is dropped, not truncated',
    shot({ src: `data:image/png;base64,${'A'.repeat(400_001)}`, width: 10, height: 10 }), null);
  check('a picture with no size is refused', shot({ src: png, width: 0, height: 0 }), null);
  check('a picture with no funnel behind it is refused',
    buildSnapshotDoc({ funnelImage: { src: png, width: 10, height: 10 } }, {}).funnelImage, null);
}
check('funnel text is bounded',
  buildSnapshotDoc({ funnel: { caption: 'x'.repeat(500), stages: [{ label: 'y'.repeat(200) }] } }, {})
    .funnel.stages[0].label.length, 80);

// ---- the close-rate trend in a snapshot -----------------------------------
// The trend is the funnel's close-rate column with the time axis put back,
// and it is what the reader of the email came for: the tab shows it and the
// email showed nothing. It travels as formatted text for the same reason the
// funnel does, bounded on both axes because this document is rewritten on
// every visit to the tab.
{
  const trendIn = {
    months: ['Apr', 'May', 'Jun'],
    rows: [
      {
        label: 'Stage 5: Prepare & Bid', stage: 5,
        cells: [{ rate: '17%', count: '1/6' }, null, { rate: '100%', count: '2/2' }],
        overall: { rate: '44%', count: '7/16', ahead: 25 },
        rolling12: { rate: '19%', count: '9/47' },
      },
      {
        label: 'All closed opps', stage: null,
        cells: [null, null, null],
        overall: { rate: '10%', count: '7/68', ahead: null },
        rolling12: { rate: '5%', count: '9/176' },
      },
    ],
  };
  const t = buildSnapshotDoc({ closeRateTrend: trendIn }, {}).closeRateTrend;
  check('the trend survives the snapshot', t.months, ['Apr', 'May', 'Jun']);
  check('a rate keeps the count under it', t.rows[0].cells[0], { rate: '17%', count: '1/6' });
  check('a month with nothing closed stays blank', t.rows[0].cells[1], null);
  check('the points above the rolling year travel, for the ▲', t.rows[0].overall.ahead, 25);
  check('a stage keeps its number, for the funnel’s own colour', t.rows[0].stage, 5);
  // A null stage that clamped into range would paint the total row as
  // Stage 3 — the same blue as a stage whose figures it isn't.
  check('the all-closed row has no stage of its own', t.rows[1].stage, null);
  check('and is not flagged as ahead', t.rows[1].overall.ahead, null);

  // Bounds. A row longer than the month list would hand the email a grid
  // whose columns don't line up; a short one would leave a ragged row.
  const ragged = buildSnapshotDoc({
    closeRateTrend: {
      months: Array.from({ length: 40 }, (_, i) => `M${i}`),
      rows: Array.from({ length: 40 }, () => ({ label: 'x'.repeat(200), cells: [] })),
    },
  }, {}).closeRateTrend;
  check('the month columns are capped', ragged.months.length, 12);
  check('so are the rows', ragged.rows.length, 8);
  check('a row is padded to the month count', ragged.rows[0].cells.length, 12);
  check('a row that came up short reads as blank months', ragged.rows[0].cells[0], null);
  check('row labels are bounded', ragged.rows[0].label.length, 80);
  check('a trend with no months stores none',
    buildSnapshotDoc({ closeRateTrend: { months: [], rows: [{ label: 'Stage 3' }] } }, {}).closeRateTrend, null);
  check('a trend with no rows stores none',
    buildSnapshotDoc({ closeRateTrend: { months: ['Jun'], rows: [] } }, {}).closeRateTrend, null);
  check('no trend at all stores none', buildSnapshotDoc({}, {}).closeRateTrend, null);
  // The trend reads the Opps cache alone, so it must not be gated on the
  // funnel the way the funnel's picture is.
  check('the trend does not need a funnel behind it',
    buildSnapshotDoc({ closeRateTrend: trendIn }, {}).closeRateTrend.rows.length, 2);
}

// ---- rendering -----------------------------------------------------------

const html = renderWeeklyReportHtml({
  capturedAt: Date.parse('2026-09-07T05:02:00Z'),
  periodEnd,
  scope: 'week',
  periodLabel: 'Mon, Aug 31 – Sun, Sep 6, 2026',
  kpiNote: 'Year to date — not scoped to the week picker',
  kpiCards: [
    { label: 'Progress to target', value: '36.6%', status: 'behind', chip: 'Behind pace', lines: ['$484,616 sold of $1,325,000'] },
  ],
  funnel: {
    caption: 'Band height = pipeline value, segment length = avg opp life: 495 days end to end.',
    stages: [
      { label: 'Stage 3: Qualify Opportunity', count: 3, amount: '$402,000', life: '120 days', closeRate: '25%' },
      { label: 'Stage 4: Influence and Develop', count: 4, amount: '$918,000', life: null, closeRate: null },
    ],
    outcome: { soldLabel: 'Closed YTD', sold: '$485K', weighted: '$349K', total: '$833K', note: '63% of $1.3M target' },
  },
  closeRateTrend: {
    months: ['Apr', 'May', 'Jun'],
    rows: [
      {
        label: 'Stage 5: Prepare & Bid', stage: 5,
        cells: [{ rate: '17%', count: '1/6' }, null, { rate: '100%', count: '2/2' }],
        overall: { rate: '44%', count: '7/16', ahead: 25 },
        rolling12: { rate: '19%', count: '9/47' },
      },
      {
        label: 'All closed opps', stage: null,
        cells: [{ rate: '8%', count: '1/13' }, null, { rate: '13%', count: '2/15' }],
        overall: { rate: '10%', count: '7/68', ahead: null },
        rolling12: { rate: '5%', count: '9/176' },
      },
    ],
  },
  tiles: [
    { label: 'Emails sent', value: 27, goal: 50, accent: 'blue', sub: 'recorded Sep 3' },
    { label: 'New opps', value: 2, goal: 1, accent: 'green' },
  ],
  oppChanges: { newOpps: ['Acme: HQ retrofit (Discovery)'], closed: [] },
  goals: { created: ['Book two site walks'], completed: [], active: ['#1 Close Berkshire'] },
  narrative: '## Summary\nTwo new opps landed.',
});

check('renders the KPI value', html.includes('36.6%'), true);
check('renders the chip', html.includes('Behind pace'), true);
check('a missed goal draws a blue bar under 100%',
  html.includes('width:54%') && html.includes('#3B82F6'), true);
check('the tile carries the number the tab shows', html.includes('>27<'), true);
check('the tile says where an off-feed number came from', html.includes('recorded Sep 3'), true);
check('the KPI section carries the tab’s year-to-date note',
  html.includes('not scoped to the week picker'), true);
check('a met goal draws a green bar capped at 100%',
  html.includes('width:100%') && html.includes('#10B981'), true);
check('lists the opp changes', html.includes('Acme: HQ retrofit'), true);
check('omits sections with nothing in them', html.includes('Deals closed'), false);
check('includes the narrative', html.includes('Two new opps landed.'), true);

// The funnel is a drawn chart on the tab and a table here; the figures have
// to be the same ones, including the exit block hanging off the arrow.
check('draws the funnel stages', html.includes('Stage 4: Influence and Develop'), true);
check('carries the funnel caption', html.includes('495 days end to end'), true);
check('carries the projected total', html.includes('$833K'), true);
check('carries the share of target', html.includes('63% of $1.3M target'), true);
check('a stage with no life or close rate reads as a dash', html.includes('>—<'), true);
// A goal's priority is drawn as the same dark pill the tab uses, so the
// text arrives split around it.
check('lists the goals', html.includes('Close Berkshire'), true);
check('draws the goal priority as a pill', /#1<\/span>/.test(html), true);
// The goal groups sit inside a "Goals" card, titled as the tab titles them.
check('names the period in the goal heading', html.includes('Set this week'), true);
check('omits goal groups with nothing in them', html.includes('completed / closed'), false);

// The close rate trend — the section that was on the tab and missing from
// the inbox. It has to carry the same figures the grid shows, including the
// denominator under every rate: "17%" off six deals and off sixty read
// identically without it, and only one is worth reacting to.
check('draws the trend heading', html.includes('Close rate trend'), true);
check('names the window in the heading note',
  html.includes('Last 3 months, by the stage each closed deal reached'), true);
check('heads the month columns', html.includes('>Apr</th>') && html.includes('>Jun</th>'), true);
check('heads the two aggregate columns',
  html.includes('>3 mo</th>') && html.includes('>12 mo</th>'), true);
check('draws a stage row', html.includes('Stage 5: Prepare &amp; Bid'), true);
check('draws a month rate', html.includes('>17%</div>'), true);
check('draws the count under it', html.includes('>1/6</div>'), true);
check('draws the rolling-year figure', html.includes('>9/47</div>'), true);
check('marks a row running ahead of its year with the app’s green',
  html.includes('#DCFCE7') && html.includes('&#9650; 44%'), true);
check('leaves a row that is not ahead in plain ink', html.includes('&#9650; 10%'), false);
check('says why a month is blank rather than 0%', html.includes('blank, not 0%'), true);
check('says which deals the 12 mo column counts', html.includes('rolling 365 days'), true);

// A snapshot with no funnel must not leave an empty heading behind.
const noFunnel = renderWeeklyReportHtml({ capturedAt: Date.now(), kpiCards: [] });
check('no funnel means no funnel heading', noFunnel.includes('Pipeline funnel'), false);
check('no trend means no trend heading', noFunnel.includes('Close rate trend'), false);
// …and the trend stands on its own: it reads the Opps cache, which can be
// there on a visit where no stage volumes were.
const trendOnly = renderWeeklyReportHtml({
  capturedAt: Date.now(),
  closeRateTrend: { months: ['Jun'], rows: [{ label: 'All closed opps', stage: null, cells: [{ rate: '13%', count: '2/15' }], overall: { rate: '13%', count: '2/15', ahead: null }, rolling12: null }] },
});
check('a trend with no funnel still renders', trendOnly.includes('Close rate trend'), true);
check('and a missing rolling year reads as a dash', trendOnly.includes('&mdash;'), true);

// A snapshot with nothing cached must still produce a sendable email rather
// than throwing — the cron has no user to fall back to.
const bare = renderWeeklyReportHtml({ capturedAt: Date.now() });
check('an empty snapshot still renders', bare.includes('Weekly Report'), true);
check('an empty snapshot says nothing was cached', bare.includes('No chart data'), true);
check('a null snapshot still renders', renderWeeklyReportHtml(null).includes('Weekly Report'), true);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
