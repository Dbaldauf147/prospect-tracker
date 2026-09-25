// Assertion tests for the server-side Weekly Report rebuild — the thing
// that lets a scheduled email carry current figures without anyone having
// opened the tab. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/weeklyReportBuild.test.mjs
//
// Two things are worth pinning here.
//
// The first is the reading: every input lives in a different corner of
// Firestore, two of them chunked across a subcollection, and a loader that
// silently returns nothing for a document it cannot parse looks exactly
// like a user with no data. So the fake database below is deliberately
// awkward — one chunked document, one plain one, one missing.
//
// The second is the period. The rebuild reports the last *completed* week,
// in the user's own timezone. A runner in UTC computing a Chicago week
// would put the boundary six hours out, which lands Sunday-evening sends
// in the wrong week; and a report of a week still in progress would be
// flagged stale by freshnessNote on every single send.
import {
  completedPeriodBounds, loadReportSources, buildReportPayload,
  payloadHasFigures, buildWeeklyReport, trendHistoryStart,
} from '../api/_lib/weeklyReportBuild.js';
import { readChunkedJson, MIRROR } from '../api/_lib/firestoreChunks.js';
import { freshnessNote } from '../api/_lib/weeklyReportEmailHtml.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const at = (iso) => Date.parse(iso);

// ---- a fake firebase-admin Firestore ------------------------------------
// Only the surface the loaders touch: collection().doc().get(), .data(),
// and a `chunks` subcollection that iterates with forEach.
function fakeDb(seed) {
  // A copy, so a write one test makes cannot leak into the next; the
  // written state is exposed as `docs` on the fake for tests to read.
  const docs = { ...seed };
  const makeSnap = (path) => {
    const v = docs[path];
    return { exists: v !== undefined, data: () => v };
  };
  const makeRef = (path) => ({
    get: async () => makeSnap(path),
    // A shallow-enough merge for the one write the build makes: the
    // coverage-ratio log's `weeks` map, one entry at a time.
    set: async (value, opts) => {
      const prev = docs[path] || {};
      docs[path] = opts?.merge
        ? { ...prev, ...value, weeks: { ...(prev.weeks || {}), ...(value.weeks || {}) } }
        : value;
    },
    collection: (sub) => ({
      get: async () => {
        const prefix = `${path}/${sub}/`;
        const entries = Object.keys(docs)
          .filter(k => k.startsWith(prefix))
          .map(k => ({ id: k.slice(prefix.length), data: () => docs[k] }));
        return { forEach: (cb) => entries.forEach(cb) };
      },
      doc: (id) => makeRef(`${path}/${sub}/${id}`),
    }),
  });
  return { docs, collection: (name) => ({ doc: (id) => makeRef(`${name}/${id}`) }) };
}

// ---- fixtures -----------------------------------------------------------
const UID = 'u1';
const WEEK_START = at('2026-09-07T00:00:00Z'); // Mon
const NOW = at('2026-09-14T06:00:00Z');        // the following Mon, 6am

const opps2 = {
  headers: [],
  records: [
    // New this week: first touch inside the window.
    {
      _id: 'o1', Account: 'Acme', Scope: 'HQ retrofit', Stage: 'Stage 4: Influence and Develop',
      'Quoted Amount': '$120,000',
      _fieldUpdatedAt: { Account: at('2026-09-08T10:00:00Z'), Stage: at('2026-09-08T10:00:00Z') },
    },
    // Older opp, closed Sold inside the window.
    {
      _id: 'o2', Account: 'Berkshire', Scope: 'Chiller', Stage: 'Sold',
      'Quoted Amount': '$400,000', 'Close Date': '9/9/2026',
      _fieldUpdatedAt: {
        Account: at('2026-04-01T10:00:00Z'),
        Stage: at('2026-09-09T12:00:00Z'),
        'Close Date': at('2026-09-09T12:00:00Z'),
      },
    },
    // Older opp, untouched this week.
    {
      _id: 'o3', Account: 'Cortland', Scope: 'Lighting', Stage: 'Stage 5: Prepare & Bid',
      'Quoted Amount': '$90,000',
      _fieldUpdatedAt: { Account: at('2026-02-01T10:00:00Z') },
    },
  ],
};

