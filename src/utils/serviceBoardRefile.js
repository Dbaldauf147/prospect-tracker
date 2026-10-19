// Putting services back in their boxes from a backup, for the "Refile from
// backups" button on Dropdowns › Services › Edit buckets.
//
// A service that falls out of every box lands on the "Other services" card,
// and nothing on the board remembers where it used to be. The backups do:
// every browser backup and nightly cloud backup carries the whole board
// layout (settings.customServiceCategories). So for each service on the
// card, the newest backup that had it filed says which box it goes back to.
//
// Only the services currently in no box are looked up. Anything the user has
// filed since stays exactly where it is, so this can't undo deliberate moves.
//
// The plan is pure data so it can be tested without a backup store; the
// component fetches the backups (settingsBackupSources) and shows the plan
// for the user to tick through before anything is written.

import { moveServiceToBucket, serviceBucketOf } from './serviceCategoriesStore.js';
import { SERVICE_RENAME_LOG_KEY } from './serviceNameMerges.js';

const norm = s => String(s ?? '').trim().toLowerCase();

// The stored board layout in a backup's settings, or null. A backup with no
// stored layout was showing the seed, which is not a record of where the
// user had anything, so it is skipped rather than read as one.
export function backupLayout(data) {
  const cats = data?.customServiceCategories;
  return Array.isArray(cats) && cats.length ? cats : null;
}

// Every name `name` has been known by, newest first, following the rename
// log back: a service renamed since the backup was taken sits in it under
// the old name.
function namesOf(name, settings) {
  const log = Array.isArray(settings?.[SERVICE_RENAME_LOG_KEY]) ? settings[SERVICE_RENAME_LOG_KEY] : [];
  const out = [name];
  const seen = new Set([norm(name)]);
  for (let i = 0; i < out.length; i += 1) {
    for (const e of log) {
      if (!e || norm(e.to) !== norm(out[i]) || !String(e.from || '').trim()) continue;
      if (seen.has(norm(e.from))) continue;
      seen.add(norm(e.from));
      out.push(e.from);
    }
  }
  return out;
}

/**
 * Where each of `names` was last filed, against `sources` ([{ label, data }],
 * newest first, data being a settings backup).
 *
 * Returns { found: [{ name, bucket, label, newBucket }], missing: [name] }.
 * `bucket` is matched to the current layout's own spelling of the box when
 * it still exists; `newBucket` says the box is gone and refiling brings it
 * back. A name no backup ever had in a box is in `missing`.
 */
export function planBoardRefile(settings, categories, names, sources) {
  const found = [];
  const missing = [];
  for (const name of names || []) {
    const aliases = namesOf(name, settings);
    let hit = null;
    for (const src of sources || []) {
      const layout = backupLayout(src?.data);
      if (!layout) continue;
      for (const alias of aliases) {
        const bucket = serviceBucketOf(layout, alias);
        if (bucket) { hit = { bucket, label: src.label }; break; }
      }
      if (hit) break;
    }
    if (!hit) { missing.push(name); continue; }
    const live = (categories || []).find(c => norm(c.name) === norm(hit.bucket));
    found.push({ name, bucket: live ? live.name : hit.bucket, label: hit.label, newBucket: !live });
  }
  return { found, missing };
}

// The layout with each pick filed into its box, or null when nothing moved.
// A box that no longer exists is added on the end, as moveServiceToBucket
// does for any bucket name it doesn't know.
export function applyBoardRefile(categories, picks, renames) {
  let next = categories;
  let moved = false;
  for (const p of picks || []) {
    const after = moveServiceToBucket(next, p.name, p.bucket, renames);
    if (after) { next = after; moved = true; }
  }
  return moved ? next : null;
}
