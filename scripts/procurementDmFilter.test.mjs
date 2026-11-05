// The "Procurement DMs, open" button's rule.
import assert from 'node:assert/strict';
import { isProcurementDecisionMaker, answeredProcurementServices, isOpenProcurementDecisionMaker } from '../src/utils/procurementDmFilter.js';

// Two Procurement services (by their Contact Tags) and one that isn't.
const ctx = {
  names: ['PPA/VPPA', 'REOA', 'GHG Inventory'],
  overrides: {
    'PPA/VPPA': { contactTags: 'Procurement' },
    REOA: { contactTags: 'Procurement; Utilities' },
    'GHG Inventory': { contactTags: 'ESG' },
  },
};
const dm = { dans_tags: 'Decision Maker; procurement; Dan Key Target' };

assert.equal(isProcurementDecisionMaker(dm), true, 'tags matched whatever the case');
assert.equal(isProcurementDecisionMaker({ dans_tags: 'Procurement' }), false, 'needs both tags');
assert.equal(isProcurementDecisionMaker({ dans_tags: 'Decision Maker' }), false);
assert.equal(isProcurementDecisionMaker({}), false);

const open = { servicesExplored: { 'PPA/VPPA': 'Exploring', 'GHG Inventory': 'Sold' } };
const sold = { servicesExplored: { REOA: 'Sold' } };
const notSold = { servicesExplored: { 'PPA/VPPA': 'Not Sold', REOA: '-' } };

assert.deepEqual(answeredProcurementServices(open, ctx), [], 'a Sold service outside Procurement does not count');
assert.deepEqual(answeredProcurementServices(sold, ctx), [{ name: 'REOA', status: 'Sold' }]);
assert.equal(isOpenProcurementDecisionMaker(dm, open, ctx), true);
assert.equal(isOpenProcurementDecisionMaker(dm, sold, ctx), false, 'Sold leaves them out');
assert.equal(isOpenProcurementDecisionMaker(dm, notSold, ctx), false, 'Not Sold leaves them out');
assert.equal(isOpenProcurementDecisionMaker(dm, null, ctx), true, 'no matched company: nothing answered');
assert.equal(isOpenProcurementDecisionMaker({ dans_tags: 'Procurement' }, open, ctx), false);
console.log('PASS  procurement DM filter');
