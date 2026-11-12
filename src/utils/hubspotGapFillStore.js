// Published snapshot of the Gap Fill work left on each active My Accounts
// company (utils/hubspotContactGaps.js gapFillIssueRecords): contacts to
// add from the HubSpot export, and app contacts with blanks it can fill.
// HubspotMappingTab writes it whenever that work recomputes; the Issues
// tab (useIssues -> computeIssues) reads it, one issue per account. The
// same pattern as hubspotOthersActivityStore: scoped per user, mirrored to
// Firestore, announced with an event.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

const KEY = 'hubspot:gap-fill';
export const HUBSPOT_GAP_FILL_KEY = KEY;
export const HUBSPOT_GAP_FILL_EVENT = 'hubspot-gap-fill-changed';

registerMirroredKey(KEY, HUBSPOT_GAP_FILL_EVENT);

// Each record: { accountId, company, add, fill, fields: { [label]: n } }
export function loadHubspotGapFill() {
  try {
    const raw = userLsGet(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveHubspotGapFill(records) {
  try {
    userLsSet(KEY, JSON.stringify(Array.isArray(records) ? records : []));
    queueMirrorPush(KEY);
    window.dispatchEvent(new Event(HUBSPOT_GAP_FILL_EVENT));
  } catch (err) {
    console.warn('Failed to persist the Hubspot Gap Fill work', err);
  }
}
