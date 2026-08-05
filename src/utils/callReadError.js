// What to tell someone whose saved calls wouldn't load.
//
// Every failed read used to end in "Reload to try again", which is only
// advice for one kind of failure. A dropped connection does clear on a
// reload. A rules denial does not: the database is refusing the read on
// purpose, and reloading re-runs exactly the same refusal — so the one
// error that needs someone to go and fix something was the one telling
// the user to keep pressing refresh.
//
// The split is made on the Firestore error CODE, never on its message.
// Codes are a stable contract; the messages are prose Google can reword,
// and a UI that string-matched them would quietly fall back to the wrong
// advice the day it changed.
//
// Everything here is pure: an error in, wording out. No React, no
// Firebase.

// Failures that will fail again identically on the next attempt. Anything
// not listed is treated as worth retrying — the safe way round, since
// telling someone to reload when they can't is a wasted click, while
// telling them to go fix something when a retry would have worked sends
// them after a problem they don't have.
const PERMANENT = {
  // The rules refused it. For this app that nearly always means the
  // ruleset in firestore.rules hasn't reached the Firebase project —
  // nothing in the build deploys it, so git and the deployed ruleset
  // drift apart silently and reads start coming back denied.
  'permission-denied': 'Reloading won’t change this: the database refused the read. The security rules '
    + 'that grant access to your saved calls live in firestore.rules — check that ruleset has been '
    + 'deployed to Firebase.',
  // The credential, not the rules. A reload re-sends the same bad token.
  unauthenticated: 'Reloading won’t change this: your sign-in is no longer valid. Sign out and back in.',
};

// Retryable, but each for its own reason — so the advice can say what to
// wait for instead of just "try again".
const TRANSIENT = {
  unavailable: 'Reload once you’re back online.',
  'deadline-exceeded': 'The read timed out. Reload to try again.',
  'resource-exhausted': 'The database is rate-limiting requests. Wait a moment, then reload.',
};

const DEFAULT_ADVICE = 'Reload to try again.';

/**
 * How to describe a failed read of the stored calls.
 *
 * Returns null when nothing failed, so a caller can use it as the
 * condition for showing anything at all.
 *
 *   {
 *     permanent: boolean,   // true when reloading cannot help
 *     advice: string,       // the sentence to show after the message
 *   }
 */
export function describeReadFailure(failure) {
  if (!failure) return null;
  const { ok, code, error } = failure;
  // `ok` is optional: callers that only have an error can pass one.
  if (ok === true) return null;
  const message = typeof error === 'string' ? error.trim() : '';
  if (ok !== false && !message && !code) return null;

  const key = String(code || '').trim();
  const permanent = Object.prototype.hasOwnProperty.call(PERMANENT, key);
  return {
    permanent,
    advice: permanent ? PERMANENT[key] : (TRANSIENT[key] || DEFAULT_ADVICE),
  };
}