// The dashboard record as PipelineView saves it: a 1.325M target, a 3.21×
// coverage goal, and stage rows whose pipeline totals come to 2,358,500.
const pipeline = {
  target: 1_325_000,
  closedYTD: 484_616,
  coverageGoal: 3.21,
  stages: [
    { key: 'stage3', label: 'Stage 3: Qualify Opportunity', activeActual: 4, pipelineActual: 700_000, dealSizeActual: 175_000, lifeActual: 60, activeGoal: 6, dealSizeGoal: 150_000, closeGoal: 0.2, closeActual: 0.25, lifeGoal: 90 },
    { key: 'stage4', label: 'Stage 4: Influence and Develop', activeActual: 5, pipelineActual: 918_500, dealSizeActual: 183_700, lifeActual: 45, activeGoal: 5, dealSizeGoal: 180_000, closeGoal: 0.3, closeActual: 0.3, lifeGoal: 90 },
    { key: 'stage5', label: 'Stage 5: Prepare & Bid', activeActual: 3, pipelineActual: 740_000, dealSizeActual: 246_667, lifeActual: 30, activeGoal: 4, dealSizeGoal: 200_000, closeGoal: 0.4, closeActual: 0.5, lifeGoal: 60 },
  ],
};

const goals = [
  { id: 'g1', text: 'Book two site walks', createdAt: at('2026-09-08T09:00:00Z'), archivedAt: null, priority: 1 },
  { id: 'g2', text: 'Old finished goal', createdAt: at('2026-01-01T09:00:00Z'), archivedAt: at('2026-09-10T09:00:00Z'), priority: null },
];

const settings = {
  workEmail: 'dan@se.com',
  weeklyTargets: { emails: 50, newOpps: 1 },
};

// Two sent-external emails inside the week, one internal-only that must
// not count, and one the week before.
const hubspotEmails = [
  { id: 'e1', hs_timestamp: '2026-09-08T09:00:00Z', hs_email_from_email: 'dan@se.com', hs_email_to_email: 'jane@acme.com', hs_email_subject: 'Proposal' },
  { id: 'e2', hs_timestamp: '2026-09-09T09:00:00Z', hs_email_from_email: 'dan@se.com', hs_email_to_email: 'bob@se.com, pat@acme.com', hs_email_subject: 'Scope' },
  { id: 'e3', hs_timestamp: '2026-09-10T09:00:00Z', hs_email_from_email: 'dan@se.com', hs_email_to_email: 'colleague@se.com', hs_email_subject: 'Internal' },
  { id: 'e4', hs_timestamp: '2026-09-02T09:00:00Z', hs_email_from_email: 'dan@se.com', hs_email_to_email: 'jane@acme.com', hs_email_subject: 'Last week' },
];

// The mirrors store their value as a JSON string, chunked past ~1MB. Opps 2
// is chunked here on purpose, with its slices under `json`; the mirrors use
// `s`, and reading one with the other's field name yields an empty string.
const opps2Json = JSON.stringify(opps2);
const half = Math.ceil(opps2Json.length / 2);
const docs = {
  'opps2Data/u1': { chunkCount: 2 },
  'opps2Data/u1/chunks/0': { json: opps2Json.slice(0, half) },
  'opps2Data/u1/chunks/1': { json: opps2Json.slice(half) },
  [`userSettings/u1/localMirrors/${MIRROR.pipeline}`]: { json: JSON.stringify(pipeline), updatedAt: 1 },
  [`userSettings/u1/localMirrors/${MIRROR.goals}`]: { json: JSON.stringify(goals), updatedAt: 1 },
  [`userSettings/u1/localMirrors/${MIRROR.activityLog}`]: { json: JSON.stringify({ '2026-09-07': { emails: 99, calls: 0, meetings: 0, at: at('2026-09-11T00:00:00Z') } }), updatedAt: 1 },
  // yoy-chart-overrides and bfo-activity deliberately absent.
  'userSettings/u1': settings,
  'progressHistory/u1': { weeks: [{ week: '2026-09-07', covered: 12 }] },
};

function fakeFetch(emails) {
  return async (url) => {
    const type = url.includes('/emails/') ? 'emails' : url.includes('/calls/') ? 'calls' : 'meetings';
    const results = type === 'emails'
      ? emails.map(({ id, ...properties }) => ({ id, properties }))
      : [];
    return { ok: true, status: 200, json: async () => ({ results, paging: null }) };
  };
}

