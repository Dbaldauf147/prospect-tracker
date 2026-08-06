// Assertion tests for the auto-N/A rules. Plain Node — no test framework
// (the project has none). Run:
//   node scripts/callNaRules.test.mjs
//
// src/utils/callNaRules.js is import-free so it can be exercised here.
// Two failure modes are worth far more than the feature itself, and both
// are silent:
//
//   - a rule that matches more than the user meant, quietly marking a
//     real client call as belonging to no deal;
//   - a rule that overrides a decision the user made by hand, so the
//     page argues with them every time it syncs.
//
// Everything below is aimed at those two.
import {
  normalizeMeetingName, normalizeRule, normalizeRules, ruleMatchesName,
  matchingRule, autoNaMatches, autoNaPatchFor, describeNaRules, MAX_NA_RULES,
} from '../src/utils/callNaRules.js';
import { oppTagStateOf, isAutoNa, markOppNaPatch, clearOppTagPatch, tagOppPatch } from '../src/utils/callOppTag.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- normalising a name -----------------------------------------------------

eq(normalizeMeetingName('HUBSPOT HOUR [Optional]'), 'hubspot hour optional', 'punctuation and case fall away');
eq(normalizeMeetingName('Canceled: Prospecting Time'), 'prospecting time', 'a calendar prefix is not part of the name');
eq(normalizeMeetingName('CM  +  RECA   Monthly'), 'cm reca monthly', 'runs of separators collapse to one space');
eq(normalizeMeetingName('  Weekly 1:1  '), 'weekly 1 1', 'surrounding space is not part of the name');
eq(normalizeMeetingName(''), '', 'nothing normalises to nothing');
eq(normalizeMeetingName(null), '', 'null normalises to nothing');
eq(
  normalizeMeetingName('Simon — Weekly Check‑In'),
  normalizeMeetingName('Simon - Weekly Check-In'),
  'an em-dash title matches a rule typed with a hyphen',
);

// ---- normalising a rule -----------------------------------------------------

eq(normalizeRule('  Prospecting Time '), { text: 'Prospecting Time', key: 'prospecting time' }, 'a rule keeps its typed text and gains a match key');
eq(normalizeRule(''), null, 'an empty rule is not a rule');
eq(normalizeRule('   '), null, 'a whitespace rule is not a rule');
eq(normalizeRule({ text: 'Office Hours' })?.key, 'office hours', 'a rule object works as well as a string');

// The one input that could mark an entire history N/A: "" is a substring
// of every string, so a rule that normalises to nothing must be refused
// rather than stored.
eq(normalizeRule('---'), null, 'a punctuation-only rule is refused, not turned into a match-everything');
eq(normalizeRule('!!!'), null, 'and so is any other rule with no letters or digits in it');

eq(
  normalizeRules(['Prospecting Time', 'prospecting  time', '', 'Office Hours']).map(r => r.text),
  ['Prospecting Time', 'Office Hours'],
  'duplicates collapse on the normalised key, blanks drop out',
);
eq(normalizeRules(null), [], 'no rules is not a crash');
eq(normalizeRules(Array.from({ length: 80 }, (_, i) => `rule ${i}`)).length, MAX_NA_RULES, 'the stored list is capped');

// ---- matching ---------------------------------------------------------------

eq(ruleMatchesName('Prospecting Time', 'Prospecting Time'), true, 'an exact name matches');
eq(ruleMatchesName('prospecting time', 'PROSPECTING TIME'), true, 'case never matters');
eq(ruleMatchesName('Office Hours', 'CM + RECA Monthly Office Hours'), true, 'a rule matches a name that contains it');
eq(ruleMatchesName('Prospecting Time', 'Canceled: Prospecting Time'), true, 'a cancelled recurrence still matches');
eq(ruleMatchesName('Prospecting Time', 'Prologis — quarterly review'), false, 'an unrelated call does not match');
eq(ruleMatchesName('', 'anything at all'), false, 'an empty rule matches nothing');
eq(ruleMatchesName('Office Hours', ''), false, 'a call with no name matches nothing');

// The direction of "contains" matters. A rule is the SHORTER thing: a
// name containing the rule matches, but a rule containing the name must
// not — otherwise a rule for "Weekly 1:1 with Dana" would swallow every
// call named "Weekly".
eq(ruleMatchesName('Weekly 1:1 with Dana', 'Weekly'), false, 'a rule longer than the name does not match it');

eq(matchingRule(['Office Hours', 'Prospecting'], 'Prospecting Time')?.text, 'Prospecting', 'the matching rule is reported');
eq(matchingRule(['Office Hours'], 'Prologis review'), null, 'no match reports null');

// ---- what a rule set would change -------------------------------------------

