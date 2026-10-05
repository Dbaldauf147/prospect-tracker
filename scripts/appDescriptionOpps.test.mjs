// Assertion tests for the Application Description list shared by the
// Agents page prompt and the Issues tab. Plain Node, no framework. Run:
//   node scripts/appDescriptionOpps.test.mjs
//
// The split that matters: an opp whose company has both a Contracting
// Entity and an address goes to the prompt; anything else is reported on
// the Issues tab and must never reach the assistant with a blank value.
// (clientIssues.js uses bundler-style imports Node can't load, so the
// Issues detector itself is checked in the browser.)
import { computeAppDescriptionOpps } from '../src/utils/appDescriptionOpps.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const opp = (id, name, stage, account, extra = {}) => ({
  _id: id, Account: account, Stage: stage, 'BFO Link': name,
  'BFO Address': `https://se.lightning.force.com/lightning/r/Opportunity/${name}/view`, ...extra,
});
const oppsCache = { headers: [], records: [
  opp('a', 'OppA', 'Agreement Sent', 'Edward Jones'),
  opp('b', 'OppB', 'Contracting', 'Simon Property Group'),
  opp('c', 'OppC', 'Contracting', 'Oxea (a SVP co.)'),
  opp('d', 'OppD', 'Agreement Sent', 'Unknown Co'),
  opp('e', 'OppE', 'Quoted', 'Edward Jones'),
  opp('f', 'OppF', 'Contracting', 'Edward Jones'),
  opp('g', 'OppG', 'Contracting', 'Edward Jones'),
] };
const row = (name, stage, desc = '') => ({ 'Opportunity Name': name, 'Sales Stage': stage, 'Application Description': desc });
const bfoActivity = { headers: ['Opportunity Name', 'Sales Stage', 'Application Description'], rows: [
  row('OppA', '6 - Negotiate to Win'),
  row('OppB', '5 - Prepare & Bid'),
  row('OppC', '6 - Negotiate to Win', '-'),
  row('OppD', '5 - Prepare & Bid'),
  row('OppE', '5 - Prepare & Bid'),
  row('OppF', '4 - Influence and Develop'),
  row('OppG', '5 - Prepare & Bid', 'Already filled'),
] };
const prospects = [
  { id: 'p1', company: 'Edward Jones', contractingEntity: 'Edward D. Jones & Co., L.P.', contractingEntityAddress: '12555 Manchester Rd' },
  { id: 'p2', company: 'Simon Property Group', contractingEntity: 'Simon Property Group, L.P.', contractingEntityAddress: '' },
  { id: 'p3', company: 'Oxea', bfoCompanyName: 'Oxea (a SVP co.)' },
];

const { rows, hasAppDescCol } = computeAppDescriptionOpps({ bfoActivity, oppsCache, prospects });
check('reads the Application Description column', hasAppDescCol, true);
check('only Stage 5/6, Contracting/Agreement Sent, blank description',
  rows.map(r => r.name), ['OppA', 'OppC', 'OppB', 'OppD']);
check('complete company has nothing missing',
  rows.find(r => r.name === 'OppA').missing, []);
check('missing address only',
  rows.find(r => r.name === 'OppB').missing, ['Contracting Entity Address']);
check('matched through BFO Company Name, missing both',
  [rows.find(r => r.name === 'OppC').prospectId, rows.find(r => r.name === 'OppC').missing],
  ['p3', ['Contracting Entity', 'Contracting Entity Address']]);
check('no matching company',
  rows.find(r => r.name === 'OppD').missing, ['company not found in Table View']);

const noCol = computeAppDescriptionOpps({
  bfoActivity: { headers: ['Opportunity Name', 'Sales Stage'], rows: bfoActivity.rows },
  oppsCache, prospects,
});
check('without the column every qualifying opp is listed',
  [noCol.hasAppDescCol, noCol.rows.map(r => r.name)], [false, ['OppA', 'OppG', 'OppC', 'OppB', 'OppD']]);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed.');
