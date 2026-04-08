import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeToProspects, addProspect as addDoc, updateProspect as updateDoc, deleteProspect as deleteDoc, seedProspects, replaceAllProspects, setProspectsUserId } from '../utils/firestoreSync';
import seedData from '../data/seedProspects';

export function useProspects(user) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seededRef = useRef(false);
  const pausedRef = useRef(false);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (!user) { setProspects([]); setLoading(false); setProspectsUserId(null); return; }
    setProspectsUserId(user.uid);

    async function init() {
      try {
        if (!seededRef.current) {
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

  return { prospects, loading, error, addProspect, updateProspect, deleteProspect, replaceAll };
}
