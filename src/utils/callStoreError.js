// What to tell someone whose saved calls wouldn't load — or wouldn't save.
//
// Every failed read used to end in "Reload to try again", which is only
// advice for one kind of failure. A dropped connection does clear on a
// reload. A rules denial does not: the database is refusing on purpose,
// and reloading re-runs the same refusal — so the one error that needs
// someone to go and fix something was the one telling the user to keep
// pressing refresh.
//
// Writes were worse than badly advised: they said nothing at all. A
// denied save left the page showing a tag or a summary that existed only
// in the browser, so the work looked done and was gone on refresh. Every
// write failure now leads with the fact that decides what the user does
// next — nothing was saved — and only then says whether it is worth
// trying again.
//
// The split is made on the Firestore error CODE, never on its message.
// Codes are a stable contract; the messages are prose Google can reword,
// and a UI that string-matched them would quietly fall back to the wrong
// advice the day it changed.
//
// Everything here is pure: a failure in, wording out. No React, no
// Firebase.

// How each Firestore code behaves, and what to say about it for a read
// and for a write. The remedies differ by more than tense: a reload
// re-runs a read, but it does nothing for a write the user has to
// perform again.
//
// `permanent` means the next attempt fails identically. Anything not
// listed here is treated as worth retrying — the safe way round, since
// telling someone to retry when they can't is a wasted click, while
// telling them to go fix infrastructure when a retry would have worked
// sends them after a problem they don't have.
const CODES = {
  // The rules refused it. For this app that nearly always means the
  // ruleset in firestore.rules hasn't reached the Firebase project —
  // nothing in the build deploys it, so git and the deployed ruleset
  // drift apart silently and access starts coming back denied.
  'permission-denied': {
    permanent: true,
    read: 'Reloading won’t change this: the database refused the read. The security rules that grant '
      + 'access to your saved calls live in firestore.rules — check that ruleset has been deployed to Firebase.',
    write: 'Nothing was saved, and trying again won’t help: the database refused the write. The security '
      + 'rules that grant access to your saved calls live in firestore.rules — check that ruleset has been '
      + 'deployed to Firebase.',
    delete: 'Nothing was deleted, and trying again won’t help: the database refused it. The security '
      + 'rules that grant access to your saved calls live in firestore.rules — check that ruleset has been '
      + 'deployed to Firebase.',
  },
  // The credential, not the rules. A retry re-sends the same bad token.
  unauthenticated: {
    permanent: true,
    read: 'Reloading won’t change this: your sign-in is no longer valid. Sign out and back in.',
    write: 'Nothing was saved: your sign-in is no longer valid. Sign out and back in, then do this again.',
    delete: 'Nothing was deleted: your sign-in is no longer valid. Sign out and back in, then try again.',
  },
  unavailable: {
    permanent: false,
    read: 'Reload once you’re back online.',
    write: 'Nothing was saved — you appear to be offline. This will need doing again once you’re back.',
    delete: 'Nothing was deleted — you appear to be offline. Try again once you’re back.',
  },
  'deadline-exceeded': {
    permanent: false,
    read: 'The read timed out. Reload to try again.',
    write: 'Nothing was saved: the write timed out. Try again.',
    delete: 'Nothing was deleted: it timed out. Try again.',
  },
  'resource-exhausted': {
    permanent: false,
    read: 'The database is rate-limiting requests. Wait a moment, then reload.',
    write: 'Nothing was saved: the database is rate-limiting writes. Wait a moment, then try again.',
    delete: 'Nothing was deleted: the database is rate-limiting requests. Wait a moment, then try again.',
  },
};

const DEFAULT_ADVICE = {
  read: 'Reload to try again.',
  write: 'Nothing was saved. Try again.',
  delete: 'Nothing was deleted. Try again.',
};

function describe(failure, operation) {
  if (!failure) return null;
  const { ok, code, error } = failure;
  // `ok` is optional: callers that only have an error can pass one.
  if (ok === true) return null;
  const message = typeof error === 'string' ? error.trim() : '';
  if (ok !== false && !message && !code) return null;

  const known = CODES[String(code || '').trim()];
  return {
    permanent: !!known?.permanent,
    advice: known ? known[operation] : DEFAULT_ADVICE[operation],
  };
}

/**
 * How to describe a failed READ of the stored calls.
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
  return describe(failure, 'read');
}

/**
 * How to describe a failed WRITE to the stored calls.
 *
 * Same shape, but every message leads with the fact that nothing was
 * saved — the page keeps showing the change so the user's work isn't
 * thrown away on top of not being stored, which makes "this is not
 * saved" the thing they have to be told.
 */
export function describeWriteFailure(failure) {
  return describe(failure, 'write');
}

/**
 * How to describe a failed DELETE of a stored call.
 *
 * Its own wording rather than the write's: "nothing was saved" tells
 * someone who pressed Forget the opposite of what happened, and the
 * whole point of these messages is that the user can trust what the
 * screen now claims.
 */
export function describeDeleteFailure(failure) {
  return describe(failure, 'delete');
}
