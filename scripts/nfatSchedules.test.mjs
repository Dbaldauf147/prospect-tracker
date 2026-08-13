// Assertion tests for the "No Further Action Today" clear schedules. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/nfatSchedules.test.mjs
//
// The reported bug: a time set in the Clear "No Further Action Today" popup
// was back to the 06:00 default the next day.
//
// The schedule runner fires on a minute tick and then records the run by
// advancing lastRunAt. It used to persist that by writing the WHOLE
// nfatSchedules object — rebuilt from the copy that tab was holding — so an
// automatic background job rewrote `enabled`, `days` and `time` every time
// it fired. The settings merge resolves scalar conflicts ours-wins, so a tab
// still holding 06:00 (one left open on another machine, or one whose
// snapshot hadn't caught up) wrote 06:00 back over a time changed elsewhere,
// and it stuck. Overnight there is always such a tab.
//
// nfatRunStampPaths is the fix: a run is recorded as dotted leaf paths, so
// the write cannot carry a sibling field whatever the writing tab believes.
// The first block below is what guards that; the rest covers the Eastern
// clock arithmetic that decides when a run is due at all.
//
// nfatConfigRepairPaths is the second half, for the writers this app does not
// control: a tab on an older build, or one that slept through the night and
// fires its catch-up run before its Firestore listener has reconnected. Both
// still write the whole object from a stale copy. The configuration carries
// the time it was set, so a cloud copy stamped OLDER than what this browser
// has seen is a restatement rather than an edit, and goes back.
import {
  NFAT_DEFAULT_TIME,
  NFAT_SCHEDULE_TYPES,
  defaultNfatSchedules,
  easternDayParts,
  easternWallToUtcMs,
  mergeNfatShadow,
  mostRecentNfatScheduleMs,
  nfatConfigRepairPaths,
  nfatRunStampPaths,
  nfatTypesDue,
  normalizeNfatSchedules,
  anyNfatScheduleEnabled,
  sameNfatConfig,
  stampNfatConfig,
} from '../src/utils/nfatSchedules.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
const j = (v) => JSON.stringify(v);

// Eastern wall time → UTC ms, for building fixtures readably.
const et = (y, m, d, hh, mm) => easternWallToUtcMs(y, m, d, hh, mm);

// --- recording a run touches lastRunAt and nothing else -------------------
const stamp = nfatRunStampPaths(['check'], 1234);
check('one path per type', j(Object.keys(stamp)), j(['nfatSchedules.check.lastRunAt']));
check('and the value is the run time', stamp['nfatSchedules.check.lastRunAt'], 1234);
check('no path mentions time', Object.keys(stamp).some(k => k.endsWith('.time')), false);
check('nor days', Object.keys(stamp).some(k => k.endsWith('.days')), false);
check('nor enabled', Object.keys(stamp).some(k => k.endsWith('.enabled')), false);
check('several types at once',
  j(Object.keys(nfatRunStampPaths(['check', 'any'], 7))),
  j(['nfatSchedules.check.lastRunAt', 'nfatSchedules.any.lastRunAt']));
check('an unknown type is ignored', j(nfatRunStampPaths(['bogus'], 7)), '{}');
check('no types, no write', j(nfatRunStampPaths([], 7)), '{}');
check('missing types, no write', j(nfatRunStampPaths(undefined, 7)), '{}');

// --- normalize keeps what's stored, fills what isn't ----------------------
const stored = { check: { enabled: true, days: [1], time: '14:30', lastRunAt: 99 } };
const norm = normalizeNfatSchedules(stored);
check('a stored time survives', norm.check.time, '14:30');
check('a stored day set survives', j(norm.check.days), j([1]));
check('untouched types get defaults', norm.x.time, NFAT_DEFAULT_TIME);
check('and are off by default', norm.x.enabled, false);
check('a partial entry keeps the default time', normalizeNfatSchedules({ x: { enabled: true } }).x.time, NFAT_DEFAULT_TIME);
check('nothing stored is all defaults', j(normalizeNfatSchedules(null)), j(defaultNfatSchedules()));
check('every type is present', j(Object.keys(normalizeNfatSchedules({}))), j(NFAT_SCHEDULE_TYPES));
check('anyNfatScheduleEnabled sees an enabled type', anyNfatScheduleEnabled(norm), true);
check('and none when all are off', anyNfatScheduleEnabled(defaultNfatSchedules()), false);

