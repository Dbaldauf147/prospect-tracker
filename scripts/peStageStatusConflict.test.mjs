// Assertion tests for the PE Portfolio warning that a firm is written off
// in one field and live in the other. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/peStageStatusConflict.test.mjs
//
// A PE firm says "this didn't land" in two places: the Status on its
// company record ("Lost - Not Sold") and its PE Stage ("Not Sold"). Every
// rule in the app reads one of them alone, so a firm carrying one without
// the other is counted as written off by half the app and as a live
// relationship by the other half. The PE Portfolio table flags exactly
// that pair, and what it must not do is cry wolf: a firm at stage Not Sold
// whose account is still live is a real state, not a contradiction.
import { NOT_SOLD_STATUS, PE_STAGES, STATUSES } from '../src/data/enums.js';
import { PE_NOT_SOLD_STAGE, peStageStatusConflict } from '../src/utils/peStages.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// ---- the two values the rule turns on ---------------------------------------

check('the written-off status is spelled as a record spells it',
  NOT_SOLD_STATUS, 'Lost - Not Sold');
check('and is one of the statuses the dropdown offers',
  STATUSES.includes(NOT_SOLD_STATUS), true);
check('the closing stage is spelled as the enum spells it',
  PE_NOT_SOLD_STAGE, 'Not Sold');
check('and is one of the stages the enum offers',
  PE_STAGES.includes(PE_NOT_SOLD_STAGE), true);

// ---- what gets flagged ------------------------------------------------------

check('written off, still in Discovery',
  peStageStatusConflict({ status: NOT_SOLD_STATUS, peStage: 'Discovery' }),
  { status: 'Lost - Not Sold', stage: 'Discovery' });
check('written off, still at Lead',
  peStageStatusConflict({ status: NOT_SOLD_STATUS, peStage: 'Lead' }),
  { status: 'Lost - Not Sold', stage: 'Lead' });
check('written off, still an Existing Partnership',
  peStageStatusConflict({ status: NOT_SOLD_STATUS, peStage: 'Existing Partnership' }),
  { status: 'Lost - Not Sold', stage: 'Existing Partnership' });
// A blank stage reads as Lead everywhere else in the app, and Lead is a
// live stage — so a written-off firm nobody staged is flagged, and named
// as the Lead it is rather than as an empty field.
check('written off and never staged reads as the Lead it is',
  peStageStatusConflict({ status: NOT_SOLD_STATUS, peStage: '' }),
  { status: 'Lost - Not Sold', stage: 'Lead' });
check('a stage retired from the enum does too',
  peStageStatusConflict({ status: NOT_SOLD_STATUS, peStage: 'Unassigned' }),
  { status: 'Lost - Not Sold', stage: 'Lead' });
// The Status arrives off a dropdown, but a pasted or imported record can
// carry stray whitespace, and a flag that misses those is a flag that
// misses the rows most likely to be stale.
check('surrounding whitespace on the status is still the status',
  peStageStatusConflict({ status: `  ${NOT_SOLD_STATUS} `, peStage: 'Piloting' }),
  { status: 'Lost - Not Sold', stage: 'Piloting' });

// ---- what does not ----------------------------------------------------------

check('written off and staged Not Sold is the pair agreeing',
  peStageStatusConflict({ status: NOT_SOLD_STATUS, peStage: PE_NOT_SOLD_STAGE }), null);
// One-directional on purpose: a firm can pass on a partnership and still be
// a live account (a portfolio company of it might be the client).
for (const status of STATUSES.filter(s => s !== NOT_SOLD_STATUS)) {
  check(`stage Not Sold with a status of "${status}" is a real state`,
    peStageStatusConflict({ status, peStage: PE_NOT_SOLD_STAGE }), null);
  check(`and so is "${status}" mid-pipeline`,
    peStageStatusConflict({ status, peStage: 'Discovery' }), null);
}
check('no status set is nothing to flag',
  peStageStatusConflict({ status: '', peStage: 'Discovery' }), null);
check('a near-miss status is not guessed at',
  peStageStatusConflict({ status: 'lost - not sold', peStage: 'Discovery' }), null);
check('a firm with neither field is nothing to flag',
  peStageStatusConflict({}), null);
check('and a missing record is not a conflict', peStageStatusConflict(null), null);
check('undefined either', peStageStatusConflict(undefined), null);

console.log(failures === 0 ? '\nAll PE status/stage conflict tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
