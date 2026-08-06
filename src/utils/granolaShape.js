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

/**
 * Turn the probe's hint into the sentence shown under the setup message.
 * Each case points at a different fix, which is the whole reason the
 * hint exists.
 */
export function describeMissingKey(hint) {
  if (!hint) return '';
  const where = hint.environment && hint.environment !== 'unknown'
    ? `The ${hint.environment} deployment`
    : 'This deployment';
  const build = hint.commit ? ` (build ${hint.commit})` : '';
  const named = (hint.granolaVars || []).filter(n => n !== 'GRANOLA_API_KEY');

  if ((hint.granolaVars || []).includes('GRANOLA_API_KEY')) {
    // Present but empty: the variable exists with a blank or
    // whitespace-only value, which is a re-paste rather than a re-scope.
    return `${where}${build} has a GRANOLA_API_KEY, but it is empty. Re-paste the key value and redeploy.`;
  }
  if (named.length === 1 && named[0] === 'GRANOLA_API_BASE') {
    // The two names sit next to each other in .env.example, so this is
    // usually the key pasted into the wrong row rather than a deliberate
    // host override.
    return `${where}${build} can see GRANOLA_API_BASE but no GRANOLA_API_KEY. GRANOLA_API_BASE is an optional override for the API's address, not the key: if you pasted the key into it, delete that variable and add the key as GRANOLA_API_KEY instead.`;
  }
  if (named.length > 0) {
    return `${where}${build} can see ${named.join(', ')} but no GRANOLA_API_KEY: check the variable's name.`;
  }
  return `${where}${build} has no environment variable mentioning Granola at all. The most common cause is the variable being saved for a different environment than this one, or against a different Vercel project.`;
}

// How each connection state paints. Granola's own violet for "never set
// up", which is a setup step rather than a fault; red only for Granola
// actively refusing us; green for a live key, because "it works" is the
// answer the user is looking for and a colourless line does not give it.
const CONNECTION_TONES = {
  ok: { background: '#F0FDF4', color: '#166534', border: '#BBF7D0' },
  setup: { background: '#F5F3FF', color: '#5B21B6', border: '#DDD6FE' },
  refused: { background: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
  unknown: { background: '#F8FAFC', color: '#475569', border: '#E2E8F0' },
};

/**
 * The Granola connection as one line the panel can render, or null when
 * there is nothing to say yet.
 *
 * Four states, and they are NOT interchangeable. Until this existed the
 * page collapsed them into a single "0 meetings", which is the one
 * reading that points nowhere:
 *
 *   - no key in this deployment: nothing was ever set up, and the fix is
 *     a variable plus a redeploy. describeMissingKey names which variable
 *     the deployment can actually see, since "not configured" has several
 *     causes that look identical from the browser;
 *   - a key Granola refuses: it exists but is wrong, expired, or on a
 *     plan without API access. A different fix entirely;
 *   - a live key: worth saying plainly, because it rules the connection
 *     out as the reason the panel is empty and sends the user to look at
 *     the date range instead;
 *   - no answer: the check itself failed, which is not evidence either
 *     way and must not be reported as one.
 *
 * `retry` marks the states where asking again is the sensible next
 * action. A missing variable is not one of them: no amount of re-checking
 * writes it.
 */
export function describeGranolaConnection(status, { checking = false } = {}) {
  if (!status) {
    return checking
      ? { ...CONNECTION_TONES.unknown, headline: 'Checking whether Granola is connected…', detail: '', retry: false }
      : null;
  }

  if (status.timedOut) {
    return {
      ...CONNECTION_TONES.unknown,
      headline: "Couldn't check whether Granola is connected.",
      detail: 'The check timed out, so this says nothing about Granola either way. Any meetings already imported are unaffected.',
      retry: true,
    };
  }

  if (!status.configured) {
    return {
      ...CONNECTION_TONES.setup,
      headline: 'Granola has no API key in this deployment, so no meetings can be imported from it.',
      detail: `${describeMissingKey(status.hint)} Create a key in Granola under Settings > API (it needs a Business or Enterprise plan), save it as GRANOLA_API_KEY, and redeploy.`.trim(),
      retry: false,
    };
  }

  if (!status.ok) {
    return {
      ...CONNECTION_TONES.refused,
      headline: 'Granola has a key here, but it was rejected.',
      detail: status.error || 'Granola refused the request without saying why.',
      retry: true,
    };
  }

  return {
    ...CONNECTION_TONES.ok,
    headline: 'Granola is connected and the key is live.',
    // Said because it is the next question. A working connection and an
    // empty panel is a real combination: Granola only serves notes it
    // has finished summarising, so a meeting can be genuinely absent
    // rather than merely unreachable.
    detail: 'Meetings arrive once Granola has finished summarising them, so a meeting that just ended may not be here yet.',
    retry: false,
  };
}
