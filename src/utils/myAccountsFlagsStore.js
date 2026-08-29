// Published snapshot of the flagged accounts on the My Accounts page —
// tier mismatch, status mismatch, and missing HQ Region. MyAccountsView
// writes this whenever its resolved account set recomputes; the Issues
// tab (via useIssues -> computeIssues) reads it so the same ⚠ flags the
// user sees on My Accounts also surface as Issues rows. Scoped per user
// and announced with a custom event so the Issues tab and the sidebar
// badge refresh cross-tab, mirroring the deals / snooze stores.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

const FLAGS_KEY = 'my-accounts:flags';
export const MY_ACCOUNTS_FLAGS_KEY = FLAGS_KEY;
export const MY_ACCOUNTS_FLAGS_EVENT = 'my-accounts-flags-changed';

// Mirrored to Firestore. This one rebuilds itself the next time My Accounts
// is opened, so it is the least costly of the set to lose — but until that
// visit the sidebar badge and the Issues tab are missing its rows, and the
// mirror closes that window on a fresh browser.
registerMirroredKey(FLAGS_KEY, MY_ACCOUNTS_FLAGS_EVENT);

// Each record is one (account, flag) pair:
//   { id, company, kind: 'tier'|'status'|'hqRegion', ...flag-specific fields }
export function loadMyAccountsFlags() {
  try {
    const raw = userLsGet(FLAGS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveMyAccountsFlags(flags) {
  try {
    userLsSet(FLAGS_KEY, JSON.stringify(Array.isArray(flags) ? flags : []));
    queueMirrorPush(FLAGS_KEY);
    window.dispatchEvent(new Event(MY_ACCOUNTS_FLAGS_EVENT));
  } catch (err) {
    console.warn('Failed to persist My Accounts flags', err);
  }
}
