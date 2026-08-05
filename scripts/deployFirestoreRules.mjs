// Publishes firestore.rules to the Firebase project.
//
// Why this exists: firestore.rules was the one part of the app nothing
// shipped. The Vercel build deploys the site and the API routes; the
// security rules were a `firebase deploy` someone had to remember, and
// forgetting it fails silently and late — the rules granting access to
// `callRecordings/{uid}/items` were written on 4 Aug 2026 and never
// released, so for a day the Call Recordings page denied every read and
// every write while looking, on a fresh load, like a user with no calls.
//
// A GitHub Actions workflow that does this is written and staged in
// .github/workflows-pending/, but it cannot be activated by an assistant:
// GitHub rejects writes to .github/workflows/ from a credential without
// the `workflow` scope, over git and over the contents API alike. So the
// release is hung off the one pipeline that does run on every merge —
// the production build — via the `prebuild` script in package.json.
//
// Two ways in:
//
//   npm run deploy:rules          release now, from a shell, and FAIL loudly
//   node …/deployFirestoreRules.mjs --build   the build hook (see below)
//
// --build differs in two ways that matter:
//
//   * It does nothing unless VERCEL_ENV is 'production'. A preview build
//     of an unmerged branch must never push that branch's rules over the
//     live ones — rules are a single global resource with no per-branch
//     equivalent of a preview URL.
//   * It never fails the build. A site that deploys with stale rules is
//     bad; a site that cannot deploy at all because a rules release was
//     refused is worse. Failures are logged in full and the build carries
//     on.
//
// Releasing is idempotent: the deployed ruleset's source is fetched and
// compared first, and an unchanged file is a no-op. That is not just
// tidiness — a project caps at 2500 rulesets, and a build hook that
// minted one per deploy would burn through them.
//
// No firebase-tools and no interactive login: this talks to the Firebase
// Rules REST API with a service-account JWT it signs itself. That keeps
// it to zero dependencies, which is what makes it safe to hang off a
// build — nothing to install, nothing to resolve.

import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// Firestore's ruleset is released under this fixed id. (Storage uses
// `firebase.storage`; there is no Firestore equivalent to choose.)
const RELEASE_ID = 'cloud.firestore';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RULES_API = 'https://firebaserules.googleapis.com/v1';

// Requesting both is free — a service account's JWT scope cannot grant
// anything its IAM roles don't already allow — and it means the release
// doesn't hinge on which of the two the API happens to list.
const SCOPES = [
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

// Every network call is bounded. An unbounded fetch in a `prebuild` is a
// hung deploy, which is the one failure mode worse than stale rules.
const TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------
// Pure helpers. Exported for scripts/deployFirestoreRules.test.mjs —
// everything below this line that touches the network or the disk is
// wrapped by main(), so the decisions can be tested without either.
// ---------------------------------------------------------------------

/**
 * Which Firebase project to release to, read from .firebaserc rather
 * than hard-coded: the staged workflow hard-codes `tracker-3161a`, and
 * two copies of a project id drift the day one of them is changed.
 */
export function projectIdFrom(firebaserc) {
  const id = firebaserc?.projects?.default;
  return typeof id === 'string' && id.trim() ? id.trim() : '';
}

/**
 * Where the rules live, read from firebase.json so this script and the
 * `firebase deploy` a human might run by hand can never disagree about
 * which file is the source of truth.
 */
export function rulesPathFrom(firebaseJson) {
  const p = firebaseJson?.firestore?.rules;
  return typeof p === 'string' && p.trim() ? p.trim() : 'firestore.rules';
}

/**
 * The service-account JSON, from the environment.
 *
 * Accepts raw JSON or base64 of it, matching api/_lib/firebaseAdmin.js —
 * the same credential already configured for the API routes is the one
 * this uses, so there is nothing new to set up for the build hook.
 *
 * FIREBASE_SERVICE_ACCOUNT_KEY is the app's name for it;
 * FIREBASE_SERVICE_ACCOUNT is the name the staged workflow expects, and
 * is accepted so that activating the workflow later needs no second
 * secret.
 *
 * Returns null when nothing is configured — the caller decides whether
 * that is fatal, because it is on a manual run and isn't on a build.
 */
export function serviceAccountFrom(env = {}) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY || env.FIREBASE_SERVICE_ACCOUNT || '';
  const text = String(raw).trim();
  if (!text) return null;
  const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  if (!parsed?.client_email || !parsed?.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key.');
  }
  return parsed;
}

