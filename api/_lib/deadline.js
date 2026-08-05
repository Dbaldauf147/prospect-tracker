// A time limit for one await.
//
// Serverless functions here run with maxDuration 300, which is a ceiling
// for work that is meant to take a while — not a timeout. Anything on
// the request path that can stall (a token verified against Google, a
// Firestore transaction retrying behind the scenes) will happily hold
// the function open for minutes, and the browser gives up long before
// that with nothing to show but "timed out". The caller learns which
// layer stalled only if each one answers for itself.
//
// So: bound the await, and say which step ran out of time.

/**
 * Resolve `promise`, or throw after `ms` naming `label`.
 *
 * The underlying work isn't cancelled — most SDK calls can't be — it is
 * abandoned. That is fine for a serverless invocation about to end, and
 * far better than holding the response until the platform's ceiling.
 */
export async function withDeadline(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${label} didn't finish within ${Math.round(ms / 1000)}s.`);
          err.timedOut = true;
          reject(err);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function isDeadline(err) {
  return !!err?.timedOut;
}