// --- the Eastern clock ----------------------------------------------------
// 2026-08-12 is a Wednesday. EDT (UTC-4) in August.
check('a weekday is placed correctly', easternDayParts(et(2026, 8, 12, 9, 0)).dow, 3);
check('and its calendar date', easternDayParts(et(2026, 8, 12, 9, 0)).day, 12);
// Just after Eastern midnight is still the same Eastern day even though it's
// already tomorrow in UTC — the whole reason these go through the formatter.
check('00:30 ET is still that Eastern day', easternDayParts(et(2026, 8, 12, 0, 30)).day, 12);
// January is EST (UTC-5): the same wall time is an hour later in UTC.
check('EST and EDT differ by an hour',
  et(2026, 1, 14, 9, 0) - Date.UTC(2026, 0, 14, 9, 0), 5 * 3600_000);
check('EDT offset', et(2026, 8, 12, 9, 0) - Date.UTC(2026, 7, 12, 9, 0), 4 * 3600_000);

// --- when a run is due ----------------------------------------------------
const WED_1000 = et(2026, 8, 12, 10, 0);
const WEEKDAYS = [1, 2, 3, 4, 5];

check('the occurrence earlier today is the most recent',
  mostRecentNfatScheduleMs(WEEKDAYS, '06:00', WED_1000), et(2026, 8, 12, 6, 0));
check('a time later today falls back to the previous day',
  mostRecentNfatScheduleMs(WEEKDAYS, '14:00', WED_1000), et(2026, 8, 11, 14, 0));
check('a day not in the set is skipped',
  mostRecentNfatScheduleMs([1], '06:00', WED_1000), et(2026, 8, 10, 6, 0));
check('no days, no occurrence', mostRecentNfatScheduleMs([], '06:00', WED_1000), null);
check('an unparseable time, no occurrence', mostRecentNfatScheduleMs(WEEKDAYS, 'nope', WED_1000), null);

const sched = (over) => normalizeNfatSchedules({ check: { enabled: true, days: WEEKDAYS, time: '06:00', ...over } });
check('due when the last run predates the occurrence',
  j(nfatTypesDue(sched({ lastRunAt: et(2026, 8, 11, 6, 0) }), WED_1000).map(d => d.type)), j(['check']));
check('and the occurrence it fires for is today\'s',
  nfatTypesDue(sched({ lastRunAt: et(2026, 8, 11, 6, 0) }), WED_1000)[0].occurrence, et(2026, 8, 12, 6, 0));
check('not due once it has run',
  nfatTypesDue(sched({ lastRunAt: et(2026, 8, 12, 6, 30) }), WED_1000).length, 0);
check('a disabled type never fires',
  nfatTypesDue(sched({ enabled: false, lastRunAt: 0 }), WED_1000).length, 0);
check('nothing enabled, nothing due', nfatTypesDue(defaultNfatSchedules(), WED_1000).length, 0);

// A run already handled this session is skipped, so the minute tick can't
// double-fire while the settings write is in flight.
check('an in-session fire is not repeated',
  nfatTypesDue(sched({ lastRunAt: 0 }), WED_1000, { check: et(2026, 8, 12, 6, 0) }).length, 0);
check('but an older in-session mark does not block a newer occurrence',
  nfatTypesDue(sched({ lastRunAt: 0 }), WED_1000, { check: et(2026, 8, 11, 6, 0) }).length, 1);

// Catching up: the app was closed across the scheduled time.
check('a missed run fires on the next open',
  nfatTypesDue(sched({ lastRunAt: et(2026, 8, 7, 6, 0) }), WED_1000).length, 1);

// Several types due at once each get their own entry.
const two = normalizeNfatSchedules({
  check: { enabled: true, days: WEEKDAYS, time: '06:00', lastRunAt: 0 },
  any: { enabled: true, days: WEEKDAYS, time: '09:00', lastRunAt: 0 },
});
check('both due types are returned', j(nfatTypesDue(two, WED_1000).map(d => d.type)), j(['check', 'any']));

