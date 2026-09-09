// What to tell someone whose roster didn't load.
//
// Firestore's failures reach the app as opaque SDK text — "Missing or
// insufficient permissions", "Failed to get document because the client
// is offline" — and the reader's next move is completely different for
// each: one is an account that needs re-signing in, the other is a
// network or an extension. Classifying it here rather than in the panel
// keeps it pure, so scripts/prospectsLoadError.test.mjs can pin the
// wording down without rendering React.

const PERMISSION = 'The database refused the read for this account. If you have just been added, signing out and back in picks up the new permissions.';
const OFFLINE = 'The browser could not reach the database. That is usually the connection, a VPN, or an extension blocking firestore.googleapis.com — the app itself loaded fine.';
const UNKNOWN = 'The database returned an error instead of the roster. Reloading is worth a try; if it comes back every time, copy the message below.';

/**
 * A one-line explanation for a failed prospects subscription, chosen from
 * the raw error text. Falls back to the generic line, which is safe for
 * anything unrecognised — the raw message is always shown beneath it.
 */
export function explainProspectsLoadError(message) {
  const m = String(message || '').toLowerCase();
  // Checked before the network case: a permission-denied carries no
  // network words, but an offline error can mention neither, so the more
  // specific match goes first.
  if (m.includes('permission') || m.includes('insufficient') || m.includes('unauthenticated')) return PERMISSION;
  if (m.includes('offline') || m.includes('unavailable') || m.includes('network') || m.includes('failed to fetch')) return OFFLINE;
  return UNKNOWN;
}

export const PROSPECTS_LOAD_ERROR_LINES = { PERMISSION, OFFLINE, UNKNOWN };
