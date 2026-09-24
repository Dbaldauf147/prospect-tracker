// Assertion tests for the shared Opps 2 reader behind App's always-mounted
// hooks. Plain Node, no test framework. Run:
//   node scripts/opps2Live.test.mjs
//
// What has to hold:
//   1. The first start loads the newest copy for that account.
//   2. A re-read that finds the same _updatedAt keeps the object already
//      held and notifies nobody (the whole point: focus used to recompute
//      every App-level hook).
//   3. A newer write is published, and a trigger landing mid-read still
//      gets the write that followed it.
//   4. The tick publishes new records even when nothing changed, so the
//      day-relative counts roll over.
//   5. Switching account drops the last account's data.

import { createOpps2Live } from '../src/utils/opps2Live.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
const flush = () => new Promise(r => setTimeout(r, 0));

let stored = { _updatedAt: 1, records: [{ _id: 'a' }] };
let cacheReads = 0;
let newestReads = [];
const live = createOpps2Live({
  loadCache: async () => { cacheReads += 1; return structuredClone(stored); },
  loadNewest: async (uid) => { newestReads.push(uid); return structuredClone(stored); },
});
let notified = 0;
live.subscribe(() => { notified += 1; });

const stop = live.start('u1');
await flush(); await flush();
check('first start reads the newest for the account', newestReads.length === 1 && newestReads[0] === 'u1');
check('first read is published', live.getSnapshot()?._updatedAt === 1 && notified === 1);

const held = live.getSnapshot();
await live.refresh(); await flush();
check('unchanged re-read keeps the same object', live.getSnapshot() === held);
check('unchanged re-read notifies nobody', notified === 1);

// Four hooks' worth of triggers at once: one read, plus one follow-up.
cacheReads = 0;
live.refresh(); live.refresh(); live.refresh(); live.refresh();
await flush(); await flush(); await flush(); await flush();
check(`concurrent triggers share reads (got ${cacheReads})`, cacheReads <= 2);

// A save that lands while a read is in flight is still picked up.
const p = live.refresh();
stored = { _updatedAt: 2, records: [{ _id: 'a' }, { _id: 'b' }] };
live.refresh();
await p; await flush(); await flush(); await flush();
check('a write made mid-read is published', live.getSnapshot()?._updatedAt === 2 && live.getSnapshot().records.length === 2);

const before = live.getSnapshot();
const n = notified;
live.tick(); await flush(); await flush(); await flush();
check('tick publishes a fresh snapshot', live.getSnapshot() !== before && notified > n);
check('tick hands out a new records array', live.getSnapshot().records !== before.records);
check('tick keeps the data', live.getSnapshot()._updatedAt === 2);

stop();
live.start('u2');
check('switching account clears the held data at once', live.getSnapshot() === null);
await flush(); await flush();
check('switching account reads the newest for the new one', newestReads.at(-1) === 'u2' && live.getSnapshot() !== null);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll passed');
