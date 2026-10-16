// The Suggested Vertical column on My Accounts: what the Targets list's
// vertical suggests for a mapped company. Plain Node. Run:
//   node scripts/targetVerticalSuggest.test.mjs
import assert from 'node:assert/strict';
import { targetVerticalIndex, suggestTargetVertical } from '../src/utils/targetTier.js';

const data = {
  sheetNames: ['Targets', 'Other'],
  sheets: {
    Targets: { records: [
      { 'Account Name': 'Barings', Vertical: 'real estate' },
      { 'Account Name': 'Bain Capital', Vertical: 'PE' },
      { 'Account Name': 'Blank Co', Vertical: '' },
    ] },
    Other: { records: [{ 'Account Name': 'Barings', Vertical: 'Ignored' }] },
  },
};
const settings = { targetVerticalNames: { pe: 'Private Equity' } };
const index = targetVerticalIndex(data, settings);
assert.equal(index.get('barings'), 'real estate', 'first row with a vertical wins');
assert.equal(index.get('bain capital'), 'Private Equity', 'renamed through Vertical names');
assert.equal(index.has('blank co'), false);

const options = ['Real Estate', 'Private Equity'];
const s = (o) => suggestTargetVertical({ index, options, ...o });

// A blank Vertical gets the mapped row's, snapped to the dropdown spelling.
assert.deepEqual(s({ targetNames: ['Barings'] }), { vertical: 'Real Estate', from: 'Barings', onList: true });
// Already has it (any case): nothing to suggest.
assert.equal(s({ targetNames: ['Barings'], vertical: 'REAL ESTATE' }), null);
// A different Vertical is suggested a change.
assert.equal(s({ targetNames: ['Bain Capital'], vertical: 'Real Estate' }).vertical, 'Private Equity');
// Kept on purpose over the Targets list: quiet while it is still that one.
assert.equal(s({ targetNames: ['Bain Capital'], vertical: 'Real Estate', verticalOverride: 'real estate' }), null);
assert.equal(s({ targetNames: ['Bain Capital'], vertical: 'Other', verticalOverride: 'Real Estate' }).vertical, 'Private Equity');
// Not mapped, or mapped to rows with no vertical: nothing.
assert.equal(s({ targetNames: [] }), null);
assert.equal(s({ targetNames: ['Blank Co', 'Nowhere'] }), null);
// The first mapped name with a vertical counts.
assert.equal(s({ targetNames: ['Blank Co', 'Bain Capital'] }).from, 'Bain Capital');
// Off the dropdown list: offered as it is, marked off-list.
assert.deepEqual(suggestTargetVertical({ index, options: ['Real Estate'], targetNames: ['Bain Capital'] }), { vertical: 'Private Equity', from: 'Bain Capital', onList: false });

console.log('targetVerticalSuggest: all assertions passed');
