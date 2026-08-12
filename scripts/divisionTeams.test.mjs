// Assertion tests for bucketing a division's contacts by Team Name — the
// grouping the divisions chart draws under each box. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/divisionTeams.test.mjs
//
// What matters here is order and identity: buckets come out in the order
// the teams first appear (so the chart doesn't re-sort people out from
// under whoever assigned them), untagged people land in one trailing
// bucket, and two spellings of the same team are one bucket.
import { groupDivisionContactsByTeam } from '../src/utils/divisions.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const c = (id, name) => ({ id, name, jobtitle: '', email: '' });
// Stands in for the chart's teamOf: id first, name as the fallback a
// typed-in contact takes.
const teams = { '1': 'FP&A', '2': 'Treasury', '3': 'FP&A', '4': '  ' };
const byName = { 'shea drake': 'Treasury' };
const teamOf = (x) => teams[x.id] || byName[String(x.name || '').toLowerCase()] || '';

const shape = (groups) => groups.map(g => [g.team, g.contacts.map(x => x.name)]);

eq(shape(groupDivisionContactsByTeam(
  [c('1', 'Dan Egan'), c('2', 'Jonah Miller'), c('3', 'Greg Beutler')], teamOf)),
  [['FP&A', ['Dan Egan', 'Greg Beutler']], ['Treasury', ['Jonah Miller']]],
  'buckets by team, teams in first-appearance order');

eq(shape(groupDivisionContactsByTeam(
  [c('9', 'No Team'), c('2', 'Jonah Miller'), c('4', 'Blank Team')], teamOf)),
  [['Treasury', ['Jonah Miller']], ['', ['No Team', 'Blank Team']]],
  'untagged (and whitespace-only) people collect in one trailing bucket');

eq(shape(groupDivisionContactsByTeam(
  [c('', 'Shea Drake'), c('2', 'Jonah Miller')], teamOf)),
  [['Treasury', ['Shea Drake', 'Jonah Miller']]],
  'a typed contact with no id buckets off the name fallback');

eq(shape(groupDivisionContactsByTeam(
  [c('a', 'A'), c('b', 'B')], (x) => (x.id === 'a' ? 'Field Ops' : ' field  ops '))),
  [['Field Ops', ['A', 'B']]],
  'case and stray spacing are one team, labelled by the first spelling');

eq(shape(groupDivisionContactsByTeam([c('x', 'X'), c('y', 'Y')], () => '')),
  [['', ['X', 'Y']]],
  'nobody with a team gives one unlabelled bucket — the flat list the chart drew before');

eq(groupDivisionContactsByTeam([], teamOf), [], 'no contacts, no buckets');
eq(groupDivisionContactsByTeam(null, teamOf), [], 'a missing list is not a crash');
eq(shape(groupDivisionContactsByTeam([c('1', 'Dan Egan')], null)),
  [['', ['Dan Egan']]], 'no teamOf resolver means nothing is bucketed');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
