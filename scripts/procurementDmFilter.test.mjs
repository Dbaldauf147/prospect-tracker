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
