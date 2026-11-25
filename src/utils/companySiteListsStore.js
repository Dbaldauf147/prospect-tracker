// Per-company site lists, one Firestore document each.
//
// These used to live as a single `companySiteLists` map on the one
// userSettings document. A site list is a whole spreadsheet — every
// uploaded row, plus the analysis columns "Save to <company>" appends —
// so a handful of portfolios filled that document's 1 MiB budget, and
// once it was full EVERY settings write started failing, not just the
// site-list ones:
//
//   Document 'userSettings/…' cannot be written because its size
//   (1,060,683 bytes) exceeds the maximum allowed size of 1,048,576 bytes.
//
// Each company now gets its own document under
// `userSettings/{uid}/companySiteLists/{slug}`, so the cap applies per
// company rather than across all of them, and the settings document goes
// back to holding only small things. Callers are unchanged:
// subscribeToUserSettings folds these back in as
// `settings.companySiteLists`, and writes aimed at that key (or at a
// `companySiteLists.<slug>` path) are routed here.

import { clearLocalOnly, errorText, markLocalOnly } from './localOnlyFiles.js';
import { siteListBytes, SITE_LIST_LIMIT_BYTES } from './siteListSize.js';
import {
  collection, doc, deleteDoc, deleteField, getDoc, getDocs, runTransaction, setDoc, updateDoc,
} from 'firebase/firestore';
import { onSnapshot } from './safeOnSnapshot';
import { db } from '../firebase';
import {
  dottedFieldEntries, restDeleteDoc, restGetDoc, restListDocs, restSetDoc, restUpdateFields,
} from './firestoreRest.js';
import { viaSdkOrRest } from './firestoreClientHealth.js';
import { SITE_LISTS_KEY, isStorableSlug } from './companySiteListRouting';
import { foldSiteListDocs, partCountOf, partDocId, partOwner, splitSiteListEntry } from './siteListParts.js';

const COL = 'userSettings';

// Re-exported so the sync layer has one import for all of this.
export {
  SITE_LISTS_KEY, isStorableSlug, slugsForOps, splitSiteListPaths, splitSiteListUpdates,
} from './companySiteListRouting';

function listsCol(userId) {
  return collection(db, COL, userId, SITE_LISTS_KEY);
}

function listDoc(userId, slug) {
  return doc(db, COL, userId, SITE_LISTS_KEY, slug);
}

// The same two, as paths for the HTTPS fallback below.
const listColPath = (userId) => `${COL}/${userId}/${SITE_LISTS_KEY}`;
const listDocPath = (userId, slug) => `${listColPath(userId)}/${slug}`;

// A field name nothing stores, so a listing can ask for ids without
// downloading every company's rows to find out which slugs exist.
const NO_FIELDS = ['_idsOnly'];

// Every read and write below goes through viaSdkOrRest, which falls back to
// plain HTTPS once the Firestore SDK has crashed its own async queue.
//
// "Save to <company>" writes the company's site list here, and this was the
// one step of that save with no way round a crashed client: it threw the
// internal assertion before the settings write it sits in front of ever ran,
// so the whole save was lost and the user was told the fallback had failed
// when nothing had tried one. See utils/firestoreClientHealth.
//
// The transaction in migrateCompanySiteLists is deliberately not wrapped: it
// is a read-and-conditional-write with no honest one-request equivalent, and
// it only runs off a snapshot — which a crashed client never delivers.

// Live view of every company's list, as the same slug → entry map the
// settings key always exposed.
export function subscribeToCompanySiteLists(userId, onChange, onError) {
  return onSnapshot(listsCol(userId), (snap) => {
    const docs = {};
    snap.forEach((d) => { docs[d.id] = d.data(); });
    // A list too big for one document is stored in parts (siteListParts);
    // callers get it back whole.
    onChange(foldSiteListDocs(docs));
  }, (err) => {
    console.error('companySiteLists subscription error:', err);
    onError?.(err);
  });
}

// The stored entries for specific companies (or all of them, when
// `slugs` is null). Used on the stale-write path so the auto-merge in
// useUserSettings still sees what the other device wrote.
export async function readCompanySiteLists(userId, slugs = null) {
  const docs = {};
  if (slugs == null) {
    await viaSdkOrRest(async () => {
      const snap = await getDocs(listsCol(userId));
      snap.forEach((d) => { docs[d.id] = d.data(); });
    }, async () => {
      for (const { id, data } of await restListDocs(listColPath(userId))) docs[id] = data;
    });
    return foldSiteListDocs(docs);
  }
  const wanted = [...new Set(slugs)].filter(isStorableSlug);
  await Promise.all(wanted.map(async (slug) => {
    const data = await readListDoc(userId, slug);
    if (!data) return;
    docs[slug] = data;
    const ids = Array.from({ length: partCountOf(data) }, (_, i) => partDocId(slug, i));
    await Promise.all(ids.map(async (id) => {
      const part = await readListDoc(userId, id);
      if (part) docs[id] = part;
    }));
  }));
  return foldSiteListDocs(docs);
}

