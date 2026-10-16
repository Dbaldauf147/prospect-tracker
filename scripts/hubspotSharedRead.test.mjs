// Assertion tests for getHubspotCacheShared, the one HubSpot-cache read the
// always-on readers (App, roster coverage, decision-maker coverage) share.
// Plain Node - no test framework. Run:
//   node scripts/hubspotSharedRead.test.mjs
//
// The point of it is fewer reads; what must never happen is a STALE read:
//   - readers that arrive while a read is running join it (one read);
//   - once that read settles nothing is kept: the next call reads again;
//   - a write, or the update event, means the next caller never joins a
//     read that began before it;
//   - another user's read is never handed out;
//   - getHubspotCache (what writers use) always does its own read.
import { register } from 'node:module';
register('./stubs/idbLoader.mjs', import.meta.url);

const idb = await import('./stubs/idbStore.mjs');
const { getHubspotCache, getHubspotCacheShared, setHubspotCache, notifyCacheUpdated } = await import('../src/utils/hubspotContactsCache.js');

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const names = (c) => (c?.contacts || []).map(x => x.firstname);

idb.setDbUserId('u1');
await setHubspotCache({ contacts: [{ id: '1', firstname: 'Ann' }] });

// Three readers at once: one read between them.
{
  const before = idb.stats.gets;
  const release = idb.holdReads();
  const reads = [getHubspotCacheShared(), getHubspotCacheShared(), getHubspotCacheShared()];
  release();
  const got = await Promise.all(reads);
  check('three readers at once share one read', idb.stats.gets - before, 1);
  check('and all see the cache', got.map(names), [['Ann'], ['Ann'], ['Ann']]);
}

// Settled reads are not remembered.
{
  const before = idb.stats.gets;
  await getHubspotCacheShared();
  await getHubspotCacheShared();
  check('a read after the last one settled goes back to storage', idb.stats.gets - before, 2);
}

// A write during a read: the next caller does not join the old read.
{
  const release = idb.holdReads();
  const old = getHubspotCacheShared();
  await setHubspotCache({ contacts: [{ id: '2', firstname: 'Bo' }] });
  const fresh = getHubspotCacheShared();
  release();
  check('a caller after a write does not get the read begun before it', names(await fresh), ['Bo']);
  await old;
}

// The update event alone (another writer in this tab) does the same.
{
  const release = idb.holdReads();
  const old = getHubspotCacheShared();
  notifyCacheUpdated();
  const fresh = getHubspotCacheShared();
  check('the update event starts a new read', fresh === old, false);
  release();
  await Promise.all([old, fresh]);
}

// A different user never gets the first user's read.
{
  const release = idb.holdReads();
  const mine = getHubspotCacheShared();
  idb.setDbUserId('u2');
  const theirs = getHubspotCacheShared();
  release();
  check('another user does not join the read', mine === theirs, false);
  check('and reads their own (empty) cache', names(await theirs), []);
  await mine;
  idb.setDbUserId('u1');
}

// Writers keep their own copy.
{
  const release = idb.holdReads();
  const shared = getHubspotCacheShared();
  const own = getHubspotCache();
  release();
  const [a, b] = await Promise.all([shared, own]);
  check('getHubspotCache never hands out the shared object', a === b, false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
