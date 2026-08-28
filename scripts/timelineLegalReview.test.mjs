// Assertion tests for the optional contract-legal-review run-up: the months a
// deal spends in legal before anyone signs, added ahead of the signature on
// the Implementation chart. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/timelineLegalReview.test.mjs
//
// The run-up is a STEP, so what has to hold is that the control on the
// Timelines tab authors exactly one of them: adding, re-sizing and removing
// leave a single step at the head of the plan, keeping whatever the user has
// renamed or described it as, and 0 leaves nothing behind.
//
// And that the plan it's added to doesn't move. A timeline placed by months
// counts from kickoff, so making room in front of it means pushing every
// later step right — that's the shift, and it's what the run-up has always
// done. A timeline placed by DATES has already been placed by the calendar:
// there the same shift walked a step dated 31 July into September while the
// axis still said July. Dates stay where the dates put them, and the
// signature is simply where the engagement starts.
import {
  getTimelineTemplates, legalReviewMonths, legalReviewStage, setLegalReviewMonths,
  LEGAL_REVIEW_NAME,
} from '../src/utils/timelineTemplatesStore.js';
import { applyRunUpShift, placeStages, placementBaseMonth } from '../src/utils/timelineDates.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// The Budget timeline as the Timelines tab holds it: implementation format,
// placed by dates, drawn against a declared Jul–Oct 2026 window.
const dated = {
  ...getTimelineTemplates({})[0],
  format: 'phased',
  positionMode: 'dates',
  rangeStart: '2026-07-31',
  rangeEnd: '2026-10-01',
};

// --- authoring the step ---------------------------------------------------
check('a timeline starts with no run-up', legalReviewMonths(dated), 0);
const two = setLegalReviewMonths(dated, 2);
check('adding one writes a step', two.stages.length, dated.stages.length + 1);
check('…at the head of the plan, where the run-up belongs', two.stages[0].name, LEGAL_REVIEW_NAME);
check('…marked as happening before signature', two.stages[0].preKickoff, true);
check('…and flagged, so the control can find it again', legalReviewMonths(two), 2);
check('…as a bar rather than a point in time', two.stages[0].kind, 'timeline');

const four = setLegalReviewMonths(two, 4);
check('re-sizing keeps it to one step', four.stages.length, two.stages.length);
check('…and says the new length', legalReviewMonths(four), 4);
const renamed = setLegalReviewMonths(
  { ...two, stages: two.stages.map(st => (st.legalReview ? { ...st, name: 'MSA negotiation', description: 'Both legal teams' } : st)) },
  3,
);
check('a renamed run-up keeps its name', legalReviewStage(renamed).name, 'MSA negotiation');
check('…and its description', legalReviewStage(renamed).description, 'Both legal teams');
check('…and is still found by the control', legalReviewMonths(renamed), 3);
check('setting the same length changes nothing', setLegalReviewMonths(two, 2), two);
check('0 removes the step', setLegalReviewMonths(four, 0).stages.length, dated.stages.length);
check('…leaving nothing flagged behind', legalReviewStage(setLegalReviewMonths(four, 0)), null);
check('a negative is treated as none', legalReviewMonths(setLegalReviewMonths(two, -3)), 0);

// --- dates, and the window that has to cover them --------------------------
check('on a dated timeline the step is dated too', legalReviewStage(two).start, '2026-05-01');
check('…ending the month before the engagement starts', legalReviewStage(two).end, '2026-06-30');
check('…in whole months, so it fills its columns exactly', legalReviewStage(four).start, '2026-03-01');
check('the declared range moves back to cover it', two.rangeStart, '2026-05-31');
check('…and further when the run-up grows', four.rangeStart, '2026-03-31');
check('…and comes back exactly when it goes', setLegalReviewMonths(four, 0).rangeStart, dated.rangeStart);
check('the far end of the range is left alone', two.rangeEnd, dated.rangeEnd);
// A plan written in months from kickoff has no calendar to date against.
const months = setLegalReviewMonths({ ...dated, positionMode: 'months' }, 2);
check('a months-placed run-up carries no dates', legalReviewStage(months).start, '');
check('…and says its length as a duration', legalReviewStage(months).duration, 2);
check('…in months', legalReviewStage(months).durationUnit, 'months');

// --- and the plan it was added to doesn't move -----------------------------
function placed(tpl) {
  const mode = tpl.positionMode === 'months' ? 'months' : 'dates';
  const raw = placeStages(tpl.stages, placementBaseMonth(tpl, tpl.stages), mode)
    .map((pos, i) => ({ stage: tpl.stages[i], ...pos }));
  const out = applyRunUpShift(raw, 0, mode);
  return { preSpan: out.preSpan, months: out.placed.map(p => p.month) };
}
const before = placed(dated);
const after = placed(two);
check('a dated step keeps the month its date puts it in',
  after.months.slice(1).join(','), before.months.map(m => m + 2).join(','));
check('…because the run-up took the two months in front of it', after.preSpan, 2);
check('…so the signature lands where the engagement starts', after.preSpan + 1, after.months[1]);

// A months-placed plan is relative, so there the later steps DO move.
const relative = [
  { stage: { name: 'Run-up', preKickoff: true }, month: 1, span: 2 },
  { stage: { name: 'Kickoff' }, month: 1, span: 1 },
  { stage: { name: 'Build' }, month: 2, span: 3 },
];
const shifted = applyRunUpShift(relative, 0, 'months');
check('months mode still pushes the engagement clear of the run-up',
  shifted.placed.map(p => p.month).join(','), '1,3,4');
check('…by the length of the run-up', shifted.preSpan, 2);
const held = applyRunUpShift(relative, 0, 'dates');
check('dates mode moves nothing', held.placed.map(p => p.month).join(','), '1,1,2');
check('…and reads the signature off the first step after it', held.preSpan, 0);
check('a stated signature month still wins in either mode', applyRunUpShift(relative, 5, 'dates').preSpan, 0);
check('a run-up with nothing after it still draws its signature',
  applyRunUpShift([relative[0]], 0, 'dates').preSpan, 2);

console.log(failures === 0 ? '\nAll legal review tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
