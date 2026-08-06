// Reading a Granola list response's shape back to the user.
//
// /api/granola-calls returns a `shape` alongside every page of notes —
// which key the notes came out of, how many there were, and how many
// carried no id. This turns that into the sentence a page shows when a
// sync ran clean and still imported nothing.
//
// It lives apart from granolaCalls.js because that module imports
// apiFetch, which initialises Firebase on import; this one imports
// nothing, so the wording can be pinned by tests under plain Node
// (scripts/granolaShape.test.mjs). Getting a branch wrong here sends
// someone off debugging the wrong thing, which is worth a test.

/**
 * Why a sync that ran clean still imported nothing.
 *
 * "Already up to date" is the right answer when Granola genuinely has
 * nothing new, and the wrong one when it answered with something this
 * build couldn't read — which looks identical from the page. `shape` is
 * what tells them apart. Returns '' when there is nothing to add, so a
 * caller can append it unconditionally.
 */
export function diagnoseEmptySync(shape) {
  if (!shape) return '';
  if (shape.rowCount > 0 && shape.missingIds === shape.rowCount) {
    return `Granola returned ${shape.rowCount} note${shape.rowCount === 1 ? '' : 's'}, but none of them carried an id this build recognises, so none could be stored. That usually means Granola has renamed the field.`;
  }
  if (shape.rowsFrom === null) {
    const seen = (shape.bodyKeys || []).join(', ');
    return `Granola answered, but nothing in its reply looked like a list of notes${seen ? ` (it sent: ${seen})` : ' (its reply was empty)'}. That usually means the API's response shape has changed.`;
  }
  if (shape.missingIds > 0) {
    return `${shape.missingIds} of ${shape.rowCount} notes arrived without an id and were skipped.`;
  }
  return '';
}

/**
 * What Granola's answer about the CALENDAR means, as one sentence.
 *
 * Granola syncs the user's Outlook calendar — that sync is what fills
 * its own "Coming up" list — so "pull my meetings from Granola" is a
 * perfectly reasonable thing to expect. What its API serves is notes,
 * and only notes it has finished summarising: by the time a meeting
 * appears there it is over. A meeting still to come has no note, so no
 * amount of re-syncing will produce one.
 *
 * That is the sentence this returns, and the reason it exists. An empty
 * panel with a ↻ Granola button beside it invites a retry loop against
 * an API that cannot serve what is being retried for; naming the limit
 * once costs less than discovering it a dozen times.
 *
 * `attempts` is what each candidate endpoint answered, from the user's
 * own key — so this reports a checked fact rather than a claim about
 * what some documentation said.
 */
export function describeGranolaCalendar({ supported = false, attempts = [], error = '', events = 0 } = {}) {
  if (error) return `Granola calendar: ${error}`;
  if (supported) {
    return events > 0 ? '' : 'Granola served a calendar, but it holds no meetings in this window.';
  }
  // Nothing has been asked yet, so nothing is known.
  if (!attempts.length) return '';

  // A key that is rejected or under-scoped says nothing about whether
  // the endpoint exists, and its fix is a different one.
  const denied = attempts.find(a => a.status === 401 || a.status === 403);
  if (denied) {
    return denied.status === 401
      ? 'Granola rejected the API key when asked for your calendar. Generate a new key in Granola (Settings → API).'
      : 'That Granola key isn’t allowed to read a calendar. Granola’s API covers notes; the calendar sync behind its “Coming up” list isn’t exposed to API keys.';
  }
  return 'Granola’s API doesn’t serve your calendar — only notes it has finished summarising, which means meetings that have already happened. Upcoming meetings can’t come from Granola.';
}
