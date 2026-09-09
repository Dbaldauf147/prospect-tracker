// Putting a ceiling on a promise that might never settle.
//
// Written for the Firestore calls on the sign-in path, where "it failed"
// and "it never answered" are different problems and only the first one
// rejects. `setDoc` is the sharp edge: its promise resolves when the
// SERVER acknowledges the write, so a client that cannot reach
// firestore.googleapis.com queues the write locally and leaves the
// promise pending for the life of the tab. A try/catch around it never
// runs, because nothing ever throws. `getDoc` can sit the same way when
// the document is not in the local cache.
//
// A hung await is invisible in a way a rejection is not: it produces no
// log, no error, and no state change -- just a screen that never moves.

/** Rejection raised when the ceiling is reached. */
export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} did not answer within ${ms}ms`);
    this.name = 'TimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

/**
 * `promise`, but rejecting with a TimeoutError if it has not settled
 * within `ms`. The timer is always cleared, so a promise that settles
 * first doesn't hold the event loop open; the losing side of the race is
 * left alone rather than cancelled, since neither Firestore call can be
 * aborted and a queued write should still land when the network returns.
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

/** True for the rejection `withTimeout` raises, however it was re-thrown. */
export function isTimeoutError(err) {
  return err instanceof TimeoutError || err?.name === 'TimeoutError';
}
