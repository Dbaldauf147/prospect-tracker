// Assertion tests for a timeline step's duration and its unit. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/timelineStepDuration.test.mjs
//
// A step says how long it lasts in the unit that suits it, and everything
// downstream places steps in whole month columns. So the two things worth
// pinning down are the conversion — which decides how wide a bar is drawn —
// and the precedence, which decides whether a duration is what gets used at
// all when the step also carries dates or a typed span.
import {
  durationToMonths, formatStepDuration, getStageMonths,
  STEP_DURATION_UNITS, DEFAULT_DURATION_UNIT, WEEKS_PER_RELATIVE_MONTH,
} from '../src/utils/timelineDates.js';
import { getTimelineTemplates, makeTimelineStage } from '../src/utils/timelineTemplatesStore.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// ---- conversion ------------------------------------------------------------

check('the week axis draws four to a month', WEEKS_PER_RELATIVE_MONTH, 4);
check('four weeks is exactly one column', durationToMonths(4, 'weeks'), 1);
check('so two weeks is one column too', durationToMonths(2, 'weeks'), 1);
check('and five weeks spills into a second', durationToMonths(5, 'weeks'), 2);
check('eight weeks is two', durationToMonths(8, 'weeks'), 2);
check('a month is a column', durationToMonths(1, 'months'), 1);
check('three months is three', durationToMonths(3, 'months'), 3);
check('a fractional month still occupies one', durationToMonths(0.5, 'months'), 1);
check('28 days is four weeks is one column', durationToMonths(28, 'days'), 1);
check('29 days tips into the next', durationToMonths(29, 'days'), 2);
check('no duration converts to nothing', durationToMonths('', 'weeks'), null);
check('nor does zero', durationToMonths(0, 'weeks'), null);
check('nor a negative', durationToMonths(-3, 'weeks'), null);
check('nor a non-number', durationToMonths('soon', 'weeks'), null);
check('an unknown unit falls back to the default', durationToMonths(4, 'furlongs'), durationToMonths(4, DEFAULT_DURATION_UNIT));

check('the label singularizes', formatStepDuration(1, 'months'), '1 month');
check('and pluralizes', formatStepDuration(3, 'weeks'), '3 weeks');
check('and is empty with nothing to say', formatStepDuration('', 'weeks'), '');

// ---- what the store keeps --------------------------------------------------

const stored = getTimelineTemplates({
  timelineTemplates: [{
    id: 'tl-1', name: 'T', services: ['S'],
    stages: [
      { id: 'st-a', name: 'A' },
      { id: 'st-b', name: 'B', duration: 3, durationUnit: 'weeks' },
      { id: 'st-c', name: 'C', duration: '2', durationUnit: 'nonsense' },
    ],
  }],
})[0];
check('a step with no duration keeps none', stored.stages[0].duration, '');
check('and still carries a usable unit', STEP_DURATION_UNITS.includes(stored.stages[0].durationUnit), true);
check('a duration is kept as typed, not converted', stored.stages[1].duration, 3);
check('with its unit', stored.stages[1].durationUnit, 'weeks');
check('a numeric string becomes a number', stored.stages[2].duration, 2);
check('and a junk unit falls back', stored.stages[2].durationUnit, DEFAULT_DURATION_UNIT);
check('a fresh step starts with no duration', makeTimelineStage().duration, '');

// ---- precedence at placement time -----------------------------------------
//
// Span: a typed Span cell wins, then the duration, then whatever the dates
// imply. Position is untouched by any of it.

const span = (stage, mode, base = 1) => getStageMonths(stage, base, mode).span;

check('a duration sizes a step in months mode',
  span({ startMonth: 1, duration: 6, durationUnit: 'weeks' }, 'months'), 2);
check('and in dates mode, where a step is placed by its date but still has a length',
  span({ timing: 'Mar 2026', duration: 6, durationUnit: 'weeks' }, 'dates', 3), 2);
check('a typed Span outranks the duration',
  span({ startMonth: 1, months: 5, duration: 1, durationUnit: 'weeks' }, 'months'), 5);
check('the duration outranks a span read off the timing label',
  span({ timing: 'Jan–Jun 2026', duration: 2, durationUnit: 'weeks' }, 'dates', 1), 1);
check('with no duration, the dates still speak',
  span({ timing: 'Jan–Mar 2026' }, 'dates', 1), 3);
check('and with neither, a step is one month',
  span({ name: 'bare' }, 'months'), 1);

// A milestone is a moment. Giving one a duration must not stretch it into a
// bar — the renderers read this span for the diamond's column.
check('a milestone stays a point in time whatever its duration says',
  span({ kind: 'milestone', startMonth: 2, duration: 3, durationUnit: 'months' }, 'months'), 1);

// The position must be unaffected by any of the above.
check('a duration does not move the step',
  getStageMonths({ startMonth: 4, duration: 9, durationUnit: 'weeks' }, 1, 'months').month, 4);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
