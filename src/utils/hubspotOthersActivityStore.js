// Published snapshot of the Hubspot Mapping page's Others' Activity rows:
// activity on one of Dan's My Accounts companies that somebody else
// logged in HubSpot, and that he hasn't ignored. HubspotMappingTab writes
// it whenever those rows recompute (a drop, an ignore, a remap); the
// Issues tab (useIssues -> computeIssues) reads it, so each row shows up
// there as an issue. The same pattern as myAccountsFlagsStore: scoped per
// user, mirrored to Firestore, and announced with an event so the Issues
// tab and the sidebar badge refresh.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

const KEY = 'hubspot:others-activity';
export const HUBSPOT_OTHERS_ACTIVITY_KEY = KEY;
export const HUBSPOT_OTHERS_ACTIVITY_EVENT = 'hubspot-others-activity-changed';

registerMirroredKey(KEY, HUBSPOT_OTHERS_ACTIVITY_EVENT);

// Each record: { key, accountId, company, salesperson, date, type, subject, hubspotCompany }
export function loadHubspotOthersActivity() {
  try {
    const raw = userLsGet(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveHubspotOthersActivity(records) {
  try {
    userLsSet(KEY, JSON.stringify(Array.isArray(records) ? records : []));
    queueMirrorPush(KEY);
    window.dispatchEvent(new Event(HUBSPOT_OTHERS_ACTIVITY_EVENT));
  } catch (err) {
    console.warn('Failed to persist the Hubspot Others\' Activity rows', err);
  }
}
