// The Biggest Deal column's pick and its money format.
import assert from 'node:assert/strict';
import { biggestDeal, formatDealAmount } from '../src/utils/biggestDeal.js';

const opps = [
  { Stage: 'Proposal', 'Quoted Amount': '$250,000', 'BFO Link': 'Acme Procurement' },
  { Stage: 'Not Sold', 'Quoted Amount': '$9,000,000', 'BFO Link': 'Lost one' },
  { Stage: 'Sold', 'Quoted Amount': 'USD 1,200,000.00', 'BFO Link': 'Acme ESG' },
  { Stage: '#N/A', 'Quoted Amount': '$5,000,000' },
  { Stage: 'Lead', 'Quoted Amount': '-' },
];
assert.deepEqual(biggestDeal(opps), { amount: 1200000, stage: 'Sold', name: 'Acme ESG' }, 'Sold counts, Not Sold and broken stages do not');
assert.deepEqual(biggestDeal(opps.slice(0, 2)), { amount: 250000, stage: 'Proposal', name: 'Acme Procurement' });
assert.equal(biggestDeal([{ Stage: 'Lead', 'Quoted Amount': '' }]), null, 'no amount: nothing');
assert.equal(biggestDeal([]), null);
assert.equal(biggestDeal(null), null);
assert.equal(biggestDeal([{ Stage: 'Lead', 'Quoted Amount': '100', 'BFO Link': '-' }]).name, '', 'a dash name is blank');

assert.equal(formatDealAmount(950), '$950');
assert.equal(formatDealAmount(12000), '$12K');
assert.equal(formatDealAmount(12500), '$12.5K');
assert.equal(formatDealAmount(250000), '$250K');
assert.equal(formatDealAmount(1200000), '$1.2M');
assert.equal(formatDealAmount(3.4e9), '$3.4B');
assert.equal(formatDealAmount(0), '');
console.log('biggestDeal ok');
