// Per-user fixed-window rate limiting backed by Firestore so the count
// survives serverless cold starts. Keyed by uid + bucket name.
import { adminDb } from './firebaseAdmin.js';

/**
 * Returns { ok: true } when under the limit, or { ok: false, retryAfter }
 * when the caller has exhausted `limit` requests in the current window.
 * Uses a transaction so concurrent invocations count correctly.
 */
export async function checkRateLimit(uid, bucket, limit, windowMs) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const ref = adminDb().collection('rateLimits').doc(`${uid}__${bucket}__${windowStart}`);
  try {
    return await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? (snap.data().count || 0) : 0;
      if (count >= limit) {
        return { ok: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
      }
      tx.set(ref, { count: count + 1, expiresAt: windowStart + windowMs }, { merge: true });
      return { ok: true };
    });
  } catch {
    // Never let a metering failure take down the feature.
    return { ok: true };
  }
}

/**
 * Convenience guard for handlers: enforces the limit and writes a 429 on
 * exhaustion. Returns true when the caller may proceed.
 */
export async function enforceRateLimit(res, uid, bucket, limit, windowMs) {
  const r = await checkRateLimit(uid, bucket, limit, windowMs);
  if (!r.ok) {
    res.setHeader('Retry-After', String(r.retryAfter || 60));
    res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
    return false;
  }
  return true;
}
