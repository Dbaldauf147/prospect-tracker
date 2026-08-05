// Per-user fixed-window rate limiting backed by Firestore so the count
// survives serverless cold starts. Keyed by uid + bucket name.
import { adminDb } from './firebaseAdmin.js';
import { withDeadline } from './deadline.js';

// Firestore retries a transaction it can't complete, with backoff, for
// far longer than a request should wait. Metering is not worth holding
// the response open for: past this it fails open, same as any other
// metering failure.
const TXN_TIMEOUT_MS = 5000;

/**
 * Returns { ok: true } when under the limit, or { ok: false, retryAfter }
 * when the caller has exhausted `limit` requests in the current window.
 * Uses a transaction so concurrent invocations count correctly.
 */
export async function checkRateLimit(uid, bucket, limit, windowMs) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    // Inside the try with everything else: adminDb() throws when the
    // service account is missing or unparseable, and a throw here reaches
    // the caller as an unhandled rejection rather than the fail-open this
    // is supposed to guarantee.
    const ref = adminDb().collection('rateLimits').doc(`${uid}__${bucket}__${windowStart}`);
    return await withDeadline(
      adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? (snap.data().count || 0) : 0;
        if (count >= limit) {
          return { ok: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
        }
        tx.set(ref, { count: count + 1, expiresAt: windowStart + windowMs }, { merge: true });
        return { ok: true };
      }),
      TXN_TIMEOUT_MS,
      'The rate-limit check',
    );
  } catch {
    // Never let a metering failure — or a metering stall — take down the
    // feature it is only counting.
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
