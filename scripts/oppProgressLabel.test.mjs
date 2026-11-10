// Company card > Opps: the Stalled / Progressing label. Run:
//   node scripts/oppProgressLabel.test.mjs
import assert from 'node:assert/strict';
const { oppProgressFor, oppProgressPatch, oppProgressId } = await import('../src/utils/oppProgressLabel.js');

assert.deepEqual(oppProgressPatch('abc', 'stalled'), { 'oppProgress.abc': 'stalled' }, 'sets a label');
assert.deepEqual(oppProgressPatch('abc', ''), { 'oppProgress.abc': null }, 'blank clears it');
assert.deepEqual(oppProgressPatch('abc', 'bogus'), { 'oppProgress.abc': null }, 'unknown value clears it');
assert.equal(oppProgressPatch('', 'stalled'), null, 'no id, no patch');
assert.equal(oppProgressId('a.b/c'), 'a_b_c', 'dots and slashes cannot split the path');
assert.equal(oppProgressFor({ abc: 'progressing' }, 'abc'), 'progressing', 'reads a label');
assert.equal(oppProgressFor({ a_b: 'stalled' }, 'a.b'), 'stalled', 'reads through the same key');
assert.equal(oppProgressFor({ abc: 'weird' }, 'abc'), '', 'ignores junk');
assert.equal(oppProgressFor(null, 'abc'), '', 'no map');
assert.equal(oppProgressFor({ abc: 'on-hold' }, 'abc'), 'on-hold', 'reads On Hold');
assert.deepEqual(oppProgressPatch('abc', 'on-hold'), { 'oppProgress.abc': 'on-hold' }, 'sets On Hold');
console.log('PASS  oppProgressLabel');
