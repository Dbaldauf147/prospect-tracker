import { useSyncExternalStore } from 'react';
import { subscribeBadEmails, getPublishedBadEmails } from '../utils/badEmails';

/**
 * { map, clear(email), failedByContact, recordFailed(contactId, email, info),
 * removeFailed(contactId, email) } - the bad-email flags App publishes
 * (utils/badEmails).
 */
export function useBadEmails() {
  return useSyncExternalStore(subscribeBadEmails, getPublishedBadEmails, getPublishedBadEmails);
}
