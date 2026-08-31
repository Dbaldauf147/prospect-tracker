// Every browser-only store either syncs to Firestore or says why it doesn't.
//
// The failure this exists to prevent has already happened. On 28 Aug 2026 a
// "clear cookies and site data" destroyed the Deals roster outright: it lived
// in localStorage and nowhere else, so there was no copy to restore from. The
// four backup layers in the app all cover the userSettings DOCUMENT, and the
// roster was never in it.
//
// The roster was never a considered decision. The commit that built the Deals
// tab (6036a446, 12 May 2026) says it "follows the RA Clients pattern" — and
// that pattern had ALREADY been fixed elsewhere eleven days earlier, when
// b27dd251 gave the Lists tab a Firestore backup "so a Clear Site Data can't
// lose it". A stale pattern got cloned, nothing flagged it, and the gap sat
// there for three months until it cost a day's work to find out.
//
// So this is a scan, not a unit test. A new store that persists to
// localStorage or IndexedDB and neither keeps a cloud copy nor is listed
// below fails the build, and whoever adds it has to make the call on
// purpose.
//
// "Keeps a cloud copy" is two things: registering with localMirrorSync
// (the small keyed stores), or writing its own Firestore documents (the
// big ones, through utils/chunkedDoc). Both are detected, so a store that
// does either needs no entry in the lists below.
//
// Run: node scripts/mirroredStores.test.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UTILS = fileURLToPath(new URL('../src/utils/', import.meta.url));

// Infrastructure, not stores: these implement the persistence the scan is
// looking for, so they always "call" it.
const INFRASTRUCTURE = new Set(['userLs.js', 'db.js', 'localMirrorSync.js']);

// Stores that persist locally ON PURPOSE. A reason is required — the point
// of the list is that the decision is written down, not that the file is
// silenced. Keep these honest: if a reason stops being true, mirror it.
const LOCAL_BY_DESIGN = {
  // Caches. The real copy is server-side; losing these costs a refetch.
  'callHistoryCache.js': 'cache — the call history itself is one document per call in Firestore',
  'hubspotContactsCache.js': 'cache — refetched from HubSpot',

  // Backup layers. Mirroring a backup to the cloud defeats its purpose:
  // these exist to survive a bad cloud write, not to be one.
  'settingsBackup.js': 'IS the local backup layer for userSettings',
  'opps2Backup.js': 'IS the local rolling backup for the Opps 2 blob',

  // Cannot meaningfully leave this browser.
  'localRecordings.js': 'holds a FileSystemDirectoryHandle — not serialisable, and machine-specific',
  'nfatSchedules.js':
    'the schedules themselves live on userSettings (Firestore); the only key written here is '
    + "this browser's shadow copy of the newest config it has seen, which exists to REPAIR that "
    + 'document. Mirroring a repair shadow would let it repair itself and defeat the check.',

  // Transient queues, emptied in the same session they are filled.
  'draftCampaignQueue.js': 'session-scoped queue for the Draft Emails page',
  'draftLeadsQueue.js': 'session-scoped queue for the Draft Emails page',
  'draftRecipientsQueue.js': 'session-scoped queue for the Draft Emails page',

  // Per-browser view preferences. Cheap to redo, and arguably SHOULD differ
  // between a laptop and an external monitor.
  'stageTableColumns.js': 'per-browser column layout',
  'yoyHiddenChartsStore.js': 'per-browser chart visibility',

  // Not a store: helpers that write through to other stores' keys.
  'companyRenameCascade.js': 'rename helper — writes through the stores it cascades into',
  'fullBackup.js': 'IS the export/restore path — it reads and writes every other store by definition',
};

// Should have a cloud copy and does not. Listed rather than ignored so the
// debt is visible on every run; the scan reports these but does not fail
// on them.
//
// Empty, as of the commit that gave the captured Quoted Projections rows,
// the Market Update attachments and the saved SIA workbooks a chunked
// Firestore copy. Anything added here should be a deliberate, temporary
// admission — not a resting place.
const KNOWN_GAPS = {};

