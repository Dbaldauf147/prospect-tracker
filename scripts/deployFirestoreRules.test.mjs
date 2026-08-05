// Assertion tests for the Firestore rules release. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/deployFirestoreRules.test.mjs
//
// The script itself talks to Firebase; everything tested here is the
// part that decides WHETHER and WHAT to release, which is where a
// mistake is expensive:
//
//   * releasing an unchanged file mints a redundant ruleset, and a
//     project caps at 2500 of them;
//   * reading the project id from the wrong place releases to the wrong
//     project;
//   * failing to spot a credential in .env sends someone off configuring
//     one they already have.
//
// Importing the module must not attempt a release — it is guarded to run
// only when invoked directly — so this file is also the test of that.
import {
  projectIdFrom, rulesPathFrom, serviceAccountFrom, sameSource,
  jwtClaims, describeApiError, parseEnvFile,
} from './deployFirestoreRules.mjs';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }
function throws(fn, name) {
  try { fn(); failed++; console.log(`FAIL  ${name}\n        expected a throw`); }
  catch { passed++; console.log(`PASS  ${name}`); }
}

// --- which project, which file ------------------------------------------
{
  eq(projectIdFrom({ projects: { default: 'tracker-3161a' } }), 'tracker-3161a', 'the default project is read from .firebaserc');
  eq(projectIdFrom({ projects: { default: '  tracker-3161a  ' } }), 'tracker-3161a', 'and trimmed');
  eq(projectIdFrom({ projects: {} }), '', 'no default project reads as none, rather than a guess');
  eq(projectIdFrom(null), '', 'and so does no file at all');

  eq(rulesPathFrom({ firestore: { rules: 'firestore.rules' } }), 'firestore.rules', 'the rules path comes from firebase.json');
  eq(rulesPathFrom({ firestore: { rules: 'config/rules.txt' } }), 'config/rules.txt', 'wherever firebase.json puts it');
  eq(rulesPathFrom({}), 'firestore.rules', 'falling back to the conventional path');
}

// The real files in this repo, since the whole point is that the script
// and a hand-run `firebase deploy` release the same thing to the same
// place. A rename that broke this would otherwise only show up at deploy.
{
  const { readFileSync } = await import('node:fs');
  const firebaserc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
  const firebaseJson = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  eq(projectIdFrom(firebaserc), 'tracker-3161a', "this repo's .firebaserc names tracker-3161a");
  eq(rulesPathFrom(firebaseJson), 'firestore.rules', "and firebase.json points at the repo's rules file");

  // The grant this whole exercise is about. If it ever leaves the file,
  // releasing cleanly would still leave the Call Recordings page denied.
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  ok(rules.includes('match /callRecordings/{userId}/items/{recordingId}'), 'the rules being released grant access to the call recordings');
}

// --- not releasing what is already released ------------------------------
{
  const content = 'rules_version = "2";\n';
  ok(sameSource([{ name: 'firestore.rules', content }], 'firestore.rules', content), 'an unchanged file matches by name');
  eq(sameSource([{ name: 'firestore.rules', content }], 'firestore.rules', `${content}// edited\n`), false, 'an edited file does not');

  // The console, the CLI and this script can each name the uploaded file
  // differently; a name mismatch is not a reason to mint a ruleset.
  ok(sameSource([{ name: 'rules.txt', content }], 'firestore.rules', content), 'a lone file under another name still matches on content');
  eq(sameSource([{ name: 'a', content }, { name: 'b', content: 'x' }], 'firestore.rules', content), false,
    'but a multi-file ruleset with no name match is treated as different');

  eq(sameSource([], 'firestore.rules', content), false, 'an empty ruleset never matches');
  eq(sameSource(null, 'firestore.rules', content), false, 'and neither does a missing one');
  // Whitespace is significant to the compiler, so it is significant here.
  eq(sameSource([{ name: 'firestore.rules', content }], 'firestore.rules', `${content} `), false, 'a whitespace-only change still counts as a change');
}

