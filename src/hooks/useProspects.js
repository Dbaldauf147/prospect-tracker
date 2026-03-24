import { useState, useEffect, useRef } from 'react';
import { subscribeToProspects, addProspect as addDoc, updateProspect as updateDoc, deleteProspect as deleteDoc, seedProspects } from '../utils/firestoreSync';
import seedData from '../data/seedProspects';

export function useProspects(user) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!user) { setProspects([]); setLoading(false); return; }

    // Seed on first load if empty
    if (!seededRef.current) {
      seededRef.current = true;
      seedProspects(seedData).then(didSeed => {
        if (didSeed) console.log('Seeded', seedData.length, 'prospects');
      }).catch(err => console.error('Seed error:', err));
    }

    const unsub = subscribeToProspects((data) => {
      setProspects(data);
      setLoading(false);
    });
    return unsub;
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

  return { prospects, loading, addProspect, updateProspect, deleteProspect };
}
