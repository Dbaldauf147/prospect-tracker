// Assertion tests for the N/A sale status on the contact tag table.
// Plain Node, no framework. Run: node scripts/tagStatusNa.test.mjs
import {
  tagRecordFrom, tagStateFrom, tagAnswerFrom, recordKeepsTag, withTagAnswer,
  withTagStatus, recordForVerdict, isLocalTagVerdict, isSaleStatus,
} from '../src/utils/contactTagReview.js';
import { hasTopicTagSaleStatus } from '../src/utils/procurementDmFilter.js';
import { decisionMakersSaleStatus } from '../src/utils/decisionMakerTagMatrix.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

eq(tagRecordFrom({ answer: 'yes', status: 'na' }), { answer: 'yes', status: 'na' }, 'N/A is a stored status');
eq(isSaleStatus('na'), false, 'N/A is not a sale');
eq(isLocalTagVerdict({ answer: '', status: 'na' }), true, 'a lone N/A is kept in the app');

// Neutral: the answer decides the tag.
eq(recordKeepsTag({ answer: 'yes', status: 'na' }), true, 'Yes + N/A keeps the tag');
eq(recordKeepsTag({ answer: '', status: 'na' }), false, 'N/A alone does not put the tag on');
eq(recordKeepsTag({ answer: 'no', status: 'na' }), false, 'No + N/A leaves it off');

// It survives either way the tag is.
eq(tagStateFrom(true, { answer: 'yes', status: 'na' }), { answer: 'yes', status: 'na' }, 'tagged: Yes + N/A shows both');
eq(tagStateFrom(false, { answer: 'no', status: 'na' }), { answer: 'no', status: 'na' }, 'untagged: No + N/A shows both');
eq(tagStateFrom(false, { answer: 'yes', status: 'na' }), { answer: '', status: 'na' }, 'untagged: a stale Yes goes, N/A stays');

// The single-pill reading ignores it.
eq(tagAnswerFrom(true, { answer: 'yes', status: 'na' }), 'yes', 'All Contacts reads Yes + N/A as Yes');
eq(tagAnswerFrom(false, { answer: 'unsure', status: 'na' }), 'unsure', 'and Not sure + N/A as Not sure');
eq(tagAnswerFrom(false, { answer: '', status: 'na' }), '', 'and a lone N/A as unanswered');

// Setters: N/A sits beside any answer.
eq(withTagStatus({ answer: 'no', status: '' }, 'na'), { answer: 'no', status: 'na' }, 'N/A keeps a No');
eq(withTagStatus({ answer: 'no', status: '' }, 'sold'), { answer: '', status: 'sold' }, 'Sold still clears a No');
eq(withTagAnswer({ answer: '', status: 'na' }, 'no'), { answer: 'no', status: 'na' }, 'a No keeps N/A');
eq(withTagAnswer({ answer: '', status: 'notsold' }, 'no'), { answer: 'no', status: '' }, 'a No still clears Not sold');
eq(withTagStatus({ answer: 'yes', status: 'sold' }, 'na'), { answer: 'yes', status: 'na' }, 'N/A replaces Sold');
eq(recordForVerdict({ answer: 'yes', status: '' }, 'na'), { answer: 'yes', status: 'na' }, 'bulk mark N/A');

// Coverage: N/A is not a sale, so the DM stays open and is not coverage.
const c = { id: 7, properties: { dans_tags: 'Decision Maker' } };
eq(hasTopicTagSaleStatus(c, { 7: { Procurement: { answer: '', status: 'na' } } }, 'Procurement'), false, 'N/A keeps a DM on the open list');
eq(decisionMakersSaleStatus([c], 'Procurement', { 7: { Procurement: { answer: 'no', status: 'na' } } }).length, 0,
  'N/A does not count as sale coverage in the DM matrix');
eq(decisionMakersSaleStatus([c], 'Procurement', { 7: { Procurement: { answer: 'yes', status: 'notsold' } } }).length, 1,
  'Not sold still does');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
