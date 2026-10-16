// Assertion tests for the By Category steps-remaining rule shared by the
// company popup and My Accounts > Company Data. Plain Node. Run:
//   node scripts/dmSteps.test.mjs
import assert from 'node:assert/strict';
import { DM_STEPS, bucketStepsLeft, companyStepsRemaining } from '../src/utils/dmSteps.js';

const esg = { key: 'esg', label: 'ESG', tag: 'esg' };

// A Yes decision maker leaves nothing to do, whatever the ticks say.
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: true }), 0);
// No DM and nothing else: every step left.
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false }), DM_STEPS.length);
// A Zoom Company ID on the company is the first step done, ticked or not.
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, zoomCompanyId: '123' }), 4);
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, zoomCompanyId: '   ' }), 5);
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, searchRun: { esg: '2026-10-01' } }), 4);
// The furthest step reached counts, so ticking a later one covers those above.
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, searchSteps: { esg: { manual: 'x' } } }), 2);
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, searchSteps: { esg: { closeOut: 'x' } } }), 0);
// Another bucket's ticks don't count.
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, searchSteps: { utilities: { closeOut: 'x' } } }), 5);

// A logged Zoom title search does Zoom search ran (step 2) on its own.
assert.equal(bucketStepsLeft({ bucket: esg, hasYesDm: false, zoomCompanyId: '1', titleSearched: true }), 3);
assert.equal(companyStepsRemaining({ record: { zoomCompanyId: '1' }, titleSearches: [{ tag: 'ESG' }] })
  .perBucket.find(b => b.bucket.key === 'esg').left, 3);
assert.equal(companyStepsRemaining({ record: { zoomCompanyId: '1' }, titleSearches: [{ tag: 'ESG' }] }).total, 19);

// A whole company: five categories, a DM who is Yes for ESG only (the tag
// read ignoring spacing, as the popup does), a Zoom ID, Procurement closed out.
const dm = { id: 7, dans_tags: 'Decision Maker; esg' };
const all = companyStepsRemaining({
  dms: [dm],
  record: { zoomCompanyId: '999', dmSearchSteps: { procurement: { closeOut: 'x' } } },
});
assert.equal(all.max, 25);
const left = Object.fromEntries(all.perBucket.map(b => [b.bucket.key, b.left]));
assert.deepEqual(left, { capitalplanning: 4, climaterisk: 4, esg: 0, procurement: 0, utilities: 4 });
assert.equal(all.total, 12);
// Closed out isn't a decision maker, so this company doesn't have them all.
assert.equal(all.allDms, false);

// A Yes decision maker on every category: allDms.
const everyTag = { id: 9, dans_tags: 'Decision Maker; ESG; Procurement; Utilities; Climate Risk; Capital Planning' };
assert.equal(companyStepsRemaining({ dms: [everyTag] }).allDms, true);
assert.equal(companyStepsRemaining({ dms: [everyTag] }).total, 0);
assert.equal(companyStepsRemaining({}).allDms, false);

// Nobody and nothing: 25.
assert.equal(companyStepsRemaining({}).total, 25);

// A Not sure answer is not a Yes, so the category still has steps.
const review = { 8: { ESG: { answer: 'unsure' } } };
const unsure = companyStepsRemaining({ dms: [{ id: 8, dans_tags: 'Decision Maker' }], tagReview: review });
assert.equal(unsure.perBucket.find(b => b.bucket.key === 'esg').left, 5);

console.log('dmSteps: all assertions passed');