/**
 * Whether the ruleset already deployed is the file on disk.
 *
 * Matches on the file NAME first and falls back to a lone file under a
 * different name — the CLI, this script, and the console can each name
 * the uploaded file differently, and a name mismatch is not a reason to
 * mint a redundant ruleset.
 */
export function sameSource(deployedFiles, name, content) {
  const files = Array.isArray(deployedFiles) ? deployedFiles : [];
  const match = files.find(f => f?.name === name) || (files.length === 1 ? files[0] : null);
  return !!match && String(match.content) === String(content);
}

/** The signed-JWT claims used to mint an access token. */
export function jwtClaims(serviceAccount, nowSec) {
  return {
    iss: serviceAccount.client_email,
    scope: SCOPES,
    aud: TOKEN_URL,
    iat: nowSec,
    // Google caps assertion lifetime at an hour.
    exp: nowSec + 3600,
  };
}

/**
 * A Rules API failure, in terms of what to do about it.
 *
 * The two that actually happen deserve better than their raw bodies: a
 * 403 means the credential exists but lacks the role (the fix is one IAM
 * grant, and saying which one saves a search), and a 400 is a rules file
 * that doesn't compile, where the diagnostics are the whole message.
 */
export function describeApiError(status, body, projectId) {
  const detail = typeof body === 'string' ? body.trim() : JSON.stringify(body);
  if (status === 403 || status === 404) {
    return `Firebase refused the request (HTTP ${status}). The service account needs the `
      + `"Firebase Rules Admin" role (roles/firebaserules.admin) on project ${projectId}. `
      + `Note that a missing permission on this API can come back as 404 rather than 403.\n${detail}`;
  }
  if (status === 400) {
    return `Firebase rejected the ruleset (HTTP 400) — it did not compile. The diagnostics below `
      + `give the line and column.\n${detail}`;
  }
  return `Firebase Rules API returned HTTP ${status}.\n${detail}`;
}

/**
 * KEY=value pairs out of a .env file, for a manual run.
 *
 * Vite loads .env for the app; plain Node does not, so without this
 * `npm run deploy:rules` would report "not configured" to someone whose
 * credential is sitting right there in the file. Deliberately minimal —
 * this is a convenience for one variable, not a dotenv replacement, so
 * it handles single-line values (base64, or JSON with escaped newlines)
 * and quietly ignores anything else.
 */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------
