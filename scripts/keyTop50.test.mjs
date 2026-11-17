// The Key tab's top-50 counter and its Decision Maker flag.
import assert from 'node:assert/strict';
import { KEY_CONTACTS_TARGET, isKeyTabContact, isDmTagged, keyTopCounts } from '../src/utils/keyTop50.js';

assert.equal(KEY_CONTACTS_TARGET, 50);
assert.equal(isKeyTabContact({ dans_tags: 'Dan Key Target' }), true);
assert.equal(isKeyTabContact({ dans_tags: 'dan key target; Hide' }), false, 'hidden is off the tab');
assert.equal(isKeyTabContact({ dans_tags: 'Dan Key Target;Left' }), false, 'left is off the tab');
assert.equal(isKeyTabContact({ dans_tags: 'Decision Maker' }), false);
assert.equal(isKeyTabContact({ dan_s_tags: 'Dan Key Target' }), true, 'either tag field');
assert.equal(isDmTagged({ dans_tags: 'decision maker' }), true);
assert.equal(isDmTagged({}), false);

const key = (dm) => ({ dans_tags: dm ? 'Dan Key Target;Decision Maker' : 'Dan Key Target;Procurement' });
assert.deepEqual(keyTopCounts([key(true), key(false), { dans_tags: 'Decision Maker' }, { dans_tags: 'Dan Key Target;Hide' }]),
  { total: 2, notDm: 1, over: 0 }, 'counts only the tab, flags the non-DM');
assert.deepEqual(keyTopCounts(Array.from({ length: 53 }, (_, i) => key(i % 2 === 0))),
  { total: 53, notDm: 26, over: 3 }, 'over the target by 3');
assert.deepEqual(keyTopCounts(Array.from({ length: 50 }, () => key(true))).over, 0, 'exactly 50 is not over');
assert.deepEqual(keyTopCounts(null), { total: 0, notDm: 0, over: 0 });
console.log('keyTop50 ok');
