// The BFO Activity record: the rows pasted on the BFO Activity tab, plus
// the store/key constants several views had been spelling out for
// themselves. Pasted data with no other source — re-pasting it is manual
// work — so it is mirrored to Firestore.
//
// Only the data record is mirrored. The sibling prefs record (column widths
// and hidden columns) is per-browser display state, cheap to redo, and not
// worth a document.

import { dbGet } from './db';
import { registerMirroredDbKey, mirrorDbPut } from './localMirrorSync';

export const BFO_ACTIVITY_STORE = 'bfo-activity';
export const BFO_ACTIVITY_KEY = 'current';
export const BFO_ACTIVITY_EVENT = 'bfo-activity-changed';

registerMirroredDbKey(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY, BFO_ACTIVITY_EVENT);

export async function loadBfoActivity() {
  try {
    return (await dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY)) || null;
  } catch { return null; }
}

// Save the pasted rows and queue the Firestore mirror. Callers that write
// this record go through here so the mirror can't be skipped at one of them.
export async function saveBfoActivity({ headers, rows }) {
  await mirrorDbPut(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY, { headers, rows });
}
