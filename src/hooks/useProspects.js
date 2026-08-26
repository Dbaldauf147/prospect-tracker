import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeToProspects, addProspect as addDoc, updateProspect as updateDoc, deleteProspect as deleteDoc, seedProspects, reconcileAllProspects, setProspectsUser, findDuplicateProspects, dedupeProspects, groupDuplicateProspects, collapseDuplicateGroups, companyDedupeKey, readAllProspects } from '../utils/firestoreSync';
import { createAddProspectGuard } from '../utils/addProspectGuard';
import seedData from '../data/seedProspects';

// Local calendar date as YYYY-MM-DD. Used to stamp when a firm entered
// its current PE Stage (the PE Portfolio "Days in Stage" board diffs this
// against today). A plain date string keeps it easy to parse/compare with
// the shared oppsCallIn date helpers.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A promise plus its resolver, for "has the first snapshot arrived yet".
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

export function useProspects(user, { settingsLoaded = true, onDuplicatesCollapsed } = {}) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seededRef = useRef(false);
  const pausedRef = useRef(false);
  const unsubRef = useRef(null);
  const dedupeRanRef = useRef(false);
  // Keep the collapse callback in a ref so wiring it doesn't re-run (and
  // re-arm) the one-time auto-dedupe effect below.
  const onCollapseRef = useRef(onDuplicatesCollapsed);
  onCollapseRef.current = onDuplicatesCollapsed;
  // Always-current view of the loaded prospects so addProspect can check
  // for an existing record without a Firestore read.
  const prospectsRef = useRef([]);
  prospectsRef.current = prospects;
  // Resolves when the subscription has delivered at least once. The
  // duplicate check is only meaningful against a roster that has
  // actually arrived — before that the array is empty, and every add
  // reads as a company we don't have.
  const rosterReadyRef = useRef(null);
  if (!rosterReadyRef.current) rosterReadyRef.current = deferred();
  const addGuardRef = useRef(null);
  if (!addGuardRef.current) {
    addGuardRef.current = createAddProspectGuard({
      keyOf: (p) => companyDedupeKey(p?.company),
      getRoster: () => prospectsRef.current,
      whenRosterReady: () => rosterReadyRef.current.promise,
      readRoster: () => readAllProspects(),
      create: (record) => addDoc(record),
    });
  }

  useEffect(() => {
    if (!user) { setProspects([]); setLoading(false); setProspectsUser(null, null); return; }
    setProspectsUser(user.uid, user.email);
    dedupeRanRef.current = false; // re-arm the one-time cleanup for this user
    // A different account has a different roster, so the previous one's
    // "it has arrived" signal must not carry over.
    rosterReadyRef.current = deferred();

    async function init() {
      try {
        // Only seed the shared prospects collection (admin account). Other
        // users start with an empty per-user collection so they're not
        // surprised by 99 admin-owned companies.
        if (!seededRef.current && user.email === 'baldaufdan@gmail.com') {
          seededRef.current = true;
          const didSeed = await seedProspects(seedData);
          if (didSeed) console.log('Seeded', seedData.length, 'prospects');
        }
      } catch (err) {
        console.error('Seed error:', err);
        setError('Failed to seed data: ' + err.message);
      }

      // Subscribe to real-time updates
      unsubRef.current = subscribeToProspects((data) => {
        if (pausedRef.current) return; // Skip updates during bulk operations
        console.log('Firestore returned', data.length, 'prospects');
        prospectsRef.current = data;
        setProspects(data);
        setLoading(false);
        // Anything the roster now carries no longer needs remembering,
        // and adds waiting on the first delivery can go ahead.
        addGuardRef.current?.noteRoster(data);
        rosterReadyRef.current.resolve();
      });
    }

    init();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [user]);

  // any duplicate prospect documents (same company stored twice).
  // Detection runs against the already-subscribed list, so when the data
  // is clean (the normal case) this does ZERO Firestore reads/writes —
  // just an in-memory grouping. It only touches Firestore when actual
  // duplicates are found, and those deletions stream back through the
  // live subscription so every page self-heals without a manual step.
  //
  // Gate on settingsLoaded as well: collapsing a duplicate has to migrate
  // the loser's account-id-keyed settings (Target Account mappings, etc.)
  // onto the keeper, and that migration needs the loaded settings. Running
  // before settings arrive would delete the copy and drop its mapping with
  // no chance to move it.
  useEffect(() => {
    if (loading || !settingsLoaded || dedupeRanRef.current || !user) return;
    dedupeRanRef.current = true;
    const groups = groupDuplicateProspects(prospectsRef.current);
    if (groups.length === 0) return; // clean: no I/O
    (async () => {
      try {
        const result = await collapseDuplicateGroups(groups);
        if (result.removed > 0) {
          console.log(`Auto-removed ${result.removed} duplicate prospect(s) across ${result.groups} compan${result.groups === 1 ? 'y' : 'ies'}`);
        }
        if (result.remaps?.length && onCollapseRef.current) onCollapseRef.current(result.remaps);
      } catch (err) {
        console.warn('Auto de-dupe failed:', err.message);
      }
    })();
  }, [loading, settingsLoaded, user]);

  async function addProspect(prospect) {
    // Idempotent by company: if a prospect with the same dedupe key
    // already exists, return it instead of minting a duplicate. Uses
    // companyDedupeKey so a regional variant like "Brookfield (Dubai)" is
    // NOT treated as the same company as "Brookfield (NAM Multifamily)"
    // or a bare "Brookfield".
    //
    // The guard owns the timing (see utils/addProspectGuard): it waits
    // for the roster to have arrived before deciding, and remembers what
    // it has created until the roster confirms it. Checking the
    // subscription's array directly was wrong twice over — that array is
    // empty before the first snapshot, and stale for a moment after
    // every write, so a bulk add could create the same company twice.
    return addGuardRef.current.add(prospect);
  }

  async function updateProspect(id, updates) {
    let patch = updates;
    // When a firm's PE Stage changes, stamp the date it entered the new
    // stage so the PE Portfolio "Days in Stage" board can measure how long
    // it's been there. Only re-stamp on an actual change (comparing against
    // the last-synced value) — the prospect modal auto-saves the whole
    // record every edit, so most updates carry an unchanged peStage (and a
    // stale peStageEnteredAt echoed from the record) that must pass through
    // untouched. On a real change we overwrite peStageEnteredAt regardless
    // of what the caller folded in. Clearing the stage clears the date.
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'peStage')) {
      const current = prospectsRef.current.find(p => p.id === id);
      const nextStage = String(patch.peStage || '').trim();
      const prevStage = String(current?.peStage || '').trim();
      if (nextStage !== prevStage) {
        patch = { ...patch, peStageEnteredAt: nextStage ? todayISO() : '' };
      } else if (Object.prototype.hasOwnProperty.call(patch, 'peStageEnteredAt')) {
        // Stage unchanged: drop any peStageEnteredAt the caller folded in
        // (the modal echoes the record's — possibly stale — value on every
        // auto-save) so it can't overwrite the authoritative stored date.
        patch = { ...patch };
        delete patch.peStageEnteredAt;
      }
    }
    return updateDoc(id, patch);
  }

  async function deleteProspect(id) {
    return deleteDoc(id);
  }

  // Make the roster match an uploaded file. `confirm` is handed the
  // counts before anything is written (see reconcileAllProspects) so the
  // user approves the real plan, not an estimate.
  const reconcileAll = useCallback(async (newProspects, { onProgress, confirm } = {}) => {
    // Pause the onSnapshot listener so batch writes don't trigger re-renders
    pausedRef.current = true;
    try {
      const result = await reconcileAllProspects(newProspects, { onProgress, confirm });
      // Records that were already duplicates of each other lost one copy;
      // move its id-keyed settings onto the survivor rather than leaving
      // them pointed at a document that no longer exists.
      if (result?.remaps?.length && onCollapseRef.current) onCollapseRef.current(result.remaps);
      return result;
    } finally {
      // Resume listener — it will fire once with the final state
      pausedRef.current = false;
    }
  }, []);

  // Preview duplicate prospects (grouped by normalized company name)
  // without changing anything — used to confirm before cleanup.
  const findDuplicates = useCallback(() => findDuplicateProspects(), []);

  // Collapse duplicate prospects, keeping the richest record. The
  // onSnapshot listener stays live so the UI reflects the deletions as
  // they stream in.
  const dedupe = useCallback(async () => {
    const result = await dedupeProspects();
    if (result?.remaps?.length && onCollapseRef.current) onCollapseRef.current(result.remaps);
    return result;
  }, []);

  return { prospects, loading, error, addProspect, updateProspect, deleteProspect, reconcileAll, findDuplicates, dedupe };
}
