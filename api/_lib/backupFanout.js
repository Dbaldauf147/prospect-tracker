// How the nightly backup's fan-out (api/daily-backup.js) reaches each
// user's run, and how it reads the answer. Pure apart from nothing, so it
// loads under plain Node (scripts/backupFanout.test.mjs).
//
// The fan-out calls this deployment's own /api/daily-backup?uid= once per
// user. It used to take ANY 2xx as success, and read a missing status as
// "ok". A call that never reached the function (Vercel's deployment
// protection redirecting to its login page, an HTML error page) came back
// 200 with no JSON, was logged as "ok", and nothing was saved: the cron log
// said the account had been backed up while its newest nightly file stayed
// 84 days old. Success is now only an answer the function itself gave,
// about the user it was asked for.

/** The base URL to call: the production domain when Vercel says what it is. */
export function selfBaseUrl({ env = {}, headers = {} } = {}) {
  const prod = String(env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  const host = headers['x-forwarded-host'] || headers.host;
  const proto = headers['x-forwarded-proto'] || 'https';
  return host ? `${proto}://${host}` : '';
}

/** Headers for the call: the cron secret, and Vercel's protection bypass when set. */
export function selfCallHeaders(env = {}) {
  const h = {};
  if (env.CRON_SECRET) h.Authorization = `Bearer ${env.CRON_SECRET}`;
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) h['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return h;
}

/**
 * Read one child call's answer.
 *   { uid, status, error? , reachedFunction }
 * `reachedFunction` is false when the answer didn't come from the backup
 * function at all; the fan-out then runs that user's backup itself.
 */
export function readChildAnswer(uid, { status = 0, location = '', text = '' } = {}) {
  if (status >= 300 && status < 400) {
    return {
      uid, status: 'error', reachedFunction: false,
      error: `The backup call was redirected${location ? ` to ${String(location).slice(0, 120)}` : ''}, most likely by Vercel deployment protection.`,
    };
  }
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!body || typeof body !== 'object' || body.uid !== uid) {
    const looksHtml = /^\s*</.test(String(text));
    return {
      uid, status: 'error', reachedFunction: false,
      error: `The backup call answered HTTP ${status}${looksHtml ? ' with a web page' : ''} instead of a backup result, so it never reached the backup.`,
    };
  }
  if (status >= 400 || body.status === 'error') {
    return { uid, status: 'error', reachedFunction: true, error: String(body.error || `HTTP ${status}`).slice(0, 300) };
  }
  return { uid, status: String(body.status || 'ok'), reachedFunction: true };
}