// One document in the collection, or null when it does not exist.
async function readListDoc(userId, id) {
  return viaSdkOrRest(async () => {
    const snap = await getDoc(listDoc(userId, id));
    return snap.exists() ? snap.data() : null;
  }, () => restGetDoc(listDocPath(userId, id)));
}

const setListDoc = (userId, id, data) => viaSdkOrRest(
  () => setDoc(listDoc(userId, id), data),
  () => restSetDoc(listDocPath(userId, id), data),
);
const deleteListDoc = (userId, id) => viaSdkOrRest(
  () => deleteDoc(listDoc(userId, id)),
  () => restDeleteDoc(listDocPath(userId, id)),
);

// Store one company's list, in parts when it is too big for one document
// (siteListParts). The parts go first and the company's own document last,
// since that is what says which parts belong to it; then any parts left
// over from a bigger list before are removed. `previousParts` is how many
// the stored list had, when the caller already knows (a replace-all has
// just listed them); otherwise it is read.
async function writeSiteList(userId, slug, entry, previousParts = null) {
  const before = previousParts ?? partCountOf(await readListDoc(userId, slug));
  const { main, parts } = splitSiteListEntry(slug, entry);
  for (let i = 0; i < parts.length; i += 1) await setListDoc(userId, partDocId(slug, i), parts[i]);
  await setListDoc(userId, slug, main);
  for (let i = parts.length; i < before; i += 1) await deleteListDoc(userId, partDocId(slug, i));
}

// Remove one company's list and any parts it was stored in.
async function deleteSiteList(userId, slug) {
  const before = partCountOf(await readListDoc(userId, slug));
  await deleteListDoc(userId, slug);
  for (let i = 0; i < before; i += 1) await deleteListDoc(userId, partDocId(slug, i));
}

// Apply the operations produced by splitSiteListUpdates / splitSiteListPaths.
//
//   { slug, value }        replace that company's list (null deletes it)
//   { slug, paths }        patch dotted fields inside one company's list
//   { replaceAll: map }    the whole key was written: every company in the
//                          map is stored and any company absent from it is
//                          dropped, which is what writing the top-level key
//                          used to do (a settings restore relies on it)
//
// Sequential rather than batched on purpose: a single list can run to
// several hundred KB and a batch commit caps at 10 MiB, so a restore of a
// large portfolio would fail as one write where it succeeds as many.
export async function applySiteListOps(userId, ops) {
  for (const op of ops) {
    if (op.replaceAll) {
      await viaSdkOrRest(
        () => replaceAllViaSdk(userId, op.replaceAll),
        () => replaceAllViaRest(userId, op.replaceAll),
      );
      continue;
    }
    if (!isStorableSlug(op.slug)) {
      console.warn('companySiteLists: skipping unstorable slug', op.slug);
      continue;
    }
    if (op.paths) {
      try {
        await viaSdkOrRest(
          () => patchViaSdk(listDoc(userId, op.slug), op.paths),
          // No not-found branch to mirror: a masked PATCH creates the
          // document when it is absent, which is what the SDK needed two
          // calls to do.
          () => restUpdateFields(listDocPath(userId, op.slug), dottedFieldEntries(op.paths)),
        );
        clearLocalOnly(`siteList:${op.slug}`);
      } catch (err) {
        markLocalOnly(`siteList:${op.slug}`, { kind: 'siteList', reason: 'backup-failed', owner: op.slug, error: errorText(err) });
        throw err;
      }
    } else if (op.value == null) {
      await deleteSiteList(userId, op.slug);
      clearLocalOnly(`siteList:${op.slug}`);
    } else {
      try {
        await writeSiteList(userId, op.slug, op.value);
        clearLocalOnly(`siteList:${op.slug}`);
      } catch (err) {
        // The save alerts; this keeps a row on the Issues tab after the
        // alert is gone, since the list is now only in the open tab.
        const bytes = siteListBytes(op.value);
        markLocalOnly(`siteList:${op.slug}`, {
          kind: 'siteList',
          reason: bytes >= SITE_LIST_LIMIT_BYTES ? 'too-big' : 'backup-failed',
          name: op.value?.fileName, sizeBytes: bytes, limitBytes: SITE_LIST_LIMIT_BYTES,
          owner: op.value?.company || op.slug, error: errorText(err),
        });
        throw err;
      }
    }
  }
}

