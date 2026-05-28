// fetch() wrapper for our serverless API that attaches the signed-in
// user's Firebase ID token as a Bearer credential. Every call to
// /api/* must go through this so the backend can verify identity.
import { auth } from '../firebase';

export async function apiFetch(input, init = {}) {
  const user = auth.currentUser;
  const headers = new Headers(init.headers || {});
  if (user) {
    try {
      const token = await user.getIdToken();
      headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // No token — the request will be rejected with 401 by the server.
    }
  }
  return fetch(input, { ...init, headers });
}
