import { useEffect, useSyncExternalStore } from 'react';
import { loadOpps2Cache, loadOpps2Newest } from '../utils/opps2Store';
import { createOpps2Live } from '../utils/opps2Live';

// The Opps 2 data ({ records, headers, _updatedAt, ... }) for the hooks App
// keeps mounted, off one shared reader. See utils/opps2Live.js for why. The
// newest of the local cache and Firestore on first mount per account, then
// the local cache on focus, after every Opps 2 save and on a 10-minute tick.
// Null until the first read lands.
const live = createOpps2Live({ loadCache: loadOpps2Cache, loadNewest: loadOpps2Newest });

export function useOpps2Data(userId) {
  useEffect(() => live.start(userId), [userId]);
  return useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
}