let passed = 0, failed = 0;
function ok(cond, name, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

const files = readdirSync(UTILS).filter((f) => f.endsWith('.js') && !INFRASTRUCTURE.has(f));
const read = (f) => readFileSync(join(UTILS, f), 'utf8');
const source = new Map(files.map((f) => [f, read(f)]));

// A file persists to the browser if it writes a user-scoped localStorage key
// or an IndexedDB record. Both are wiped by "clear cookies and site data".
const persistsLocally = (src) =>
  /\buserLsSet\s*\(/.test(src) || /\bdbPut\s*\(/.test(src) || /\bmirrorDbPut\s*\(/.test(src)
  // uploadedListStore opens its own database rather than going through
  // db.js, and was invisible to this scan until this line.
  || /\bindexedDB\.open\s*\(/.test(src);
const isMirrored = (src) => /\bregisterMirroredKey\s*\(|\bregisterMirroredDbKey\s*\(/.test(src);
// A store that writes its own Firestore documents rather than registering
// a mirrored key — the payloads too big for one, which go through
// utils/chunkedDoc (or, for the uploaded lists, listBackupSync).
const keepsOwnCloudCopy = (src) =>
  /from '(firebase\/firestore|\.\.\/firebase)'/.test(src)
  || /from '\.\/(chunkedDoc|listBackupSync)(\.js)?'/.test(src);

const local = files.filter((f) => persistsLocally(source.get(f)));
const mirrored = local.filter((f) => isMirrored(source.get(f)));
const cloudBacked = local.filter((f) => isMirrored(source.get(f)) || keepsOwnCloudCopy(source.get(f)));

// ── 1. Nothing persists locally without a decision ─────────────────────
const undeclared = local.filter(
  (f) => !cloudBacked.includes(f) && !(f in LOCAL_BY_DESIGN) && !(f in KNOWN_GAPS),
);
ok(
  undeclared.length === 0,
  'every browser-only store keeps a cloud copy, or is listed with a reason',
  undeclared.length === 0 ? '' :
    `${undeclared.join(', ')}\n        `
    + 'This store keeps data only in the browser, where "clear cookies and site data" destroys it.\n        '
    + 'Either register it with localMirrorSync (see dealsStore.js), or add it to LOCAL_BY_DESIGN\n        '
    + 'in this file with a reason it is safe to lose.',
);

// ── 2. A mirrored store is useless unless hydration loads it ───────────
//
// Keys register at import time, so hydrateLocalMirrors force-imports each
// store. A store missing from that list registers nothing at signin, and a
// cleared browser restores nothing from it — silently, because the push side
// still works from the page that owns the store.
const hydrateSrc = readFileSync(join(UTILS, 'localMirrorSync.js'), 'utf8');
// The force-imports live in loadMirroredStores, which both hydration and the
// full-backup restore call. Slice from there rather than from
// hydrateLocalMirrors, which now delegates to it.
const hydrateBody = hydrateSrc.slice(hydrateSrc.indexOf('async function loadMirroredStores'));
const hydrateImports = new Set(
  [...hydrateBody.matchAll(/import\(\s*'\.\/([A-Za-z0-9_]+)(?:\.js)?'\s*\)/g)].map((m) => `${m[1]}.js`),
);
const notHydrated = mirrored.filter((f) => !hydrateImports.has(f));
ok(
  notHydrated.length === 0,
  'every mirrored store is force-imported by hydrateLocalMirrors',
  notHydrated.length === 0 ? '' :
    `${notHydrated.join(', ')}\n        `
    + 'Add it to the Promise.all([...]) in hydrateLocalMirrors, or its key never registers\n        '
    + 'at signin and a cleared browser will not restore it.',
);

// ── 3. The lists stay honest ───────────────────────────────────────────
const stale = [...Object.keys(LOCAL_BY_DESIGN), ...Object.keys(KNOWN_GAPS)]
  .filter((f) => !local.includes(f));
ok(
  stale.length === 0,
  'no stale entries in LOCAL_BY_DESIGN / KNOWN_GAPS',
  stale.length === 0 ? '' :
    `${stale.join(', ')} — no longer persists locally (or was renamed/deleted). Remove the entry.`,
);

const contradiction = cloudBacked.filter((f) => f in LOCAL_BY_DESIGN || f in KNOWN_GAPS);
ok(
  contradiction.length === 0,
  'no store is both backed up and listed as not backed up',
  contradiction.length === 0 ? '' : `${contradiction.join(', ')} — now has a cloud copy, so remove the entry.`,
);

// ── Report ─────────────────────────────────────────────────────────────
console.log(
  `\n${mirrored.length} mirrored · ${cloudBacked.length - mirrored.length} keep their own cloud copy`
  + ` · ${Object.keys(LOCAL_BY_DESIGN).length} local by design · ${Object.keys(KNOWN_GAPS).length} known gaps`,
);
if (Object.keys(KNOWN_GAPS).length) {
  console.log('\nKnown gaps — no cloud copy; a downloaded full backup is the only one:');
  for (const [file, why] of Object.entries(KNOWN_GAPS)) console.log(`  ${file}\n      ${why}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
