// Assertion tests for a campaign's subject lines.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/campaignSubjects.test.mjs
//
// The rules worth pinning: a campaign saved before subjects were a list
// still reads as one subject, `subject` never drifts away from the first of
// the list, and the match test is the same containment test the campaign
// report has always used — now against any of the lines, longest wins.
import {
  normalizeSubjects, campaignSubjects, primarySubject, withSubjects,
  matchedSubject, subjectsMatch, sameSubjects, parseSubjectLines, subjectLinesText,
} from '../src/utils/campaignSubjects.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- cleaning a list --------------------------------------------------
check('trims and drops blanks', normalizeSubjects(['  Q3 update ', '', '   ']), ['Q3 update']);
check('collapses case-insensitive duplicates',
  normalizeSubjects(['Q3 Update', 'q3 update', 'Q4 update']), ['Q3 Update', 'Q4 update']);
check('keeps the order given', normalizeSubjects(['B', 'A', 'C']), ['B', 'A', 'C']);
check('a bare string is a list of one', normalizeSubjects('Q3 update'), ['Q3 update']);
check('nothing in, nothing out', normalizeSubjects(undefined), []);

// --- reading a campaign ----------------------------------------------
check('the list wins', campaignSubjects({ subject: 'A', subjects: ['A', 'B'] }), ['A', 'B']);
check('an older campaign has just its subject', campaignSubjects({ subject: 'A' }), ['A']);
check('an empty list falls back to the subject', campaignSubjects({ subject: 'A', subjects: [] }), ['A']);
check('a campaign with neither', campaignSubjects({}), []);
check('primary is the first', primarySubject({ subjects: ['B', 'A'] }), 'B');
check('primary of an older campaign', primarySubject({ subject: 'A' }), 'A');
check('primary of nothing', primarySubject(null), '');

// --- writing a campaign ----------------------------------------------
check('subject follows the first line',
  withSubjects({ title: 'T', subject: 'old' }, [' A ', 'B', 'a']),
  { title: 'T', subject: 'A', subjects: ['A', 'B'] });
check('cleared to nothing keeps the shape',
  withSubjects({ subject: 'old' }, ['  ']), { subject: '', subjects: [] });

// --- matching a sent subject -----------------------------------------
const camp = { subjects: ['Q3 update', 'Q3 update: ERCOT'] };
check('a prefix on the sent subject still matches',
  matchedSubject(camp, 'RE: Q3 update'), 'Q3 update');
check('the longest — most specific — line wins',
  matchedSubject(camp, 'FW: Q3 update: ERCOT prices'), 'Q3 update: ERCOT');
check('case-insensitive both ways', matchedSubject({ subjects: ['Q3 UPDATE'] }, 're: q3 update'), 'Q3 UPDATE');
check('a second line matches on its own',
  matchedSubject({ subjects: ['Data center power', 'Retail update'] }, 'Retail update — March'), 'Retail update');
check('no line matches', matchedSubject(camp, 'Something else'), '');
check('an empty sent subject matches nothing', matchedSubject(camp, ''), '');
check('a bare list works too', matchedSubject(['A line'], 'RE: A line'), 'A line');
check('subjectsMatch is the yes/no of it', [subjectsMatch(camp, 'RE: Q3 update'), subjectsMatch(camp, 'nope')], [true, false]);

// --- comparing two sets ----------------------------------------------
check('same set, different order', sameSubjects(['A', 'B'], ['b', 'a']), true);
check('one added', sameSubjects(['A'], ['A', 'B']), false);
check('blanks don’t count', sameSubjects(['A', ''], ['A']), true);

// --- the textarea round trip -----------------------------------------
check('one per line', parseSubjectLines('A\n\n  B  \na'), ['A', 'B']);
check('and back again', subjectLinesText({ subjects: ['A', 'B'] }), 'A\nB');
check('an older campaign renders one line', subjectLinesText({ subject: 'A' }), 'A');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
