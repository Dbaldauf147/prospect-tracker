// fetch() wrapper for our serverless API that attaches the signed-in
// user's Firebase ID token as a Bearer credential. Every call to
// /api/* must go through this so the backend can verify identity.
import { auth } from '../firebase';

// Minting the token is a network call of its own — Firebase refreshes it
// against Google when the cached one is near expiry. It happens before
// the request is sent, which puts it outside the reach of any AbortSignal
// the caller passes: a refresh that never settles used to hang the call
// with no request ever leaving the browser, and nothing on screen but a
// spinner. Bound it, and let the caller say so.
const TOKEN_TIMEOUT_MS = 10000;

const STALLED = 'apiFetchStalled';

/** Did this fail because a layer stalled, rather than answering badly? */
export function isStalled(err) {
  return err?.name === STALLED;
}

async function idToken(user) {
  let timer = null;
  try {
    return await Promise.race([
      user.getIdToken(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(
            'Couldn’t get a sign-in token from Firebase within 10s. The request was never sent: '
            + 'check your connection, and reload the page if it persists.',
          );
          err.name = STALLED;
          reject(err);
        }, TOKEN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function apiFetch(input, init = {}) {
  const user = auth.currentUser;
  const headers = new Headers(init.headers || {});
  if (user) {
    let token;
    try {
      token = await idToken(user);
    } catch (err) {
      // A stall is not a bad token. Sending the request anyway would come
      // back 401 and send the user off to re-authenticate over what is
      // really the token endpoint being unreachable.
      if (isStalled(err)) throw err;
      // Anything else — no token. The server rejects it with a 401,
      // which is the honest answer for a credential we couldn't produce.
      token = '';
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
