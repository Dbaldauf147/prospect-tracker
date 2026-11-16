// Clients > Retention (utils/clientRetention). Plain Node. Run:
//   node scripts/clientRetention.test.mjs
import { clientRetention, retentionPercent, withRetentionMark } from '../src/utils/clientRetention.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const names = (rows) => rows.map(r => r.company);

const prospects = [
  { id: 'wsp', company: 'WSP', status: 'Client', cdm: 'Dan', companyAliases: ['WSP Global'] },
  { id: 'pro', company: 'Prologis', status: 'Old Client' },
  { id: 'bx', company: 'Blackstone', status: 'Inside Sales' },
  { id: 'ara', company: 'Ara Partners', status: 'Client' },
];
const opps = [
  { Account: 'WSP', Stage: 'Sold', 'Quoted Amount': '$10,000', 'Close Date': '3/1/2025' },
  { Account: 'WSP Global Inc.', Stage: 'Sold', 'Quoted Amount': '5000', 'Close Date': '6/1/2026' },
  { Account: 'Prologis, Inc.', Stage: 'Sold', 'Quoted Amount': '$40,000', 'Close Date': '1/5/2024' },
  { Account: 'Blackstone', Stage: 'Sold', 'Quoted Amount': '' },
  { Account: 'Ara Partners', Stage: 'Not Sold', 'Quoted Amount': '$90,000' },
  { Account: 'Ara Partners', Stage: 'Quoted', 'Quoted Amount': '$90,000' },
  { Account: 'Acme Widgets', Stage: 'Sold', 'Quoted Amount': '$2,000' },
  { Account: '', Stage: 'Sold' },
  null,
];

const r = clientRetention(opps, prospects);
eq(names(r.retained), ['WSP', 'Acme Widgets', 'Blackstone'], 'Sold column: every sold company not Old Client, biggest first');
eq(names(r.left), ['Prologis'], 'They left us: the sold company with status Old Client');
eq(r.total, 4, 'four sold companies; Ara never sold, a blank account is skipped');
eq(retentionPercent(r.rate), '75%', 'retention is 3 of 4');

const wsp = r.retained[0];
eq([wsp.soldOpps, wsp.soldAmount, wsp.lastSold, wsp.accounts], [2, 15000, '6/1/2026', ['WSP', 'WSP Global Inc.']],
  'two spellings (one via alias) make one row with both opps');
eq([wsp.prospectId, wsp.status, wsp.cdm, wsp.inTableView], ['wsp', 'Client', 'Dan', true], 'the row carries the company record');
const acme = r.retained.find(x => x.company === 'Acme Widgets');
eq([acme.inTableView, acme.prospectId, acme.status], [false, null, ''], 'an account with no Table View company still counts as sold, flagged');

eq(clientRetention(opps, prospects.map(p => p.id === 'wsp' ? { ...p, status: ' old client ' } : p)).left.map(x => x.company),
  ['Prologis', 'WSP'], 'Old Client is read loosely (case, spaces)');

// An unmerged duplicate: the sale goes to the record that is a client.
const dup = clientRetention([{ Account: 'Hines', Stage: 'Sold' }],
  [{ id: 'h1', company: 'Hines', status: 'Qualifying' }, { id: 'h2', company: 'Hines Inc.', status: 'Old Client' }]);
eq([dup.left.length, dup.left[0]?.prospectId], [1, 'h2'], 'a duplicate prefers the client record');

eq(clientRetention([], prospects), { retained: [], left: [], expired: [], other: [], total: 0, rate: null }, 'nothing sold');

// Marks: sold by someone else leaves the page and the rate; scope expired is
// its own column, also out of the rate. A mark beats the Old Client status.
{
  const marks = { 'p:bx': 'other', 'p:pro': 'expired', 'a:acmewidgets': 'bogus' };
  const m = clientRetention(opps, prospects, marks);
  eq(names(m.retained), ['WSP', 'Acme Widgets'], 'marked: Sold keeps the unmarked; an unknown mark is ignored');
  eq(names(m.left), [], 'marked: the Old Client marked expired is not under They left us');
  eq(names(m.expired), ['Prologis'], 'marked: Scope expired column');
  eq(names(m.other), ['Blackstone'], 'marked: sold by someone else, listed apart');
  eq([m.total, retentionPercent(m.rate)], [2, '100%'], 'marked: both left out of the rate');
  eq(m.expired[0].mark, 'expired', 'rows carry their mark');
}
eq(withRetentionMark({ a: 'other' }, 'b', 'expired'), { a: 'other', b: 'expired' }, 'set a mark');
eq(withRetentionMark({ a: 'other', b: 'expired' }, 'a', ''), { b: 'expired' }, 'clear a mark');
eq(withRetentionMark(undefined, 'a', 'nope'), {}, 'an unknown mark clears');
eq(retentionPercent(null), '-', 'no rate reads as a dash');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
