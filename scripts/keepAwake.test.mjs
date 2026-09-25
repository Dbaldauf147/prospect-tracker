// The sidebar's "Keep awake" timer: parsing a typed duration, counting
// down, and surviving a reload through storage. Run:
//   node scripts/keepAwake.test.mjs
import {
  parseDurationMinutes, endFor, isRunning, formatRemaining, readSession, writeSession,
  KEEP_AWAKE_STORAGE_KEY, KEEP_AWAKE_PRESETS,
} from '../src/utils/keepAwake.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${a}\n      want: ${e}`}`);
}

// ---- typed durations -----------------------------------------------------
check('a bare number is minutes', parseDurationMinutes('90'), 90);
check('minutes with a unit', parseDurationMinutes('45m'), 45);
check('decimal hours', parseDurationMinutes('1.5h'), 90);
check('words', parseDurationMinutes('2 hours'), 120);
check('hours and minutes together', parseDurationMinutes('1h 30m'), 90);
check('case and spacing do not matter', parseDurationMinutes('  3 HR '), 180);
check('blank is not a duration', parseDurationMinutes(''), null);
check('text is not a duration', parseDurationMinutes('soon'), null);
check('trailing junk is refused', parseDurationMinutes('2h please'), null);
check('zero is refused', parseDurationMinutes('0'), null);
check('more than a day is refused', parseDurationMinutes('25h'), null);
check('a full day is fine', parseDurationMinutes('24h'), 1440);

// ---- the session ---------------------------------------------------------
const NOW = 1_000_000;
check('a timed session ends that many minutes out', endFor(30, NOW), NOW + 30 * 60_000);
check('"until I stop it" has no end', endFor(0, NOW), null);
check('a session before its end is running', isRunning({ until: NOW + 1 }, NOW), true);
check('one past its end is not', isRunning({ until: NOW }, NOW), false);
check('an open-ended one always is', isRunning({ until: null }, NOW), true);
check('no session is not running', isRunning(null, NOW), false);
check('the menu offers an open-ended option', KEEP_AWAKE_PRESETS.some(p => p.minutes === 0), true);

// ---- the countdown -------------------------------------------------------
check('under an hour reads m:ss', formatRemaining(4 * 60_000 + 59_000), '4:59');
check('over an hour reads h:mm:ss', formatRemaining(3_909_000), '1:05:09');
check('a part second rounds up, so it never shows 0:00 while running', formatRemaining(400), '0:01');
check('past the end reads 0:00', formatRemaining(-5000), '0:00');

// ---- storage -------------------------------------------------------------
const mem = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
{
  const s = mem();
  writeSession(s, { until: NOW + 60_000 });
  check('a reload picks the session back up', readSession(s, NOW), { until: NOW + 60_000 });
  check('but not once it has run out', readSession(s, NOW + 60_000), null);
  writeSession(s, { until: null });
  check('an open-ended session survives a reload', readSession(s, NOW), { until: null });
  writeSession(s, null);
  check('stopping clears it', s.getItem(KEEP_AWAKE_STORAGE_KEY), null);
  s.setItem(KEEP_AWAKE_STORAGE_KEY, '{not json');
  check('a garbled value is ignored', readSession(s, NOW), null);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  check('blocked storage reads as no session', readSession(blocked, NOW), null);
  writeSession(blocked, { until: null });
  check('and writing to it does not throw', true, true);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
