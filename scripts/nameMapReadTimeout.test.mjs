// The save that spent twenty minutes building a workbook.
//
// "Save to Veris Residential" on a 27-site upload sat at "Saving to Veris
// Residential… (1296s)" — the message set on the FIRST line of the save,
// before the workbook build starts — and was never going to move. 27 sites
// is a second of work, so nothing about the build was slow. It was stopped.
//
// Step 5 of the build reads the Utility Name Mapping table so the three
// Utility Mapping sheets can classify each site's electric utility:
//
//   const savedNameMap = await loadListFromIDB(NAME_MAP_LIST_KEY);
//
// That reads IndexedDB — but a browser that has never held the list falls
// through to the list's Firestore backup, and THAT is a getDoc on a
// document which by definition is not in the local cache. A getDoc with
// nothing cached and no route to firestore.googleapis.com does not fail:
// it sits pending for the life of the tab (see utils/withTimeout). So an
// optional enrichment for three sheets out of thirteen held the whole save
// — analysis, site list, company stamp — behind a promise that would never
// settle, under a status line with nothing to say about it.
//
// What this pins down: that read hangs (rather than failing) on the path
// the export takes, and a ceiling turns it back into a bounded miss the
// export can carry on past.
//
// Run: node scripts/nameMapReadTimeout.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { setDbUserId } = await import('../src/utils/db.js');
const { loadList } = await import('../src/utils/uploadedListStore.js');
const { withTimeout, isTimeoutError } = await import('../src/utils/withTimeout.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// The key SitesView's Master Analysis build reads at step 5.
const KEY = 'utility-name-map-list-override';
const BACKUP = `listBackups/${KEY}`;
// No indexedDB and no localStorage in Node, which is exactly the shape of
// the browser case that matters: IDB holds nothing for this key, so the
// read falls through to the Firestore backup.
setDbUserId('uid-1');

// Did `p` settle within `ms`? Returns the outcome, or 'pending'.
const settledWithin = (p, ms) => Promise.race([
  p.then((value) => ({ state: 'resolved', value }), (err) => ({ state: 'rejected', err })),
  new Promise((resolve) => setTimeout(() => resolve({ state: 'pending' }), ms)),
]);

// ── The hang ───────────────────────────────────────────────────────────
{
  fs.reset();
  fs.hangOn(BACKUP, 'getDoc');
  const read = loadList(KEY);
  // Swallow the rejection this promise will never have, so leaving it
  // pending can't trip an unhandled-rejection warning later.
  read.catch(() => {});
  const outcome = await settledWithin(read, 150);
  ok(outcome.state === 'pending',
    'an IDB miss whose Firestore backup never answers leaves the read pending — it does not fail');
  ok(fs.calls.some((c) => c.op === 'getDoc' && c.path === BACKUP),
    'and the call it is stuck on is the backup read, not IndexedDB');
}

// ── The ceiling ────────────────────────────────────────────────────────
{
  fs.reset();
  fs.hangOn(BACKUP, 'getDoc');
  const read = loadList(KEY);
  read.catch(() => {});
  const outcome = await settledWithin(
    withTimeout(read, 60, 'reading the Utility Name Mapping table'),
    400,
  );
  ok(outcome.state === 'rejected', 'under a ceiling the same read settles');
  ok(isTimeoutError(outcome.err), 'as a TimeoutError the build can catch');
  ok(outcome.err?.label === 'reading the Utility Name Mapping table',
    'naming the step, so the save can say which one it gave up on');
}

// ── A backup that answers still comes back ─────────────────────────────
//
// The ceiling must not cost the restore its whole reason for existing: a
// browser that has never held the list, on a working connection, still
// gets it from Firestore.
{
  fs.reset();
  fs.store.set(BACKUP, { json: JSON.stringify([{ name: 'Con Edison', mappedTo: 'ConEd' }]) });
  const outcome = await settledWithin(
    withTimeout(loadList(KEY), 200, 'reading the Utility Name Mapping table'),
    400,
  );
  ok(outcome.state === 'resolved', 'a backup that answers is not cut off by the ceiling');
  ok(Array.isArray(outcome.value) && outcome.value[0]?.name === 'Con Edison',
    'and the list comes back intact');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
