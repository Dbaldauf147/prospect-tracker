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
