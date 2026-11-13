// Tests for planTagRecovery: putting back lost tag answers and tags from the
// settings backups. Plain Node. Run:
//   node scripts/tagRecovery.test.mjs
import { planTagRecovery, withRecoveredAnswers } from '../src/utils/tagRecovery.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const contacts = [
  { id: '1', name: 'Ben Barker', company: 'Apollo', tags: 'Decision Maker' },
  { id: '2', name: 'Amy', company: 'Acme', tags: 'ESG' },
  { id: '3', name: 'Cy', company: 'Beta', tags: '' },
];
const current = {
  1: { Utilities: { answer: 'unsure', status: '' } },
  2: { ESG: { answer: 'yes', status: '' } },
};
const backups = [
  { label: 'cloud 2026-11-12', review: {
    1: { ESG: { answer: 'yes', status: '' }, Utilities: { answer: 'no', status: '' } },
  } },
  { label: 'cloud 2026-11-01', review: {
    1: { ESG: { answer: 'no', status: '' }, Procurement: { answer: 'no', status: '' }, 'Capital Planning': { answer: 'yes', status: 'sold' } },
    3: { 'Climate Risk': { answer: 'yes', status: 'notsold' } },
  } },
];
const plan = planTagRecovery({ contacts, current, backups });
const ben = plan.rows.find(r => r.id === '1');
eq(ben.answers, {
  ESG: { answer: 'yes', status: '' },
  Procurement: { answer: 'no', status: '' },
  'Capital Planning': { answer: 'yes', status: 'sold' },
}, 'missing answers come back, each from the newest backup that has it');
eq(ben.answers.Utilities, undefined, 'an answer that exists today is never replaced');
eq(ben.addTags, ['ESG', 'Capital Planning'], 'a recovered Yes or Sold puts its tag back on');
eq(plan.rows.some(r => r.id === '2'), false, 'a contact with nothing missing is not listed');
const cy = plan.rows.find(r => r.id === '3');
eq([cy.answers['Climate Risk'], cy.addTags], [{ answer: 'yes', status: 'notsold' }, []], 'a Not sold answer comes back without its tag (it holds the tag off)');
eq([plan.answerCount, plan.tagCount], [4, 2], 'totals');

const standing = planTagRecovery({ contacts: [{ id: '9', tags: '' }], current: { 9: { ESG: { answer: 'yes', status: '' } } }, backups: [] });
eq(standing.rows[0].addTags, ['ESG'], 'a Yes still on record whose tag fell off gets the tag back');

eq(withRecoveredAnswers(current, plan.rows)['1'], {
  Utilities: { answer: 'unsure', status: '' },
  ESG: { answer: 'yes', status: '' },
  Procurement: { answer: 'no', status: '' },
  'Capital Planning': { answer: 'yes', status: 'sold' },
}, 'applying fills the gaps and keeps what is there');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