// ---- the period ---------------------------------------------------------
{
  // Zoned first, because it is the only fully deterministic case: these are
  // exact instants whatever zone the test runner itself is in.
  const utc = completedPeriodBounds(NOW, { scope: 'week', timeZone: 'UTC' });
  check('the week reported is the one that just ended', utc.start, WEEK_START);
  check('and it ends where the next one starts', utc.end, at('2026-09-14T00:00:00Z'));
  check('labelled the way the tab labels it', utc.label, 'Mon, Sep 7 – Sun, Sep 13, 2026');
  // The point of reporting a finished period: a report of a week still
  // running is partial, and the email would brand it stale on every send.
  check('a built report is never stale on arrival',
    freshnessNote({ capturedAt: NOW, periodEnd: utc.end, scope: 'week' }, NOW).stale, false);

  // Same instant, a Chicago user: local midnight is 05:00 UTC, so the week
  // runs five hours later than a UTC runner's own.
  const chi = completedPeriodBounds(NOW, { scope: 'week', timeZone: 'America/Chicago' });
  check('a zoned week starts at the local midnight of the user, not the runner',
    chi.start, at('2026-09-07T05:00:00Z'));
  check('and ends at the next local midnight', chi.end, at('2026-09-14T05:00:00Z'));

  const day = completedPeriodBounds(NOW, { scope: 'day', timeZone: 'UTC' });
  check('a daily report covers yesterday', day.start, at('2026-09-13T00:00:00Z'));
  check('one day long', day.end - day.start, 24 * 3600 * 1000);

  // Unzoned, the boundaries are the runner's own local midnights, so what
  // is pinned is the shape rather than the instant: a whole week, already
  // over, starting on a Monday. A zone Intl doesn't recognise throws on its
  // first call and has to land here rather than take the send down with it.
  for (const tz of ['', 'Mars/Olympus']) {
    const p = completedPeriodBounds(NOW, { scope: 'week', timeZone: tz });
    check(`${tz || 'no zone'}: a whole week`,
      Math.round((p.end - p.start) / (24 * 3600 * 1000)), 7);
    check(`${tz || 'no zone'}: already finished when the mail goes out`, p.end <= NOW, true);
    check(`${tz || 'no zone'}: starting on a Monday`, new Date(p.start).getDay(), 1);
  }
}

// ---- reading the sources ------------------------------------------------
{
  const db = fakeDb(docs);
  const chunked = await readChunkedJson(db.collection('opps2Data').doc(UID), { field: 'json' });
  check('a chunked document rejoins into the JSON it was written from', chunked, opps2Json);
  check('reading chunks under the wrong field name yields nothing, not a short document',
    await readChunkedJson(db.collection('opps2Data').doc(UID), { field: 's' }), null);
  check('a missing document reads null',
    await readChunkedJson(db.collection('opps2Data').doc('nobody')), null);
}