// --- a stale writer restating an older configuration ----------------------
// The user sets ✓ to 08:30 on Monday. Overnight, a tab holding the 06:00 copy
// writes the whole object back. Tuesday morning the cloud says 06:00 with
// Monday's — older — edit stamp, and this browser knows better.
const SET_AT = et(2026, 8, 10, 9, 0);
const saved = stampNfatConfig(
  normalizeNfatSchedules({ check: { enabled: true, days: WEEKDAYS, time: '08:30' } }), SET_AT);
check('a save stamps every type', j(NFAT_SCHEDULE_TYPES.map(t => saved[t].updatedAt)), j([SET_AT, SET_AT, SET_AT]));
check('and leaves the rest of the schedule alone', saved.check.time, '08:30');

const shadow = mergeNfatShadow(null, saved);
check('the shadow takes a stamped save', shadow.check.time, '08:30');
check('and its stamp', shadow.check.updatedAt, SET_AT);
check('but not the run stamp', shadow.check.lastRunAt, undefined);

const clobbered = normalizeNfatSchedules({
  check: { enabled: true, days: WEEKDAYS, time: '06:00', lastRunAt: et(2026, 8, 11, 6, 0) },
});
const repair = nfatConfigRepairPaths(clobbered, shadow);
check('the time goes back', repair['nfatSchedules.check.time'], '08:30');
check('with the days it was saved with', j(repair['nfatSchedules.check.days']), j(WEEKDAYS));
check('and enabled as saved', repair['nfatSchedules.check.enabled'], true);
check('carrying the stamp it was saved with', repair['nfatSchedules.check.updatedAt'], SET_AT);
check('a repair never moves a run stamp',
  Object.keys(repair).some(k => k.endsWith('.lastRunAt')), false);
check('and only touches the type that was clobbered',
  j([...new Set(Object.keys(repair).map(k => k.split('.')[1]))]), j(['check']));

// Nothing to repair in the normal case, on every load.
check('a cloud copy that agrees is left alone', j(nfatConfigRepairPaths(normalizeNfatSchedules(saved), shadow)), '{}');
check('no shadow, no repair', j(nfatConfigRepairPaths(clobbered, null)), '{}');
check('an unstamped shadow claims nothing',
  j(nfatConfigRepairPaths(clobbered, { check: { enabled: true, time: '08:30' } })), '{}');

// A newer edit — from this browser or another device — is adopted, not undone.
const LATER = SET_AT + 60_000;
const elsewhere = stampNfatConfig(normalizeNfatSchedules({ check: { enabled: true, days: [1], time: '13:00' } }), LATER);
check('a newer edit is not repaired away', j(nfatConfigRepairPaths(elsewhere, shadow)), '{}');
const adopted = mergeNfatShadow(shadow, elsewhere);
check('the shadow follows it instead', adopted.check.time, '13:00');
check('and takes its stamp', adopted.check.updatedAt, LATER);
check('an older cloud copy is not adopted', mergeNfatShadow(adopted, saved).check.time, '13:00');
check('an unchanged shadow is returned as-is', mergeNfatShadow(adopted, saved), adopted);
check('nothing stamped in the cloud leaves the shadow untouched',
  mergeNfatShadow(adopted, defaultNfatSchedules()), adopted);

// A stale writer that restates the SAME configuration has taken nothing away.
const restated = normalizeNfatSchedules({ check: { enabled: true, days: WEEKDAYS, time: '08:30' } });
check('an unchanged restatement is not repaired', j(nfatConfigRepairPaths(restated, shadow)), '{}');
check('sameNfatConfig ignores the run stamp',
  sameNfatConfig({ enabled: true, days: [1], time: '08:30', lastRunAt: 1 }, { enabled: true, days: [1], time: '08:30' }), true);
check('and day order', sameNfatConfig({ days: [5, 1] }, { days: [1, 5] }), true);
check('but not a narrowed day set', sameNfatConfig({ days: [1] }, { days: [1, 5] }), false);
check('nor a switched-off schedule', sameNfatConfig({ enabled: false }, { enabled: true }), false);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
