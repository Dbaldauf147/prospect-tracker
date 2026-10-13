// How the nightly backup's fan-out reads each per-user call. A call that
// never reached the backup function must fail (and be backed up in-process),
// not be logged as "ok".
//
// Run: node scripts/backupFanout.test.mjs
import { readChildAnswer, selfBaseUrl, selfCallHeaders } from '../api/_lib/backupFanout.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const ok = readChildAnswer('u1', { status: 200, text: JSON.stringify({ uid: 'u1', status: 'ok', counts: {} }) });
check('the function saying ok is ok', [ok.status, ok.reachedFunction], ['ok', true]);

const html = readChildAnswer('u1', { status: 200, text: '<!doctype html><html>Log in to Vercel</html>' });
check('a 200 web page is not a backup', [html.status, html.reachedFunction], ['error', false]);
check('and says it was a web page', /HTTP 200 with a web page/.test(html.error), true);

const empty = readChildAnswer('u1', { status: 200, text: '{}' });
check('JSON with no status for this user is not a backup', [empty.status, empty.reachedFunction], ['error', false]);

const other = readChildAnswer('u1', { status: 200, text: JSON.stringify({ uid: 'u2', status: 'ok' }) });
check("another user's answer is not this user's backup", other.status, 'error');

const redirect = readChildAnswer('u1', { status: 307, location: 'https://vercel.com/sso-api?url=x' });
check('a redirect fails and names protection', [redirect.status, redirect.reachedFunction, /deployment protection/.test(redirect.error)], ['error', false, true]);

const failedRun = readChildAnswer('u1', { status: 500, text: JSON.stringify({ uid: 'u1', status: 'error', error: 'GCS upload 403: billing' }) });
check('a real failure is kept, and not retried in-process', [failedRun.status, failedRun.reachedFunction, failedRun.error], ['error', true, 'GCS upload 403: billing']);

const skipped = readChildAnswer('u1', { status: 200, text: JSON.stringify({ uid: 'u1', status: 'skipped-empty' }) });
check('a skipped user stays skipped', skipped.status, 'skipped-empty');

check('the production domain is preferred over the request host',
  selfBaseUrl({ env: { VERCEL_PROJECT_PRODUCTION_URL: 'tracker.example.com' }, headers: { host: 'x-abc.vercel.app' } }), 'https://tracker.example.com');
check('without it, the request host', selfBaseUrl({ env: {}, headers: { host: 'x.vercel.app', 'x-forwarded-proto': 'https' } }), 'https://x.vercel.app');
check('headers carry the cron secret and the bypass when set',
  selfCallHeaders({ CRON_SECRET: 's', VERCEL_AUTOMATION_BYPASS_SECRET: 'b' }), { Authorization: 'Bearer s', 'x-vercel-protection-bypass': 'b' });
check('and nothing when not', selfCallHeaders({}), {});
check('no em dash in any message', [html.error, redirect.error].some(t => t.includes('—')), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