// --- the credential ------------------------------------------------------
{
  const sa = { client_email: 'sa@tracker-3161a.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n' };
  const raw = JSON.stringify(sa);

  eq(serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT_KEY: raw }), sa, 'raw JSON is accepted, as api/_lib/firebaseAdmin.js accepts it');
  eq(serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT_KEY: Buffer.from(raw).toString('base64') }), sa, 'and so is base64 of it');
  // The staged workflow's secret name, so activating it needs no second secret.
  eq(serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT: raw }), sa, "the workflow's FIREBASE_SERVICE_ACCOUNT name works too");
  eq(serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT_KEY: `  ${raw}  ` }), sa, 'surrounding whitespace is tolerated');

  eq(serviceAccountFrom({}), null, 'nothing configured reads as null, for the caller to judge');
  eq(serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT_KEY: '   ' }), null, 'and so does an empty variable');

  // A half-filled credential must not reach the token endpoint as an
  // opaque failure — it is a configuration mistake with a clear name.
  throws(() => serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT_KEY: '{"client_email":"a@b.c"}' }), 'a key with no private_key is rejected by name');
  throws(() => serviceAccountFrom({ FIREBASE_SERVICE_ACCOUNT_KEY: '{"private_key":"x"}' }), 'and so is one with no client_email');
}

// --- the assertion -------------------------------------------------------
{
  const sa = { client_email: 'sa@tracker-3161a.iam.gserviceaccount.com', private_key: 'x' };
  const claims = jwtClaims(sa, 1_770_000_000);
  eq(claims.iss, sa.client_email, 'the assertion is issued by the service account');
  eq(claims.aud, 'https://oauth2.googleapis.com/token', 'and addressed to the token endpoint');
  eq(claims.exp - claims.iat, 3600, 'with the hour of life Google allows');
  ok(claims.scope.includes('firebase'), 'it asks for the firebase scope');
  ok(claims.scope.includes('cloud-platform'), 'and cloud-platform, so the release does not hinge on which one the API lists');
}

// --- saying what went wrong ---------------------------------------------
{
  // The failure most likely to be hit first: the credential exists (the
  // API routes use it) but was never granted the rules role.
  const denied = describeApiError(403, '{"error":{"message":"Permission denied"}}', 'tracker-3161a');
  ok(denied.includes('roles/firebaserules.admin'), 'a 403 names the exact role to grant');
  ok(denied.includes('tracker-3161a'), 'and the project to grant it on');

  // This API reports a missing permission as 404, which reads as a typo
  // in the path unless it is spelled out.
  const missing = describeApiError(404, 'Not Found', 'tracker-3161a');
  ok(missing.includes('roles/firebaserules.admin'), 'a 404 gets the same advice, since that is how this API reports a missing permission');
  ok(missing.includes('404 rather than 403'), 'and says so, so it is not read as a bad path');

  const broken = describeApiError(400, 'L4:56 Unexpected \';\'.', 'tracker-3161a');
  ok(broken.includes('did not compile'), 'a 400 is reported as a rules file that does not compile');
  ok(broken.includes('L4:56'), 'and keeps the diagnostics, which are the whole message');

  ok(describeApiError(500, 'boom', 'tracker-3161a').includes('500'), 'anything else still reports its status and body');
}

// --- finding a credential that is already on disk ------------------------
{
  const env = parseEnvFile([
    '# a comment',
    '',
    'FIREBASE_SERVICE_ACCOUNT_KEY=eyJhIjoxfQ==',
    'QUOTED="value"',
    "SINGLE='value'",
    'WITH_EQUALS=a=b=c',
    'not a pair',
  ].join('\n'));
  eq(env.FIREBASE_SERVICE_ACCOUNT_KEY, 'eyJhIjoxfQ==', 'a base64 credential is read out of .env');
  eq(env.QUOTED, 'value', 'double quotes are stripped');
  eq(env.SINGLE, 'value', 'and single quotes');
  eq(env.WITH_EQUALS, 'a=b=c', 'a value containing = survives intact');
  eq(env['# a comment'], undefined, 'comments are skipped');
  eq(Object.keys(env).length, 4, 'and lines that are not pairs are ignored');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
