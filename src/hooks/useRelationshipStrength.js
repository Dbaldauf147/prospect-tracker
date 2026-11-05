// The Relationship Strength data every view reads: the HubSpot touch
// index, the activities you logged (and your edits to HubSpot ones), and
// the Opps 2 records for the opportunity component.
//
// Re-read whenever any of them changes: a logged or edited activity
// (RELATIONSHIP_EVENT), a fresh HubSpot pull (the Activity tab rebuilds
// the index and fires the same event), another browser tab, or a sign-in.
// Every score on screen is a memo over these, so it re-scores straight
// away.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOppsRecords } from '../utils/rosterHooks';
import {
  loadRelationshipLog, loadTouchIndex, hydrateTouchIndex, RELATIONSHIP_EVENT, RELATIONSHIP_LOG_KEY,
} from '../utils/relationshipLog';
import { oppsForContact, scoreContact, touchesForContact, RELATIONSHIP_CONFIG } from '../utils/relationshipStrength';

export function useRelationshipData() {
  const { user } = useAuth() || {};
  const uid = user?.uid || '';
  const [index, setIndex] = useState(() => loadTouchIndex());
  const [log, setLog] = useState(() => loadRelationshipLog());
  // False until the index has been read from IndexedDB, so a page can
  // tell "still loading" from "no activity on record".
  const [indexLoaded, setIndexLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const reload = () => { setIndex(loadTouchIndex()); setLog(loadRelationshipLog()); };
    const onStorage = (e) => {
      if (e.key && e.key.endsWith(`:${RELATIONSHIP_LOG_KEY}`)) reload();
    };
    reload();
    hydrateTouchIndex().finally(() => { if (!cancelled) { reload(); setIndexLoaded(true); } });
    window.addEventListener(RELATIONSHIP_EVENT, reload);
    window.addEventListener('hubspot-activity-cache-updated', reload);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(RELATIONSHIP_EVENT, reload);
      window.removeEventListener('hubspot-activity-cache-updated', reload);
      window.removeEventListener('storage', onStorage);
    };
  }, [uid]);
  const oppsRecords = useOppsRecords(uid);

  const touchesFor = useCallback(
    (contact) => touchesForContact(contact, index, log, RELATIONSHIP_CONFIG),
    [index, log],
  );
  const scoreFor = useCallback((contact, nowMs = Date.now()) => {
    const touches = touchesFor(contact);
    return scoreContact(touches, { opps: oppsForContact(contact, oppsRecords, { nowMs }), nowMs });
  }, [touchesFor, oppsRecords]);

  return { index, log, oppsRecords, touchesFor, scoreFor, hasFeed: !!index, indexLoaded };
}

/** One contact's score, re-scored whenever its activity changes. */
export function useContactRelationship(contact) {
  const data = useRelationshipData();
  const { touchesFor, scoreFor } = data;
  const touches = useMemo(() => (contact ? touchesFor(contact) : []), [contact, touchesFor]);
  const result = useMemo(() => (contact ? scoreFor(contact) : null), [contact, scoreFor]);
  return { ...data, touches, result };
}