// The release itself.
// ---------------------------------------------------------------------

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signedAssertion(serviceAccount, nowSec) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify(jwtClaims(serviceAccount, nowSec)));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(serviceAccount.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

async function accessToken(serviceAccount) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: signedAssertion(serviceAccount, Math.floor(Date.now() / 1000)),
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Could not exchange the service-account key for an access token (HTTP ${res.status}).\n${text}`);
  }
  const token = JSON.parse(text)?.access_token;
  if (!token) throw new Error('The token endpoint returned no access_token.');
  return token;
}

async function api(token, path, { method = 'GET', body, projectId } = {}) {
  const res = await fetch(`${RULES_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(describeApiError(res.status, text, projectId));
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

/**
 * The ruleset currently released, or null when there is no release yet
 * (a project whose rules have never been deployed). A 404 here is the
 * ordinary "nothing released" answer as well as a possible permission
 * error; either way the next step — creating a ruleset — resolves the
 * ambiguity with a clearer failure.
 */
async function currentRulesetName(token, projectId) {
  try {
    const release = await api(token, `projects/${projectId}/releases/${RELEASE_ID}`, { projectId });
    return release?.rulesetName || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function deployedSource(token, rulesetName, projectId) {
  const ruleset = await api(token, rulesetName, { projectId });
  return ruleset?.source?.files || [];
}

async function createRuleset(token, projectId, name, content) {
  const created = await api(token, `projects/${projectId}/rulesets`, {
    method: 'POST',
    projectId,
    body: { source: { files: [{ name, content }] } },
  });
  if (!created?.name) throw new Error('Firebase created a ruleset but returned no name for it.');
  return created.name;
}

async function release(token, projectId, rulesetName, hasRelease) {
  const name = `projects/${projectId}/releases/${RELEASE_ID}`;
  if (hasRelease) {
    await api(token, name, { method: 'PATCH', projectId, body: { release: { name, rulesetName } } });
    return;
  }
  await api(token, `projects/${projectId}/releases`, {
    method: 'POST',
    projectId,
    body: { name, rulesetName },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Environment plus, on a manual run, whatever .env has to add. */
function environment() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return process.env;
  try {
    return { ...parseEnvFile(readFileSync(envPath, 'utf8')), ...process.env };
  } catch {
    return process.env;
  }
}

async function deployRules(log) {
  const projectId = projectIdFrom(readJson(resolve(ROOT, '.firebaserc')));
  if (!projectId) throw new Error('No default project in .firebaserc.');

  const rulesPath = rulesPathFrom(readJson(resolve(ROOT, 'firebase.json')));
  const content = readFileSync(resolve(ROOT, rulesPath), 'utf8');
  const fileName = basename(rulesPath);

  const serviceAccount = serviceAccountFrom(environment());
  if (!serviceAccount) {
    throw new Error(
      'No service-account credential. Set FIREBASE_SERVICE_ACCOUNT_KEY to the JSON key '
      + '(raw or base64) of a service account holding the "Firebase Rules Admin" role '
      + `(roles/firebaserules.admin) on project ${projectId}.`,
    );
  }

  const token = await accessToken(serviceAccount);

  const existing = await currentRulesetName(token, projectId);
  if (existing) {
    const files = await deployedSource(token, existing, projectId);
    if (sameSource(files, fileName, content)) {
      log(`already up to date on ${projectId} (${existing.split('/').pop()}) — nothing to release.`);
      return;
    }
  }

  const rulesetName = await createRuleset(token, projectId, fileName, content);
  await release(token, projectId, rulesetName, !!existing);
  log(`released ${rulesPath} to ${projectId} as ${rulesetName.split('/').pop()}.`);
}

async function main() {
  const buildHook = process.argv.includes('--build');
  const say = (message) => console.log(`firestore rules: ${message}`);

  if (buildHook && process.env.VERCEL_ENV !== 'production') {
    // Silent on a local build; a one-liner on a preview, where seeing
    // "skipped" is the reassurance that a branch cannot overwrite the
    // live rules.
    if (process.env.VERCEL_ENV) say(`skipped — VERCEL_ENV is "${process.env.VERCEL_ENV}", not production.`);
    return;
  }

  try {
    await deployRules(say);
  } catch (err) {
    const message = err?.message || String(err);
    if (buildHook) {
      // Loud, but not fatal. Vercel shows this in the build log, and the
      // app still deploys — with rules that may now be behind git, which
      // the Call Recordings page will say for itself if they are.
      console.warn(`\nfirestore rules: NOT RELEASED — the deployed rules may be behind git.\n${message}\n`);
      return;
    }
    console.error(`firestore rules: ${message}`);
    process.exitCode = 1;
  }
}

// Only when run directly, so the test file can import the helpers above
// without a release being attempted.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
