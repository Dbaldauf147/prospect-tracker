import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeToProspects, addProspect as addDoc, updateProspect as updateDoc, deleteProspect as deleteDoc, seedProspects, replaceAllProspects, setProspectsUser, findDuplicateProspects, dedupeProspects } from '../utils/firestoreSync';
import seedData from '../data/seedProspects';

export function useProspects(user) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seededRef = useRef(false);
  const pausedRef = useRef(false);
  const unsubRef = useRef(null);
  const dedupeRanRef = useRef(false);

  useEffect(() => {
    if (!user) { setProspects([]); setLoading(false); setProspectsUser(null, null); return; }
    setProspectsUser(user.uid, user.email);
    dedupeRanRef.current = false; // re-arm the one-time cleanup for this user

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
        setProspects(data);
        setLoading(false);
      });
    }

    init();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [user]);

  // One-time automatic cleanup: once the collection has loaded, collapse
  // any duplicate prospect documents (same company stored twice). The
  // deletions stream back through the live subscription, so every page
  // that reads `prospects` self-heals without a manual step. No-ops when
  // there are no duplicates.
  useEffect(() => {
    if (loading || dedupeRanRef.current || !user) return;
    dedupeRanRef.current = true;
    (async () => {
      try {
        const result = await dedupeProspects();
        if (result.removed > 0) {
          console.log(`Auto-removed ${result.removed} duplicate prospect(s) across ${result.groups} compan${result.groups === 1 ? 'y' : 'ies'}`);
        }
      } catch (err) {
        console.warn('Auto de-dupe failed:', err.message);
      }
    })();
  }, [loading, user]);

  async function addProspect(prospect) {
    return addDoc(prospect);
  }

  async function updateProspect(id, updates) {
    return updateDoc(id, updates);
  }

  async function deleteProspect(id) {
    return deleteDoc(id);
  }

  const replaceAll = useCallback(async (newProspects, onProgress) => {
    const existingIds = prospects.map(p => p.id);
    // Pause the onSnapshot listener so batch writes don't trigger re-renders
    pausedRef.current = true;
    try {
      const result = await replaceAllProspects(existingIds, newProspects, onProgress);
      return result;
    } finally {
      // Resume listener — it will fire once with the final state
      pausedRef.current = false;
    }
  }, [prospects]);

  // Preview duplicate prospects (grouped by normalized company name)
  // without changing anything — used to confirm before cleanup.
  const findDuplicates = useCallback(() => findDuplicateProspects(), []);

  // Collapse duplicate prospects, keeping the richest record. The
  // onSnapshot listener stays live so the UI reflects the deletions as
  // they stream in.
  const dedupe = useCallback(() => dedupeProspects(), []);

  return { prospects, loading, error, addProspect, updateProspect, deleteProspect, replaceAll, findDuplicates, dedupe };
}
