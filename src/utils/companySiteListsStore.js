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

import {
  collection, doc, deleteDoc, deleteField, getDoc, getDocs, onSnapshot, runTransaction, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  dottedFieldEntries, restDeleteDoc, restGetDoc, restListDocs, restSetDoc, restUpdateFields,
} from './firestoreRest.js';
import { isClientWedged, isClientWedgedError, noteClientWedged } from './firestoreClientHealth.js';
import { SITE_LISTS_KEY, isStorableSlug } from './companySiteListRouting';

const COL = 'userSettings';

// ── Going around a crashed SDK ─────────────────────────────────────────
//
// The Firestore client can kill its own async queue mid-session (see
// utils/firestoreClientHealth), and from then on every call in the tab
// rejects with an internal assertion. Saving a company from the Utility
// Look Up page writes one of these documents, so that save used to die
// with the message that there was no fallback either — the settings
// document had an HTTPS fallback and the site lists did not.
//
// Every operation below is one document read, write or delete, and each
// has an exact one-request REST equivalent, so there is nothing here that
// has to go through the SDK. `sdkOrRest` runs the SDK version unless the
// client is already known to be dead, and takes the assertion as the cue
// to switch for the rest of the tab.
async function sdkOrRest(sdk, rest) {
  if (isClientWedged()) return { value: await rest(), viaRest: true };
  try {
    return { value: await sdk(), viaRest: false };
  } catch (err) {
    if (!isClientWedgedError(err)) throw err;
    noteClientWedged(err);
    return { value: await rest(), viaRest: true };
  }
}

const listsPath = (userId) => `${COL}/${userId}/${SITE_LISTS_KEY}`;
const listPath = (userId, slug) => `${listsPath(userId)}/${slug}`;

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

// Live view of every company's list, as the same slug → entry map the
// settings key always exposed.
export function subscribeToCompanySiteLists(userId, onChange, onError) {
  return onSnapshot(listsCol(userId), (snap) => {
    const out = {};
    snap.forEach((d) => { out[d.id] = d.data(); });
    onChange(out);
  }, (err) => {
    console.error('companySiteLists subscription error:', err);
    onError?.(err);
  });
}

// The stored entries for specific companies (or all of them, when
// `slugs` is null). Used on the stale-write path so the auto-merge in
// useUserSettings still sees what the other device wrote.
export async function readCompanySiteLists(userId, slugs = null) {
  const out = {};
  if (slugs == null) {
    const { value } = await sdkOrRest(
      async () => {
        const snap = await getDocs(listsCol(userId));
        return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      },
      () => restListDocs(listsPath(userId)),
    );
    for (const d of value) out[d.id] = d.data;
    return out;
  }
  const wanted = [...new Set(slugs)].filter(isStorableSlug);
  await Promise.all(wanted.map(async (slug) => {
    const { value } = await sdkOrRest(
      async () => {
        const snap = await getDoc(listDoc(userId, slug));
        return snap.exists() ? snap.data() : null;
      },
      () => restGetDoc(listPath(userId, slug)),
    );
    if (value) out[slug] = value;
  }));
  return out;
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
//
// Returns { viaRest }: true when the SDK had crashed and any part of this
// went over plain HTTPS instead, so the save that called it can tell the
// user the tab needs reloading even though their work landed.
export async function applySiteListOps(userId, ops) {
  let viaRest = false;
  // Each operation reports whether it had to go around the SDK; one that
  // did is enough to make the whole save a fallback save.
  const run = async (sdk, rest) => {
    const result = await sdkOrRest(sdk, rest);
    if (result.viaRest) viaRest = true;
    return result.value;
  };

  for (const op of ops) {
    if (op.replaceAll) {
      const map = op.replaceAll;
      const existing = await run(
        async () => {
          const snap = await getDocs(listsCol(userId));
          return snap.docs.map((d) => d.id);
        },
        // Ids only: this listing decides which companies to DELETE, and
        // downloading every stored portfolio to answer that would be a
        // few megabytes to learn a handful of slugs.
        async () => (await restListDocs(listsPath(userId), { idsOnly: true })).map((d) => d.id),
      );
      const keep = new Set(Object.keys(map).filter(isStorableSlug));
      for (const [slug, entry] of Object.entries(map)) {
        if (!isStorableSlug(slug) || !entry || typeof entry !== 'object') continue;
        await run(
          () => setDoc(listDoc(userId, slug), entry),
          () => restSetDoc(listPath(userId, slug), entry),
        );
      }
      for (const slug of existing) {
        if (keep.has(slug)) continue;
        await run(
          () => deleteDoc(listDoc(userId, slug)),
          () => restDeleteDoc(listPath(userId, slug)),
        );
      }
      continue;
    }
    if (!isStorableSlug(op.slug)) {
      console.warn('companySiteLists: skipping unstorable slug', op.slug);
      continue;
    }
    const ref = listDoc(userId, op.slug);
    if (op.paths) {
      const patch = {};
      for (const [path, value] of Object.entries(op.paths)) {
        patch[path] = value == null ? deleteField() : value;
      }
      await run(
        async () => {
          try {
            await updateDoc(ref, patch);
          } catch (err) {
            // No document yet: build the nested shape and create it. Deletes
            // have nothing to delete from, so they simply drop out.
            if (err?.code !== 'not-found') throw err;
            const nested = {};
            for (const [path, value] of Object.entries(op.paths)) {
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
        },
        // A masked PATCH needs no not-found branch of its own: it creates
        // the document when it is missing, and a null value is a field
        // delete, which is what deleteField() spells above.
        () => restUpdateFields(listPath(userId, op.slug), dottedFieldEntries(op.paths)),
      );
    } else if (op.value == null) {
      await run(
        () => deleteDoc(ref),
        () => restDeleteDoc(listPath(userId, op.slug)),
      );
    } else {
      await run(
        () => setDoc(ref, op.value),
        () => restSetDoc(listPath(userId, op.slug), op.value),
      );
    }
  }
  return { viaRest };
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