const RULES = ['Prospecting Time', 'Office Hours'];
const records = {
  a: { id: 'a', name: 'Prospecting Time' },
  b: { id: 'b', name: 'CM + RECA Monthly Office Hours' },
  c: { id: 'c', name: 'Prologis — quarterly review' },
  d: { id: 'd', name: 'Prospecting Time', oppId: 'opp_1', oppLabel: 'Prologis — Bill payment' },
  e: { id: 'e', name: 'Prospecting Time', ...clearOppTagPatch() },
  f: { id: 'f', name: 'Office Hours', ...markOppNaPatch() },
};

eq(
  autoNaMatches(records, RULES).map(m => m.id),
  ['a', 'b'],
  'only undecided calls the user has never ruled on are candidates',
);
eq(autoNaMatches(records, RULES)[0].rule, 'Prospecting Time', 'each candidate carries the rule that caught it');
eq(autoNaMatches(records, []).length, 0, 'no rules changes nothing');
eq(autoNaMatches(null, RULES).length, 0, 'no records is not a crash');
eq(autoNaMatches(Object.values(records), RULES).map(m => m.id), ['a', 'b'], 'an array of records works as well as a map');

// The protection that makes this safe to leave on: a call the user
// tagged by hand is never taken back, however well its name matches.
eq(
  autoNaMatches({ d: records.d }, RULES).length,
  0,
  'a hand-tagged call is never overridden by a rule',
);
// And a call the user deliberately put BACK in the queue stays there,
// rather than being re-tagged on the next sync forever.
eq(
  autoNaMatches({ e: records.e }, RULES).length,
  0,
  'clearing an auto-N/A takes the call out of the rules’ reach for good',
);

// ---- the sync path ----------------------------------------------------------

const NOW = new Date('2026-08-06T12:00:00.000Z');
const fresh = autoNaPatchFor({ name: 'Prospecting Time' }, RULES, null, NOW);
eq(fresh.oppNa, true, 'an incoming recurrence is N/A on arrival');
eq(fresh.oppNaRule, 'Prospecting Time', 'and records which rule did it');
eq(fresh.oppTagManual, false, 'an auto tag is not a manual one');
eq(fresh.oppNaAt, '2026-08-06T12:00:00.000Z', 'and when it happened');
eq(isAutoNa({ ...fresh }), true, 'the page can tell an auto N/A from a hand-made one');
eq(isAutoNa({ ...markOppNaPatch() }), false, 'a hand-made N/A is not reported as automatic');

eq(autoNaPatchFor({ name: 'Prologis review' }, RULES, null, NOW), null, 'an unmatched call is left alone');
eq(autoNaPatchFor({ name: 'Prospecting Time' }, [], null, NOW), null, 'with no rules nothing is applied');
eq(
  autoNaPatchFor({ name: 'Prospecting Time' }, RULES, records.d, NOW),
  null,
  'a re-synced call that was hand-tagged keeps its tag',
);
eq(
  autoNaPatchFor({ name: 'Prospecting Time' }, RULES, records.e, NOW),
  null,
  'a re-synced call the user cleared is not re-tagged',
);
eq(
  autoNaPatchFor({ name: 'Prospecting Time' }, RULES, { id: 'x', name: 'Prospecting Time' }, NOW)?.oppNa,
  true,
  'a re-synced call nobody has ruled on is still caught',
);

// Tagging by hand afterwards beats the auto tag, and clears the trace of
// it — otherwise the row would claim a rule put it where it now is.
const afterManual = { ...fresh, ...tagOppPatch({ _id: 'opp_1', Account: 'Prologis' }, { label: 'Prologis — Bill payment' }) };
eq(oppTagStateOf(afterManual), 'tagged', 'a hand tag overrides an auto N/A');
eq(afterManual.oppNaRule, '', 'and drops the rule that had claimed it');
eq(afterManual.oppTagManual, true, 'and marks the call as the user’s to keep');

// ---- explaining it ----------------------------------------------------------

eq(
  describeNaRules({ rules: [] }),
  'No auto-N/A rules yet. Add the name of a recurring meeting — a weekly 1:1, office hours, a prospecting block — and calls with that name are marked N/A as they arrive.',
  'with no rules the panel says what a rule is for',
);
eq(
  describeNaRules({ rules: RULES, matches: 37 }),
  '2 rules covering 37 untagged calls.',
  'the count the button will write is the count the panel shows',
);
eq(
  describeNaRules({ rules: RULES, matches: 1 }),
  '2 rules covering 1 untagged call.',
  'one call reads as one call',
);
eq(
  describeNaRules({ rules: ['Prospecting Time'], matches: 0, total: 12 }),
  '1 rule, and every stored call they cover is already dealt with. New calls matching them are marked N/A as they sync.',
  'nothing left to do still says the rules are live for what comes next',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
