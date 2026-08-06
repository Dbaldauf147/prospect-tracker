// Assertion tests for the "Trying again" rule. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/tryingAgain.test.mjs
//
// Two boards paint this chip (the company card's Services Explored grid
// and Opps 2's Scope picker) off one implementation, so what it claims is
// worth pinning: a purple chip says a service is BACK IN PLAY, and an
// established account has a closed opp naming almost everything. Getting
// the live check wrong turns most of the board purple and reads as a
// pipeline that doesn't exist.
import { isTryingAgain, hasSavedStatus, tryingAgainTitle } from '../src/utils/tryingAgain.js';
import { isActiveOppStage, isRealOppStage } from '../src/utils/oppStages.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- what counts as a saved status ------------------------------------------

eq(hasSavedStatus('Sold'), true, 'a real status counts as previously saved');
eq(hasSavedStatus('-'), false, 'the auto sentinel is not a saved status');
eq(hasSavedStatus(''), false, 'a service never touched has no saved status');
eq(hasSavedStatus('   '), false, 'whitespace is not a saved status');
eq(hasSavedStatus(null), false, 'nothing is not a saved status');

// ---- what counts as a live opp ----------------------------------------------

for (const stage of ['Lead', 'Not Started', 'Qualifying', 'Quoting', 'Quoted', 'Verbal']) {
  eq(isActiveOppStage(stage), true, `${stage} is a live stage`);
}
for (const stage of ['Sold', 'Not Sold', 'Closed', 'Lost']) {
  eq(isActiveOppStage(stage), false, `${stage} is finished, not live`);
}
for (const stage of ['#N/A', '#REF!', 'N/A', '-', '']) {
  eq(isActiveOppStage(stage), false, `${JSON.stringify(stage)} is a broken cell, not a stage`);
}
eq(isRealOppStage('Sold'), true, 'a closed stage is still a real stage');
eq(isRealOppStage('#REF!'), false, 'a spreadsheet error is not');

// ---- the pair ---------------------------------------------------------------

eq(isTryingAgain('Sold', 'Quoted'), true, 'sold before, quoted again → trying again');
eq(isTryingAgain('Not Sold', 'Lead'), true, 'lost before, a live lead now → trying again');

// The case that prompted this. An account with years of history has a
// closed opp naming almost every service it ever bought; pairing that
// with the saved status the closed opp produced is not "again", it is the
// same event counted twice.
eq(isTryingAgain('Sold', 'Sold'), false, 'a closed-won opp is history, not a retry');
eq(isTryingAgain('Sold', 'Not Sold'), false, 'a closed-lost opp is history too');
eq(isTryingAgain('Not Sold', 'Sold'), false, 'whichever way round the two closed values fall');

eq(isTryingAgain('', 'Quoted'), false, 'a live opp with no history is a first attempt, not a retry');
eq(isTryingAgain('-', 'Quoted'), false, 'and the auto sentinel is not history either');
eq(isTryingAgain('Sold', ''), false, 'a saved status with no opp behind it is just history');
eq(isTryingAgain('Sold', '#N/A'), false, 'a broken Stage cell cannot put a service back in play');
eq(isTryingAgain('Sold', 'N/A'), false, 'nor can an N/A one');

// ---- what the chip says -----------------------------------------------------

eq(
  tryingAgainTitle('Sold', 'Quoted'),
  'Trying again: this service was already marked “Sold”, and a live opp now names it (Quoted). The saved status is unchanged.',
  'the tooltip says the opp is live, which is now what the chip actually means',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