{
  const sources = await loadReportSources(fakeDb(docs), UID, {
    token: 'tok', start: WEEK_START, end: at('2026-09-14T00:00:00Z'),
    fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  check('the opps records come back', sources.oppsRecords.length, 3);
  check('so does the dashboard target', sources.pipeline.target, 1_325_000);
  check('and the goals', sources.goals.length, 2);
  check('and the settings', sources.settings.workEmail, 'dan@se.com');
  check('and the progress weeks', sources.progressWeeks.length, 1);
  check('a mirror that was never written reads as its fallback, not an error',
    sources.yoyOverrides && Object.keys(sources.yoyOverrides).length, 0);
  check('an absent BFO paste is null, not a throw', sources.bfo, null);
  check('the live feed arrives shaped like the browser cache',
    sources.activityCache.emails.length, 4);
  check('nothing failed', sources.errors.length, 0);
}

// A source that throws is recorded and the rest still load: a HubSpot
// outage must cost the emails tile, not the entire report.
{
  const db = fakeDb(docs);
  const sources = await loadReportSources(db, UID, {
    token: '', start: WEEK_START, end: at('2026-09-14T00:00:00Z'),
  });
  check('no HubSpot token is an error, not a crash', sources.errors.length, 1);
  check('and it names the source', sources.errors[0].startsWith('hubspotActivity:'), true);
  check('the Firestore sources still loaded', sources.oppsRecords.length, 3);
}

// ---- the built report ---------------------------------------------------
{
  const built = await buildWeeklyReport(fakeDb(docs), UID, {
    now: NOW, token: 'tok', fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  const p = built.payload;
  check('the build is usable', built.usable, true);
  check('it covers the finished week', p.periodLabel, 'Mon, Sep 7 – Sun, Sep 13, 2026');

  // The KPI cards, through the same emailKpiCards the tab publishes.
  check('two KPI cards, as the email carries them', p.kpiCards.length, 2);
  check('progress leads with the dollars sold', p.kpiCards[0].value, '$400,000');
  check('coverage divides the same stage totals the dashboard holds',
    p.kpiCards[1].value, '1.78×');
  check('with its share of the goal beside it', p.kpiCards[1].chip, '55.5%');
  check('and says what it is a share of', p.kpiCards[1].lines[0], 'of the 3.21× goal');

  // The two history series. The reported week is the last point in each,
  // so the figures the email leads with are the same ones the change lists
  // below it are drawn from.
  const wk = p.trends.emailsByWeek;
  check('five weeks of email history', wk.length, 5);
  // Two external sends inside the week, the internal-only one dropped and
  // last week's excluded — counted by computeActivity, the same function
  // the tab counts with.
  check('the reported week counts the live window', wk[4].value, 2);
  // A live feed that covers the window outranks the recording, so the
  // planted 99 must not surface.
  check('a covering live feed beats the recorded total', wk[4].recorded, false);
  check('the last point is the week the report covers',
    wk[4].key, '2026-09-07');

  const mo = p.trends.newOppsByMonth;
  check('five months of opp history', mo.length, 5);
  check('the current month counts the opp that first appeared', mo[4].value, 1);
  check('the months run oldest first', mo.map(x => x.key).join(','),
    '2026-05,2026-06,2026-07,2026-08,2026-09');

  // The change lists, named the way the tab names them.
  check('the new opp is listed', p.oppChanges.newOpps[0], 'Acme: HQ retrofit (Stage 4: Influence and Develop)');
  check('the closed deal is listed with its amount',
    p.oppChanges.closed[0], 'Berkshire: Chiller → Sold ($400,000)');
  check('an opp untouched this week is in none of them',
    JSON.stringify(p.oppChanges).includes('Cortland'), false);

  // Goals, split the way the tab splits them.
  check('a goal set this week is listed', p.goals.created[0], 'Book two site walks');
  check('one finished this week too', p.goals.completed[0], 'Old finished goal');
  check('the active list keeps its priority pill', p.goals.active[0], '#1 Book two site walks');

  // The funnel travels as a table; the picture needs a DOM.
  check('the funnel stages are carried', p.funnel.stages.length, 3);
  check('with the dashboard amounts', p.funnel.stages[1].amount, '$918,500');
  check('and no picture, which a serverless build cannot draw', p.funnelImage, null);
  // The recap stays the tab's on-demand piece.
  check('no narrative is invented', p.narrative, '');
}

// ---- the coverage ratio by week -----------------------------------------
// The KPI card's ratio has no history of its own, so the build writes the
// week it reports into the log when nobody measured it while it ran, and
// the email draws the log as a weekly series.
{
  const db = fakeDb(docs);
  const built = await buildWeeklyReport(db, UID, {
    now: NOW, token: 'tok', fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  const cr = built.payload.coverageRatio;
  check('the coverage ratio series is carried', !!cr, true);
  check('eight weeks of it', cr.points.length, 8);
  check('ending on the week the report covers', cr.points[7].key, '2026-09-07');
  check('whose point is the KPI card figure', cr.points[7].value, 1.78);
  check('weeks nobody measured are blank, not 0', cr.points[0].value, null);
  check('the goal rides along', cr.goal, 3.21);
  const saved = db.docs[`coverageRatioHistory/${UID}`]?.weeks?.['2026-09-07'];
  check('the reading is written to the log', saved?.ratio, 1.78);
  check('with the figures it divides', saved?.pipeline, 2_358_500);
  check('stamped with when it was taken', saved?.at, NOW);
  check('the write is not an error', built.errors.some(e => e.startsWith('coverageRatioHistory')), false);
}

// A week the tab already measured keeps its reading: the build fills
// gaps, it does not overwrite what was taken while the week ran.
{
  const db = fakeDb({
    ...docs,
    [`coverageRatioHistory/${UID}`]: { weeks: {
      '2026-08-31': { ratio: 1.5, goal: 3.21, at: 1 },
      '2026-09-07': { ratio: 1.9, goal: 3.21, at: 2 },
    } },
  });
  const built = await buildWeeklyReport(db, UID, {
    now: NOW, token: 'tok', fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  const pts = built.payload.coverageRatio.points;
  check('a reading taken during the week stands', pts[7].value, 1.9);
  check('the week before is drawn from the log', pts[6].value, 1.5);
  check('and the log is left alone',
    db.docs[`coverageRatioHistory/${UID}`].weeks['2026-09-07'].at, 2);
  check('the note says which way it went', built.payload.coverageRatio.note,
    'Up 0.40× since Aug 31, from 1.50× to 1.90×.');
}

// A send well after the week closed is measuring a different week, so it
// does not fill the closed one.
{
  const db = fakeDb(docs);
  const late = at('2026-09-18T12:00:00Z'); // Friday
  const built = await buildWeeklyReport(db, UID, {
    now: late, token: 'tok', fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  check('a late send writes nothing', db.docs[`coverageRatioHistory/${UID}`], undefined);
  check('and has no series to draw', built.payload.coverageRatio, null);
}

// A daily report closes a day, not the week the log is kept in.
{
  const db = fakeDb(docs);
  await buildWeeklyReport(db, UID, {
    now: NOW, scope: 'day', token: 'tok', fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  check('a daily send writes nothing', db.docs[`coverageRatioHistory/${UID}`], undefined);
}

check('a coverage ratio series alone is worth sending',
  payloadHasFigures({ coverageRatio: { points: [{ label: 'Sep 7', value: 2 }] } }), true);

// Without a live feed the recorded weekly totals stand in, exactly as the
// tile did in the browser when the storage quota had dropped the cache.
// This matters more for a five-week series than it did for one number: a
// series that counted the missing feed would read zero across every week
// and draw a collapse in outbound that never happened.
{
  const built = await buildWeeklyReport(fakeDb(docs), UID, { now: NOW, token: '' });
  const wk = built.payload.trends.emailsByWeek;
  check('no feed → the recording answers', wk[4].value, 99);
  check('and the series owns up to where the number came from', wk[4].recorded, true);
  // The four weeks before it were never recorded either, and with no feed
  // to count they are unknown — not zero. An empty bar would assert four
  // quiet weeks that nobody measured.
  check('unrecorded weeks with no feed are blank, not zero',
    wk.slice(0, 4).map(x => x.value).join(','), ',,,');
  check('the rest of the report is unaffected',
    built.payload.trends.newOppsByMonth[4].value, 1);
}

// The live feed has to be asked for the whole span the weekly series
// covers. A fetch bounded to the reported week would come back stamped
// `fetchedAt: now` — which liveCacheCovers reads as an answer for every
// week in the series — and would then answer 0 for the four weeks whose
// emails it never fetched. Five bars, four of them a confident lie.
{
  const windows = [];
  const spyFetch = async (url, opts) => {
    const body = JSON.parse(opts?.body || '{}');
    const f = (body.filterGroups?.[0]?.filters || []);
    const from = Number(f.find(x => x.operator === 'GTE')?.value);
    if (Number.isFinite(from)) windows.push(from);
    return fakeFetch(hubspotEmails)(url, opts);
  };
  await buildWeeklyReport(fakeDb(docs), UID, {
    now: NOW, token: 'tok', fetchOpts: { fetchImpl: spyFetch },
  });

  const period = completedPeriodBounds(NOW, { scope: 'week' });
  const seriesStart = trendHistoryStart(period.start);
  check('HubSpot was actually asked', windows.length > 0, true);
  check('and asked back to the start of the five-week series',
    Math.min(...windows) <= seriesStart, true);
  // Bounded, not unbounded: widening the fetch is only acceptable because
  // it is still a fixed span. A whole-history page is what the cron was
  // built to stop doing.
  check('but no further back than the series needs',
    Math.min(...windows) > seriesStart - 40 * 24 * 60 * 60 * 1000, true);
}

// ---- when there is nothing to rebuild from ------------------------------
{
  const built = await buildWeeklyReport(fakeDb({}), 'ghost', { now: NOW, token: '' });
  check('an empty Firestore builds nothing usable', built.usable, false);
  check('so the caller falls back to the published snapshot',
    payloadHasFigures(built.payload), false);
  // A payload is judged on figures, not on having been constructed.
  check('an empty payload has no figures', payloadHasFigures({}), false);
  check('one KPI card is enough to be worth sending',
    payloadHasFigures({ kpiCards: [{ label: 'Progress to target' }] }), true);
  check('so is a single opp change',
    payloadHasFigures({ oppChanges: { newOpps: ['Acme'] } }), true);
}

// The payload builder is pure, so the same sources always give the same
// document — which is what makes the rebuild safe to run on every send.
{
  const period = completedPeriodBounds(NOW, { scope: 'week' });
  const sources = await loadReportSources(fakeDb(docs), UID, {
    token: 'tok', start: period.start, end: period.end,
    fetchOpts: { fetchImpl: fakeFetch(hubspotEmails) },
  });
  const a = JSON.stringify(buildReportPayload(sources, period));
  const b = JSON.stringify(buildReportPayload(sources, period));
  check('the same sources build the same report twice', a, b);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
