// The "Procurement DMs, open" button's rule.
import assert from 'node:assert/strict';
import { isProcurementDecisionMaker, hasProcurementTagSaleStatus, isOpenProcurementDecisionMaker } from '../src/utils/procurementDmFilter.js';

const dm = { id: 7, dans_tags: 'Decision Maker; procurement; Dan Key Target' };

assert.equal(isProcurementDecisionMaker(dm), true, 'tags matched whatever the case');
assert.equal(isProcurementDecisionMaker({ dans_tags: 'Procurement' }), false, 'needs both tags');
assert.equal(isProcurementDecisionMaker({ dans_tags: 'Decision Maker' }), false);
assert.equal(isProcurementDecisionMaker({}), false);

assert.equal(isOpenProcurementDecisionMaker(dm, {}), true, 'no status recorded: in');
assert.equal(isOpenProcurementDecisionMaker(dm, undefined), true);
assert.equal(isOpenProcurementDecisionMaker(dm, { 7: { Procurement: { answer: 'yes', status: 'sold' } } }), false, 'tag status Sold leaves them out');
assert.equal(isOpenProcurementDecisionMaker(dm, { 7: { procurement: { answer: 'yes', status: 'notsold' } } }), false, 'tag status Not sold leaves them out, any spelling');
assert.equal(isOpenProcurementDecisionMaker(dm, { 7: { Procurement: { answer: 'yes', status: '' } } }), true, 'a plain Yes stays in');
assert.equal(isOpenProcurementDecisionMaker(dm, { 7: { 'Decision Maker': { status: 'sold' } } }), true, 'another tag\'s status does not count');
assert.equal(isOpenProcurementDecisionMaker(dm, { 8: { Procurement: { status: 'sold' } } }), true, 'another contact\'s status does not count');
assert.equal(hasProcurementTagSaleStatus({}, { 7: { Procurement: { status: 'sold' } } }), false, 'no id: nothing recorded');
assert.equal(isOpenProcurementDecisionMaker({ id: 7, dans_tags: 'Procurement' }, {}), false);
console.log('PASS  procurement DM filter');

// ESG and CAP (Capital Planning) work the same way, each on its own tag.
{
  const { isOpenTopicDecisionMaker } = await import('../src/utils/procurementDmFilter.js');
  const esg = { id: 9, dans_tags: 'ESG; Decision Maker' };
  assert.equal(isOpenTopicDecisionMaker(esg, {}, 'ESG'), true);
  assert.equal(isOpenTopicDecisionMaker(esg, {}, 'Procurement'), false, 'ESG DM is not a Procurement DM');
  assert.equal(isOpenTopicDecisionMaker(esg, { 9: { ESG: { status: 'sold' } } }, 'ESG'), false);
  assert.equal(isOpenTopicDecisionMaker(esg, { 9: { Procurement: { status: 'sold' } } }, 'ESG'), true);
  const cap = { id: 10, dans_tags: 'CapitalPlanning;decision maker' };
  assert.equal(isOpenTopicDecisionMaker(cap, {}, 'Capital Planning'), true, 'spacing ignored');
  assert.equal(isOpenTopicDecisionMaker(cap, { 10: { 'Capital Planning': { status: 'notsold' } } }, 'Capital Planning'), false);
  console.log('PASS  ESG / CAP DM filter');
}

// PE ESG: the ESG rule, at Private Equity firms only.
{
  const { DM_TOPICS, isPeCompany, matchesDmTopic } = await import('../src/utils/procurementDmFilter.js');
  const peEsg = DM_TOPICS.find(t => t.key === 'peEsg');
  const esg = { id: 11, dans_tags: 'ESG; Decision Maker' };
  assert.equal(isPeCompany({ type: 'Private Equity' }), true);
  assert.equal(isPeCompany({ type: 'Owner Operator', vertical: 'private equity' }), true, 'the vertical counts too');
  assert.equal(isPeCompany({ type: 'Portfolio Company' }), false, 'a portfolio company is not the firm');
  assert.equal(isPeCompany(null), false);
  assert.equal(matchesDmTopic(esg, { type: 'Private Equity' }, {}, peEsg), true);
  assert.equal(matchesDmTopic(esg, { type: 'Developer' }, {}, peEsg), false, 'not a PE firm');
  assert.equal(matchesDmTopic(esg, null, {}, peEsg), false, 'no company record');
  assert.equal(matchesDmTopic(esg, { type: 'Private Equity' }, { 11: { ESG: { status: 'sold' } } }, peEsg), false, 'ESG Sold leaves them out');
  assert.equal(matchesDmTopic({ id: 12, dans_tags: 'Procurement; Decision Maker' }, { type: 'Private Equity' }, {}, peEsg), false, 'needs the ESG tag');
  assert.equal(matchesDmTopic(esg, null, {}, DM_TOPICS.find(t => t.key === 'esg')), true, 'plain ESG ignores the company');
  console.log('PASS  PE ESG DM filter');
}
