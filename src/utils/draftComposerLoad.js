// Put a history entry back in the Draft Emails composer: write it to the
// composer's autosave slot, which the composer reads when it mounts. Shared
// by the Draft History tab and a campaign's linked-drafts list, so both ask
// the same question before replacing whatever is being written now.
//
// Returns false when the user said no; the caller then stays put.

import { userLsGet } from './userLs';
import { writeWorkKey } from './mirroredWorkKeys';
import { draftHasContent, DRAFT_AUTOSAVE_KEY } from './emailDraftHistory';

export function loadDraftIntoComposer(entry) {
  let current = null;
  try { current = JSON.parse(userLsGet(DRAFT_AUTOSAVE_KEY) || 'null'); } catch { current = null; }
  if (current && draftHasContent(current)) {
    const ok = window.confirm('Open this draft in the composer? It replaces what is in the compose box now. Save that first (Save Draft) if you want to keep it.');
    if (!ok) return false;
  }
  writeWorkKey(DRAFT_AUTOSAVE_KEY, JSON.stringify({
    subject: entry.subject, body: entry.body, contacts: entry.contacts, cc: entry.cc, bannerId: entry.bannerId,
  }));
  return true;
}
