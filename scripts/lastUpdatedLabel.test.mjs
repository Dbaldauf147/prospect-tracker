// Assertion tests for the "Last updated" label. Plain Node, no test framework
// (the project has none). Run:
//   node scripts/lastUpdatedLabel.test.mjs
//
// The label exists to answer "is this pipeline current?", so the cases that
// matter are the boundaries where the answer changes character, and the two
// inputs that would otherwise produce a confident lie: a missing timestamp
// (old saved data, pasted before any of this was recorded) and one ahead of
// the clock.
import { formatLastUpdated } from '../src/utils/lastUpdatedLabel.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0); // 2026-09-04T12:00:00Z
const ago = (ms) => NOW - ms;
const MIN = 60 * 1000, HR = 60 * MIN, DAY = 24 * HR;
const rel = (ts) => formatLastUpdated(ts, NOW)?.relative;

// ── No usable timestamp ───────────────────────────────────────────────────
// Data saved before timestamps were recorded. The caller has to say something
// honest about that, so it must get null rather than a plausible-looking time.
check('missing', formatLastUpdated(undefined, NOW), null);
check('null', formatLastUpdated(null, NOW), null);
check('zero', formatLastUpdated(0, NOW), null);
check('not a number', formatLastUpdated('yesterday', NOW), null);
check('negative', formatLastUpdated(-1, NOW), null);

// ── Minutes ───────────────────────────────────────────────────────────────
check('seconds ago reads as just now', rel(ago(30 * 1000)), 'just now');
check('just under a minute', rel(ago(59 * 1000)), 'just now');
check('one minute', rel(ago(MIN)), '1 minute ago');
check('plural minutes', rel(ago(45 * MIN)), '45 minutes ago');
check('just under an hour', rel(ago(HR - 1)), '59 minutes ago');

// ── Hours ─────────────────────────────────────────────────────────────────
check('one hour', rel(ago(HR)), '1 hour ago');
check('hours', rel(ago(5 * HR)), '5 hours ago');
check('just under a day', rel(ago(DAY - 1)), '23 hours ago');

// ── Days ──────────────────────────────────────────────────────────────────
check('one day', rel(ago(DAY)), '1 day ago');
check('days', rel(ago(3 * DAY)), '3 days ago');
check('just under a week', rel(ago(7 * DAY - 1)), '6 days ago');

// ── Past a week it hands over to the date ─────────────────────────────────
// "47 days ago" is a number to decode; the date is a fact to read.
{
  const old = ago(47 * DAY);
  const out = formatLastUpdated(old, NOW);
  check('a month and a half back is not counted in days', /\bdays ago$/.test(out.relative), false);
  check('...it is the date', out.relative, new Date(old).toLocaleDateString(undefined, { dateStyle: 'medium' }));
}
check('exactly a week hands over', /days ago/.test(rel(ago(7 * DAY))), false);

// ── Clock skew ────────────────────────────────────────────────────────────
// A mirrored record from a device running fast must not read "in 40 minutes".
check('a timestamp ahead of the clock reads as current', rel(NOW + 40 * MIN), 'just now');
check('...and so does one on the dot', rel(NOW), 'just now');

// ── The exact form is always there for the tooltip ────────────────────────
{
  const out = formatLastUpdated(ago(3 * DAY), NOW);
  check('exact accompanies every relative form',
    out.exact, new Date(ago(3 * DAY)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  check('exact carries a time, relative does not', out.exact !== out.relative, true);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