// Patch dotted fields inside one company's list.
async function patchViaSdk(ref, paths) {
  const patch = {};
  for (const [path, value] of Object.entries(paths)) {
    patch[path] = value == null ? deleteField() : value;
  }
  try {
    await updateDoc(ref, patch);
  } catch (err) {
    // No document yet: build the nested shape and create it. Deletes
    // have nothing to delete from, so they simply drop out.
    if (err?.code !== 'not-found') throw err;
    const nested = {};
    for (const [path, value] of Object.entries(paths)) {
      if (value == null) continue;
      const parts = path.split('.');
      let cur = nested;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    }
    if (Object.keys(nested).length) await setDoc(ref, nested);
  }
}

// The whole key was written: store every company in the map and drop any
// company absent from it.
// Both transports share this; they differ only in how the stored ids are
// listed. A part document goes with its company: kept when the company is,
// and a kept company's own parts are trimmed by writeSiteList.
async function replaceAll(userId, map, existingIds) {
  const keep = new Set(Object.keys(map).filter(isStorableSlug));
  for (const [slug, entry] of Object.entries(map)) {
    if (!isStorableSlug(slug) || !entry || typeof entry !== 'object') continue;
    // Counted from the listing rather than read: a part the stored list no
    // longer points at is cleared too.
    await writeSiteList(userId, slug, entry, maxPartIndex(existingIds, slug));
  }
  for (const id of existingIds) {
    if (!keep.has(partOwner(id) || id)) await deleteListDoc(userId, id);
  }
}

// One past the highest part index stored for `slug`, from a listing of ids.
function maxPartIndex(ids, slug) {
  let n = 0;
  for (const id of ids) {
    if (partOwner(id) !== slug) continue;
    n = Math.max(n, Number(id.slice(id.lastIndexOf('-') + 1)) + 1);
  }
  return n;
}

async function replaceAllViaSdk(userId, map) {
  const existing = await getDocs(listsCol(userId));
  await replaceAll(userId, map, existing.docs.map(d => d.id));
}

async function replaceAllViaRest(userId, map) {
  // Ids only: the sweep needs to know which companies are stored, not what
  // is in them, and their rows are the largest thing this app holds.
  const existing = await restListDocs(listColPath(userId), { fieldPaths: NO_FIELDS });
  await replaceAll(userId, map, existing.map(d => d.id));
}

// Move a legacy `companySiteLists` map off the settings document.
//
// Every company is copied to its own document FIRST; only once they are
// stored is the field dropped. An interrupted run therefore leaves the
// same company in both places — which the subscription resolves in the
// subcollection's favour — rather than leaving a hole where a portfolio
// used to be.
export async function migrateCompanySiteLists(userId, legacyMap) {
  const kept = {};   // whatever could not be moved, left where it is
  let moved = 0;

  for (const [slug, entry] of Object.entries(legacyMap || {})) {
    if (!isStorableSlug(slug) || !entry || typeof entry !== 'object') {
      console.warn('companySiteLists: leaving an entry that cannot be stored on its own', slug);
      kept[slug] = entry;
      continue;
    }
    try {
      // Create-if-absent. A company already in the subcollection has the
      // newer copy — this device or another one has saved since the map
      // was read — and draining the old map must not write over it.
      await runTransaction(db, async (tx) => {
        const ref = listDoc(userId, slug);
        const snap = await tx.get(ref);
        if (!snap.exists()) tx.set(ref, entry);
      });
      moved += 1;
    } catch (err) {
      // One company that won't store (a list near the document cap all
      // by itself) must not strand every other company on a settings
      // document that is already too full to write. The rest still move;
      // this one stays where it is, where it is at least still readable.
      console.error(`companySiteLists: could not move "${slug}"`, err);
      kept[slug] = entry;
    }
  }

  if (!moved) return { moved: 0, kept: Object.keys(kept).length };
  await updateDoc(doc(db, COL, userId), {
    [SITE_LISTS_KEY]: Object.keys(kept).length ? kept : deleteField(),
  });
  console.log(`companySiteLists: moved ${moved} site list(s) off the settings document`
    + (Object.keys(kept).length ? `; ${Object.keys(kept).length} could not be moved` : ''));
  return { moved, kept: Object.keys(kept).length };
}

